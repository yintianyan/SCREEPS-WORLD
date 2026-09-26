import type { ColonyState } from "../../kernel/contracts";
import { CONFIG } from "../../config";

/**
 * 殖民相位（Colony Phase）— 每房经济状态的唯一权威来源，替代散落各处的
 * 经济判断（crisis.ts / computeColonyState / 局部阈值），每 tick 每房算一个
 * 统一相位映射为 ColonyState 供所有系统消费。核心信号是总储备趋势
 * （reserveDelta = 收入 − 支出）：<5W harvester 下 source 再生(10/tick)快于采集、
 * source 常满，不能当失败信号，而总储备趋势直接反映经济盈亏。
 */

export type ColonyPhase = "bootstrap" | "growth" | "crisis" | "recovery" | "steady";

/**
 * source 平均填充率（0..1）—— 「采集塌方」信号（PhaseInput.srcRatio）的口径定义。
 *
 * 为什么取平均而不是最满：source 数 > harvester 数时，没被分配的那颗**必然**满载，
 * max 口径于是恒 >0.9 —— 实测 5-source 房 srcStall 常驻 8730/9000 tick，把「编制不满」
 * 报成「采集塌方」，而 P0-1 通道是绕过迟滞直接进危机带的。真塌方（harvester 死绝、
 * body 退化采不动）时所有 source 一起满，平均口径照样越过 0.9 抓到，灵敏度没被换掉。
 */
export function averageSourceFillRatio(
  sources: readonly { energy?: number; energyCapacity?: number }[],
): number {
  let sum = 0;
  let counted = 0;
  for (const s of sources) {
    const cap = s.energyCapacity ?? 3000;
    if (cap <= 0) continue;
    sum += Math.min(1, (s.energy ?? 0) / cap);
    counted++;
  }
  return counted > 0 ? sum / counted : 0;
}

/** 单次评估的输入信号（由 room-observer 从快照 + creep 统计得出）。 */
export interface PhaseInput {
  /** 总储备 = energyAvailable + 所有 container + storage 的能量。 */
  reserve: number;
  /** 立即可用于孵化的能量（spawn+extension），用于观测记录。 */
  spendable: number;
  /**
   * 可达能量占比 = spendable / energyCapacity（0..1）— 流动性维度核心信号：
   * 低值（< liquiditySpendableRatio）= spawn 实际破产，即使总储备很高。
   */
  spendableRatio: number;
  /**
   * 冻结能量占比 = 最满 container 的填充率（0..1）。与低 spendableRatio
   * 同时出现 = 流动性陷阱（W37S58 实测：spendableRatio≈5%、frozenRatio≈94%、
   * 0 hauler → 永久死锁）。
   */
  frozenRatio: number;
  /** harvester + worker 数量。 */
  harvesterCount: number;
  sourceCount: number;
  rcl: number;
  /**
   * 最满 source 的填充率（0..1）。> srcRatioTrap 持续 = source 满载但采不动。
   * P0-1 病灶 1：双维度分数看不到采集塌方（harvester 退化致采集塌方但 source
   * 持续满载、spawn 健康）— srcRatio + storageDrainRate 双条件强制 crisis 通道
   * 绕过迟滞。NaN（数据缺失）按 0 处理（保守不触发）。
   */
  srcRatio: number;
  /**
   * Storage 单 tick 净流出（E，负值=流失）；无 storage 时为 0。作为
   * storageDrainAccum 的累积源（P0-1）：srcRatio>0.9 期间流失累加、回填抵消。
   * 旧单 tick drainRate<-2 判定已弃 — 流失是稀疏大脉冲，单 tick 差分
   * 大部分=0 无法持续触发。
   */
  storageDrainRate: number;
  /**
   * P2-3：Storage 水位（0..1）。满仓豁免：forceCrisis 在 storage 高水位
   * （> forceCrisisStorageHigh）时不触发 — 满仓时流失是正常消费（upgrader 取能），
   * 避免「满仓 → crisis → upgrader 冻结 → link 死锁」正反馈。无 storage 为 undefined。
   */
  storageRatio?: number;
}

