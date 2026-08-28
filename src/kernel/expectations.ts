/** 期望自检 — 帝国的「自我体感」：对运行时序不变式做周期性断言。 */
import type { EventKind } from "./event-log";

/** 遥测新鲜度阈值（采样间隔 10t，500t ≈ 50 个采样周期仍无更新即判停摆）。 */
export const TELEMETRY_STALE_TICKS = 500;
/** P3 存活宽限倍数（相对名义 interval）。 */
export const P3_GRACE_MULTIPLIER = 3;
/** boot 宽限：reset 后系统尚未各跑一遍的容忍窗。 */
export const P3_BOOT_GRACE_TICKS = 1500;
/** 饥饿旁路窗口时长（每次违例续期；软/硬上限不受旁路影响）。 */
export const P3_BYPASS_WINDOW_TICKS = 1200;

// ── E3: spawn queue 持续非空 ────────────────────────────────
/** spawn queue 持续非空触发违例的 tick 阈值。 */
export const E3_QUEUE_STALE_TICKS = 2000;
/** 违例记录限流间隔（避免每 tick 写入 Memory）。 */
export const E3_RECORD_INTERVAL = 100;
/** 违例恢复后清除标记所需的连续空队列 tick 数（滞回防抖动）。 */
export const E3_RECOVERY_TICKS = 50;

export interface ExpectationViolation {
  id: string;
  detail: string;
}

export interface ExpectationResult {
  violations: ExpectationViolation[];
  /** 任一 P3 系统存活违例 → true（调用方设置旁路与事件）。 */
  p3Starved: boolean;
}

// ── E4: Memory 增长检测 ────────────────────────────────────────
/** Memory 体积采样间隔（tick）。 */
export const E4_SAMPLE_INTERVAL = 500;
/** 历史采样窗口大小（保留多少个采样点）。 */
export const E4_HISTORY_SIZE = 20;
/** 环比增长阈值（%）。 */
export const E4_GROWTH_THRESHOLD_PCT = 50;
/** 线性增长斜率阈值（bytes/sample）。 */
export const E4_SLOPE_THRESHOLD = 200;

export interface MemorySizeSample {
  tick: number;
  bytes: number;
  /** 采样时的房间数（用于区分合理增长与泄漏）。 */
  roomCount: number;
}

// ── E5: RCL 长期不增长 ────────────────────────────────────────
/** RCL 无增长触发违例的 tick 阈值。 */
export const E5_STALE_TICKS = 10000;

export interface RCLSnapshot {
  room: string;
  rcl: number;
  progress: number;
  progressTotal: number;
  /** 最近一次 RCL 变化的 tick；undefined = 尚无观测基准（跳过检测）。 */
  lastRclChange?: number;
  /** 是否有 upgrader 角色存活。 */
  hasUpgrader: boolean;
  /** storage 能量储备。 */
  storageEnergy: number;
}

// ── E6: buildQueue 持续非空 ──────────────────────────────────
/** buildQueue 持续非空触发违例的 tick 阈值。 */
export const E6_STALE_TICKS = 5000;

export interface BuildQueueSnapshot {
  room: string;
  queueLength: number;
  /** 队首任务创建 tick。 */
  oldestTaskTick?: number;
  /** 队首任务类型。 */
  oldestTaskType?: string;
  /** 当前 RCL（判断是否因 RCL 未解锁）。 */
  rcl?: number;
  /** builder 数量。 */
  builderCount: number;
  /** colonyState。 */
  colonyState?: string;
}

// ── E7: site 长期无进度 ──────────────────────────────────────
/** site 无进度触发违例的 tick 阈值。 */
export const E7_STALE_TICKS = 2000;

export interface SiteProgressSnapshot {
  room: string;
  /** site ID 或位置标识。 */
  siteId: string;
  /** 结构类型。 */
  structureType: string;
  progress: number;
  progressTotal: number;
  /** 最近一次进度变化的 tick。 */
  lastProgressTick: number;
  /** builder 到达次数（采样窗口内）。 */
  builderVisits: number;
  /** site 年龄（tick）。 */
  siteAge: number;
}

// ── E8: 关键路径持续失败 ─────────────────────────────────────
/** 关键路径连续失败触发违例的 tick 阈值。 */
export const E8_STALE_TICKS = 2000;

export interface PathFailureSnapshot {
  room: string;
  /** 路径标识（如 "source→container"）。 */
  pathId: string;
  /** 最近成功 tick。 */
  lastSuccessTick: number;
  /** 连续失败次数。 */
  consecutiveFailures: number;
}

