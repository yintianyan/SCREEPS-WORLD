/** R662：模板注册表按 layout.templateId 取模板，未知 id 回退 V2（老房不动）。 */
import { describe, expect, it } from "vitest";
import { getTemplateById } from "../../../src/domain/layout/templates";
import { COMPACT_CORE_V3 } from "../../../src/domain/layout/templates/compact-core-v3";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";
import { resolveLayoutMode } from "../../../src/domain/layout/planner";

describe("getTemplateById — R662", () => {
  it("v3 / v2 各回各的模板", () => {
    expect(getTemplateById("compact-core-v3")).toBe(COMPACT_CORE_V3);
    expect(getTemplateById("compact-core-v2")).toBe(COMPACT_CORE_V2);
  });

  it("未知或缺失 ⇒ 回退 V2（不对老房静默换模板）", () => {
    expect(getTemplateById(undefined)).toBe(COMPACT_CORE_V2);
    expect(getTemplateById("unknown-template")).toBe(COMPACT_CORE_V2);
  });

  it("V3 的 terminal 紧贴 storage（R661 优化仍在）", () => {
    const storage = COMPACT_CORE_V3.cells.find(c => c.structureType === STRUCTURE_STORAGE)!;
    const terminal = COMPACT_CORE_V3.cells.find(c => c.structureType === STRUCTURE_TERMINAL)!;
    const d = Math.max(Math.abs(terminal.dx - storage.dx), Math.abs(terminal.dy - storage.dy));
    expect(d).toBeLessThanOrEqual(2);
  });
});

describe("resolveLayoutMode — R663 按房引擎", () => {
  it("房内显式 mode 优先于全局", () => {
    expect(resolveLayoutMode("template", "constraint")).toBe("template");
    expect(resolveLayoutMode("constraint", "template")).toBe("constraint");
  });

  it("房内缺省 ⇒ 沿用全局（老房 constraint 不变）", () => {
    expect(resolveLayoutMode(undefined, "constraint")).toBe("constraint");
    expect(resolveLayoutMode(undefined, "template")).toBe("template");
  });
});

describe("V3 与 V2 的差异面（R663 迁移安全边界）", () => {
  it("位置差异只有 terminal；lab.07 只改 minRcl", () => {
    const v2 = new Map(COMPACT_CORE_V2.cells.map(c => [c.key, c]));
    const posDiff: string[] = [];
    const rclDiff: string[] = [];
    for (const c of COMPACT_CORE_V3.cells) {
      const o = v2.get(c.key);
      expect(o, `V3 新增了 V2 没有的 key: ${c.key}`).toBeDefined();
      if (o!.dx !== c.dx || o!.dy !== c.dy) posDiff.push(c.key);
      if (o!.minRcl !== c.minRcl) rclDiff.push(c.key);
    }
    expect(posDiff.sort()).toEqual(["core.terminal.01"]);
    // R660 已把 v2 的 lab.07 下放到 RCL8 ⇒ 两版此格同 RCL，无额外差异。
    expect(rclDiff.sort()).toEqual([]);
  });
});
