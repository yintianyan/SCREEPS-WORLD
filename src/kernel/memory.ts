/** Memory 生命周期 — 迁移执行、每 tick 维护、skip 遥测。迁移数据表见 ./migrations/。 */

import { CONFIG } from "../config";
import { globalCache } from "./global-cache";
import { EventKind, recordCreepDeath, recordEvent } from "./event-log";
import { log } from "./log";
import { MIGRATIONS } from "./migrations";

/**
 * 执行版本化迁移（K-5：与日常维护拆分为独立错误边界）。
 * 迁移中途 throw 不再连坐死 creep 清理/房间兜底 — 持续失败的迁移
 * 曾使 maintainMemory 后半段整 tick 跳过，Memory.creeps 慢性泄漏。
 */
export function runMigrations(): void {
  const current = Memory.schemaVersion ?? 0;
  if (current < CONFIG.memory.schemaVersion) migrateMemory(current);
  else if (current > CONFIG.memory.schemaVersion) {
    // 降版保护：代码回滚到旧 schema 而 Memory 已被新版迁移 —— 迁移链静默跳过
    // 会让旧代码跑在新结构上且无人知晓。无自动降级迁移（未实现），当前唯一
    // 选择是继续运行，但必须响亮可见；每次 global reset（模块重载）告警一次。
    if (!(globalThis as { __schemaDowngradeWarned?: boolean }).__schemaDowngradeWarned) {
      (globalThis as { __schemaDowngradeWarned?: boolean }).__schemaDowngradeWarned = true;
      log.warn(
        "memory",
        `[schema] WARNING: Memory.schemaVersion=${current} > code ${
          CONFIG.memory.schemaVersion
        } — rolled-back code running on newer schema; no downgrade migration exists.`,
      );
    }
  }
}

/** 维护 Memory：清理死亡 creep、初始化默认值、失守房宽限清理（迁移由 runMigrations 独立执行，见 K-5）。 */
export function maintainMemory(): void {
  Memory.creeps ??= {};
  Memory.rooms ??= {};
  Memory.kernel ??= {};
  // 本次 boot 的首个 tick（期望自检 E2 的相对宽限基准 —— reset 后系统需要
  // 数个 interval 才能各跑一遍，绝对 tick 判据会把正常的 post-reset 待跑
  // 误报为 P3 饥饿）。heap/global 均可：写 Memory 使跨 reset 语义稳定。
  if (Memory.kernel.bootTick === undefined) Memory.kernel.bootTick = Game.time;

  // 每 tick 清理死亡 creep memory（小帝国安全且廉价）；清理前记录死亡事件
  // （战斗黑匣子 M9 — 这是死亡的唯一系统性检测点）。
  // B3-F02 修复：recordCreepDeath 加 try/catch — 单个 creep 死亡记录异常
  // 不应连坐失守房清理等后续逻辑。catch 中仍执行 delete 防止死者 Memory 滞留。
  // deathAnchor 清理需要「存活角色集合」，与死亡清理共用同一次 Memory.creeps 遍历，
  // 避免每 tick 两次全量遍历 Memory（Memory 访问成本高）。
  // 循环前 deathAnchor 不存在 → 本 tick 新增的锚点必然新鲜、无需清理，集合可省。
  const activeRoles = Memory.kernel.stats?.deathAnchor ? new Set<string>() : undefined;

  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      try {
        recordCreepDeath(name);
      } catch {
        // recordCreepDeath 失败不阻塞清理 — 死者 Memory 仍需删除。
      }
      delete Memory.creeps[name];
      continue;
    }
    if (activeRoles) {
      const role = name.split("-")[0];
      if (role) activeRoles.add(role);
    }
  }

  const ownedRooms = new Set<string>();
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room || !room.controller?.my) continue;
    ownedRooms.add(roomName);
    if (!Memory.rooms[roomName]) {
      Memory.rooms[roomName] = { spawnQueue: [], buildQueue: [] };
    } else {
      const rm = Memory.rooms[roomName];
      rm.spawnQueue ??= [];
      rm.buildQueue ??= [];
    }
  }

  // 失守房清理：条目房不在拥有集合即为失守（自有房恒有视野）。
  // 宽限期防 claim 边界抖动误删布局与队列数据；到期后连同 tuning 覆盖
  // 一并清除，避免失守房数据永久滞留（慢性泄漏）。
  const LOST_ROOM_GRACE = 20000;
  Memory.kernel.lostRooms ??= {};
  const lostRooms = Memory.kernel.lostRooms;
  for (const roomName in Memory.rooms) {
    if (ownedRooms.has(roomName)) {
      if (lostRooms[roomName] !== undefined) delete lostRooms[roomName];
      continue;
    }
    const lostAt = (lostRooms[roomName] ??= Game.time);
    if (Game.time - lostAt > LOST_ROOM_GRACE) {
      recordLostRoomPurge(roomName, Game.time - lostAt);
      delete Memory.rooms[roomName];
      delete lostRooms[roomName];
      if (Memory.kernel.tuning?.rooms[roomName]) {
        delete Memory.kernel.tuning.rooms[roomName];
      }
      if (Memory.kernel.tuning?.lastEval?.[roomName]) {
        delete Memory.kernel.tuning.lastEval[roomName];
      }
    }
  }

  // E-FINDING-09: 清理 deathAnchor 中已灭绝角色的条目。
  // deathAnchor 由 recordCreepDeath 写入，记录最后死亡 tick 供 P1 补位 EMA 计算。
  // 当某角色不再存活且超过 2000 tick（长于最长寿命 1500+缓冲），清理过期锚点。
  // activeRoles 来自上方死亡清理同一次遍历（未建集合时无过期锚点可清，直接跳过）。
  const stats = Memory.kernel.stats;
  if (stats?.deathAnchor && activeRoles) {
    const STALE_ANCHOR_TICKS = 2000;
    for (const role of Object.keys(stats.deathAnchor)) {
      if (!activeRoles.has(role) && Game.time - stats.deathAnchor[role]! > STALE_ANCHOR_TICKS) {
        delete stats.deathAnchor[role];
      }
    }
  }
}

