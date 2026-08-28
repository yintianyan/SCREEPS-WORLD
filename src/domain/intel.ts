/** 邻居房情报（C2：M7 远矿/扩张的数据源）— 纯函数，不访问 Game/Memory。 */

/** 邻房类型：普通房 / source keeper 房 / 中心房 / 公路房。 */
export type RoomKind = "normal" | "sk" | "center" | "highway";

/**
 * NPC Invader 的 username。Invader Core 会预定房间 — 这是核心占坑信号，
 * 不是玩家争矿。远矿评选 / 运行时退出必须把它与敌对玩家 reservation 分开：
 * 玩家预定止损不去；Invader 预定应派 coreClearer 拆核（次级）或等 decay（要塞）。
 */
export const INVADER_USERNAME = "Invader";

/** 是否为敌对玩家预定（排除己方续期与 NPC Invader）。无 myUsername 时非 Invader 预定一律视为敌对。 */
export function isHostilePlayerReservation(
  reservedBy: string | undefined,
  myUsername: string | undefined,
): boolean {
  if (!reservedBy) return false;
  if (reservedBy === INVADER_USERNAME) return false;
  if (!myUsername) return true;
  return reservedBy !== myUsername;
}

/** 单个邻房的情报记录（存 RoomMemory.intel，短字段、有界）。 */
export interface RoomIntel {
  kind: RoomKind;
  /** Game.map.getRoomStatus 的 status（"normal" / "closed" / "novice" / "respawn"）。 */
  status: string;
  /** 有视野时记录的 source 数。 */
  sources?: number;
  /** 有视野时记录的矿物类型（如 "H" / "U" / "X"）。 */
  mineral?: string;
  /** 有视野且房间有主时记录的 owner 名。 */
  owner?: string;
  /** 有视野且 controller 被预定时记录的预定者名（区分己方/敌方续期与拉锯）。 */
  reservedBy?: string;
  /** 有视野时记录的敌方 tower 数（进攻/远矿风险评估的核心变量）。 */
  towers?: number;
  /** 有视野时记录的非我方 spawn 数（含敌对玩家活跃 spawn 与无主遗迹 spawn —
   * 遗迹 spawn 的房间（controller 无主）仍可运营远矿/占领，见 remote-mining-manager；
   * 但占领（claim）需先拆除，见 expansion evaluator 的筛选）。 */
  enemySpawns?: number;
  /** 有视野时记录的人工墙数（constructedWall + 非我方 rampart）— 前任玩家
   * 防御工事/活跃封路信号；有墙才有入口封死问题，sealedExits 只在 wallCount>0 时计算。 */
  wallCount?: number;
  /** 被人工墙完全封死的出口方向（ExitConstant 数字）— 该方向可通行格全部被墙覆盖，
   * 编队无法经此进出；全部出口封死 = 房间不可达。仅在有视野且 wallCount>0 时计算。 */
  sealedExits?: number[];
  /** 有视野时记录的 power bank 存在（PB 野采链，审计缺口 2）：中立结构，
   * 出现后约 5000 tick 自动消失 — 新鲜 intel 才值得派遣编队。 */
  powerBank?: boolean;
  /** home 锚点到该房中心的 PathFinder 实测成本（swampCost:5 计入地形）；地形静态、
   * 算一次终身缓存，缺失时评选方回退线性距离估算。 */
  pathCost?: number;
  lastSeen: number;
}

/** 出口封死判定输入 — 纯函数输入，不直接访问 Game（可测试）。 */
export interface SealedExitInput {
  /** 目标房名（pack 边界带用）。 */
  roomName: string;
  /** 该房出口表（Game.map.describeExits 的返回值，方向数字 → 邻房名）。 */
  exits: Readonly<Record<string, string>>;
  /** 人工墙 packed 位置集合（constructedWall + 非我方 rampart）。 */
  artificialWalls: ReadonlySet<number>;
  /** 地形查询（TERRAIN_MASK_WALL = 1）。 */
  getTerrain: (x: number, y: number) => number;
}

