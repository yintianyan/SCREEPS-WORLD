/**
 * 「系统 CPU 单价」的两份口径之一 —— per-tick 归一。
 *
 * 立案理由：扩张雄心档位（domain/strategy/capacity）判的是「帝国每拍用掉多少产能」，
 * 而内核原本只出 per-run EMA。低频系统跑一次很贵、摊到每拍却几乎免费，两者相差可到
 * 两个数量级 —— 拿错的那份排榜就会把优化力气花在不吃产能的系统上（这个单位错配在本
 * 项目已经付过一次学费，见 CPU 定标那次）。所以归一逻辑单独钉住。
 */
import { describe, expect, it } from "vitest";
import { cpuPerTickOfRun } from "../../../src/kernel/kernel";

describe("cpuPerTickOfRun", () => {
  it("按 cadence 摊平：per-run 同价 ≠ 同产能", () => {
    expect(cpuPerTickOfRun(3, 100)).toBe(0.03); // expansion-planner：贵一次，不吃产能
    expect(cpuPerTickOfRun(1.9, 1)).toBe(1.9); // traffic-manager：每拍都在花
  });

  it("interval 缺失或小于 1 时按每拍算（不把成本除成 Infinity 或放大）", () => {
    expect(cpuPerTickOfRun(2, undefined)).toBe(2);
    expect(cpuPerTickOfRun(2, 0)).toBe(2);
    expect(cpuPerTickOfRun(2, 0.5)).toBe(2);
  });
});
