/** 远矿 hauler 编制单测 — 就位比例缩放（非按 harvester 绝对数封顶）。 */
import { describe, expect, it } from "vitest";
import { remoteHaulerTarget } from "../../../src/domain/remote/staffing";
import { CONFIG } from "../../../src/config";

describe("remoteHaulerTarget — 就位比例缩放", () => {
  it("采集满编时编制等于 haulerNeed，不被 harvester 数封顶（回归：远房运力不足）", () => {
    // 2 source 满编、远房需 4 只 hauler。harvester 上限只有 2 只，
    // 若按 harvester 绝对数封顶则编制恒为 2 → 运力跟不上产出。
    expect(remoteHaulerTarget(2, 4, 2)).toBe(4);
  });

  it("编制 = 回收侧口径（harvester 满编时两侧必须一致）", () => {
    // 回收侧按 op.haulerNeed 判超额；demand 侧必须能长到同一数字，
    // 否则 demand 永远够不到回收配额（口径分裂）。
    for (const need of [1, 2, 3, 4]) {
      expect(remoteHaulerTarget(2, need, 2)).toBe(need);
    }
  });

  it("爬坡期按就位比例收缩（半编 → 需求减半）", () => {
    expect(remoteHaulerTarget(2, 4, 1)).toBe(2); // 1/2 就位 → ceil(4×0.5)
    expect(remoteHaulerTarget(2, 4, 0)).toBe(1); // 未就位 → 下限 1
  });

  it("下限 1 保物流连通", () => {
    expect(remoteHaulerTarget(2, 1, 1)).toBe(1); // ceil(1×0.5) = 1
    expect(remoteHaulerTarget(2, 4, 0)).toBe(1);
  });

  it("haulerNeed 缺失时回退 1（存量运营兼容）", () => {
    expect(remoteHaulerTarget(2, undefined, 2)).toBe(1);
    expect(remoteHaulerTarget(1, undefined, 1)).toBe(1);
  });

  it("haulerNeed 超上限时收敛到 haulersMax", () => {
    expect(remoteHaulerTarget(1, 99, 1)).toBe(CONFIG.remote.haulersMax);
  });

  it("sources 缺失时回退 harvestersPerTarget 作分母", () => {
    // 分母回退 1 → 1 只 harvester 就位即视为满编。
    expect(remoteHaulerTarget(undefined, 4, 1)).toBe(4);
    expect(remoteHaulerTarget(undefined, 4, 0)).toBe(1);
  });

  it("就位 harvester 多于 source 时不放大编制（readiness 封顶 1）", () => {
    expect(remoteHaulerTarget(1, 2, 5)).toBe(2);
  });
});