// ── E9: recovery 状态持续过久 ───────────────────────────────
/** recovery 持续触发违例的 tick 阈值。 */
export const E9_STALE_TICKS = 2000;

export interface RecoverySnapshot {
  room: string;
  /** colonyState。 */
  colonyState: string;
  /** recovery 开始 tick。 */
  recoveryStartTick: number;
  /** 缺失结构数。 */
  missingStructures: number;
  /** 缺失角色数。 */
  missingRoles: number;
  /** storage 能量。 */
  storageEnergy: number;
  /** spawnQueue 长度。 */
  spawnQueueLength: number;
  /** buildQueue 长度。 */
  buildQueueLength: number;
}

export interface P3SystemRef {
  name: string;
  interval?: number;
}

/** E3 输入：单房 spawn queue 快照。 */
export interface SpawnQueueSnapshot {
  room: string;
  queueLength: number;
  /** 队首请求的创建 tick（无请求时 undefined）。 */
  oldestRequestTick?: number;
  /** 队首请求的 key（用于跨 tick 追踪同一请求是否停滞）。 */
  oldestRequestKey?: string;
  /** 队首请求优先级。 */
  oldestPriority?: number;
  /** 队首请求角色。 */
  oldestRole?: string;
  /** 当前房 RCL。 */
  rcl?: number;
  /** 当前可用能量。 */
  energyAvailable?: number;
  /** 当前 spawn 状态：是否有正在孵化的 creep。 */
  spawning: boolean;
  /** colonyState（区分 recovery/bootstrap 正常排队）。 */
  colonyState?: string;
}

/** E3 违例持久化记录（存 Memory.kernel.expectations.e3）。 */
export interface E3ViolationRecord {
  room: string;
  queueLength: number;
  oldestRequestKey?: string;
  oldestPriority?: number;
  oldestRole?: string;
  rcl?: number;
  energyAvailable?: number;
  spawning: boolean;
  colonyState?: string;
  /** 违例开始 tick。 */
  violationStartTick: number;
  /** 最近一次记录 tick。 */
  lastRecordedTick: number;
  /** 最近一次恢复 tick（0 = 未恢复）。 */
  recoveryTick: number;
  /** 空队列连续 tick 数（用于滞回恢复判定）。 */
  emptyStreak: number;
}

