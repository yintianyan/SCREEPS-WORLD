/** Intelligence 系统 — IntelState 唯一写者（完整版情报架构） */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { safeRun } from "../kernel/safe-run";
import { globalCache } from "../kernel/global-cache";
import {
  readIntelPlayersSegment,
  markIntelPlayersDirty,
  type IntelPlayersSegmentData,
} from "../kernel/segment-store";
import { log } from "../kernel/log";
import {
  adoptRoomIntel,
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
  type RoomIntel,
  INTEL_ROOMS_CAP,
} from "../domain/intel";

// ─── IntelState heap 层（模块级 = heap 语义；global reset 后由
// 观察交接 + segment 冷存惰性重建，符合三级存储分层）────────

/** 房间域活跃层：subject（房名）→ 条目。容量上限内环形覆盖。 */
const roomEntries = new Map<string, IntelEntry>();
/** 玩家域威胁记忆：owner → 条目（segment 冷存持久化，heap 为活跃副本）。 */
const playerEntries = new Map<string, PlayerIntelEntry>();

/** 老化周期（低频批处理；写事件式采集每 interval 都跑，老化 100t 一次）。 */
const AGING_INTERVAL = 100;
const PARENT_INTERVAL = 10;

/** 老化批上一次真正跑起来的 tick（heap：换码后首拍即跑，与 ageRooms/capRooms 的幂等性一致）。 */
let lastAgingTick: number | undefined;

/**
 * 老化批的到期判定（#115）—— 从「相位取模」改成「距上次运行够久」。
 * 导出只为让这条算术落在单测里：老化块要吃 Memory/RawMemory 段与 Game，
 * 为它手拼一套假引擎夹具，测到的是夹具而不是行为。
 */
export function agingDue(tick: number, lastRunTick: number | undefined): boolean {
  return lastRunTick === undefined || tick - lastRunTick >= AGING_INTERVAL;
}

/** 敌对信号判定：房名命中战争黑名单（止损链冷却期内）→ 该房观测到的 owner 记敌对。 */
function isBlacklistedRoom(roomName: string, tick: number): boolean {
  const blacklist = (Memory.kernel?.warBlacklist ?? {}) as Record<string, number>;
  const until = blacklist[roomName];
  return until !== undefined && until > tick;
}

/**
 * 观察交接采用：room-observer 采集管线写入 globalCache.intelHandoff，本系统
 * 采用为 IntelEntry 并清空缓冲（IntelState 唯一写者；观察方不直写状态）。
 */
