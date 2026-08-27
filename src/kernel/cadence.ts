/** Cadence 注册表 — 系统执行间隔的治理视图。 */

import { CONFIG } from "../config";
import type { Registry } from "./registry";

export interface CadenceEntry {
  /** 生效间隔（覆盖值优先于注册值）。 */
  readonly interval: number;
  /** 来源：'registered'（注册声明）| 'override'（CONFIG 覆盖）。 */
  readonly via: "registered" | "override";
}

/** 系统名 → 生效 cadence。Kernel 构造时建立，tick 间不变。 */
export type CadenceTable = ReadonlyMap<string, CadenceEntry>;

/** 从注册表 + CONFIG 覆盖层构建 cadence 表（构造期一次）。 */
export function buildCadenceTable(registry: Registry): CadenceTable {
  const overrides = CONFIG.cpu.cadenceOverrides ?? {};
  const table = new Map<string, CadenceEntry>();
  for (const system of registry.getSystems()) {
    const override = overrides[system.name];
    if (override !== undefined) {
      table.set(system.name, { interval: Math.max(1, override), via: "override" });
    } else {
      table.set(system.name, { interval: system.interval ?? 1, via: "registered" });
    }
  }
  return table;
}

/** 查询生效间隔（未知系统回退注册值或 1）。 */
export function resolveInterval(table: CadenceTable, name: string, fallback = 1): number {
  return table.get(name)?.interval ?? fallback;
}