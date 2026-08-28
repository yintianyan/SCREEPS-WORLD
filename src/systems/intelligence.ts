/** Intelligence 系统 — IntelState 唯一写者（完整版情报架构） */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { systemPhase } from "../kernel/phase";
import { safeRun } from "../kernel/safe-run";
import {
  readIntelPlayersSegment,
  markIntelPlayersDirty,
  type IntelPlayersSegmentData,
} from "../kernel/segment-store";
import { log } from "../kernel/log";
import {
  adoptLegacyRoomIntel,
  ageRooms,
  capRooms,
  upsertRoomEntry,
  upsertPlayerObservation,
  toPlayersRecord,
  fromPlayersRecord,
  isActionUsable,
  needsRescout,
  confidenceAt,
  INVADER_USERNAME,
  type IntelEntry,
  type PlayerIntelEntry,
  INTEL_ROOMS_CAP,
} from "../domain/intel";

// ─── IntelState heap 层（模块级 = heap 语义；global reset 后由
// legacy 输入桥 + segment 冷存惰性重建，符合三级存储分层）────────

/** 房间域活跃层：subject（房名）→ 条目。容量上限内环形覆盖。 */
const roomEntries = new Map<string, IntelEntry>();
/** 玩家域威胁记忆：owner → 条目（segment 冷存持久化，heap 为活跃副本）。 */
const playerEntries = new Map<string, PlayerIntelEntry>();

/** 老化周期（低频批处理；写事件式采集每 interval 都跑，老化 100t 一次）。 */
const AGING_INTERVAL = 100;
/** 老化门相位（phase.ts 内部门规范：相对父系统相位取模，避免绝对对齐无交集）。 */
const PARENT_INTERVAL = 10;
const PARENT_PHASE = systemPhase("intelligence", PARENT_INTERVAL);

/** 敌对信号判定：房名命中战争黑名单（止损链冷却期内）→ 该房观测到的 owner 记敌对。 */
function isBlacklistedRoom(roomName: string, tick: number): boolean {
  const blacklist = (Memory.kernel?.warBlacklist ?? {}) as Record<string, number>;
  const until = blacklist[roomName];
  return until !== undefined && until > tick;
}

/**
 * legacy 输入桥采用：RoomMemory.intel（room-observer 侦察管线产出的邻房情报）
 * 只读上采为 IntelEntry。legacy 桥在消费者迁移到 IntelQuery 前保持运行；
 * 本系统对其只读，不构成第二写者。
 */
function adoptLegacyIntel(tick: number): void {
  for (const roomName in Memory.rooms) {
    const intel = Memory.rooms[roomName]?.intel;
    if (!intel) continue;
    for (const subject in intel) {
      const legacy = intel[subject];
      if (!legacy) continue;
      upsertRoomEntry(roomEntries, adoptLegacyRoomIntel(subject, legacy, tick));
    }
    // 玩家域信号：legacy 记录的 owner（排除 NPC Invader）→ 活动观测。
    for (const subject in intel) {
      const owner = intel[subject]?.owner;
      if (!owner || owner === INVADER_USERNAME) continue;
      upsertPlayerObservation(
        playerEntries,
        owner,
        subject,
        intel[subject]!.lastSeen,
        isBlacklistedRoom(subject, tick),
      );
    }
  }
}

/** 被动威胁信号：自有房可见敌对单位 → owner 域敌对记忆单调前移。 */
function adoptPassiveThreats(ctx: TickContext): void {
  for (const snapshot of ctx.snapshots()) {
    for (const creep of snapshot.threatCreeps) {
      const owner = creep.owner?.username;
      if (!owner || owner === INVADER_USERNAME) continue;
      upsertPlayerObservation(playerEntries, owner, snapshot.roomName, ctx.tick, true);
    }
  }
}

/** segment 冷存 → heap 惰性重建（幂等 upsert，heap 更新者胜）。 */
function restorePlayersFromSegment(): void {
  const seg = readIntelPlayersSegment();
  for (const owner in seg.players) {
    const rec = seg.players[owner]!;
    const restored = fromPlayersRecord(owner, rec);
    const prev = playerEntries.get(owner);
    if (!prev || restored.lastSeenAt > prev.lastSeenAt) playerEntries.set(owner, restored);
  }
}

/** heap → segment 冷存落地（脏标记增量写，tick 末 flush）。 */
function persistPlayersToSegment(): void {
  const seg = readIntelPlayersSegment() as IntelPlayersSegmentData;
  seg.players = toPlayersRecord(playerEntries);
  markIntelPlayersDirty();
}

// ─── 查询 API（消费者经此只读取数；发现过期只能发侦察任务，无刷新权）────

/** 房间域条目读取（heap 活跃层遮蔽；未命中 = 未知，由 needsRescout 驱动侦察）。 */
export function getRoomIntel(subject: string): IntelEntry | undefined {
  return roomEntries.get(subject);
}

/** 玩家域威胁记忆读取（segment 常驻激活，heap 即活跃层）。 */
export function getPlayerIntel(owner: string): PlayerIntelEntry | undefined {
  return playerEntries.get(owner);
}

/**
 * 不可逆行动硬门槛查询（进攻/占领/大额调拨）：fact 级 + 可选年龄上限。
 * 语义见 domain isActionUsable——inferred/stale 一律拒绝。
 */
export function intelActionUsable(subject: string, tick: number, maxAge?: number): boolean {
  return isActionUsable(roomEntries.get(subject), tick, maxAge);
}

/** 盲区/过期侦察触发查询（未知 ≠ 安全；stale 的合法用途是两段式核实）。 */
export function intelNeedsRescout(subject: string, tick: number): boolean {
  return needsRescout(roomEntries.get(subject), tick);
}

/** 读侧派生置信度（fact/stale/inferred/unknown）。 */
export function intelConfidence(subject: string, tick: number) {
  const entry = roomEntries.get(subject);
  return entry ? confidenceAt(entry, tick) : "unknown" as const;
}

/** 观测通道：IntelState 体积（观测用）。 */
export function intelSize(): { rooms: number; players: number } {
  return { rooms: roomEntries.size, players: playerEntries.size };
}

// ─── 系统定义 ─────────────────────────────────────────────

/**
 * Intelligence — IntelState 唯一写者（房间域 heap + 玩家域 segment 冷存）。
 * 采集 = legacy 输入桥采用（只读）+ 快照被动威胁信号；老化 = 低频批处理；
 * 玩家域月级记忆经 segment 5 持久化。查询走本模块导出的只读 API。
 */
export const intelligenceSystem: System = {
  name: "intelligence",
  priority: 2 as Priority,
  interval: PARENT_INTERVAL,

  run(ctx: TickContext): void {
    // 采集（写事件式轻量轮询）：legacy 桥采用 + 被动威胁信号。幂等 upsert。
    safeRun("intelligence/adopt", () => {
      adoptLegacyIntel(ctx.tick);
      adoptPassiveThreats(ctx);
    }, false);

    // 老化批处理（低频相对相位门）：超期清理 + 容量覆盖 + 玩家域冷存落地。
    if ((ctx.tick - PARENT_PHASE) % AGING_INTERVAL === 0) {
      safeRun("intelligence/aging", () => {
        const removed = ageRooms(roomEntries, ctx.tick);
        capRooms(roomEntries, INTEL_ROOMS_CAP);
        restorePlayersFromSegment();
        persistPlayersToSegment();
        if (removed > 0) {
          log.info("intelligence", `intelligence: aged out ${removed} room entries ` +
            `(active=${roomEntries.size}, players=${playerEntries.size})`,);
        }
      }, false);
    }
  },
};
