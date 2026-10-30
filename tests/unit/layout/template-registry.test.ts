/** R662：模板注册表按 layout.templateId 取模板，未知 id 回退 V2（老房不动）。 */
import { describe, expect, it } from "vitest";
import { getTemplateById } from "../../../src/domain/layout/templates";
import { COMPACT_CORE_V3 } from "../../../src/domain/layout/templates/compact-core-v3";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";

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
