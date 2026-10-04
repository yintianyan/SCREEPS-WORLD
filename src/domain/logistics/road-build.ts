/**
 * 通勤建路账本 —— 「这条路到底有没有人施工」的六个计数。
 *
 * 为什么要有：远矿 road site 挂到全帝国车道上限（20）而**建成道路恒为 0**，这件事从
 * 2026-09-23 查到现在定不了案。原因是现场只给了一个数（`site.progress`），而三种归因
 * 都能解释它：① 落点与通勤线不相交（没机会施工）；② 有机会但每趟只点一下、进度被摊薄
 * （施工强度不够）；③ 满载腿把能量先交出去了、轮到此格时背包已空（有力气没能量）。
 * 三者要的动作完全不同（①改规划落点、②改车道数或选择键、③改施工时机），靠推理挑一个
 * 已经错过三次 —— 这份账本就是用来把「推理」换成「读数」的。
 *
 * 纯数据契约 + 一个归因函数，不碰 Game/Memory（本层不得触运行时全局，也不被内核值导入，
 * 所以这里只出类型与判据，**建行处唯一在 `kernel/global-cache.roadBuildCounters()`**）。
 * 记数是 `creeps/roles/remote-hauler.ts` 的脚下建路，读者是 road-planner（建成侧）、
 * telemetry 快照与体检脚本。
 */

/** 单房累计计数（heap，自本次进程启动起；global reset 归零）。 */
export interface RoadBuildCounters {
  /** 进入脚下建路的次数 ≈ 通勤 tick 数（分母）。 */
  calls: number;
  /** 因背包无能量早退的次数（情形③的直接证据）。 */
  noEnergy: number;
  /**
   * 情形③的**可行动拆分**：`noEnergy` 那一拍本就有 WORK、且射程（range≤3）内确实有自己的 site
   * 的次数 —— 即「只要背包里留着能量，这一拍就会真建上」。
   *
   * 为什么要单独立一列：`classifyRoadBuildAttempt` 先判能后判人（本文件注释自己承认 `noEnergy`
   * 会盖住双重缺陷），于是 2026-10-04 线上 `W36S58` 的 `noEnergy=3,216` 里**有多少落在射程内**
   * 账本答不出来 ⇒ 「让空载腿留 200-300 能量」这条修法的收益无法定价（见 #111/R286）。
   * 不变式：`noEnergyInRange ≤ noEnergy`（它是子集，不是并列桶），所以两者**不可相加**。
   */
  noEnergyInRange: number;
  /**
   * 因 body 无 WORK 早退的次数。
   *
   * ⚠️ 这一列在 2026-10-04 之前读到 0，本文件曾据此写「该归因已被证伪」——**那句话现在作废**：
   * 只读探针（R316）普查 10 台 remoteHauler 的 body，W36S58/W37S57/W37S58 是 `[1W 20C 21M]`，
   * 而 W38S56(3 台)/W39S56(1 台) 是 `[0W 16C 16M]` —— 0 WORK 是 `bodies.ts` 里按
   * `energyCapacityAvailable`  affordable 出来的**合法档位**，不是坏 creep。首轮的 0 只说明
   * **那两条走廊当时用的是带 WORK 的档**，不说明这条通道不存在。
   */
  noWork: number;
  /**
   * `noWork` 那一拍射程（range≤3）内确实有自己的 site 的次数 —— 即「body 补一个 WORK 就会真建上」。
   *
   * 为什么必须有：`noEnergyInRange` 的前置是 `workParts > 0`（那一类的动作是留能量），于是
   * 0-WORK 走廊里 `noEnergyInRange` **恒为 0** —— 那是仪器的结构性盲区，不是「这条线没机会」。
   * 少了这一列，#111 的「远矿 hauler 要不要设 WORK 下限」只能靠推理（会错第四次的方向）。
   *
   * 两条不变式：`noWorkInRange ≤ noWork`（子集，**不可与父桶相加**）；
   * 与 `noEnergyInRange` **互斥**（前置条件分别是 `workParts === 0` / `> 0`），所以两列**可以相加**，
   * 和的含义是「这一拍有能、有人差其一，且脚下就有格」= 可行动机会总数。
   * 「既无能量又无 WORK」的那一类故意不记 —— 两个动作都缺，留着能量或换 body 单独都不构成施工机会。
   */
  noWorkInRange: number;
  /** 本房一个自己的 site 都没有的次数（规划器没铺，或视野/缓存为空）。 */
  noSiteAtAll: number;
  /** 有 site 但射程（range≤3）内一个都不在的次数（情形①的直接证据）。 */
  outOfRange: number;
  /**
   * 上面那些 outOfRange 里，「最近的自己的 site 有多远」的分桶（只在有能有人时统计）。
   *
   * 为什么必须再分一层：2026-09-28 的首轮账本实测 `outOfRange` 占绝对多数
   * （W36S58 72 次里 59 次、W37S57 33 次里 28 次），这判死了「没 WORK 所以不建」和
   * 「背包空」两条，但**判不了 ① 的具体形状** —— 差 4 格（把施工射程放宽就够）与
   * 差 20 格（site 压根下在另一条线上，得按走过的路重下）是两个完全不同的动作。
   */
  outOfRangeNear: number;
  /** 最近 site 在 6-10 格的次数。 */
  outOfRangeMid: number;
  /** 最近 site 在 11 格以外（含跨房/对角出口）的次数。 */
  outOfRangeFar: number;
  /** 真正发出且被引擎接受的 build() 次数。 */
  built: number;
  /** 发出 build() 但引擎拒绝的次数（ERR_*）。 */
  buildRejected: number;
  // ── 以下三个由 road-planner（有视野那一侧）写，不是 creep 侧计数 ──
  /** 本房我方 road site 的 progress 之和（两次快照的差 = 真实施工速率）。 */
  roadProgressSum: number;
  /** 待建 road site 数（progress < 满额）。 */
  roadSitesPending: number;
  /** **已建成**的 road 条数 —— 判「这条路有没有了」只看这个，progress 会骗人（路会衰减）。 */
  roadsBuilt: number;
}

