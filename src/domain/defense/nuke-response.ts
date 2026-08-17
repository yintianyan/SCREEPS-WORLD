/**
 * Nuke 响应决策 — 纯函数层（审计缺口 1+3：核弹落点感知 + 资产抢救）。
 *
 * 引擎语义 [Fact]：敌方 nuke 发射后 50000 tick（约 11 小时）落地，落点
 * range≤2 内建筑全毁 — terminal/storage 无法移动，唯一出路是把库存
 * terminal.send 到无警报兄弟房。send 无单笔量上限（只受 terminal 库存与
 * 10 tick 冷却限制），预警窗口内可多轮转空。
 *
 * 感知（room-snapshot）：自有房每 tick FIND_NUKES（视野内常量查询，零额外
 * find）；Nuke.timeToLand 逐 tick 递减，无需 Memory 持久化 — 无 schema 变更。
 *
 * 抢救价值序：power/G/浓缩矿物（价值密度高、不可再生）优先于能量（可再生、
 * 自身即运费来源）；能量只留运费地板（send 矿物也要能量付运费）。
 */

/** 资产抢救接收房候选（由执行层从 snapshot 采集，纯函数不访问 Game）。 */
export interface SalvageCandidate {
  roomName: string;
  hasTerminal: boolean;
  /** 本房是否也处于 nuke 落点预警（true 不可作接收方 — 转进去是二次损失）。 */
  nukeAlert: boolean;
  /** terminal 剩余容量（字节口径与 store.getFreeCapacity 一致）。 */
  terminalFree: number;
}

/**
 * 选择资产抢救接收房：无警报 + 有 terminal + 容量最富余者优先。
 * 全部候选不合格时返回 undefined（单房帝国无处可转 — 静默等待，事件已记录）。
 */
export function pickSalvageRecipient(
  candidates: readonly SalvageCandidate[],
  excludeRoom: string,
): SalvageCandidate | undefined {
  let best: SalvageCandidate | undefined;
  for (const c of candidates) {
    if (c.roomName === excludeRoom) continue;
    if (c.nukeAlert || !c.hasTerminal) continue;
    if (c.terminalFree <= 0) continue;
    if (!best || c.terminalFree > best.terminalFree) best = c;
  }
  return best;
}

/**
 * 抢救资源优先序（价值密度降序）：
 * power（GPL 硬通货）> G（核弹/浓缩原料）> 高级化合物 X*（boost 战备）>
 * battery（压缩能量）> 基础矿物 > 兜底任意（含 OPS 等）。
 * 能量不在列表 — 由 planSalvageShipment 单独处理（留运费地板后全发）。
 */
const SALVAGE_PRIORITY: readonly string[] = [
  RESOURCE_POWER,
  RESOURCE_GHODIUM,
  "XUH2O", "XUHO2", "XZH2O", "XZHO2", "XLH2O", "XLHO2", "XKH2O", "XKHO2", "XGH2O", "XGHO2",
  RESOURCE_BATTERY,
  RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_UTRIUM, RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM, RESOURCE_ZYNTHIUM, RESOURCE_CATALYST,
];

/** 一次抢救发运计划。 */
export interface SalvageShipment {
  to: string;
  resourceType: string;
  amount: number;
}

/**
 * 规划一次抢救发运（每 terminal 每轮一笔，terminal 冷却 10 tick + 系统
 * interval 200 下 50000 tick 窗口绰绰有余）：
 * 1. 非能量资源按优先序取首个有库存者全量发；
 * 2. 无非能量资源时发能量（留运费地板，剩余全发）；
 * 3. 无可发资源返回 undefined（抢救完成或本无库存）。
 */
export function planSalvageShipment(
  terminalResources: ReadonlyMap<string, number>,
  recipient: string,
  energyFeeReserve: number,
): SalvageShipment | undefined {
  for (const resourceType of SALVAGE_PRIORITY) {
    const amount = terminalResources.get(resourceType) ?? 0;
    if (amount > 0) {
      return { to: recipient, resourceType, amount };
    }
  }
  // 非能量资源发完 → 能量兜底（留运费地板）。
  const energy = terminalResources.get(RESOURCE_ENERGY) ?? 0;
  const amount = energy - energyFeeReserve;
  if (amount > 0) {
    return { to: recipient, resourceType: RESOURCE_ENERGY, amount };
  }
  return undefined;
}
