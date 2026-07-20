import type { Blueprint, BlueprintCell } from "../types";

/**
 * compact-core-v1 — 以主 spawn 为锚点的紧凑核心模板。
 *
 * 锚点为已有主 spawn 的位置 (0,0)。所有结构以相对偏移定位。
 *
 * 设计原则：
 *   - extension 围绕 spawn 紧凑排列，按 RCL 阶段分批
 *   - tower 优先放在防御关键位
 *   - storage 紧邻 spawn 便于物流
 *   - source/controller container 由 layout-planner 动态生成，不在此模板中
 *
 * 结构数量限制（CONTROLLER_STRUCTURES）：
 *   extension: RCL2=5, RCL3=10, RCL4=20, RCL5=30
 *   tower:     RCL3=1, RCL5=2, RCL7=3
 *   storage:   RCL4=1
 *   link:      RCL5=2
 *   spawn:     RCL7=2
 */
function cell(
  key: string,
  dx: number,
  dy: number,
  structureType: BuildableStructureConstant,
  minRcl: number,
  phase: BlueprintCell["phase"],
  priority: BlueprintCell["priority"],
  tags: BlueprintCell["tags"],
  requires?: readonly string[],
): BlueprintCell {
  return { key, dx, dy, structureType, minRcl, phase, priority, tags, requires };
}

export const COMPACT_CORE_V1: Blueprint = {
  id: "compact-core-v1",
  anchorKind: "primary-spawn",
  cells: [
    // ── RCL2: 第一批 5 个 extension ──
    cell("core.ext.01", 1, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.02", -1, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.03", 1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.04", -1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.05", 2, 0, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),

    // ── RCL3: 补充 5 个 extension（共 10），加 1 个 tower ──
    cell("core.ext.06", -2, 0, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.07", 0, 2, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.08", 0, -2, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.09", 2, 1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.10", -2, -1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),

    cell("core.tower.01", 2, 2, STRUCTURE_TOWER, 3, "rcl3", 0, ["defense", "core"]),

    // ── RCL4: 补充 10 个 extension（共 20），加 storage ──
    cell("core.ext.11", 2, -1, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.12", -2, 1, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.13", 1, 2, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.14", -1, 2, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.15", 1, -2, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.16", -1, -2, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.17", 3, 0, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.18", -3, 0, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.19", 0, 3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.20", 0, -3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),

    cell("core.storage.01", 0, 1, STRUCTURE_STORAGE, 4, "rcl4", 0, ["core", "logistics"]),

    // ── Late (RCL5+): 补充 extension（共 30），加 tower/link/spawn ──
    cell("core.ext.21", 3, 1, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.22", -3, 1, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.23", 3, -1, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.24", -3, -1, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.25", 1, 3, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.26", -1, 3, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.27", 1, -3, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.28", -1, -3, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.29", 3, 2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.30", -3, -2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),

    cell("core.tower.02", -2, -2, STRUCTURE_TOWER, 5, "late", 0, ["defense", "core"]),
    cell("core.tower.03", 2, -2, STRUCTURE_TOWER, 7, "late", 0, ["defense", "core"]),

    cell("core.link.01", 1, 0, STRUCTURE_LINK, 5, "late", 2, ["core", "logistics"], ["core.storage.01"]),

    cell("core.spawn.02", -1, 0, STRUCTURE_SPAWN, 7, "late", 1, ["core"]),
  ],
};