/**
 * 「最近的一个自己的 site 有多远」分桶 —— 把 outOfRange 拆成可行动的形状。
 * 边界按施工可行性选：4-5 格是「放宽一点射程就能建」，6-10 格是「同一条走廊但铺错了段」，
 * 11 格以上是「根本在另一条线上」。
 */
export function roadBuildRangeBucket(
  minRange: number,
): "outOfRangeNear" | "outOfRangeMid" | "outOfRangeFar" {
  if (minRange <= 5) return "outOfRangeNear";
  if (minRange <= 10) return "outOfRangeMid";
  return "outOfRangeFar";
}

/**
 * 判一次脚下建路的结局 —— 纯函数，把「为什么这一拍没建成」归到唯一一个桶里。
 *
 * 早退顺序与执行侧一致（先看能量、再看 WORK），因为这就是代码真实的走向：
 * 先判能才判人，`noEnergy` 会盖住「同一拍也无 WORK」这种双重缺陷 —— 可接受，
 * 我们要的是「这一拍为什么不施工」的第一因，不是全部因。
 *
 * @param energyInStore 背包里的能量
 * @param workParts body 的 WORK 部件数
 * @param siteCount 本房我方 site 总数（含非 road）
 * @param inRangeCount 射程（range≤3）内的 site 数
 */
export function classifyRoadBuildAttempt(input: {
  energyInStore: number;
  workParts: number;
  siteCount: number;
  inRangeCount: number;
}): keyof RoadBuildCounters | "proceed" {
  if (input.energyInStore <= 0) return "noEnergy";
  if (input.workParts === 0) return "noWork";
  if (input.siteCount === 0) return "noSiteAtAll";
  if (input.inRangeCount === 0) return "outOfRange";
  return "proceed";
}
