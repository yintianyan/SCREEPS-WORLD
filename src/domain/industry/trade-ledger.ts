/**
 * 贸易决策实测账本 —— 「被闸挡在门外」与「跑了但决定不交易」必须分得开。
 *
 * 为什么要有（2026-09-28）：审计模块参与度时，贸易是唯一一个**线上完全看不境**的：
 * 它一个 Memory 键都不写，credits / bucket / terminal 库存 / 自有挂单数这些决策输入
 * 只活在函数栈里。当天为了判断"为什么 storage 915,129 能量nearFull 却一单不挂"，
 * 只能手打一串 console 求值 —— 而官服掉速到 2.6 秒/tick 时求值还会超时。
 * 同一个课这周已经付过两次学费（`cpuBySystem` 的单位陷阱、远矿建路账本）：
 * **静默决策的模块不能被迭代**，先补读数，再动参数。
 *
 * 本文件只出类型与建行函数，不碰 Game/Memory（写者 terminal-manager，快照者 telemetry-collector）。
 */

/** 一次运行记下的决策现场（heap 累计 + 最近一次的输入快照）。 */
export interface TradeLedger {
  /** 本进程内 terminal-manager 进入 run 的次数（分母）。 */
  runs: number;
  /** 最近一次进入 run 的 tick。 */
  lastTick: number;
  /**
   * 最近一次被哪道总闸挡下：`""` = 没被挡（进入了决策），
   * 其余取值对应 terminal-manager 的四道前置门。
   */
  gatedBy: "" | "no-market-api" | "cpu-tier" | "bucket" | "no-terminal";
  /** 决策时点的账户额度（credits）—— 判"买不动"还是"不想买"。 */
  credits: number;
  /** 决策时点的 bucket（`CONFIG.market.minBucket` 的门）。 */
  bucket: number;
  /** 有 terminal 的自有房数。 */
  roomsWithTerminal: number;
  /** 因 terminal.cooldown 跳过候选的房数（冷却被谁吃掉）。 */
  roomsOnCooldown: number;
  /** 账户内自有挂单数（`Game.market.orders`）。0 = 一单没挂。 */
  myOrders: number;
  /** 最近一次决策时各房 terminal 里的能量（卖能量的原料库存）。 */
  terminalEnergy: number;
  /** 最近一次决策时各房 storage 里的能量（盈余规模）。 */
  storageEnergy: number;
}

/** 造一份零值账本（字段齐全，读数时"没有"与"是 0"不会混）。 */
export function createTradeLedger(): TradeLedger {
  return {
    runs: 0,
    lastTick: 0,
    gatedBy: "",
    credits: 0,
    bucket: 0,
    roomsWithTerminal: 0,
    roomsOnCooldown: 0,
    myOrders: 0,
    terminalEnergy: 0,
    storageEnergy: 0,
  };
}