/** 失守房清盘的可见出口：删账前把"删了什么"记成一条事件 + 一行日志。
 *
 * 为什么值得记：调参账本随房间一起消失后，"这间房调过哪些参数、有没有因为反复回滚
 * 被冻过、有没有在途验证"就再无处可查 —— TuningAdjust/Rollback/Freeze 记的是逐次
 * 动作，不记"哪间房的覆盖被整体清过、清掉多少"。回收一间隔房重开运营时，线上只看到
 * 调参从头再来，没有这条事件就只能靠读代码反推。
 *
 * 为什么不在这里保住冻结保护与在途 pending：LOST_ROOM_GRACE(20000) 大于
 * FROZEN_DURATION(10000) 也大于 verifyDelay(1500)，能走到删这一步的账本里那份保护
 * 必然早已过期 —— 保不住，只能记下来。
 *
 * 观测失败不阻塞清理（与 recordCreepDeath 同一条纪律，B3-F02）。 */
function recordLostRoomPurge(roomName: string, lostFor: number): void {
  const tuning = Memory.kernel?.tuning;
  const state = tuning?.rooms?.[roomName];
  const lastEval = tuning?.lastEval?.[roomName];
  const remoteOps = Memory.rooms[roomName]?.remoteOps;
  // 一间本来就没账的房间清空是日常，不发事件 —— 只记真正有东西被抹掉的那次。
  if (!state && !lastEval && !remoteOps) return;

  const count = (obj: Record<string, unknown> | undefined): number =>
    obj ? Object.keys(obj).length : 0;
  try {
    recordEvent(EventKind.LostRoomPurge, roomName, [
      0, // reasonCode：0 = 失守宽限期届满（目前唯一出口）
      count(state?.roleBounds),
      count(state?.pendingValidation),
      count(state?.frozenParams),
      count(remoteOps),
      lostFor,
    ]);
    log.info(
      "memory",
      `lost-room purge ${roomName}: tuningOverrides=${count(state?.roleBounds)}` +
        ` pending=${count(state?.pendingValidation)} frozen=${count(state?.frozenParams)}` +
        ` remoteOps=${count(remoteOps)} lostFor=${lostFor}t (reason=LOST_ROOM_GRACE)`,
    );
  } catch {
    // 事件/日志写不进去也不能让维护中断 — 删除本身照旧。
  }
}

