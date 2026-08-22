/**
 * 【F1/G-A】Cadence 注册表 — 系统执行间隔的治理视图。
 *
 * 真相源：各 System 注册时声明的 interval（bootstrap 唯一组合根）；
 * CONFIG.cpu.cadenceOverrides 提供治理性覆盖（按系统名），空表=零行为变更。
 * Kernel 构造时从 Registry 构建本表，供：
 *  - shouldRunSystem 消费（生效间隔）
 *  - 遥测/蓝图检视（governance visibility，研究文档 20 号 cadence 总表）
 *
 * 语义与既有实现一致：interval≤1 表示每 tick；相位偏移由 systemPhase() 提供。
 */

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