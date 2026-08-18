/**
 * kernel — colony-state 门禁纯函数测试。
 * 覆盖 recovery/bootstrap 冻结 P2+ 角色，以及战争/真实入侵的 combat 紧急旁路。
 */
import { describe, expect, it } from "vitest";
import { colonyStateFreezesRole } from "../../../src/kernel/kernel";

type RoleLike = {
  priority: number;
  recoveryEligible?: boolean;
  combat?: boolean;
};

const p2Civilian: RoleLike = { priority: 2 };
const p2CollectorExempt: RoleLike = { priority: 2, recoveryEligible: true };
const p2Combat: RoleLike = { priority: 2, combat: true };
const p1Defender: RoleLike = { priority: 1, combat: true };

describe("colonyStateFreezesRole — 常态放行", () => {
  it("normal 态下任何角色都不冻结", () => {
    expect(colonyStateFreezesRole("normal", p2Civilian, "develop", false)).toBe(false);
    expect(colonyStateFreezesRole("normal", p2Combat, "war", false)).toBe(false);
  });

  it("非 recovery/bootstrap 态（如 fortify）不冻结 combat 角色", () => {
    expect(colonyStateFreezesRole("normal", p2Combat, "fortify", false)).toBe(false);
  });
});

describe("colonyStateFreezesRole — recovery/bootstrap 冻结", () => {
  it("recovery 下 P2 平民被冻结", () => {
    expect(colonyStateFreezesRole("recovery", p2Civilian, "develop", false)).toBe(true);
  });

  it("bootstrap 下 P2 平民被冻结", () => {
    expect(colonyStateFreezesRole("bootstrap", p2Civilian, "develop", false)).toBe(true);
  });

  it("recovery 下 recoveryEligible 角色豁免（R3a）", () => {
    expect(colonyStateFreezesRole("recovery", p2CollectorExempt, "develop", false)).toBe(false);
  });

  it("P1 角色（如 defender）永不被冻结", () => {
    expect(colonyStateFreezesRole("recovery", p1Defender, "develop", false)).toBe(false);
  });
});

describe("colonyStateFreezesRole — combat 紧急旁路", () => {
  it("recovery + war 姿态 → combat 角色不冻结（帝国不能冻自己军队）", () => {
    expect(colonyStateFreezesRole("recovery", p2Combat, "war", false)).toBe(false);
  });

  it("recovery + 本房有真实在房威胁 → combat 角色不冻结（真被入侵必须能打）", () => {
    expect(colonyStateFreezesRole("recovery", p2Combat, "fortify", true)).toBe(false);
  });

  it("recovery + 非 war 姿态 + 无活敌 → combat 角色仍冻结（危机下不养军队）", () => {
    expect(colonyStateFreezesRole("recovery", p2Combat, "fortify", false)).toBe(true);
    expect(colonyStateFreezesRole("recovery", p2Combat, "develop", false)).toBe(true);
  });

  it("undefined 姿态等同无 war → combat 角色冻结", () => {
    expect(colonyStateFreezesRole("recovery", p2Combat, undefined, false)).toBe(true);
  });
});