/**
 * 计算被人工墙完全封死的出口方向（v33 完整情报）。
 * 语义：该方向 2 格深的边界带内，所有「地形可通行」的格都被人工墙覆盖 → 封死。
 * 只对 describeExits 实际列出的方向判定（地形墙天然无出口不列入）；带宽 2 格：
 * 墙线筑在边界第二格（x=1/48、y=1/48）仍计入封死，筑在更内侧则留出立足带，
 * 编队可进房后经管线寻路绕行（pathfinding 的 CostMatrix 已含人工墙成本 255）。
 * 线上实证：W36S58 西侧墙线筑在 x=2（第 3 格），本判定正确返回「未封死」—
 * 编队仍可进入并在房内绕行，不应废弃该远矿。
 * 成本：仅在有墙房调用（observer 侧 wallCount>0 门控），每方向 ≤100 次 getTerrain。
 */
export function computeSealedExits(input: SealedExitInput): number[] {
  const sealed: number[] = [];
  const { exits, artificialWalls, getTerrain } = input;
  for (const dirStr of Object.keys(exits)) {
    const dir = Number(dirStr);
    // 边界带坐标范围（2 格深）。
    let band: Array<[number, number]>;
    switch (dir) {
      case 1: // TOP：y ∈ {0,1}
        band = [];
        for (let x = 0; x < 50; x++) band.push([x, 0], [x, 1]);
        break;
      case 3: // RIGHT：x ∈ {48,49}
        band = [];
        for (let y = 0; y < 50; y++) band.push([48, y], [49, y]);
        break;
      case 5: // BOTTOM：y ∈ {48,49}
        band = [];
        for (let x = 0; x < 50; x++) band.push([x, 48], [x, 49]);
        break;
      case 7: // LEFT：x ∈ {0,1}
        band = [];
        for (let y = 0; y < 50; y++) band.push([0, y], [1, y]);
        break;
      default:
        continue;
    }
    // 全部可通行格均被墙覆盖 → 封死。方向无任何可通行格（纯地形墙）不封死判定
    // （describeExits 一般不会列出，防御性跳过）。
    let crossable = 0;
    let covered = 0;
    for (const [x, y] of band) {
      if (getTerrain(x, y) === TERRAIN_MASK_WALL) continue;
      crossable++;
      if (artificialWalls.has(x * 50 + y)) covered++;
    }
    if (crossable > 0 && covered === crossable) sealed.push(dir);
  }
  return sealed;
}

/**
 * 按房名分类房间（无需视野）。官方地图规律（坐标 mod 10）：任一坐标 ==0 →
 * highway（十字路口无 controller）；双坐标 ==5 → center（3 source+1 矿）；
 * 双坐标 ∈{4,5,6} → sk（3 source，SK 把守）；其余 → normal（可 claim）。
 */
export function classifyRoomByName(roomName: string): RoomKind {
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return "normal";
  const x = Number(match[2]) % 10;
  const y = Number(match[4]) % 10;
  if (x === 0 || y === 0) return "highway";
  if (x === 5 && y === 5) return "center";
  if (x >= 4 && x <= 6 && y >= 4 && y <= 6) return "sk";
  return "normal";
}

/** 扫描单个邻房的情报；visibleRoom 为 undefined 时只落房名分类与房态。
 * prev：既有条目 — 无视野时保留上次的 sources/mineral/owner/towers 与 pathCost；
 * 不传视为首次建档。P1-G 后 dangerUntil 已迁至 RemoteOp，intel 不再保留。 */
