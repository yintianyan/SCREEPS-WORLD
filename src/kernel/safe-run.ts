import { CONFIG } from "../config";
import { globalCache, type ActionCpuEntry } from "./global-cache";
import { recordSkip } from "./memory";
import { EventKind, recordEvent } from "./event-log";

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

/** 检查非关键 label 是否处于冷却期。
 * K-2a：冷却跳过必须记 skipReason（plan §3.2「不能静默丢失」）—
 * 原实现静默 return，被冷却的 P1 系统在遥测中完全不可见。 */
function isCoolingDown(label: string, critical: boolean): boolean {
  if (critical) return false;
  const g = globalCache();
  if (!g.pluginCooldowns) g.pluginCooldowns = new Map();
  const cooldown = g.pluginCooldowns.get(label);
  const cooling = cooldown !== undefined && Game.time < cooldown;
  if (cooling) recordSkip(`${label}/cooldown`);
  return cooling;
}

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
      // K-2b：计数不清零 — 冷却期满后再失败从上次计数继续递增，
      // 冷却时长 80→90→…→200 真递增（plan §3.3「50 至 200 tick」）。
      // 原实现进冷却即清零 → 每轮从 3 重新触发，时长恒为 80（死代码）。
      // 成功一次仍由 resetErrorCount 归零（自愈路径不变）。
      const cooldownTicks = Math.min(50 + count * 10, 200);
      g.pluginCooldowns.set(label, Game.time + cooldownTicks);
      // K-2c：冷却是插件被禁用的帝国级事件 — 写入事件日志（此前
      // EventKind.PluginCooldown 枚举存在但从未被记录，观测链断）。
      recordEvent(EventKind.PluginCooldown, label, [cooldownTicks]);
    }
  }
}

// ──────────────────────────────────────────────
// 公共 API
// ──────────────────────────────────────────────

/** 系统和 creep 角色的错误边界：一个错误不能终止剩余 tick。
 * 相同错误按频率限流避免日志刷屏（默认每 label 每 25 tick 一次）。
 * 非关键插件连续失败 3 次以上冷却 50-200 tick；关键（P0）插件只限流不冷却。 */
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

/** 记录 Action 级 CPU profiling 数据（仅当 CONFIG.debug.actionProfiling 为 true 时调用 —
 * 调用方负责门禁）。key 格式："roleName/actionName/resolve|execute" | "roleName/onFlee"。
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