/** 跨 tick 持久化的相位状态（存入 room memory）。 */
export interface PhaseState {
  phase: ColonyPhase;
  /** 上次观测的总储备，用于算 reserveDelta；首次观测为 undefined。 */
  prevReserve?: number;
  /** 0..100 的「赤字分数」（偿付能力维度），持续入不敷出时累加，用于迟滞。 */
  drainScore: number;
  /**
   * 0..100 的「流动性分数」（流动性维度），流动性陷阱（spawn 破产 + 能量冻在
   * container）持续时累加。与 drainScore 独立：W37S58 drainScore=0（总储备在涨）
   * 但 liquidityScore 爆表。
   */
  liquidityScore: number;
  /**
   * 流动性陷阱连续成立的评估次数（{@link PhaseOptions.liquidityEnterTicks} 的驻留计数）。
   * 陷阱一断即归零 —— 防两段互不相干的瞬时陷阱跨 tick 累加成"看起来持续"的死锁。
   * 旧 Memory 无此字段按 0 处理（无需迁移：缺席即"还没开始踩"，不改变任何既有语义）。
   */
  liquidityTrapTicks?: number;
  /** 危机带（crisis/recovery）内已持续的评估次数 — 最短驻留时间用；进带从 1 起计，出带归 0。旧 Memory 无此字段按 0（v14 迁移回填）。 */
  bandTicks?: number;
  /** P0-1：srcRatio 满载 + storage 流失双条件持续的评估次数；任一条件不满足立即归零，达 srcStallEnterTicks 后强制 crisis 绕过迟滞。 */
  srcStallTicks?: number;
  /**
   * 欠员（`harvesterCount < 编制下限`）连续成立的评估次数 —— {@link PhaseOptions.bootstrapEnterTicks}
   * 的驻留计数，一断即归零。同 liquidityTrapTicks：**不在 room-state 读写两侧都持久化，
   * 就等于静默关掉这道闸**（每 tick 被当 0 重数，闸永远开不了）。
   * 旧 Memory 无此字段按 0 处理（缺席即"还没开始踩"，无需 schema 迁移）。
   */
  bootstrapTicks?: number;
  /**
   * P0-1：srcRatio>0.9 期间 storage 累积净流失量（正值=失血）。流失累加、
   * 回填抵消（max(0) 不为负）、srcRatio≤0.9 归零。替代旧单 tick 判定 —
   * 流失是稀疏大脉冲（每~235tick 一次 -800），单 tick 差分大部分=0，
   * 累积量才能捕获间歇性失血。
   */
  storageDrainAccum?: number;
}

/** evaluateColonyPhase 的返回值：新状态 + 本次观测信号（供记录/调参）。 */
export interface PhaseResult extends PhaseState {
  reserveDelta: number;
}

