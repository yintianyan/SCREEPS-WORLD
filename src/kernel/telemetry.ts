import type { Budget } from "./contracts";
import { CONFIG } from "../config";
import { globalCache } from "./global-cache";
import { getActionCpuSnapshot } from "./safe-run";

/** 在 global 中初始化单 tick 遥测对象。 */
export function initTelemetry(tick: number): void {
  const g = globalCache();
  g.telemetry = {
    tick,
    systemCpu: {},
    roleCpu: {},
    skipped: 0,
    errors: 0,
  };
  // 初始化 per-tick 事件缓冲区 — 任意系统可通过 recordEvent() 写入，
  // telemetry-collector 在 tick 末尾 flush 到 segment 2。
  if (!g.eventBuffer) {
    g.eventBuffer = { events: [] };
  } else {
    // 上一 tick 的残留事件（如果 telemetry-collector 未运行，如 recovery tier）
    // 保留最多 50 条，防止无限增长。正常情况下 collector 每 10 tick flush。
    if (g.eventBuffer.events.length > 50) {
      g.eventBuffer.events = g.eventBuffer.events.slice(-50);
    }
  }
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
          parts.push(`  ${key}=${entry.totalCpu.toFixed(2)}(×${entry.count},max=${entry.maxCpu.toFixed(2)})`);
        }
      }
    }
  }

  if (totalCpu > budget.softLimit * 0.8 || t.errors > 0) {
    console.log(parts.join(" "));
  }
}


