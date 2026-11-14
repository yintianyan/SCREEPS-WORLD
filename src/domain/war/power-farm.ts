/** Power Bank 野采决策 — 纯函数层（审计缺口 2：power 供给自给）。 */

/** 目标房内 PB 候选（执行层从 intel 采集）。 */
export interface PowerBankCandidate {
  roomName: string;
  /** intel 归属 home（sponsor 候选 — 就近出兵）。 */
  home: string;
  lastSeen: number;
  powerBank: boolean;
  /** 与 sponsor 的线性距离（roomLinearDistance 口径）。 */
  linearDistance: number;
  /** 我方正在占用该房（远矿 op/扩张目标）— PB 房通常 highway，占用的不选。 */
  occupied: boolean;
  /** 观测到的 PB 剩余 hits（intel 未带时消费方按默认 2M 处理）。 */
  hits?: number;
  /** PB 预计消失 tick（powerBankUntil）；未知时按任务超时预算。 */
  until?: number;
  /** PB 内含 power 数量（决定 collector 规模与最低价值门）。 */
  power?: number;
}

/** selectPowerBankTarget 的选项。 */
export interface PowerFarmOptions {
  /** intel 新鲜度上限（tick）— PB 5000 tick 消失，旧情报大概率已扑空。 */
  freshness: number;
  /** 派遣最大线性距离（房）。 */
  maxRange: number;
}

/** 选择野采目标：新鲜 intel 确认 PB 存在 + 距离内 + 未占用，最近者优先。 */
export function selectPowerBankTarget(
  candidates: readonly PowerBankCandidate[],
  tick: number,
  opts: PowerFarmOptions,
): PowerBankCandidate | undefined {
  let best: PowerBankCandidate | undefined;
  for (const c of candidates) {
    if (!c.powerBank) continue;
    if (c.occupied) continue;
    if (tick - c.lastSeen > opts.freshness) continue;
    if (c.linearDistance > opts.maxRange) continue;
    if (!best || c.linearDistance < best.linearDistance) best = c;
  }
  return best;
}

/**
 * 野采任务是否超时收摊（编队往返 + 击破 + collector 捡运的总预算）。
 * PB 自身 5000 tick 消失 — 超时大概率 PB 已没了，止损回收编队。
 */
export function isPowerFarmTimedOut(since: number, tick: number, timeout: number): boolean {
  return tick - since > timeout;
}

/**
 * 战损止损：非寿终损失数超编队规模 × 倍数判消耗失败。
 * PB 房无塔（highway），超出自然换代的损耗只可能是路途 NPC/玩家截杀 — 止损停手。
 */
export function isPowerFarmAttritionLost(
  losses: number,
  squadTotal: number,
  casualtyMultiplier: number,
): boolean {
  return losses > squadTotal * casualtyMultiplier;
}

/** 编队名册对账结果。 */
export interface PowerFarmRosterDiff {
  /** 非寿终消失的成员数（≈ 战损/事故/主动回收），用于止损。 */
  losses: number;
  /** 本轮新观测到的成员数（≈ 真实孵化），仅用于事件统计。 */
  spawned: number;
  /** 本轮名册：成员名 → 观测时剩余寿命（tick），供下一轮对账。 */
  roster: Record<string, number>;
}

/**
 * 编队份额拆分（多 sponsor 协同）：第 index 个 sponsor 拿
 * floor(total/count) + (index < total%count ? 1 : 0) — 均摊且确定性，
 * 多房各出一份，孵化并行、能量/boost 负担分摊。
 */
export function splitShare(total: number, index: number, count: number): number {
  if (count <= 1) return total;
  const base = Math.floor(total / count);
  return base + (index < total - base * count ? 1 : 0);
}

/**
 * 编队名册对账（纯函数）。
 *
 * 为什么不再用「累计提交孵化请求数」当战损账本：请求 TTL(1000) 到期或跨任务误删后
 * 会被重新提交，每次都 +1 —— 编队还活着也会被判「超编队 × 倍数」收摊。私服实测
 * W6N0/W10N1 两条任务：编队 6 人全员存活、PB 仍有 179–195 万 hits，却因 spawned=12
 * 反复收摊，10 只 attacker/healer 留在 PB 房空转。
 *
 * 改为比较前后两轮的实际存活名册，并用剩余寿命把「寿终」从战损里剔除：
 * - 上轮 TTL > naturalDeathTtl、本轮消失 → 非寿终，计战损；
 * - 上轮 TTL ≤ naturalDeathTtl 后消失 → 视为自然死亡/临近回收，不计战损；
 * - 本轮新出现的名字 → 真实孵化数 +1。
 *
 * `previous` 缺失（任务新开/刚部署）时只播种名册：不计战损，spawned = 当前人数。
 */
