/** Tower 目标选择 — 纯函数（P1-3）。 */

/** 单个威胁 creep 的塔目标摘要（不持有 Creep 对象，便于测试）。 */
export interface TowerThreat {
  id: string;
  /** HEAL 部件数量（用于识别奶妈并估算自愈能力）。 */
  healParts: number;

  hits: number;

  hitsMax: number;
  /** 到参考塔的距离（用于距离衰减加权与近距优先）。 */
  rangeToTower: number;
}

/** 单个 HEAL 部件每 tick 的自愈量（引擎常量 HEAL_POWER）。 */
const HEAL_POWER = 12;
/**
 * 自愈缓冲 tick 数：把「几 tick 自愈量」折算进有效血量，使带 HEAL 的单位
 * 有效血量更高 — 越难打的越该先集火其治疗源。
 */
const HEAL_BUFFER_TICKS = 5;

/** 从威胁摘要中选出全塔集火的目标 ID；无威胁返回 undefined。 */
export function selectTowerTarget(threats: readonly TowerThreat[]): string | undefined {
  if (threats.length === 0) return undefined;

  let best: TowerThreat | undefined;
  for (const t of threats) {
    if (best === undefined || isBetterTarget(t, best)) {
      best = t;
    }
  }
  return best?.id;
}

/** 估算有效血量：当前血量 + 自愈能力缓冲（奶妈更"耐打"，有效血量更高）。 */
function effectiveHp(t: TowerThreat): number {
  return t.hits + t.healParts * HEAL_POWER * HEAL_BUFFER_TICKS;
}

function isBetterTarget(a: TowerThreat, b: TowerThreat): boolean {
  // ① 奶妈优先：带 HEAL 的排在无 HEAL 之前。
  const aHeals = a.healParts > 0;
  const bHeals = b.healParts > 0;
  if (aHeals !== bHeals) return aHeals;

  // ② 有效血量最低优先（最脆先杀）。
  const aHp = effectiveHp(a);
  const bHp = effectiveHp(b);
  if (aHp !== bHp) return aHp < bHp;

  // ③ 距塔近者优先（塔伤随距离衰减，近处收益最大）。
  return a.rangeToTower < b.rangeToTower;
}
