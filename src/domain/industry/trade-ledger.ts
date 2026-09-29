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
  // ── 采购侧（terminal-market.tryBuyDeficit 写）：判「工业买不到原料」卡在哪一道 ──
  // 立这块账的现场证据（2026-09-28）：10 座 lab 全部空转（mineralType 无、reaction 无、
  // cooldown 0），而计划的反应是 `X + GH2O → XGH2O` —— 本房矿是 GO，两个原料都得买。
  // 买入这条道有四道可能的止步处（需求表空 / 价格门禁无匹配单 / 缺口算成 0 / deal 被拒），
  // 每一道的动作完全不同，而 terminal-manager 的日志在官服上看不见（info 级不落 Memory）。
  /** 最近一次运行时**活着的**采购需求条数。0 且有反应计划 ⇒ 问题在生产者（lab-system）。 */
  demandsLive: number;
  /** 最近一条被考虑的需求：`资源:数量/p优先级/来源`；空 = 一条都没有。 */
  demandTop: string;
  /** 生产者侧指纹：本房最近一次 publishProcurementDemands 交出的条数（0=生产者从没走到那行）。 */
  demandsPublished: number;
  /** 上述发布的时刻（heap 值，global reset 后归零 —— 只与同窗口的 demandsLive 对照读）。 */
  publishedAt: number;
  /**
   * 生产者侧**第二道**指纹：本房最近一次「走到采购需求发布决策」时算出的条数。
   * 与 `demandsPublished` 并存才成立：publish 写在 `if (demands.length > 0)` 里面，
   * 所以「没走到那行」与「走到了但算出 0 条」在 published 上读成同一个 0
   * （线上实证：1884 拍里 published=0，而同窗 demandsLive=1、buyOk=6 —— 那几条来自
   * recovery-execution，它没被护栏包住，lab 这条一步都没留下痕迹）。
   * 三态判读：`attemptedAt=0` ⇒ 没走到那块（查 lab 控制流/相位）；
   * `computed=0` ⇒ 走到了、判定无需买（查 expandReactionDemands 的口径）；
   * `computed>0` ⇒ 必然已发布，此时 demandsLive 仍 0 才是信道/消费侧的问题。
   */
  demandsComputed: number;
  /** 上述「走到发布决策」的时刻（heap 值；0 = 本进程从没走到过那一行）。 */
  attemptedAt: number;
  /** 采购在进入撮合前被什么挡住：`""` = 没被挡。 */
  buyBlockedBy: "" | "credits-floor";
  /** 累计：有需求但在价格门禁下找不到任何一张卖单（`buyGatePrice` 太低的直接证据）。 */
  buyNoMatch: number;
  /** 最近一次用的买入价门禁（每单位 credits）。 */
  buyGatePrice: number;
  /** 最近一次看到的最低卖价（每单位 credits）；0 = 没匹配到单。 */
  buyBestAsk: number;
  /** 累计：发出过多少次 deal。 */
  buyTried: number;
  /** 累计：deal 被引擎接受多少次（与 buyTried 的差 = 撮合成功但执行被拒）。 */
  buyOk: number;
  /**
   * 本轮 buy-deficit 候选拿到的优先级（`DEFICIT_PRIORITY_BASE` = 需求表为空时的基线）。
   * 与 `SELL_PRIORITY_CAP` 对照才知道买入有没有被日常卖出挤出 deal 窗口。
   */
  buyDeficitPriority: number;
}

/**
 * 在宿主对象上取/建贸易账本。
 *
 * 建行只此一处：写者现在有两个（terminal-manager 记决策现场、terminal-market 记采购侧），
 * 两边各自 `??=` 一份字面量的话，字段漂移不会被任何检查发现 —— 而这份账的全部意义就是
 * 「线上看到的和代码写的是同一份」。
 */
export function ensureTradeLedger(host: { tradeLedger?: TradeLedger }): TradeLedger {
  return (host.tradeLedger ??= createTradeLedger());
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
    demandsLive: 0,
    demandTop: "",
    demandsPublished: 0,
    publishedAt: 0,
    demandsComputed: 0,
    attemptedAt: 0,
    buyBlockedBy: "",
    buyNoMatch: 0,
    buyGatePrice: 0,
    buyBestAsk: 0,
    buyTried: 0,
    buyOk: 0,
    buyDeficitPriority: 0,
  };
}