export function reconcilePowerFarmRoster(
  previous: Readonly<Record<string, number>> | undefined,
  current: Readonly<Record<string, number>>,
  naturalDeathTtl: number,
): PowerFarmRosterDiff {
  const prev = previous ?? {};
  let losses = 0;
  let spawned = 0;
  if (previous === undefined) {
    spawned = Object.keys(current).length;
  } else {
    for (const [name, ttl] of Object.entries(prev)) {
      if (current[name] === undefined && ttl > naturalDeathTtl) losses++;
    }
    for (const name of Object.keys(current)) {
      if (prev[name] === undefined) spawned++;
    }
  }
  return { losses, spawned, roster: { ...current } };
}

// ─── 编队规模 / 可行性（PB 反弹伤害 + 时间窗） ──────────────

/** 引擎事实：ATTACK 30 dmg/part/tick，HEAL 12 hits/part/tick，PB 反弹 50%。 */
const ATTACK_POWER_PER_PART = 30;
const HEAL_POWER_PER_PART = 12;
const POWER_BANK_REFLECT_RATIO = 0.5;

/** 编队单个 body 档位的规划输入。 */
export interface PowerFarmPlanBody {
  /** body 部件总数（孵化时间估算）。 */
  parts: number;
  /** 孵化成本（能量）。 */
  cost: number;
}

/** planPowerFarmSquad 的完整输入。 */
export interface PowerFarmPlanInput {
  /** PB 剩余 hits。 */
  hits: number;
  /** PB 内含 power；undefined = 情报未带（按 defaultPower 规划且跳过最低价值门）。 */
  power?: number;
  /** sponsor 到目标房的线性距离（房）。 */
  distance: number;
  /** 剩余可作业 tick（PB 消失时间与任务超时取小）。 */
  availableTicks: number;
  /** sponsor 的 spawn 数（并行孵化能力）。 */
  spawnCount: number;
  attacker: PowerFarmPlanBody & { attackParts: number };
  healer: PowerFarmPlanBody & { healParts: number };
  collector: PowerFarmPlanBody & { carry: number };
  /**
   * 编队强化因子（1.0 = 裸 body）。由系统层按 sponsor 化合物库存原子判定：
   * attack/heal 必须成对启用（单边 boost 会让反弹/治疗失配，编队烧光）。
   */
  boost?: { attackFactor: number; healFactor: number };
  limits: {
    maxAttackers: number;
    maxHealers: number;
    maxCollectors: number;
    /** 目标击杀窗口（tick）：火力不足时判不可行，而不是派一队打不完的人。 */
    killWindowTicks: number;
    travelTicksPerRoom: number;
    spawnTicksPerPart: number;
    safetyTicks: number;
    /** 低于此 power 的 PB 不值得一套编队。 */
    minPowerLoot: number;
    /** 情报缺 power 时的规划值。 */
    defaultPower: number;
    /**
     * creep 寿命（引擎 CREEP_LIFE_TIME）。战斗成员在 highway 无法 renew，
     * 击杀窗口 + 通勤必须装进一条寿命，否则编队寿终在战斗中途，
     * 替换波零退款（自然死亡 dropRate×剩余寿命比 ≈ 0）— 毛成本翻倍。
     */
    creepLifetimeTicks: number;
    /**
     * boost 口径的等料驻留估算（tick）：hold 设计下编队孵化后要等 lab 进料
     * 才出征（PB_BOOST_HOLD_MIN_TTL 口径），这段也在烧寿命。boost 口径任务的
     * 寿命检查 = travel + boostWait + kill + safety ≤ lifetime。实测 labTender
     * 换矿喂料 200-400t，取 300；裸 body 任务不计此段。
     */
    boostWaitTicks: number;
  };
}

/** 编队规划结果（纯函数，可观测）。 */
export interface PowerFarmPlan {
  attackers: number;
  healers: number;
  collectors: number;
  dps: number;
  killTicks: number;
  totalTicks: number;
  reflectPerTick: number;
  healPerTick: number;
  energyCost: number;
  feasible: boolean;
  reason?: string;
  /**
   * collector 上限截断后留在 ruin 里的 power（10 tick 后落地缓 decay）。
   * > 0 时任务照开（剩余部分仍值得），但必须留遥测痕 — 不然 crit PB
   * （POWER_BANK_CAPACITY_CRIT 30% 概率 +5000，上限 10000）静默漏收。
   */
  powerOverflow?: number;
  /** 本次规划启用的强化因子（未 boost 时省略）。 */
  boost?: { attackFactor: number; healFactor: number };
}