export interface PhaseOptions {
  /** 赤字分数达到此值进入 crisis。 */
  drainEnterScore: number;
  /** 赤字分数降到此值退出 crisis（进入 recovery）。 */
  drainExitScore: number;
  /** recovery 降到此值彻底脱离（进入 growth/bootstrap/steady）。 */
  recoveryClearScore: number;
  /**
   * 流量口径：每累积多少**净流失能量**记 1 分（修法 A）。
   * 旧写法是「赤字 tick +15 / 其余 −40」的**次数计**，于是一间房的相位取决于赤字脉冲
   * 怎么排布，而不是它到底在不在失血：实测同一套 5-source 夹具连跑两次，一次
   * crisis+recovery 占 71.6%（reserve 2100）、一次 0%（reserve 6947），而那一局的
   * 总账其实是**盈余的**（赤字合计 5519 vs 盈余合计 7230）。
   * 默认 3 E/分 ⇔ 进入 crisis 需要净流失 450 E 未被抵销（drainEnterScore=150 × 3）。
   * 标定来自实测：开发房 |赤字| p50=3 / p90=10 / p99=20，战争房豁免后 p50=60。
   */
  drainEnergyPerPoint: number;
  /**
   * 盈余侧的折算偏置：同样大小的能量变动，盈余消分的效力是赤字积分的 recoveryBias 倍。
   * 沿用次数计时代的非对称比（recoveryStep/scoreStep = 40/15 ≈ 2.67）—— 保留"恢复比
   * 下降更快"的破振荡设计，只是把两边都改成按流量算。
   */
  recoveryBias: number;
  /**
   * 危机带出口之二：连续静止多少 tick 之后才开始慢消分（0 = 关闭该通道）。
   *
   * 为什么需要：旧实现里 `reserveDelta === 0` 既不加也不减，分数原地冻结 ——
   * crisis 带**没有出口**。生产塌到极致的房（creep 全灭、收支都不再变动）会永远
   * 停在 crisis，而 crisis 把 economyPressure 钉在 1.0、永久压住建造与升级，
   * 恰恰是这种尸房最需要的恢复通道。
   *
   * 为什么要"已在带内 + 恰好静止"而不是每 tick 慢消：零变化 tick 不消分是**故意的**
   * （见 `phase.test.ts`「零变化 tick 不再主动消分（慢性失血因此可见）」与
   * 「每 3 tick 一次的稀疏失血照样攒进危机带」）—— 真实慢性失血表现为
   * "大部分 tick 为 0、偶尔一个大赤字脉冲"，任何固定的每 tick 消分都会按比例削掉
   * 这条通道的灵敏度（实测 0.5/tick 会把 45 tick 攒到 150 分的标定推出危机）。
   * 而"爬向危机"阶段 bandTicks 还没开始计，间歇失血在带内又始终有 points>0，
   * 两者都不受本通道影响；被消掉的只有"进了带、然后什么都不再发生"的房。
   *
   * 200 tick ≈ 4 个经济采样周期（50t），够长到不会把短暂平稳误判成尸房。
   */
  idleDecayTicks: number;
  /** 超过 `idleDecayTicks` 的连续静止后，每 tick 消解的分数（进带 150 → 出带 30 需再 240 tick）。 */
  idleRecoveryStep: number;
  /**
   * 单 tick 积分上限（分）：一次异常大的支出脉冲不得独自把房推进危机带
   * （实测战争房有 −22540 的单 tick；60 分 = 180 E/tick 的计入上限）。
   * 持续失血仍可正常累积到 drainEnterScore。
   */
  drainStepCap: number;
  /**
   * 流动性陷阱阈值：spendableRatio 低于此视为 spawn 破产（可达能量不足）。
   * W37S58 实测≈5%；健康房物流正常时 hauler 持续补 spawn，远高于此。
   */
  liquiditySpendableRatio: number;
  /** 流动性陷阱阈值：frozenRatio 高于此视为能量积压。与低 spendableRatio 同时成立才判定 — 单独 container 满是正常物流中转。 */
  liquidityFrozenRatio: number;
  /** 流动性陷阱时每次评估的分数增加量。 */
  liquidityStep: number;
  /** 流动性恢复时每次评估的分数减少量（> liquidityStep，非对称迟滞防振荡）。 */
  liquidityRecoveryStep: number;
  /**
   * 流动性陷阱需**连续**成立多少次评估才开始计分（0 = 关闭驻留要求）。
   *
   * 为什么需要：陷阱判据（口袋占比低 + 最满 container 满）量的是一次孵化脉冲的瞬时形状，
   * 而 `liquidityStep=15` 与 `drainEnterScore=150` 的组合意味着**连踩 10 tick 就判 crisis**，
   * 紧接着 `minBandTicks=100` 又逼它在带里至少待 100 tick —— 10 tick 的观测噪声换
   * ≥100 tick 的强制危机带。实测（E2E-022 富室战争夹具，逐 tick 序列）：19 段陷阱全部在
   * **3~25 tick** 内自行结束（p50=10），没有一段超过 30 tick，却把一场已经打掉敌方塔的
   * 战争按「危机撤资」取消了（动员掐死动员自己，与 drainScore 通道被 spendableRatio
   * 打掉是同一个形状）。取 50 = 观测最长瞬态的 2 倍，而真正的物流死锁（W37S58：0 hauler，
   * 持续数 tick 万级）照样在 50+10=60 tick 内被抓到 —— 只是把"闪一下就进带"改成"持续卡住才进带"。
   */
  liquidityEnterTicks: number;
  /**
   * 偿付赤字计分门槛：仅当 spendableRatio 低于此值时，储备下降才累加 drainScore —
   * spawn 口袋健康（extension 基本满员）时的储备下降是升级/建造的主动投资，
   * 不是生产崩溃；两者同等计分正是 TD-003 极限环根因之一（normal 恢复支出 →
   * 记赤字 → 收缩支出 → 记盈余 → 秒退 → 循环）。采集者死绝场景由
   * understaffed → bootstrap 兜底，不依赖本分数。
   */
  drainSpendableFloor: number;
  /**
   * 绝对可支付豁免线：总储备 ≥ 此值时，储备下降**不累加 drainScore**。
   *
   * 为什么上面那道（口袋健康）豁免在这里不够用：它的判据是 `spendableRatio`，而**一次大额
   * 孵化本身就会把口袋抽干** —— 花几千能量孵攻击编队的那一 tick，spendableRatio 正好跌破
   * 0.5，于是"我选择花掉它"被记成"我生产不出来"。战争动员期因此必然自造赤字（实测：
   * warPressureTicks=0、storage 仍有余力，却因动员脉冲被判入 recovery 带；而 recovery 会
   * 暂停远矿、降级 body、收缩 spawn 编制**含军事编制** = 动员掐死动员自己）。
   *
   * 用**绝对储备**而不是比例：RCL6 storage 容量 1,000,000，46k 只有 4.6%，永远够不着
   * 0.8 的满仓豁免 —— 比例刻度把发展期房一律判成最低档，是本项目已踩过两次的同型错误
   * （`distributorTiers` 当年由比例制改绝对制、builder 的 B-1 修复同理）。参照系沿用
   * `CONFIG.economy.upgrade.sprintStorage`（"冲刺级盈余"，与项目同一绝对刻度参照系）。
   *
   * 真塌方不靠这条通道兜：采集者死绝由 `understaffed → bootstrap` 抓、采集塌方由
   * `srcRatio + storageDrainAccum` 的 forceCrisis 抓、物流死锁由 liquidityScore 抓 ——
   * 三者都不看 reserve 绝对值，所以本豁免不会把它们一并关掉（各有单测钉住）。
   *
   * 关键安全性质：**豁免自我终止**。判据是当 tick 的 `reserve ≥ 线`，所以一个把储备
   * 往下花的房间一旦跌到 50k 之下就恢复计分 —— 塌方不是被关掉，而是被推迟到缓冲
   * 真的变薄时才开始记账。富室乱花 200k 与穷室失血 2k 走的是同一条收口。
   */
  investmentReserveFloor: number;
  /**
   * 绝对破产兜底线：房里有 storage **且** 总储备低于此值时，直接判 crisis —— 不看分数、
   * 不看交替比例、不看豁免。
   *
   * 为什么必须有：分数体系里有三道"可以合法不算账"的闸门（主动消费豁免、绝对可支付
   * 豁免、迟滞步长），所以"慢性但真实"的失血可能被解释成投资而不进危机带。水位兜底
   * 不吃这些闸门 —— 跌破线即 crisis，与交替比例、步长、豁免全都无关 ⇒ 进场确定；
   * 出场仍走既有 minBandTicks 迟滞，所以它只把"该不该开始收缩"变成确定量。
   *
   * 修前的实测依据（那时分数还是**次数计**，draining +15 / 其余 −40，与亏多少无关）：
   * 一场净烧 6.3 万能量的战争（涓流 +20.8/tick 占 67% 的 tick、脉冲 −88.6/tick 占 33%）
   * 在 97% 的 tick 上 drainScore=0、phase 全程 growth；同一份夹具另一次谷值更高
   * （27,385 vs 5,833）却打满 150 并撤资 —— 判据取决于脉冲排布，那就不是迟滞而是随机。
   * 分数后来改成了流量口径（drainEnergyPerPoint），但这条纯水位兜底保留：它保证
   * "家底真的见底"这一条永远不可能被解释成健康。
   *
   * 为什么只在**有 storage** 时生效：RCL1-3 的房压根没有银行，总储备天然只有几千
   * （source container 2×2000 + 口袋几百 E），同一条绝对线会把整个早期游戏永久钉在危机带，
   * 而它们真正的生存信号是 `understaffed → bootstrap`。本仓的绝对能量刻度
   * （`sustainedStorage` / `sprintStorage`）一直就是 **storage 水位**口径（见 upgrader 取能档），
   * 这里沿用同一口径，不新造尺度。
   *
   * 参照系取 `CONFIG.economy.upgrade.sustainedStorage`(10k) —— "可持续水位"，
   * 与上面那道 50k 豁免线（sprintStorage）同一套刻度、区间不重叠：
   * ≥50k 消费不计赤字；10k~50k 交给分数体系；<10k 无条件进带。
   */
  bankruptReserveFloor: number;
  /**
   * 危机带最短驻留评估次数：进入 crisis/recovery 后至少停留此久才能回 normal —
   * 打破极限环第二道闸（recovery 收缩支出后分数秒清，立即回 normal 则支出恢复、
   * 赤字重积）。副作用：真危机恢复期至少 minBandTicks tick（刻意保守），且
   * crisis 退出必经 recovery 带。
   */
  minBandTicks: number;
  /** P0-1：srcRatio 强制 crisis 通道的填充率阈值（默认 0.9 — 略低于 1.0 给 harvester 通勤留余量，避免 source 短暂回血抖动）。 */
  srcRatioTrap: number;
  /**
   * P0-1：双条件持续多少次评估后强制 crisis。默认 50 tick — 私服快照显示失明路径
   * 持续 31000 tick，50 tick 内可观测真实失血而不误伤正常通勤/孵化脉冲。
   */
  srcStallEnterTicks: number;
  /**
   * P0-1：storage 累积净流失触发阈值。默认 1000 — 实测 crisis 房每~235tick 一次
   * -800，1.2 次即达；正常房 srcRatio 不持续>0.9，accum 归零不误触发。
   */
  storageDrainAccumThreshold: number;
  /** P2-3：forceCrisis 满仓豁免阈值 — storageRatio 超过此值不触发（满仓时流失是正常消费，不是采集失败）。默认 0.8。 */
  forceCrisisStorageHigh: number;
  /**
   * 欠员判据的最低编制（= 采集端"站住人"的人数），与 spawn 侧 `roles.harvester.minCount`
   * 同源。**不跟 source 数比** —— 见 evaluateColonyPhase 内 `understaffed` 的注释：
   * 那样会让 source 多而编制自然的房永久停在生存带（反常激励）。
   */
  harvesterMinStaffing: number;
  /**
   * 欠员需连续成立多少个评估周期才把房间标成 bootstrap（一断即归零）。
   * 取值 20 来自实测：真实的替换/开局窗口是 45t 与 98t，而"一只 harvester 刚死、
   * 替补还没落地"的闪断是 1t 与 12t —— 阈值必须落在两者之间。默认撤资反应是即时的
   * （bootstrap 属生存带），所以这道闸保护的是"战争不被一 tick 的排布掐掉"。
   */
  bootstrapEnterTicks: number;
}

