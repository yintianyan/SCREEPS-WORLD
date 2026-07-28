/**
 * 威胁分类 — 纯函数，区分「威胁 creep」与「无害过客」。
 *
 * 背景（P0-2）：room.find(FIND_HOSTILE_CREEPS) 不区分 scout / reserver / 中立 /
 * 攻击单位。若直接当「有敌人」消费，一个路过的 scout 会同时触发全体逃跑、
 * 切 defense 状态、停建造、作废任务、误烧 safe mode，冻结整个经济。
 *
 * 判定原则：只有具备实际威胁部件的 creep 才算威胁。
 *   - ATTACK / RANGED_ATTACK：近战 / 远程攻击
 *   - HEAL：治疗（奶妈，配合攻击单位极危险）
 *   - WORK：拆迁（可拆墙 / 结构）
 *   - CLAIM：攻击控制器（downgrade / reserve 干扰）
 * 仅有 MOVE / CARRY / TOUGH 的 creep（典型 scout / reserver 空壳）不算威胁。
 *
 * 联盟白名单：owner 命中 allies 的 creep 一律视为非威胁。
 */

/** 具备任一即视为威胁的部件类型。 */
const THREAT_PARTS: readonly BodyPartConstant[] = [
  ATTACK,
  RANGED_ATTACK,
  HEAL,
  WORK,
  CLAIM,
];

/** 威胁判定的最小输入（便于纯函数测试，无需构造完整 Creep）。 */
export interface ThreatInput {
  /** creep 拥有者用户名。 */
  readonly owner: string;
  /** creep 的 body 部件类型列表。 */
  readonly bodyParts: readonly BodyPartConstant[];
}

/** 判断单个 creep 是否构成威胁。 */
export function isThreat(input: ThreatInput, allies: readonly string[]): boolean {
  if (allies.includes(input.owner)) return false;
  return input.bodyParts.some(p => THREAT_PARTS.includes(p));
}

/** 从敌对 creep 列表中筛出真正的威胁 creep。 */
export function classifyThreats(
  hostiles: readonly Creep[],
  allies: readonly string[],
): Creep[] {
  return hostiles.filter(c =>
    isThreat(
      { owner: c.owner.username, bodyParts: c.body.map(b => b.type) },
      allies,
    ),
  );
}

/**
 * 小队威胁判定（M11 威胁分级）— 威胁量级决定响应姿态。
 *
 * 小队 = ≥2 个武装单位（ATTACK/RANGED_ATTACK），或 ≥1 武装 + 治疗组合
 * （heal-tank 编队：有效血量翻倍，单 defender 与塔的独立杀伤都可能被
 * 奶回，必须升级响应）。单个武装单位（独狼 invader）不算小队 —
 * 塔集火即可处理，不值得全员避险打断经济。
 * 纯拆迁/纯治疗/纯 CLAIM 编队（无武装）不算小队 — 无杀伤能力，
 * 各自 flee 已足够。
 */
export function isSquadThreat(threats: readonly ThreatInput[]): boolean {
  let armed = 0;
  let hasHeal = false;
  for (const t of threats) {
    if (t.bodyParts.some(p => p === ATTACK || p === RANGED_ATTACK)) armed++;
    if (t.bodyParts.some(p => p === HEAL)) hasHeal = true;
  }
  return armed >= 2 || (armed >= 1 && hasHeal);
}

/** Creep 列表版本的小队判定（snapshot 构建处使用）。 */
export function isSquadThreatCreeps(threats: readonly Creep[]): boolean {
  return isSquadThreat(
    threats.map(c => ({ owner: c.owner.username, bodyParts: c.body.map(b => b.type) })),
  );
}