/**
 * PB 野采编队规划（纯函数）。
 *
 * 引擎事实（node_modules/@screeps/engine/src/processor/intents/_damage.js）：
 * - PB 把 50% 伤害反弹给攻击者本人（不分队摊）：1 个 ATTACK 部件 = 15 反伤/tick；
 * - 1 个 HEAL 部件 = 12 治疗/tick（贴身），所以每个攻击手至少要
 *   ceil(15A/12H) 个治疗手才能站住 —— 旧配置 4 攻击 + 2 治疗远不够，
 *   攻击手 16 tick 就会被自己的反伤打死（私服 12 次孵化全灭）。
 * - PB 摧毁后 power 在 ruin 里只保留 10 tick（RUIN_DECAY_STRUCTURES.powerBank），
 *   所以 collector 必须在击破前到位，数量按 PB 内含 power / 单趟携带量规划。
 *
 * 火力：按 killWindowTicks 反推所需攻击手；超过 maxAttackers 视为火力不足，
 * 不派队（打不完只会把编队烧光）。
 *
 * 寿命：highway 无 renew，战斗成员寿命 = CREEP_LIFE_TIME(1500)。在场时钟
 * = 通勤 + 击杀，必须装进「寿命 − 安全余量」；否则编队寿终在战斗中途，
 * 替换波零退款（自然死亡 dropRate = CREEP_CORPSE_RATE × 剩余寿命比 ≈ 0），
 * 毛成本翻倍 — killWindowTicks 的取值必须由此约束反推。
 *
 * boost：attackFactor/healFactor 同乘 DPS 与治疗（X 系 T3 = ×4）。
 * 因子必须成对传入：单边 boost 会让反弹 ×4 而治疗不涨，攻击手速死。
 */
export function planPowerFarmSquad(input: PowerFarmPlanInput): PowerFarmPlan {
  const { attacker, healer, collector, limits } = input;
  const attackFactor = input.boost?.attackFactor ?? 1;
  const healFactor = input.boost?.healFactor ?? 1;
  const dpsPerAttacker = attacker.attackParts * ATTACK_POWER_PER_PART * attackFactor;
  const reflectPerAttacker = dpsPerAttacker * POWER_BANK_REFLECT_RATIO;
  const healPerHealer = healer.healParts * HEAL_POWER_PER_PART * healFactor;
  const power = input.power ?? limits.defaultPower;

  const infeasible = (reason: string): PowerFarmPlan => ({
    attackers: 0,
    healers: 0,
    collectors: 0,
    dps: 0,
    killTicks: 0,
    totalTicks: 0,
    reflectPerTick: 0,
    healPerTick: 0,
    energyCost: 0,
    feasible: false,
    reason,
  });

  if (dpsPerAttacker <= 0) return infeasible("no-attack-parts");
  if (healPerHealer <= 0) return infeasible("no-heal-parts");
  if (input.availableTicks <= 0) return infeasible("pb-expired");
  if (input.power !== undefined && input.power < limits.minPowerLoot) {
    return infeasible("low-loot");
  }

  // 火力：按击杀窗口反推；上限 maxAttackers。
  const desiredAttackers = Math.ceil(input.hits / (dpsPerAttacker * limits.killWindowTicks));
  const attackers = Math.max(1, Math.min(desiredAttackers, limits.maxAttackers));

  // 治疗：每个攻击手配 ceil(反伤/单治疗手治疗量) 个治疗手，保证贴身覆盖。
  const healersPerAttacker = Math.max(1, Math.ceil(reflectPerAttacker / healPerHealer));
  const healers = Math.max(1, Math.min(attackers * healersPerAttacker, limits.maxHealers));

  // collector：按 PB 内含 power 一次抢回（ruin 只活 10 tick，不能分批）。
  const collectorCarry = Math.max(1, collector.carry);
  const desiredCollectors = Math.ceil(power / collectorCarry);
  const collectors = Math.max(1, Math.min(desiredCollectors, limits.maxCollectors));

  const dps = attackers * dpsPerAttacker;
  const killTicks = Math.ceil(input.hits / dps);
  const bodyTicks = Math.ceil(
    ((attackers * attacker.parts + healers * healer.parts + collectors * collector.parts) *
      limits.spawnTicksPerPart) /
      Math.max(1, input.spawnCount),
  );
  const totalTicks =
    limits.safetyTicks + input.distance * limits.travelTicksPerRoom + bodyTicks + killTicks;
  const energyCost =
    attackers * attacker.cost + healers * healer.cost + collectors * collector.cost;
  const reflectPerTick = attackers * reflectPerAttacker;
  const healPerTick = healers * healPerHealer;

  let reason: string | undefined;
  if (killTicks > limits.killWindowTicks) reason = "firepower-insufficient";
  else if (healPerTick < reflectPerTick) reason = "healing-insufficient";
  else if (
    input.distance * limits.travelTicksPerRoom +
      killTicks +
      limits.safetyTicks +
      (input.boost !== undefined ? limits.boostWaitTicks : 0) >
    limits.creepLifetimeTicks
  ) {
    reason = "lifetime-insufficient";
  } else if (totalTicks > input.availableTicks) reason = "not-enough-time";

  return {
    attackers,
    healers,
    collectors,
    dps,
    killTicks,
    totalTicks,
    reflectPerTick,
    healPerTick,
    energyCost,
    feasible: reason === undefined,
    ...(reason !== undefined ? { reason } : {}),
    ...(desiredCollectors > limits.maxCollectors
      ? { powerOverflow: (desiredCollectors - limits.maxCollectors) * collectorCarry }
      : {}),
    ...(input.boost !== undefined ? { boost: { ...input.boost } } : {}),
  };
}
