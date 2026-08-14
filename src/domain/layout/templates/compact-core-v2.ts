import type { Blueprint, BlueprintCell } from "../types";

/**
 * compact-core-v2 — 偶校验棋盘格核心模板（修复 v1 全密封实心块缺陷），
 * 锚点为已有主 spawn (0,0)，结构相对偏移定位。
 * v1 教训（P0）：实心块全建成后 29/68 结构 8 邻居被堵死（spawn 无法孵化、
 * storage 无法存取、塔无法补能、extension 无法填充）；transfer/spawnCreep
 * 射程均为 1，「每结构至少 1 个相邻可站格」是不可妥协的几何约束。
 * v2：结构只落 (dx+dy) 偶数格，奇数格留空作走道 → 每结构天然 4 正交可站格，
 * 几何上不可能密封；extension 分环按 RCL 批次（RCL8 扩到 ±6）。该不变量由
 * tests/layout-v2.test.ts 永久守护。
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

export const COMPACT_CORE_V2: Blueprint = {
  id: "compact-core-v2",
  anchorKind: "primary-spawn",
  cells: [
    // ── RCL2: 5 extension（第一批）──
    cell("core.ext.01", -1, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.02", 1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.03", -1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.04", 2, 0, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.05", 3, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),

    // ── RCL3: +5 extension（共 10）、tower ──
    cell("core.ext.06", 1, 3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.07", -3, 1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.08", -1, 3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.09", 3, -1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.10", -1, -3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),

    cell("core.tower.01", 2, 2, STRUCTURE_TOWER, 3, "rcl3", 0, ["defense", "core"]),

    // ── RCL4: +10 extension（共 20）、storage ──
    cell("core.ext.11", 1, -3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.12", -3, -1, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.13", 3, 3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.14", -3, 3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.15", 3, -3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.16", -3, -3, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.17", 4, 0, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.18", 0, 4, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.19", -4, 0, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),
    cell("core.ext.20", 0, -4, STRUCTURE_EXTENSION, 4, "rcl4", 1, ["core"]),

    cell("core.storage.01", 0, 2, STRUCTURE_STORAGE, 4, "rcl4", 0, ["core", "logistics"]),

    // ── RCL5: +10 extension（共 30）、tower2 / link1 ──
    cell("core.ext.21", 4, 2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.22", 2, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.23", -2, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.24", -4, 2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.25", 4, -2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.26", 2, -4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.27", -4, -2, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.28", -2, -4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.29", 4, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),
    cell("core.ext.30", -4, 4, STRUCTURE_EXTENSION, 5, "late", 2, ["core"]),

    cell("core.tower.02", -2, -2, STRUCTURE_TOWER, 5, "late", 0, ["defense", "core"]),
    cell("core.link.01", 1, 1, STRUCTURE_LINK, 5, "late", 2, ["core", "logistics"], ["core.storage.01"]),

    // ── RCL6: +10 extension（共 40）──
    cell("core.ext.31", 4, -4, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.32", -4, -4, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.33", 5, 1, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.34", 1, 5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.35", -5, 1, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.36", -1, 5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.37", 5, -1, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.38", -1, -5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.39", 5, 3, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),
    cell("core.ext.40", 3, 5, STRUCTURE_EXTENSION, 6, "rcl6", 2, ["core"]),

    // core.link.02 已移除：原位置 (-2,2) 会被 classifyLink 误判为 storage link，
    // 导致 controller link 永远无法创建；非核心 link 由 task-factory 按
    // 角色优先级放置（source→storage→controller）。

    // ── RCL7: +10 extension（共 50）、tower3 / spawn2 ──
    cell("core.ext.41", -5, 3, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.42", -3, 5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.43", 5, -3, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.44", 3, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.45", -5, -3, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.46", -3, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.47", 5, 5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.48", -5, 5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.49", 5, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),
    cell("core.ext.50", -5, -5, STRUCTURE_EXTENSION, 7, "rcl7", 2, ["core"]),

    cell("core.tower.03", 2, -2, STRUCTURE_TOWER, 7, "late", 0, ["defense", "core"]),
    cell("core.spawn.02", -2, 0, STRUCTURE_SPAWN, 7, "late", 1, ["core"]),

    // ── RCL8: +10 extension（共 60，±6 外环）、spawn3 ──
    cell("core.ext.51", 6, 0, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.52", 0, 6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.53", -6, 0, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.54", 0, -6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.55", 6, 2, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.56", 2, 6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.57", -6, 2, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.58", -2, 6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.59", 6, -2, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),
    cell("core.ext.60", 2, -6, STRUCTURE_EXTENSION, 8, "rcl8", 2, ["core"]),

    cell("core.spawn.03", 0, -2, STRUCTURE_SPAWN, 8, "rcl8", 1, ["core"]),

    // ── Industry: Terminal (RCL6) ──
    cell("core.terminal.01", 4, 6, STRUCTURE_TERMINAL, 6, "rcl6", 1, ["core", "logistics"]),

    // ── Industry: Factory (RCL7) ──
    cell("core.factory.01", -4, 6, STRUCTURE_FACTORY, 7, "rcl7", 2, ["core", "logistics"]),

    // ── Industry: Labs (RCL6: 3, RCL7: +3=6, RCL8: +4=10) ──
    // SE cluster（2 labs，可 boost）
    cell("core.lab.01", 6, 4, STRUCTURE_LAB, 6, "rcl6", 2, ["core", "industry"]),
    cell("core.lab.02", 6, 6, STRUCTURE_LAB, 6, "rcl6", 2, ["core", "industry"]),
    // NE cluster（3 labs，可反应：lab03+lab04 → lab05）
    cell("core.lab.03", 6, -4, STRUCTURE_LAB, 6, "rcl6", 2, ["core", "industry"]),
    cell("core.lab.04", 6, -6, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
    cell("core.lab.05", 4, -6, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
    // NW cluster（2 labs，可 boost）
    cell("core.lab.06", -6, 4, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
    cell("core.lab.07", -6, 6, STRUCTURE_LAB, 7, "rcl7", 2, ["core", "industry"]),
    // SW cluster（3 labs，可反应：lab08+lab09 → lab10）
    cell("core.lab.08", -6, -4, STRUCTURE_LAB, 8, "rcl8", 2, ["core", "industry"]),
    cell("core.lab.09", -6, -6, STRUCTURE_LAB, 8, "rcl8", 2, ["core", "industry"]),
    cell("core.lab.10", -4, -6, STRUCTURE_LAB, 8, "rcl8", 2, ["core", "industry"]),

    // ── RCL8 终局建筑（Empire 阶段）──
    // observer: 侦察远程房间（无需 creep 在场），Empire 情报基础。
    cell("core.observer.01", 7, 1, STRUCTURE_OBSERVER, 8, "rcl8", 2, ["core", "defense"]),
    // powerSpawn: 处理 power（creep power 使用前提），开启 power 体系。
    cell("core.powerSpawn.01", -7, 1, STRUCTURE_POWER_SPAWN, 8, "rcl8", 1, ["core", "industry"]),
    // nuker: 跨房核打击，PvP 终局威慑武器。
    cell("core.nuker.01", 1, 7, STRUCTURE_NUKER, 8, "rcl8", 2, ["core", "defense"]),
  ],
};
