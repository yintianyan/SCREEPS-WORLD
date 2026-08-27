/** 威胁分类 — 纯函数，区分「威胁 creep」与「无害过客」。 */

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
  readonly owner: string;

  readonly bodyParts: readonly BodyPartConstant[];
}

export function isThreat(input: ThreatInput, allies: readonly string[]): boolean {
  if (allies.includes(input.owner)) return false;
  return input.bodyParts.some(p => THREAT_PARTS.includes(p));
}

export function classifyThreats(
  hostiles: readonly Creep[],
  allies: readonly string[],
): Creep[] {
  return hostiles.filter(c =>
    isThreat(
      // owner 缺失（私服注入/NPC 边缘形态）记 "?"——非盟友名，按威胁部件判定，
      // 不可在逐 tick 威胁分类里抛错（否则威胁在场期间防御链整体失能）。
      { owner: c.owner?.username ?? "?", bodyParts: c.body.map(b => b.type) },
      allies,
    ),
  );
}

/**
 * 小队威胁判定（M11 威胁分级）— 威胁量级决定响应姿态。小队 = ≥2 武装单位
 * （ATTACK/RANGED_ATTACK），或 ≥1 武装 + 治疗（heal-tank：有效血量翻倍，
 * 单 defender 与塔的独立杀伤都可能被奶回，必须升级响应）。独狼（单武装）不算 —
 * 塔集火即可；纯拆迁/纯治疗/纯 CLAIM 编队无杀伤，各自 flee 已足够。
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
    threats.map(c => ({ owner: c.owner?.username ?? "?", bodyParts: c.body.map(b => b.type) })),
  );
}
