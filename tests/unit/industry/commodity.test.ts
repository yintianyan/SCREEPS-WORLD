/**
 * Factory commodity 生产决策测试（审计缺口 6）。
 *
 * 覆盖：
 *   selectCommodityTarget（纯函数）：
 *   - 原料 = factory + storage 合计（跨容器合成判定）
 *   - 梯度优先（T2 击败 T1 — 传入降序，先到先得）
 *   - level 门槛 / 能量储备地板 / 原料不齐 → 跳过
 *   missingComponents（纯函数）：
 *   - factory 内缺口 = 配方量 - 现有（负值不出现）
 */
import { describe, expect, it } from "vitest";
import {
  missingComponents,
  selectCommodityTarget,
  type CommodityRecipe,
} from "../../../src/domain/industry/commodity";

const T1_WIRE: CommodityRecipe = {
  resourceType: "wire",
  level: 0,
  components: { U: 10, energy: 30 },
};
const T2_CIRCUIT: CommodityRecipe = {
  resourceType: "circuit",
  level: 1,
  components: { wire: 10, X: 10, energy: 100 },
};

describe("selectCommodityTarget — commodity 生产目标选择", () => {
  it("原料 = factory + storage 合计（跨容器合成）", () => {
    // factory 有 U 5、storage 有 U 5 → T1 wire 可产（合计 10 达标）。
    const target = selectCommodityTarget(
      { U: 5, energy: 50 },
      { U: 5 },
      0,
      [T1_WIRE],
      0,
    );
    expect(target?.resourceType).toBe("wire");
  });

  it("梯度优先：原料齐时 T2 击败 T1（降序先到先得）", () => {
    const target = selectCommodityTarget(
      { wire: 10, X: 10, energy: 200 },
      {},
      1,
      [T2_CIRCUIT, T1_WIRE],
      0,
    );
    expect(target?.resourceType).toBe("circuit");
  });

  it("factory level 不足 → 跳过高级配方", () => {
    const target = selectCommodityTarget(
      { wire: 10, X: 10, U: 10, energy: 200 },
      {},
      0, // level 0：T2（level 1）不可产
      [T2_CIRCUIT, T1_WIRE],
      0,
    );
    expect(target?.resourceType).toBe("wire"); // 回退 T1（U 10 齐备）
  });

  it("能量扣储备地板后不足 → 跳过", () => {
    // energy 100 - 储备 50 = 50 < T1 wire 的 30？50 ≥ 30 可产；
    // 再提高到 60 储备 → 40 ≥ 30 仍可产；80 储备 → 20 < 30 不可产。
    const ok = selectCommodityTarget({ U: 10, energy: 100 }, {}, 0, [T1_WIRE], 60);
    expect(ok?.resourceType).toBe("wire");
    const blocked = selectCommodityTarget({ U: 10, energy: 100 }, {}, 0, [T1_WIRE], 80);
    expect(blocked).toBeUndefined();
  });

  it("非能量原料不齐 → 跳过", () => {
    const target = selectCommodityTarget({ U: 9, energy: 100 }, {}, 0, [T1_WIRE], 0);
    expect(target).toBeUndefined();
  });

  it("空配方表 → undefined", () => {
    expect(selectCommodityTarget({}, {}, 0, [], 0)).toBeUndefined();
  });
});

describe("missingComponents — factory 内缺口计算", () => {
  it("缺口 = 配方量 - factory 现有", () => {
    const missing = missingComponents({ U: 4, energy: 10 }, T1_WIRE);
    expect(missing).toEqual({ U: 6, energy: 20 });
  });

  it("超量组件不出现负值", () => {
    const missing = missingComponents({ U: 20, energy: 50 }, T1_WIRE);
    expect(missing).toEqual({});
  });
});