/** 按升序执行迁移（每个幂等）。ready() 未就绪时停在断点、保留版本，下 tick 续跑。
 * 版本号只随实际执行的迁移递增，不做无条件盖章：若未来出现断号，版本停在
 * 缺口处暴露问题，而不是被盖章静默掩盖、永久丢失缺口步骤。
 *
 * FINDING-11 修复：迁移链快照——已迁移到的版本记录到 Memory.kernel.migrationCheckpoint。
 * 新 Memory（schemaVersion=0）但 checkpoint 存在时（global reset 不清 Memory），
 * 直接跳到 checkpoint 继续，避免重跑 45 个迁移。
 * 只对新 Memory 首次启动有实质收益（global reset 不重置 schemaVersion）。
 */
function migrateMemory(currentVersion: number): void {
  // 快速跳过：如果 currentVersion=0 但有 checkpoint，跳到 checkpoint。
  // checkpoint 只在 migrateMemory 成功执行后才写入，保证只跳过已执行的迁移。
  // 安全前提：每个迁移幂等——即使 checkpoint 过期（代码回滚），从旧 checkpoint
  // 继续也不会出错（幂等的迁移重复执行不改变状态）。
  const checkpoint = Memory.kernel?.migrationCheckpoint;
  let version = currentVersion;
  if (
    version === 0 &&
    checkpoint !== undefined &&
    checkpoint > 0 &&
    checkpoint <= CONFIG.memory.schemaVersion
  ) {
    version = checkpoint;
    Memory.schemaVersion = version;
    log.info("memory", `[schema] fast-forward from v0 to v${version} (checkpoint)`);
  }

  for (const migration of MIGRATIONS) {
    if (version !== migration.from) continue;
    if (migration.ready && !migration.ready()) break;
    migration.run();
    version = migration.to;
    Memory.schemaVersion = version;
  }

  // 更新快照：只前进不后退（防止回滚后 checkpoint 锁住新版本）。
  // 只在 kernel 已存在时写入——不在「迁移不创建 kernel」的测试场景中意外创建。
  if (version > 0 && Memory.kernel) {
    const existing = Memory.kernel.migrationCheckpoint ?? 0;
    if (version > existing) {
      Memory.kernel.migrationCheckpoint = version;
    }
  }
}

/** 记录跳过原因，用于遥测和诊断。
 * 单 tick 内累加到 global 缓冲区，tick 末尾由 flushSkips 低频刷入 Memory，
 * 避免 CPU 压力下频繁 Memory 写入。 */
export function recordSkip(reason: string): void {
  const g = globalCache();
  if (!g.skipBuffer) g.skipBuffer = {};
  g.skipBuffer[reason] = (g.skipBuffer[reason] ?? 0) + 1;

  if (g.telemetry && g.telemetry.tick === Game.time) {
    g.telemetry.skipped++;
  }
}

/** 将 global 的 skipBuffer 刷入 Memory 并低频清理。由 Kernel 在 tick 末尾调用。 */
export function flushSkips(): void {
  const g = globalCache();
  if (!g.skipBuffer) return;

  if (!Memory.kernel) Memory.kernel = {};
  if (!Memory.kernel.skipReasons) Memory.kernel.skipReasons = {};

  // 防御性 key 数量上限：防止未知的动态 key 导致 Memory 膨胀。
  // 现有调用方（role/system name）都是有限集合，但防御性编程要求不信任未来。
  // B3-F05 修复：从 50 提高到 200 — 系统数×原因数的乘积可能超过 50。
  const MAX_SKIP_REASONS = 200;

  for (const [reason, count] of Object.entries(g.skipBuffer)) {
    // 累加但设上限，防止数字溢出。
    const current = Memory.kernel.skipReasons[reason] ?? 0;
    Memory.kernel.skipReasons[reason] = Math.min(current + count, 100000);
  }

  // 超过 key 数量上限时只保留计数最高的 MAX_SKIP_REASONS 个。
  if (Object.keys(Memory.kernel.skipReasons).length > MAX_SKIP_REASONS) {
    const sorted = Object.entries(Memory.kernel.skipReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SKIP_REASONS);
    Memory.kernel.skipReasons = Object.fromEntries(sorted);
  }
  g.skipBuffer = {};

  // B3-F09 修复：滑动窗口 — 保留上一窗口快照，而非完全清空。
  // 防止外部采集器恰好在重置后拉取到空数据，丢失跨窗口趋势。
  if (Game.time % 500 === 0) {
    Memory.kernel.prevSkipReasons = Memory.kernel.skipReasons;
    Memory.kernel.skipReasons = {};
  }
}