export function scanNeighborIntel(
  roomName: string,
  status: string,
  tick: number,
  visibleRoom?: {
    sources: number;
    mineralType?: string;
    owner?: string;
    reservation?: string;
    towers?: number;
    enemySpawns?: number;
    wallCount?: number;
    sealedExits?: number[];
    powerBank?: boolean;
  },
  prev?: RoomIntel,
): RoomIntel {
  const intel: RoomIntel = {
    kind: classifyRoomByName(roomName),
    status,
    lastSeen: tick,
  };
  if (visibleRoom) {
    intel.sources = visibleRoom.sources;
    if (visibleRoom.mineralType) intel.mineral = visibleRoom.mineralType;
    if (visibleRoom.owner) intel.owner = visibleRoom.owner;
    // reservedBy 与 owner 同模式：有视野且被预定则记录，否则不设（=清除）——
    // 有视野确认无预定即视为预定已失效，让评选/维护立即恢复该房资格。
    if (visibleRoom.reservation) intel.reservedBy = visibleRoom.reservation;
    if (visibleRoom.towers !== undefined) intel.towers = visibleRoom.towers;
    if (visibleRoom.enemySpawns !== undefined) intel.enemySpawns = visibleRoom.enemySpawns;
    if (visibleRoom.wallCount !== undefined) intel.wallCount = visibleRoom.wallCount;
    // sealedExits 只在有墙时有值 — 有视野且 wallCount=0 时显式写空数组
    // （= 已确认无封死，覆盖旧观测的残留），而非省略保留旧值。
    intel.sealedExits = visibleRoom.sealedExits ?? [];
    // PB 存在性：有视野即覆写（false 也写 — PB 消失/被摧毁立即反映，野采链据此收摊）。
    intel.powerBank = visibleRoom.powerBank ?? false;
  } else if (prev) {
    // 无视野：沿用上次观测值（数据会随 lastSeen 保持但陈旧度由消费方判断）。
    if (prev.sources !== undefined) intel.sources = prev.sources;
    if (prev.mineral !== undefined) intel.mineral = prev.mineral;
    if (prev.owner !== undefined) intel.owner = prev.owner;
    if (prev.reservedBy !== undefined) intel.reservedBy = prev.reservedBy;
    if (prev.towers !== undefined) intel.towers = prev.towers;
    if (prev.enemySpawns !== undefined) intel.enemySpawns = prev.enemySpawns;
    if (prev.wallCount !== undefined) intel.wallCount = prev.wallCount;
    if (prev.sealedExits !== undefined) intel.sealedExits = prev.sealedExits;
    if (prev.powerBank !== undefined) intel.powerBank = prev.powerBank;
    // 无视野时 lastSeen 不应前移（视野数据没有更新）。
    intel.lastSeen = prev.lastSeen;
  }
  // 通勤成本：地形静态，终身保留（由 room-observer 一次性计算，刷新不冲掉）。
  if (prev?.pathCost !== undefined) {
    intel.pathCost = prev.pathCost;
  }
  return intel;
}

// ─── 情报时效分级（P1-1）─────────────────────────────────────

/** 情报置信度分级 — 按时效衰减分档，消费方按各自风险容忍度选择阈值。 */
export type IntelConfidence = "fresh" | "stale" | "expired" | "unknown";

/**
 * 情报时效分级纯函数（P1-1）。

 * 设计理念：不同消费方对情报新鲜度的要求不同——战争目标需要极新鲜（<500 tick），
 * 远矿运营可容忍较旧（<2000 tick），扩张评选介于两者之间。本函数提供统一的
 * 时效计算逻辑，消费方按各自 TTL 阈值调用获得分级结果，避免散落的
 * `tick - lastSeen < N` 判定（现有 6+ 处）各自演化、口径漂移。

 * 分级语义：
 * - fresh：lastSeen 在 freshTtl 内 — 可直接用于决策（进攻/开矿/扩张）。
 * - stale：超过 freshTtl 但在 staleTtl 内 — 降级使用（远矿维护可接受，进攻需补侦察）。
 * - expired：超过 staleTtl — 不可信，必须刷新后再用（等同从未观测该字段）。
 * - unknown：lastSeen 缺失 — 从未有过视野。

 * @param lastSeen  intel.lastSeen（观测 tick）。
 * @param currentTick  当前 tick（Game.time）。
 * @param freshTtl  新鲜阈值（tick）— 超过即降为 stale。
 * @param staleTtl  陈旧阈值（tick）— 超过即降为 expired（必须 > freshTtl）。
 */
export function getIntelConfidence(
  lastSeen: number | undefined,
  currentTick: number,
  freshTtl: number,
  staleTtl: number,
): IntelConfidence {
  if (lastSeen === undefined) return "unknown";
  const age = currentTick - lastSeen;
  if (age <= freshTtl) return "fresh";
  if (age <= staleTtl) return "stale";
  return "expired";
}


// ─── 完整版情报架构（IntelState 唯一写者的领域模型）────────────────
//
// 三分置信度是「来源信任」维度（fact=本源直接观测 / inferred=先验推导 / ally
// 转述同属 inferred），与旧 getIntelConfidence 的「时效」维度正交：消费方先看
// 来源可信度，再看新鲜窗。读侧派生（不落存储）实现「无视野随龄单调降级」，
// 避免降级写风暴；物理清理只在超 expiry 后发生。

/** 情报四域。市场域数据归市场系统所有，本模型只保留只读缓存位。 */
export type IntelDomain = "rooms" | "players" | "static" | "market";

