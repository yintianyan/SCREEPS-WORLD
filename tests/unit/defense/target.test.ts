import { describe, expect, it } from "vitest";
import { selectTowerTarget, type TowerThreat } from "../../../src/domain/defense/tower-target";

function threat(id: string, opts: Partial<TowerThreat> = {}): TowerThreat {
  return {
    id,
    healParts: opts.healParts ?? 0,
    hits: opts.hits ?? 1000,
    hitsMax: opts.hitsMax ?? 1000,
    rangeToTower: opts.rangeToTower ?? 10,
  };
}

describe("Tower target — selectTowerTarget", () => {
  it("无威胁时返回 undefined", () => {
    expect(selectTowerTarget([])).toBeUndefined();
  });

  it("奶妈优先：带 HEAL 的目标优先于无 HEAL 的更脆目标", () => {
    // medic 血更厚，但带 HEAL → 应先集火。
    const medic = threat("medic", { healParts: 3, hits: 2000, hitsMax: 2000, rangeToTower: 8 });
    const attacker = threat("atk", { healParts: 0, hits: 500, hitsMax: 500, rangeToTower: 3 });
    expect(selectTowerTarget([attacker, medic])).toBe("medic");
  });

  it("同为无 HEAL 时取有效血量最低（最脆）", () => {
    const tanky = threat("tanky", { hits: 1500 });
    const squishy = threat("squishy", { hits: 300 });
    expect(selectTowerTarget([tanky, squishy])).toBe("squishy");
  });

  it("有效血量相同时取距塔更近者（距离衰减加权）", () => {
    const far = threat("far", { hits: 800, rangeToTower: 15 });
    const near = threat("near", { hits: 800, rangeToTower: 4 });
    expect(selectTowerTarget([far, near])).toBe("near");
  });

  it("多奶妈时在奶妈中取有效血量最低者", () => {
    const medicHi = threat("m1", { healParts: 5, hits: 2000, hitsMax: 2000 });
    const medicLo = threat("m2", { healParts: 1, hits: 400, hitsMax: 400 });
    const attacker = threat("a1", { healParts: 0, hits: 100, hitsMax: 100 });
    expect(selectTowerTarget([medicHi, medicLo, attacker])).toBe("m2");
  });
});