export const DEFAULT_PHASE_OPTIONS: PhaseOptions = {
  // 迟滞带加宽：进入 crisis 需 150 分，退出需降到 30。
  // 旧值 100/40 在 ec=300 时 4 tick 即触发，导致 phase 在 growth↔crisis 间高频振荡。
  drainEnterScore: 150,
  drainExitScore: 30,
  recoveryClearScore: 5,
  // 流量口径（修法 A）：每 3 E 未抵销的净流失记 1 分 ⇒ 进危机带需要净亏 450 E。
  // 标定：开发房实测 |赤字| p50=3 / p90=10 / p99=20，战争房豁免后 p50=60。
  drainEnergyPerPoint: 3,
  // 沿用次数计时代的非对称比 40/15：盈余消分比赤字积分快，破临界振荡的设计不变。
  recoveryBias: 40 / 15,
  // 连续静止 200 tick 后才开始以 0.5 分/tick 慢消分：给 crisis 带一个出口，
  // 又不吃掉间歇性失血的计分灵敏度。理由详见字段注释。
  idleDecayTicks: 200,
  idleRecoveryStep: 0.5,
  // 单 tick 最多积 60 分（=180 E/tick）：一次脉冲不得独自判危机。
  drainStepCap: 60,
  // 流动性陷阱收紧：ec=300 时 spendableRatio<0.3 太容易触发（spawn 空=常态）。
  // 0.15 → ec=300 时需 spendable<45 才触发；0.8 → container 80%+ 才算积压。
  liquiditySpendableRatio: 0.15,
  liquidityFrozenRatio: 0.8,
  // 非对称步长：陷阱累积慢（15/tick），恢复快（50/tick）——交替场景下净 -35/tick。
  liquidityStep: 15,
  liquidityRecoveryStep: 50,
  // 陷阱需连续成立 50 次评估才开始计分：实测富室战争房的瞬态全在 25 tick 内自清，
  // 而真死锁（无 hauler/无搬运）会一直踩着 —— 50 tick 只杀前者。详见字段注释。
  liquidityEnterTicks: 50,
  // 主动消费豁免：spendableRatio ≥ 0.5（spawn 口袋过半）时储备下降不计赤字。
  // 0.5 给 spawn 补能延迟留余量：孵化脉冲后 hauler 回填需数 tick，健康房常态在 0.5 以上。
  drainSpendableFloor: 0.5,
  // 绝对可支付豁免线：沿用项目既有的绝对能量参照系（= upgrade.sprintStorage，冲刺级盈余）。
  // 详见 PhaseOptions 注释：spendableRatio 那道豁免会被大额孵化本身打掉，比例制水位又永远
  // 够不着发展期房 —— 两条都不足以把"选择花钱"与"生产崩溃"分开。
  investmentReserveFloor: CONFIG.economy.upgrade.sprintStorage,
  // 破产兜底线：同一套绝对刻度的下一档（"可持续水位"）。仅在房里有 storage 时生效。
  bankruptReserveFloor: CONFIG.economy.upgrade.sustainedStorage,
  // 最短驻留 100 次评估（room-state 每 tick 评估 → 100 tick）：
  // 覆盖一轮 creep 孵化 + 通勤周期，让 recovery 期真正攒出缓冲，而非形式性过场。
  minBandTicks: 100,
  // P0-1：srcRatio 强制 crisis 通道阈值（病灶 1 — 采集塌方失明）。
  // 私服快照显示 srcRatio=1.0 + storage 流失 12 E/tick 持续 31000 tick 仍判 normal。
  srcRatioTrap: 0.9,
  srcStallEnterTicks: 50,
  storageDrainAccumThreshold: 1000,
  // P2-3：满仓豁免 — storage 80% 以上时 forceCrisis 不触发。
  // 满仓时 storage 流失是正常消费（upgrader 取能），不是采集失败。
  forceCrisisStorageHigh: 0.8,
  // 欠员判据的最低编制：与 spawn 侧的 harvester 下限同源（两处脱钩就会重新制造永久 bootstrap）。
  harvesterMinStaffing: CONFIG.roles.harvester.minCount,
  // 欠员驻留闸：实测闪断 1t/12t vs 真替换窗 45t/98t，取介于两者之间的 20。
  bootstrapEnterTicks: 20,
};