/** 观测来源（IntelEntry.source）。ally/derived 永远是 inferred，不参与硬门槛。 */
export type IntelSource = "passive" | "scout" | "observer" | "ally" | "derived";

/** 三分置信度 + unknown（从未观测/已过期清空）。 */
export type IntelTrust = "fact" | "stale" | "inferred" | "unknown";

/** 本源直接观测来源（可进入 fact 通道）。 */
const DIRECT_SOURCES: ReadonlySet<IntelSource> = new Set(["passive", "scout", "observer"]);

/** 房间域动态字段 TTL（SPECULATION 初值，soak 校准——归属是慢变量，
 * KasamiBot 20k 先例，取 ~5k–20k 区间中点）。 */
export const ROOM_DYNAMIC_TTL = 10_000;
/** 敌编队/威胁事实：可见期结束即降级（行情瞬变）。 */
export const ROOM_THREAT_TTL = 200;
/** 资源/估值字段 TTL（与估值刷新同频）。 */
export const ROOM_RESOURCE_TTL = 20_000;
/** expiry 抖动上限（防到期风暴：到期时间戳加 hash jitter）。 */
export const EXPIRY_JITTER = 500;
/** 房间域 heap 容量（超限按 observedAt 最旧环形覆盖）。 */
export const INTEL_ROOMS_CAP = 256;

/** 房间域 IntelEntry payload——复用 legacy RoomIntel 的字段集（观测即全量覆写语义）。 */
export type RoomIntelPayload = RoomIntel;

/** 房间域情报条目（subject = 房名）。 */
export interface IntelEntry {
  subject: string;
  /** 最近一次有视野观测的 tick（无视野不前移——与 legacy lastSeen 语义一致）。 */
  observedAt: number;
  source: IntelSource;
  /** 过期时间戳 = observedAt + TTL + jitter(subject)；超期由老化清理为未知。 */
  expiry: number;
  payload: RoomIntelPayload;
}

/** 玩家域威胁记忆条目（subject = owner 名，月级衰减不删除，segment 冷存）。 */
export interface PlayerIntelEntry {
  owner: string;
  /** 最近一次确认活动的 tick。 */
  lastSeenAt: number;
  /** 最近一次敌对信号（在房威胁/黑名单命中）的 tick；0 = 无记录。 */
  lastHostileAt: number;
  /** 观测到活动的房间 → 最近观测 tick。 */
  rooms: Record<string, number>;
}

/** 稳定字符串哈希（与 kernel 相位同族算法，仅用于 expiry jitter）。 */
function intelHash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 该来源是否可进入 fact 通道（ally/derived 永远 inferred）。 */
export function isDirectSource(source: IntelSource): boolean {
  return DIRECT_SOURCES.has(source);
}

/** 该房 subject 的 TTL 分档：威胁字段短窗、动态字段中窗、资源字段长窗。
 * 简化实现：payload 内 towers/enemySpawns/sealedExits 属威胁类，其余走动态窗。 */
function ttlForPayload(payload: RoomIntelPayload): number {
  if (payload.towers !== undefined || payload.enemySpawns !== undefined) {
    return ROOM_THREAT_TTL;
  }
  if (payload.powerBank !== undefined) return ROOM_THREAT_TTL;
  return ROOM_DYNAMIC_TTL;
}

/**
 * 读侧派生置信度：ally/derived → inferred；直接来源按龄 fact → stale →
 * unknown（超 expiry，条目应已被老化清理）。纯函数。
 */
export function confidenceAt(entry: IntelEntry, tick: number): IntelTrust {
  if (!isDirectSource(entry.source)) return "inferred";
  const age = tick - entry.observedAt;
  if (age <= ttlForPayload(entry.payload)) return "fact";
  if (tick < entry.expiry) return "stale";
  return "unknown";
}

/**
 * 不可逆行动硬门槛（进攻/占领/大额调拨）：只接受 fact 级，且可选更严的
 * 观察年龄上限（战争授权的目标新鲜度）。inferred/stale 一律拒绝——
 * stale 的合法用途仅是触发「先侦察后行动」两段式任务。
 */
export function isActionUsable(
  entry: IntelEntry | undefined,
  tick: number,
  maxAge?: number,
): boolean {
  if (!entry) return false;
  if (confidenceAt(entry, tick) !== "fact") return false;
  if (maxAge !== undefined && tick - entry.observedAt > maxAge) return false;
  return true;
}