export function evaluateExpectations(input: {
  tick: number;
  bootTick?: number;
  statsLastSample?: number;
  systemLastRun: Readonly<Record<string, number>>;
  p3Systems: readonly P3SystemRef[];
  /** E3: spawn queue 快照列表（每房一条）。 */
  spawnQueues?: readonly SpawnQueueSnapshot[];
  /** E3: 上一 tick 的违例记录（从 Memory 传入，用于滞回计算）。 */
  e3Prev?: Record<string, E3ViolationRecord>;
  /** E4: Memory 体积历史采样。 */
  memoryHistory?: readonly MemorySizeSample[];
  /** E5: RCL 快照列表（每房一条）。 */
  rclSnapshots?: readonly RCLSnapshot[];
  /** E6: buildQueue 快照列表（每房一条）。 */
  buildQueues?: readonly BuildQueueSnapshot[];
  /** E7: site 进度快照列表。 */
  siteProgresses?: readonly SiteProgressSnapshot[];
  /** E8: 路径失败快照列表。 */
  pathFailures?: readonly PathFailureSnapshot[];
  /** E9: recovery 状态快照列表（每房一条）。 */
  recoverySnapshots?: readonly RecoverySnapshot[];
}): ExpectationResult {
  const violations: ExpectationViolation[] = [];
  let p3Starved = false;

  const bootAge = input.tick - (input.bootTick ?? -Infinity);

  // E1 遥测新鲜度。
  const sampleAge = input.statsLastSample !== undefined
    ? input.tick - input.statsLastSample
    : Infinity;
  if (sampleAge > TELEMETRY_STALE_TICKS) {
    violations.push({
      id: "telemetryStale",
      detail: "lastSample age=" + (Number.isFinite(sampleAge) ? sampleAge : "never"),
    });
  }

  // E2 P3 存活（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS) {
    for (const s of input.p3Systems) {
      const interval = Math.max(s.interval ?? 1, 1);
      const grace = interval * P3_GRACE_MULTIPLIER + P3_BOOT_GRACE_TICKS;
      const last = input.systemLastRun[s.name];
      const age = last === undefined ? Infinity : input.tick - last;
      if (age > grace) {
        violations.push({
          id: "p3Starved:" + s.name,
          detail: "age=" + (Number.isFinite(age) ? age : "never") + " grace=" + grace,
        });
        p3Starved = true;
      }
    }
  }

  // E3 spawn queue 持续非空（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS && input.spawnQueues && input.e3Prev) {
    for (const sq of input.spawnQueues) {
      const prev = input.e3Prev[sq.room];

      // 区分正常排队与真正饥饿：
      // - recovery/bootstrap colonyState 下的排队是预期行为，不触发 E3
      // - spawning=true 且 queueLength<=spawning 数量是正常孵化中
      // - 只有 queueLength > 0 且队首请求长期未进入孵化才违例
      const isNormalColonyState = sq.colonyState === "recovery" || sq.colonyState === "bootstrap";
      if (isNormalColonyState) continue;

      if (sq.queueLength > 0 && sq.oldestRequestTick !== undefined) {
        const oldestAge = input.tick - sq.oldestRequestTick;
        // 队首请求年龄超过阈值 → 潜在饥饿
        if (oldestAge > E3_QUEUE_STALE_TICKS) {
          const existing = prev;
          if (existing) {
            // 已有违例记录 — 更新 lastRecordedTick（限流）
            const sinceLastRecord = input.tick - existing.lastRecordedTick;
            if (sinceLastRecord >= E3_RECORD_INTERVAL) {
              existing.lastRecordedTick = input.tick;
              existing.queueLength = sq.queueLength;
              existing.oldestRequestKey = sq.oldestRequestKey;
              existing.oldestPriority = sq.oldestPriority;
              existing.oldestRole = sq.oldestRole;
              existing.rcl = sq.rcl;
              existing.energyAvailable = sq.energyAvailable;
              existing.spawning = sq.spawning;
              existing.colonyState = sq.colonyState;
              existing.emptyStreak = 0;
            }
            // 违例持续中
            violations.push({
              id: "spawnQueueStale:" + sq.room,
              detail: "queue=" + sq.queueLength + " oldestAge=" + oldestAge +
                " key=" + (sq.oldestRequestKey ?? "?") +
                " role=" + (sq.oldestRole ?? "?") +
                " pri=" + (sq.oldestPriority ?? "?") +
                " rcl=" + (sq.rcl ?? "?") +
                " e=" + (sq.energyAvailable ?? "?") +
                " spawn=" + sq.spawning +
                " dur=" + (input.tick - existing.violationStartTick),
            });
          } else {
            // 新违例
            input.e3Prev[sq.room] = {
              room: sq.room,
              queueLength: sq.queueLength,
              oldestRequestKey: sq.oldestRequestKey,
              oldestPriority: sq.oldestPriority,
              oldestRole: sq.oldestRole,
              rcl: sq.rcl,
              energyAvailable: sq.energyAvailable,
              spawning: sq.spawning,
              colonyState: sq.colonyState,
              violationStartTick: input.tick,
              lastRecordedTick: input.tick,
              recoveryTick: 0,
              emptyStreak: 0,
            };
            violations.push({
              id: "spawnQueueStale:" + sq.room,
              detail: "queue=" + sq.queueLength + " oldestAge=" + oldestAge +
                " key=" + (sq.oldestRequestKey ?? "?") +
                " role=" + (sq.oldestRole ?? "?") +
                " pri=" + (sq.oldestPriority ?? "?"),
            });
          }
        }
      } else if (sq.queueLength === 0) {
        // 队列为空 — 检查是否正在恢复
        const existing = prev;
        if (existing && existing.recoveryTick === 0) {
          existing.emptyStreak = (existing.emptyStreak ?? 0) + 1;
          if (existing.emptyStreak >= E3_RECOVERY_TICKS) {
            existing.recoveryTick = input.tick;
          }
        }
      } else {
        // queueLength > 0 但 oldestRequestTick 未超阈值 — 重置 emptyStreak
        const existing = prev;
        if (existing) existing.emptyStreak = 0;
      }
    }

    // 清理已恢复超过 1000 tick 的记录（防 Memory 膨胀）
    for (const room of Object.keys(input.e3Prev)) {
      const rec = input.e3Prev[room]!;
      if (rec.recoveryTick > 0 && input.tick - rec.recoveryTick > 1000) {
        delete input.e3Prev[room];
      }
    }
  }

  // E4 Memory 增长检测（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS && input.memoryHistory && input.memoryHistory.length >= 3) {
    const hist = input.memoryHistory;
    const latest = hist[hist.length - 1]!;
    const oldest = hist[0]!;
    // 环比增长：最近两个采样点之间
    if (hist.length >= 2) {
      const prev = hist[hist.length - 2]!;
      const growthPct = prev.bytes > 0 ? ((latest.bytes - prev.bytes) / prev.bytes) * 100 : 0;
      if (growthPct > E4_GROWTH_THRESHOLD_PCT) {
        // 误报保护：房间数增长导致的合理增长
        if (latest.roomCount <= prev.roomCount) {
          violations.push({
            id: "memoryGrowth:" + latest.roomCount,
            detail: "bytes=" + latest.bytes + " prev=" + prev.bytes + " growth=" + growthPct.toFixed(1) + "%",
          });
        }
      }
    }
    // 线性增长斜率：整个窗口
    if (hist.length >= 3) {
      const tickSpan = latest.tick - oldest.tick;
      if (tickSpan > 0) {
        const slope = (latest.bytes - oldest.bytes) / (tickSpan / E4_SAMPLE_INTERVAL);
        // 误报保护：房间数增长不视为泄漏
        const roomGrowth = latest.roomCount - oldest.roomCount;
        if (slope > E4_SLOPE_THRESHOLD && roomGrowth === 0) {
          violations.push({
            id: "memorySlope",
            detail: "slope=" + slope.toFixed(1) + " bytes/sample over " + tickSpan + " tick",
          });
        }
      }
    }
  }

  // E5 RCL 长期不增长（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS && input.rclSnapshots) {
    for (const rcl of input.rclSnapshots) {
      if (rcl.lastRclChange === undefined) continue;
      const rclAge = input.tick - rcl.lastRclChange;
      if (rclAge > E5_STALE_TICKS) {
        // 误报保护：RCL8 不需要增长（已满级）
        if (rcl.rcl < 8) {
          violations.push({
            id: "rclStale:" + rcl.room,
            detail: "rcl=" + rcl.rcl + " age=" + rclAge + " upgrader=" + rcl.hasUpgrader + " storage=" + rcl.storageEnergy,
          });
        }
      }
    }
  }

  // E6 buildQueue 持续非空（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS && input.buildQueues) {
    for (const bq of input.buildQueues) {
      if (bq.queueLength > 0 && bq.oldestTaskTick !== undefined) {
        const oldestAge = input.tick - bq.oldestTaskTick;
        if (oldestAge > E6_STALE_TICKS) {
          // 误报保护：recovery/bootstrap colonyState 下的排队是预期行为
          if (bq.colonyState !== "recovery" && bq.colonyState !== "bootstrap") {
            violations.push({
              id: "buildQueueStale:" + bq.room,
              detail: "queue=" + bq.queueLength + " oldestAge=" + oldestAge + " builder=" + bq.builderCount + " type=" + (bq.oldestTaskType ?? "?"),
            });
          }
        }
      }
    }
  }

  // E7 site 长期无进度（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS && input.siteProgresses) {
    for (const sp of input.siteProgresses) {
      const noProgressAge = input.tick - sp.lastProgressTick;
      if (noProgressAge > E7_STALE_TICKS && sp.builderVisits === 0) {
        violations.push({
          id: "siteStale:" + sp.room + ":" + sp.siteId,
          detail: "type=" + sp.structureType + " prog=" + sp.progress + "/" + sp.progressTotal + " age=" + sp.siteAge + " noProg=" + noProgressAge,
        });
      }
    }
  }

  // E8 关键路径持续失败（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS && input.pathFailures) {
    for (const pf of input.pathFailures) {
      const failAge = input.tick - pf.lastSuccessTick;
      if (failAge > E8_STALE_TICKS || pf.consecutiveFailures > 10) {
        violations.push({
          id: "pathFailure:" + pf.room + ":" + pf.pathId,
          detail: "failAge=" + failAge + " consec=" + pf.consecutiveFailures,
        });
      }
    }
  }

  // E9 recovery 状态持续过久（boot 宽限后生效）。
  if (bootAge >= P3_BOOT_GRACE_TICKS && input.recoverySnapshots) {
    for (const rec of input.recoverySnapshots) {
      if (rec.colonyState === "recovery") {
        const recoveryDuration = input.tick - rec.recoveryStartTick;
        if (recoveryDuration > E9_STALE_TICKS) {
          violations.push({
            id: "recoveryStale:" + rec.room,
            detail: "dur=" + recoveryDuration + " missStruct=" + rec.missingStructures + " missRole=" + rec.missingRoles + " storage=" + rec.storageEnergy,
          });
        }
      }
    }
  }

  return { violations, p3Starved };
}