/**
 * 计算殖民相位（纯函数，带迟滞）。双维度危机模型（方案 C）：
 * 偿付维度 drainScore（reserveDelta<0 持续 → 生产崩溃）与流动性维度
 * liquidityScore（spendableRatio 低且 frozenRatio 高持续 → 物流死锁，W37S58
 * 根因 — 旧模型只量总财富不量流动性，总储备在涨但 94% 冻在 container、
 * spawn 仅 5% 可达仍判 growth）；任一爆表即危机。
 * 相位优先级：crisis > recovery > steady > bootstrap > growth，
 * crisis/recovery 间用 crisisScore 迟滞防临界抖动。
 */
export function evaluateColonyPhase(
  input: PhaseInput,
  prev: PhaseState,
  options: PhaseOptions = DEFAULT_PHASE_OPTIONS,
): PhaseResult {
  // 首次观测无基线，reserveDelta 记 0（不判为赤字）。
  const reserveDelta = prev.prevReserve === undefined ? 0 : input.reserve - prev.prevReserve;

  // ── P0-1：srcRatio 强制 crisis 通道（病灶 1 — 采集塌方失明）──
  // 累积净流失判定：srcRatio>0.9 期间累积 storage 流失量，超阈值视为采集塌方。
  // 替代旧单 tick drainRate<-2 判定 — 实测流失是稀疏大脉冲（每~235tick 一次
  // -800，大部分 tick 静止），单 tick 差分=0，srcStallTicks 反复归零到不了 50；
  // 累积量才能捕获间歇性失血。流失累加、回填抵消；srcRatio≤0.9 归零（采集正常）。
  // NaN（source 数据缺失）>0.9 为 false → 保守按 0 不触发。
  const srcRatioHigh = input.srcRatio > options.srcRatioTrap;
  const drainAccumDelta = -input.storageDrainRate; // 流失为正（storageDrainRate 负=流失）
  const storageDrainAccum = srcRatioHigh
    ? Math.max(0, (prev.storageDrainAccum ?? 0) + drainAccumDelta)
    : 0;
  // P2-3：满仓豁免 — storage 高水位时流失是正常消费，不是采集失败。
  // 避免"满仓 → crisis → upgrader 冻结 → link 死锁"的正反馈循环。
  const storageHigh = (input.storageRatio ?? 0) > options.forceCrisisStorageHigh;
  const srcStalled =
    srcRatioHigh && storageDrainAccum > options.storageDrainAccumThreshold && !storageHigh;
  // 任一条件不再满足时立即归零，防残留累积导致误触发。
  const newStallTicks = srcStalled ? (prev.srcStallTicks ?? 0) + 1 : 0;
  const forceCrisis = newStallTicks >= options.srcStallEnterTicks;

  // ── 偿付能力维度：drainScore ──
  // 主动消费豁免（TD-003 根因 A）：spawn 口袋健康时的储备下降是升级/建造投资，
  // 只有「储备下降 且 可孵化能量吃紧」才视为生产端失血。
  // 第二道豁免（绝对可支付）：口袋那道会被大额孵化本身打掉（花钱的那一 tick 正是 spendable
  // 最低的一 tick），所以再加「总储备绝对水位足够」也不算赤字 —— 见 PhaseOptions 注释。
  const investing = input.reserve >= options.investmentReserveFloor;
  const draining =
    reserveDelta < 0 && input.spendableRatio < options.drainSpendableFloor && !investing;
  // 流量口径（修法 A）：分数按 |reserveDelta| 折算，而不是"赤字一次 +15 / 其余 −40"的
  // 次数计 —— 一间房该不该收缩，取决于它在不在真失血，不取决于脉冲怎么排布。
  // 非对称性保留（盈余消分效力 ×recoveryBias），只是两边都按能量折算。
  const points = Math.abs(reserveDelta) / options.drainEnergyPerPoint;
  // 危机带出口之一：已在带内待够 idleDecayTicks、且这一 tick 总储备**恰好没动**
  // （既无赤字也无盈余）→ 慢消分。旧写法在此处既不加也不减，分数原地冻结，
  // 塌到收支都不再变动的尸房会永久停在 crisis，而 crisis 把 economyPressure
  // 钉在 1.0、永久压住它最需要的建造与升级通道。
  // 用「已在带内 + 恰好静止」而不是"每 tick 固定消分"，是为了不吃掉间歇性失血
  // 的灵敏度：爬向危机的阶段不在带内（不动那条 45 tick 标定），带内真实失血的
  // 房每 tick 都有 points>0（不走这个分支），被抵消的只有"真的什么都没发生"。
  const idleDecaying =
    options.idleDecayTicks > 0 &&
    points === 0 &&
    !draining &&
    (prev.bandTicks ?? 0) > options.idleDecayTicks;
  const delta = draining
    ? Math.min(options.drainStepCap, points)
    : idleDecaying
      ? -options.idleRecoveryStep
      : -points * options.recoveryBias;
  const drainScore = Math.max(0, Math.min(options.drainEnterScore, prev.drainScore + delta));

  // ── 流动性维度：liquidityScore ──
  // 流动性陷阱 = spawn 破产（可达能量占比低）且能量积压（最满 container 填充率高）。
  // 两者必须同时成立：单独 container 满是正常物流中转（hauler 正在搬）；
  // 单独 spawn 空是孵化脉冲消耗（马上被 hauler 补回）。同时持续 = 搬运能力不足 = 真死锁。
  const liquidityTrap =
    input.spendableRatio < options.liquiditySpendableRatio &&
    input.frozenRatio > options.liquidityFrozenRatio;
  // 驻留闸（liquidityEnterTicks）：陷阱必须连续成立够久才开始计分，一断即归零。
  // 上面那句判据的本意就是「同时**持续**」，但步长配置下连踩 10 tick 就满 150 进 crisis，
  // 把一次孵化脉冲的瞬时形状当成永久死锁 —— 实测瞬态全在 25 tick 内自清（见字段注释）。
  // 未达驻留时按"非陷阱"走回落分支：分数照旧 -liquidityRecoveryStep 衰减，因此 economyPressure
  // （由分数派生，供建造门禁/编制弹性消费）也不会再被一段 25 tick 的 lag 顶到 1.00。
  const liquidityTrapTicks = liquidityTrap ? (prev.liquidityTrapTicks ?? 0) + 1 : 0;
  const liquidityTrapped = liquidityTrapTicks >= options.liquidityEnterTicks;
  const liquidityDelta = liquidityTrapped ? options.liquidityStep : -options.liquidityRecoveryStep;
  const prevLiquidity = prev.liquidityScore ?? 0;
  const liquidityScore = Math.max(
    0,
    Math.min(options.drainEnterScore, prevLiquidity + liquidityDelta),
  );

  // ── 合并双维度：任一爆表即危机 ──
  const crisisScore = Math.max(drainScore, liquidityScore);

  // ── 绝对水位兜底（不进分数体系）──
  // 分数现在按流量计（见 drainEnergyPerPoint），但它仍有三道合法闸门会把真实失血算成
  // "不是问题"：主动消费豁免（spendableRatio）、绝对可支付豁免（investmentReserveFloor）、
  // 以及迟滞带本身的非对称衰减。修前的次数计版本更严重 —— 实测同一份夹具三次运行给过
  // 「谷值 5,833 全程 growth」「谷值 27,385 打满撤资」「谷值 11,611 平安过完」三种结论，
  // **判据取决于脉冲排布**，那就不是"迟滞"而是"随机"。
  // 兜底刻意做成**纯水位判据**：跌破线即进危机带，与交替比例、步长、豁免全都无关 → 进场确定。
  // 出场仍走既有迟滞（下一 tick 起 inCrisisBand 成立，会停在 recovery 直到 minBandTicks 满），
  // 所以它只把"该不该开始收缩"变成确定量，不把"可以恢复支出"的防抖拆掉。
  // 它也不替代流量口径（那是另一件事：中位水位的慢性失血仍会看不见），只是保证
  // "家底真的见底"这一条永远不可能被解释成健康。
  // 有银行才谈得上破产：PhaseInput.storageRatio 为 undefined 即房里没有 storage（RCL1-3），
  // 这类房的总储备天然只有几千，拿同一条绝对线会把整个早期游戏永久钉进危机带 ——
  // 它们的生存信号本就是 `understaffed → bootstrap`。
  const hasBank = input.storageRatio !== undefined;
  const bankrupt = hasBank && input.reserve < options.bankruptReserveFloor;

  // 欠员 = 采集端没站住人 —— 与 spawn 侧的**最低编制**同源，而不是跟世界给的 source 数比。
  // 旧写法 `harvesterCount < sourceCount` 隐含「1 只 harvester 只能服务 1 个 source」，
  // 撞上 maxCount=4 就让 source≥5 的房永远欠员、永久 bootstrap（实测 8730/9000 tick）。
  // 只按上限截断（min(source, maxCount)）是不够的：实测同一套夹具里 2-source 房
  // growth 2500/2500，而 5-source 房仍 bootstrap 2489/2500 —— 因为需求侧自然只保持 ~2 只，
  // 于是"资源更好的房反而拿不到正常相位"这个反常激励原封不动。
  // "采不动"（吞吐不足）这层含义不在这里判：那是 srcRatio(平均口径)+storage 流失的
  // P0-1 通道，两者不重叠。
  const staffingFloor = Math.max(1, Math.min(options.harvesterMinStaffing, input.sourceCount));
  const understaffed = input.harvesterCount < staffingFloor;
  // 驻留闸（bootstrapEnterTicks）：欠员需**连续**成立够久才把房间标成 bootstrap，一断即归零。
  // 为什么必须有：bootstrap 属经济生存带，posture 的「危机撤资」在它出现的第 1 tick 就把
  // war 降回 fortify —— 而这条判据是**瞬时人头数**，一只 harvester 阵亡、替补还没落地的
  // 那一 tick 就够闪断一次。实测（warRoom 2 source / 下限 2）：闪断段长 1t 与 12t，
  // 而真实的替换与开局窗口是 45t、98t ⇒ 阈值取 20：吃掉前者、原样保留后者
  // （只延后 20 tick ≈ 一个孵化+通勤周期）。取 L1 那个 50 反而会把 45t 的真欠员整段抹掉。
  const bootstrapTicks = understaffed ? (prev.bootstrapTicks ?? 0) + 1 : 0;
  const understaffedSustained = bootstrapTicks >= options.bootstrapEnterTicks;
  const inCrisisBand = prev.phase === "crisis" || prev.phase === "recovery";
  // 危机带驻留计数（TD-003 根因 B）：带内每次评估 +1，用于最短驻留判定。
  const bandTicksSoFar = inCrisisBand ? (prev.bandTicks ?? 0) : 0;
  const dwellSatisfied = bandTicksSoFar >= options.minBandTicks;

  // P0-1：强制 crisis 通道优先（绕过迟滞），但只覆盖 phase 字段 —
  // 保留 drainScore/liquidityScore 既有计算，让迟滞分数按真实信号自然演化。
  // 这样 srcRatio 通道恢复时（forceCrisis=false），若 drainScore 仍未清会自然过渡到
  // crisis/recovery，若已清则走 recovery 带（dwellSatisfied 兜底），不会秒退 normal。
  if (forceCrisis) {
    return {
      phase: "crisis",
      prevReserve: input.reserve,
      drainScore,
      liquidityScore,
      liquidityTrapTicks,
      bandTicks: bandTicksSoFar + 1,
      reserveDelta,
      srcStallTicks: newStallTicks,
      storageDrainAccum,
      bootstrapTicks,
    };
  }

  let phase: ColonyPhase;
  // 顺序有意义：understaffed 排在绝对水位兜底**之前** —— 一个既欠员又见底的新房，
  // "bootstrap"（该去孵采集者）是比"crisis"（该收缩一切支出）更有信息量的标签，
  // 而两者都落进经济生存带（phaseToColonyState），生存门禁一个也不会因此松开。
  // 兜底排在 steady 之前：RCL8 而储备只剩 1 万的房不配叫"稳态"。
  if (crisisScore >= options.drainEnterScore) {
    phase = "crisis";
  } else if (inCrisisBand && crisisScore >= options.drainExitScore) {
    phase = "crisis";
  } else if (inCrisisBand && (crisisScore > options.recoveryClearScore || !dwellSatisfied)) {
    // 分数已清但驻留未满 → 停在 recovery 攒缓冲，防止秒退回 normal 后
    // 支出立刻恢复、赤字重新累积的极限环；同时兜住盈余折算（recoveryBias）过大
    // 导致分数从迟滞带直接跳 0、crisis 直切 normal 的路径。
    phase = "recovery";
  } else if (understaffedSustained) {
    phase = "bootstrap";
  } else if (bankrupt) {
    phase = "crisis";
  } else if (input.rcl >= 8) {
    phase = "steady";
  } else {
    phase = "growth";
  }

  const stillInBand = phase === "crisis" || phase === "recovery";
  const bandTicks = stillInBand ? bandTicksSoFar + 1 : 0;

  return {
    phase,
    prevReserve: input.reserve,
    drainScore,
    liquidityScore,
    liquidityTrapTicks,
    bandTicks,
    reserveDelta,
    srcStallTicks: newStallTicks,
    storageDrainAccum,
    bootstrapTicks,
  };
}