function adoptHandoff(tick: number): void {
  const buf = globalCache().intelHandoff;
  if (!buf || buf.length === 0) return;
  for (const obs of buf) {
    upsertRoomEntry(roomEntries, adoptRoomIntel(obs));
    const owner = obs.payload.owner;
    if (owner && owner !== INVADER_USERNAME) {
      upsertPlayerObservation(
        playerEntries,
        owner,
        obs.subject,
        obs.payload.lastSeen,
        isBlacklistedRoom(obs.subject, tick),
      );
    }
  }
  buf.length = 0;
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

/** 房间域枚举查询（IntelQuery 的房间域落点）：全部活跃条目快照。 */
export function queryRoomIntel(): IntelEntry[] {
  return [...roomEntries.values()];
}

/** 房间域 payload 视图（subject → legacy RoomIntel 字段集）——消费方按
 * payload 字段直读的便捷形态。subject 全局去重：多房重复观测取最新。 */
export function intelPayloadView(): Record<string, RoomIntel> {
  const view: Record<string, RoomIntel> = {};
  for (const [subject, entry] of roomEntries) view[subject] = entry.payload;
  return view;
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
  return entry ? confidenceAt(entry, tick) : ("unknown" as const);
}

/** 观测通道：IntelState 体积（观测用）。 */
export function intelSize(): { rooms: number; players: number } {
  return { rooms: roomEntries.size, players: playerEntries.size };
}

/** 测试专用：清空 IntelState heap（单元测试跨用例隔离；生产路径不调用）。 */
export function __resetIntelStateForTests(): void {
  roomEntries.clear();
  playerEntries.clear();
}

// ─── 系统定义 ─────────────────────────────────────────────

/**
 * Intelligence — IntelState 唯一写者（房间域 heap + 玩家域 segment 冷存）。
 * 采集 = 观察交接采用（room-observer 管线写入 globalCache.intelHandoff）+
 * 快照被动威胁信号；老化 = 低频批处理；玩家域月级记忆经 segment 5 持久化。
 * 查询走本模块导出的只读 API。
 */
export const intelligenceSystem: System = {
  name: "intelligence",
  priority: 2 as Priority,
  interval: PARENT_INTERVAL,

  run(ctx: TickContext): void {
    // 采集（写事件式轻量轮询）：观察交接采用 + 被动威胁信号。幂等 upsert。
    safeRun(
      "intelligence/adopt",
      () => {
        adoptHandoff(ctx.tick);
        adoptPassiveThreats(ctx);
      },
      false,
    );

    // 老化批处理（#115）—— 两处一起改：**elapsed 到期门** + **三段隔离**。
    //
    // 换门的理由（线上实测）：原先是单拍模门 `(tick - PARENT_PHASE) % AGING_INTERVAL === 0`，
    // 而本系统每 PARENT_INTERVAL=10 拍才跑一次 ⇒ 到期那一拍若被调度器跳过（CPU 紧张时 kernel
    // 跳过低优先级系统），整批延后一整个 10 拍；实测本窗 3 次延后、最长 +400 拍，
    // 于是 `intelCoverage.tick` 会滞后到把"仪器丢沿"照成"服务器变慢"（R391 就被它骗过）。
    // elapsed 式把延后上界钉死为一个 PARENT_INTERVAL：到点没跑，下一个可用拍一定跑。
    //
    // 拆段的理由（一次真实的红，不是假想）：单段 safeRun 里 **段 IO 抛错会吃掉观测本身**——
    // `restorePlayersFromSegment()` 一抛，其后的 `capRooms`、`intelCoverage` 同拍快照、
    // `warFunnel` 落盘全部连带不执行。本仓纪律是"观测失败不阻塞清理"（`kernel/memory.ts:133`
    // 同族），所以这里把三件事各留一段：**A 房级老化 → B 玩家段冷存 → C 同拍快照落盘**，
    // 任一段炸只丢自己；B 仍在 C 之前 ⇒ `players` 读数含义与改前一致（先恢复再快照）。
    if (agingDue(ctx.tick, lastAgingTick)) {
      // 时间戳先行落盘：safeRun 会吞异常，若"失败就 10 拍后重试"，一个持续性错误
      // 会把低频批变成每 10 拍撞一次，代价远大于晚 100 拍。
      lastAgingTick = ctx.tick;

      safeRun(
        "intelligence/aging",
        () => {
          const removed = ageRooms(roomEntries, ctx.tick);
          capRooms(roomEntries, INTEL_ROOMS_CAP);
          if (removed > 0) {
            log.info(
              "intelligence",
              `intelligence: aged out ${removed} room entries ` +
                `(active=${roomEntries.size}, players=${playerEntries.size})`,
            );
          }
        },
        false,
      );

      safeRun(
        "intelligence/aging-players",
        () => {
          restorePlayersFromSegment();
          persistPlayersToSegment();
        },
        false,
      );

      safeRun(
        "intelligence/coverage-snapshot",
        () => {
          const statsAny = (Memory as any).kernel?.stats as any;
          if (!statsAny) return;
          statsAny.intelCoverage = {
            rooms: roomEntries.size,
            players: playerEntries.size,
            tick: ctx.tick,
          };
          // #99：战争候选漏斗（war-planning 每 pass 写 heap scratch）。落在这里的理由：
          // 它与 intelCoverage 是同一个问题的两半（"池子里有房，为什么选不出靶"），
          // 同拍写入 ⇒ 两份读数永远同时刻，不必猜谁更旧。
          // scratch 为 undefined = war-planning 自 boot 起还没跑过 ⇒ **不写**（缺键是
          // "未上线"这一态，写成全零会被读成"跑过且每道筛子都空"）。
          const funnel = globalCache().warFunnelScratch;
          if (funnel) statsAny.warFunnel = { ...funnel };
        },
        false,
      );
    }
  },
};
