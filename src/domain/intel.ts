/**
 * 邻居房情报（C2：M7 远矿/扩张的数据源）— 纯函数，不访问 Game/Memory。
 * 房名分类（highway/center/SK/normal）与房态无需视野；source/矿物/归属需视野。
 */

/** 邻房类型：普通房 / source keeper 房 / 中心房 / 公路房。 */
export type RoomKind = "normal" | "sk" | "center" | "highway";

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