/** stale/inferred/unknown 的合法用途：触发侦察任务（两段式），永不直接驱动行动。 */
export function needsRescout(entry: IntelEntry | undefined, tick: number): boolean {
  if (!entry) return true; // 未知 ≠ 安全：盲区驱动侦察
  return confidenceAt(entry, tick) !== "fact";
}

/**
 * legacy 邻房 intel（RoomMemory.intel 记录）→ IntelEntry 采用转换。
 * 来源记 observer（room-observer 有视野扫描管线产出）；observedAt 取
 * legacy.lastSeen（无视野不前移的既有语义）；expiry 按 TTL 分档加 jitter。
 * pathCost 为地形静态实测值，随 payload 保留——条目过期后依赖重访重建
 * （消费方已有线性距离回退）。
 */
export function adoptLegacyRoomIntel(
  subject: string,
  legacy: RoomIntel,
  nowTick: number,
): IntelEntry {
  const ttl = ttlForPayload(legacy);
  const jitter = intelHash(subject) % (EXPIRY_JITTER + 1);
  return {
    subject,
    observedAt: legacy.lastSeen,
    source: "observer",
    expiry: legacy.lastSeen + ttl + jitter,
    payload: { ...legacy },
  };
}

/** 老化清理：超 expiry 的条目物理删除（读侧语义 = 未知）。返回删除数。 */
export function ageRooms(entries: Map<string, IntelEntry>, tick: number): number {
  let removed = 0;
  for (const [subject, entry] of entries) {
    if (tick >= entry.expiry) {
      entries.delete(subject);
      removed++;
    }
  }
  return removed;
}

/** 容量治理：超限按 observedAt 最旧环形覆盖。 */
export function capRooms(entries: Map<string, IntelEntry>, cap: number): number {
  if (entries.size <= cap) return 0;
  const byOldest = [...entries.entries()].sort((a, b) => a[1].observedAt - b[1].observedAt);
  const evict = entries.size - cap;
  for (let i = 0; i < evict; i++) entries.delete(byOldest[i]![0]);
  return evict;
}

/** upsert 语义：仅当新条目更新（observedAt 更晚）时覆盖——采用/采集幂等。 */
export function upsertRoomEntry(entries: Map<string, IntelEntry>, entry: IntelEntry): boolean {
  const prev = entries.get(entry.subject);
  if (prev && prev.observedAt >= entry.observedAt) return false;
  entries.set(entry.subject, entry);
  return true;
}

// ─── 玩家域：segment 结构化记录互转 ──────────────────────────

/** 玩家域 segment 记录的结构形态（与 kernel segment-store 的结构化最小集对齐）。 */
export interface PlayerIntelRecord {
  lastSeenAt?: number;
  lastHostileAt?: number;
  rooms?: Record<string, number>;
}

export function toPlayersRecord(players: Map<string, PlayerIntelEntry>): Record<string, PlayerIntelRecord> {
  const out: Record<string, PlayerIntelRecord> = {};
  for (const [owner, e] of players) {
    out[owner] = { lastSeenAt: e.lastSeenAt, lastHostileAt: e.lastHostileAt, rooms: { ...e.rooms } };
  }
  return out;
}

export function fromPlayersRecord(owner: string, rec: PlayerIntelRecord): PlayerIntelEntry {
  return {
    owner,
    lastSeenAt: rec.lastSeenAt ?? 0,
    lastHostileAt: rec.lastHostileAt ?? 0,
    rooms: { ...(rec.rooms ?? {}) },
  };
}

/** 玩家域观测 upsert：活动信号刷新 lastSeenAt/rooms；敌对信号单调前移 lastHostileAt。 */
export function upsertPlayerObservation(
  players: Map<string, PlayerIntelEntry>,
  owner: string,
  roomName: string,
  tick: number,
  hostile: boolean,
): void {
  const prev = players.get(owner);
  const entry: PlayerIntelEntry = prev ?? { owner, lastSeenAt: 0, lastHostileAt: 0, rooms: {} };
  if (tick > entry.lastSeenAt) entry.lastSeenAt = tick;
  if (hostile && tick > entry.lastHostileAt) entry.lastHostileAt = tick;
  const prevRoomTick = entry.rooms[roomName] ?? 0;
  if (tick > prevRoomTick) entry.rooms[roomName] = tick;
  players.set(owner, entry);
}
