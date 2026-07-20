import { CONFIG } from "../config";
import { globalCache } from "./global-cache";

/** 如果此 label 在限频窗口内已记录过日志则返回 true。 */
function shouldSuppress(label: string, tick: number): boolean {
  const g = globalCache();
  if (!g.errorLog) g.errorLog = new Map();
  const last = g.errorLog.get(label);
  if (last !== undefined && tick - last < CONFIG.kernel.errorLogInterval) return true;
  g.errorLog.set(label, tick);
  return false;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

/**
 * 系统和 creep 角色的错误边界。
 * 一个错误不能终止剩余 tick。相同错误按频率限流以避免日志刷屏
 * （默认：每个 label 每 25 tick 最多输出一次）。
 *
 * 非关键插件连续失败 3 次以上将被冷却 50-200 tick。
 * 关键（P0）插件不会被冷却 — 只有日志限流。
 */
export function safeRun(label: string, action: () => void, critical = false): void {
  const g = globalCache();

  // 检查非关键 label 的冷却状态。
  if (!critical) {
    if (!g.pluginCooldowns) g.pluginCooldowns = new Map();
    const cooldown = g.pluginCooldowns.get(label);
    if (cooldown !== undefined && Game.time < cooldown) return;
  }

  try {
    action();
    // 成功时重置错误计数。
    if (g.errorCounts) g.errorCounts.delete(label);
  } catch (error) {
    if (CONFIG.kernel.logErrors && !shouldSuppress(label, Game.time)) {
      console.log(`[${Game.time}] ${label}: ${formatError(error)}`);
    }
    recordError();

    // 跟踪连续错误并为非关键插件设置冷却。
    if (!critical) {
      if (!g.errorCounts) g.errorCounts = new Map();
      const count = (g.errorCounts.get(label) ?? 0) + 1;
      g.errorCounts.set(label, count);

      if (count >= 3) {
        if (!g.pluginCooldowns) g.pluginCooldowns = new Map();
        const cooldownTicks = Math.min(50 + count * 10, 200);
        g.pluginCooldowns.set(label, Game.time + cooldownTicks);
        g.errorCounts.set(label, 0); // 进入冷却后重置计数。
      }
    }
  }
}

/** 执行操作并测量其 CPU 消耗用于遥测。 */
export function measuredRun(label: string, action: () => void): void {
  const before = Game.cpu.getUsed();
  try {
    action();
  } finally {
    const after = Game.cpu.getUsed();
    recordCpu(label, after - before);
  }
}

function recordError(): void {
  const g = globalCache();
  if (!g.telemetry || g.telemetry.tick !== Game.time) return;
  g.telemetry.errors++;
}

function recordCpu(label: string, cost: number): void {
  const g = globalCache();
  if (!g.telemetry || g.telemetry.tick !== Game.time) return;
  if (label.startsWith("system/")) {
    const name = label.slice("system/".length);
    g.telemetry.systemCpu[name] = (g.telemetry.systemCpu[name] ?? 0) + cost;
  } else if (label.startsWith("creep/")) {
    const parts = label.split("/");
    const role = parts[2] ?? "unknown";
    g.telemetry.roleCpu[role] = (g.telemetry.roleCpu[role] ?? 0) + cost;
  }
}
