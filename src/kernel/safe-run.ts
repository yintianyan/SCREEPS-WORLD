import { CONFIG } from "../config";
import { globalCache, type ActionCpuEntry } from "./global-cache";

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

// ──────────────────────────────────────────────
// 共享的错误处理逻辑 — safeRun 和 safeRunBuild 共用
// ──────────────────────────────────────────────

/** 检查非关键 label 是否处于冷却期。 */
function isCoolingDown(label: string, critical: boolean): boolean {
  if (critical) return false;
  const g = globalCache();
  if (!g.pluginCooldowns) g.pluginCooldowns = new Map();
  const cooldown = g.pluginCooldowns.get(label);
  return cooldown !== undefined && Game.time < cooldown;
}

/** 成功时重置错误计数。 */
function resetErrorCount(label: string): void {
  const g = globalCache();
  if (g.errorCounts) g.errorCounts.delete(label);
}

/** 处理错误：限频日志、遥测计数、非关键插件冷却。 */
function handleError(label: string, error: unknown, critical: boolean): void {
  const g = globalCache();

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

// ──────────────────────────────────────────────
// 公共 API
// ──────────────────────────────────────────────

/**
 * 系统和 creep 角色的错误边界。
 * 一个错误不能终止剩余 tick。相同错误按频率限流以避免日志刷屏
 * （默认：每个 label 每 25 tick 最多输出一次）。
 *
 * 非关键插件连续失败 3 次以上将被冷却 50-200 tick。
 * 关键（P0）插件不会被冷却 — 只有日志限流。
 */
export function safeRun(label: string, action: () => void, critical = false): void {
  if (isCoolingDown(label, critical)) return;
  try {
    action();
    resetErrorCount(label);
  } catch (error) {
    handleError(label, error, critical);
  }
}

/** safeRun 的返回值变体 — 用于构建快照等需要返回值的场景。 */
export function safeRunBuild<T>(label: string, factory: () => T, critical = false): T | undefined {
  if (isCoolingDown(label, critical)) return undefined;
  try {
    const result = factory();
    resetErrorCount(label);
    return result;
  } catch (error) {
    handleError(label, error, critical);
    return undefined;
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

/**
 * 记录 Action 级 CPU profiling 数据。
 * 仅当 CONFIG.debug.actionProfiling 为 true 时调用 — 调用方负责门禁。
 * key 格式："roleName/actionName/resolve" | "roleName/actionName/execute" | "roleName/onFlee"。
 * 按 tick 惰性重置 Map。 */
export function recordActionCpu(key: string, cost: number): void {
  const g = globalCache();
  if (!g.actionCpu || g.actionCpuTick !== Game.time) {
    g.actionCpu = new Map();
    g.actionCpuTick = Game.time;
  }
  const entry = g.actionCpu.get(key);
  if (entry) {
    entry.count++;
    entry.totalCpu += cost;
    if (cost > entry.maxCpu) entry.maxCpu = cost;
  } else {
    g.actionCpu.set(key, { count: 1, totalCpu: cost, maxCpu: cost });
  }
}

/** 获取当前 tick 的 action profiling 数据（按 totalCpu 降序排序）。 */
export function getActionCpuSnapshot(): ReadonlyMap<string, ActionCpuEntry> | undefined {
  const g = globalCache();
  if (!g.actionCpu || g.actionCpuTick !== Game.time) return undefined;
  return g.actionCpu;
}