/**
 * 将殖民相位映射为 ColonyState（plan §5.4 统一状态）：defense ← 有敌对单位
 * （优先级最高）；bootstrap ← 采集者不足；recovery ← crisis/recovery；
 * normal ← growth/steady。
 */
export function phaseToColonyState(phase: ColonyPhase, hasHostiles: boolean): ColonyState {
  if (hasHostiles) return "defense";
  if (phase === "bootstrap") return "bootstrap";
  if (phase === "crisis" || phase === "recovery") return "recovery";
  return "normal";
}

/**
 * 脆弱新房（claim-secure）护栏谓词 — 「先保级再发展」的前置护栏核心判定。

 * 判定：RCL<4（无 storage 缓冲，能量池薄，一旦 builder 抢能量 controller 极易降级）
 * + controller 临近降级（ticksToDowngrade 低于进入阈值）。
 * RCL4+ 房间已有 storage 缓冲，降级由既有 emergency 豁免（upgraderGate /
 * dynamicStorageLimit 的 isEmergency）处理，不在此列。

 * 用途：room-state 用 {@link computeClaimSecure} 带迟滞写入 roomMem.claimSecure；
 * construction-manager 据此抑制非必要建造、upgrader 据此放宽取能地板。
 */
export function isClaimSecure(rcl: number, ticksToDowngrade: number | undefined): boolean {
  if (rcl >= 4) return false;
  if (ticksToDowngrade === undefined) return false;
  return ticksToDowngrade < CONFIG.economy.claimSecureEnterTtd;
}

/**
 * 带迟滞的 claimSecure 状态记忆（供 room-state 每 tick 持久化到 roomMem.claimSecure）。
 * 进入阈值 claimSecureEnterTtd，退出阈值 claimSecureExitTtd — 双门槛防「保级/发展」
 * 在临界 ttd 高频振荡（与 controllerDowngradeRisk 同款迟滞；ttd 最大值为控制器升级
 * 重置值 20000，故退出阈值取 20000 确保 upgrader 一旦保住 controller 即解除护栏）。
 */
export function computeClaimSecure(
  rcl: number,
  ticksToDowngrade: number | undefined,
  prev: boolean,
): boolean {
  if (rcl >= 4) return false;
  if (ticksToDowngrade === undefined) return false;
  if (prev) return ticksToDowngrade < CONFIG.economy.claimSecureExitTtd;
  return ticksToDowngrade < CONFIG.economy.claimSecureEnterTtd;
}
