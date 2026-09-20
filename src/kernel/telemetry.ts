import type { Budget } from "./contracts";
import { CONFIG } from "../config";
import { globalCache } from "./global-cache";
import { getActionCpuSnapshot } from "./safe-run";
import { log } from "./log";

/** 在 global 中初始化单 tick 遥测对象。 */
export function initTelemetry(tick: number): void {
  const g = globalCache();
  g.telemetry = {
    tick,
    systemCpu: {},
    roleCpu: {},
    skipped: 0,
    errors: 0,
    intents: {},
  };
  // 初始化 per-room CPU 记账 Map — kernel.runCreeps 逐只 creep 写入。
  g.cpuByHome = new Map<string, number>();
  // 初始化 per-tick 事件缓冲区 — 任意系统可通过 recordEvent() 写入，
  // telemetry-collector 在 tick 末尾 flush 到 segment 2。
  if (!g.eventBuffer) {
    g.eventBuffer = { events: [] };
  } else {
    // 上一 tick 的残留事件（如果 telemetry-collector 未运行，如 recovery tier）
    // 保留最多 200 条，防止无限增长。正常情况下 collector 每 10 tick flush。
    // Recovery tier 下 collector 每 100 tick 才 drain，200 条容量容纳 100 tick 的高频事件。
    if (g.eventBuffer.events.length > 200) {
      g.eventBuffer.events = g.eventBuffer.events.slice(-200);
    }
  }
}

/**
 * 记录一次引擎意图签发，按类别与返回码分桶。
 *
 * 依据实测：一次意图首次签发 0.15 CPU（沙箱）～0.23 CPU（`resolveTraffic` 实签，见
 * E2E-029 的 `move_B_firstIssue` / `tmPerMove`），而一次 `find()` ≈0.0003 —— 整 tick
 * 的成本几乎就是「签发了几次意图」。因此签发次数与各
 * 类别的无效率（tired/busy/refused = 花了 CPU 却没产出）必须常驻可见。
 * telemetry 未初始化（tick 首段之前、或异常环境）时静默跳过，绝不因记账拖垮主循环。
 */
export function recordIntent(kind: string, result: number): void {
  const t = globalCache().telemetry;
  if (!t) return;
  let bucket = t.intents[kind];
  if (!bucket) bucket = t.intents[kind] = { ok: 0, codes: {} };
  if (result === OK) {
    bucket.ok += 1;
    return;
  }
  bucket.codes[result] = (bucket.codes[result] ?? 0) + 1;
}

/** 输出轻量的 tick 末尾摘要。仅在有值得关注的内容时才记录日志。 */
export function emitSummary(budget: Budget): void {
  const g = globalCache();
  if (!g.telemetry) return;
  const t = g.telemetry;
  const totalCpu = Game.cpu.getUsed();
  const bucket = Game.cpu.bucket ?? 0;

  const topSystems = Object.entries(t.systemCpu)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const parts: string[] = [
    `[${t.tick}] tier=${budget.tier} cpu=${totalCpu.toFixed(1)} bucket=${bucket}`,
  ];
  if (t.errors > 0) parts.push(`errors=${t.errors}`);
  if (t.skipped > 0) parts.push(`skipped=${t.skipped}`);
  // 引擎意图签发是本项目最贵的单点开销（首次签发实测 0.15–0.23 CPU/次），与 top 系统
  // 同级呈现；括号内是各非 OK 返回码 × 次数 —— 返回码语义不同，必须分开看。
  for (const [kind, b] of Object.entries(t.intents)) {
    const errs = Object.entries(b.codes)
      .map(([code, n]) => `${code}x${n}`)
      .join(" ");
    const issued = b.ok + Object.values(b.codes).reduce((a, n) => a + n, 0);
    parts.push(`${kind}=${b.ok}/${issued}${errs ? `(${errs})` : ""}`);
  }
  for (const [name, cpu] of topSystems) {
    parts.push(`${name}=${cpu.toFixed(1)}`);
  }

  // actionProfiling 开启时输出 top 5 action 热点；仅 CPU 偏高或有错误时输出，避免刷屏。
  if (CONFIG.debug.actionProfiling) {
    const actionData = getActionCpuSnapshot();
    if (actionData && actionData.size > 0) {
      const topActions = [...actionData.entries()]
        .sort((a, b) => b[1].totalCpu - a[1].totalCpu)
        .slice(0, 5);
      if (topActions.length > 0) {
        parts.push("topActions:");
        for (const [key, entry] of topActions) {
          parts.push(
            `  ${key}=${entry.totalCpu.toFixed(2)}(×${entry.count},max=${entry.maxCpu.toFixed(2)})`,
          );
        }
      }
    }
  }

  if (totalCpu > budget.softLimit * 0.8 || t.errors > 0) {
    log.info("telemetry", parts.join(" "));
  }
}
