import type { Blueprint, BlueprintCell } from "../types";

/**
 * compact-core-v2 — 偶校验棋盘格核心模板（修复 v1 的全密封实心块缺陷）。
 *
 * 锚点为已有主 spawn 的位置 (0,0)。所有结构以相对偏移定位。
 *
 * v1 的教训（P0 缺陷）：v1 把结构排成实心块，全建成后 29/68 个结构 8 邻居全被
 * 障碍堵死 —— 三个 spawn 出生格为 0（无法孵化）、storage 无法存取、塔无法补能、
 * 22 个 extension 永远无法填充。transfer/spawnCreep 射程均为 1，
 * 「每个结构至少 1 个相邻可站格」是不可妥协的几何约束。
 *
 * v2 设计原则：
 *   1. **偶校验棋盘格**：所有结构只落在 (dx+dy) 为偶数的格子上，
 *      奇数格永远留空作走道 —— 每个结构天然拥有 4 个正交可站格，
 *      从几何上不可能形成密封（建筑孤岛）。
 *   2. **spawn 出生格**：每个 spawn 的 4 个正交邻居均为奇校验走道格，
 *      spawnCreep 永远有处可去。
 *   3. extension 按到锚点距离分环分配 RCL 批次，内密外疏；
 *      RCL8 环扩到 ±6（棋盘格密度约 50%，69 个结构需要更大占地）。
 *   4. 该模板的几何不变量由 tests/layout-v2.test.ts 永久守护：
 *      任何 cell 修改若制造密封，测试立即失败。
 *
 * 结构数量限制（CONTROLLER_STRUCTURES）：
 *   extension: RCL2=5, RCL3=10, RCL4=20, RCL5=30, RCL6=40, RCL7=50, RCL8=60
 *   tower:     RCL3=1, RCL5=2, RCL7=3
 *   storage:   RCL4=1 / link: RCL5=2, RCL6=3 / spawn: RCL7=2, RCL8=3
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
    // ── RCL2: 第一批 5 个 extension（锚点四角 + 东侧）──
    cell("core.ext.01", -1, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.02", 1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.03", -1, -1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.04", 2, 0, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),
    cell("core.ext.05", 3, 1, STRUCTURE_EXTENSION, 2, "rcl2", 1, ["core"]),

    // ── RCL3: 补充 5 个 extension（共 10），加第 1 个 tower ──
    cell("core.ext.06", 1, 3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.07", -3, 1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.08", -1, 3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.09", 3, -1, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),
    cell("core.ext.10", -1, -3, STRUCTURE_EXTENSION, 3, "rcl3", 1, ["core"]),

    cell("core.tower.01", 2, 2, STRUCTURE_TOWER, 3, "rcl3", 0, ["defense", "core"]),

    // ── RCL4: 补充 10 个 extension（共 20），加 storage ──
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

    // ── Late (RCL5): 补充 10 个 extension（共 30），加 tower2 / link1 ──
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

    // ── RCL6: 补充 10 个 extension（共 40），加 link2 ──
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

    // core.link.02 已移除 — 原位置 (-2,2) 与 storage (0,2) Chebyshev 距离 = 2，
    // classifyLink 会将其误判为第二个 storage link，导致 RCL6 的 3 个 link 槽位
    // 分配为 2 storage + 1 source，controller link 永远无法创建。
    // 所有非核心 link 由 task-factory 按角色优先级放置（source→storage→controller）。

    // ── RCL7: 补充 10 个 extension（共 50），加 tower3 / spawn2 ──
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

    // ── RCL8: 补充 10 个 extension（共 60，±6 外环），加 spawn3 ──
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
    // observer: 侦察远程房间（无需 creep 在场），Empire 情报系统基础。
    cell("core.observer.01", 7, 1, STRUCTURE_OBSERVER, 8, "rcl8", 2, ["core", "defense"]),
    // powerSpawn: 处理 power（creep power 使用前提），开启 power 体系。
    cell("core.powerSpawn.01", -7, 1, STRUCTURE_POWER_SPAWN, 8, "rcl8", 1, ["core", "industry"]),
    // nuker: 跨房核打击，PvP 终局威慑武器。
    cell("core.nuker.01", 1, 7, STRUCTURE_NUKER, 8, "rcl8", 2, ["core", "defense"]),
  ],
};
