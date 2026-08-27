/** Resource Definition */

import type { ResourceType } from "../operation/agenda-item";

// ─── 资源分类 ──────────────────────────────────────────────

/** 资源大类——决定其在经济系统中的角色。 */
export type ResourceCategory = "energy" | "mineral";

// ─── 资源定义 ──────────────────────────────────────────────

/**
 * 单资源元数据定义。
 */
export interface ResourceDefinition {
  /** 资源类型。 */
  resource: ResourceType;
  /** 资源大类。 */
  category: ResourceCategory;
  /** 人类可读名称（供 Dashboard / 日志）。 */
  displayName: string;
  /** 是否可堆叠（同类型可在同一 store 中累加）。 */
  stackable: boolean;
  /** 是否可在市场交易。 */
  tradable: boolean;
  /** 是否可存储在 storage / terminal 中。 */
  storable: boolean;
  /**
   * 是否可被 creep 携带（withdraw / transfer）。
   * 所有 StoreResource 都可携带，但未来可能有特殊资源不可携带。
   */
  carryable: boolean;
  /**
   * 默认安全储备量（该资源在 storage 中应保留的最低量）。
   * Energy 的安全储备由 economy 系统动态计算；mineral 用固定值。
   */
  defaultSafetyReserve: number;
  /**
   * 是否为「关键资源」——短缺时影响帝国运转。
   * Energy 总是关键；mineral 在有 lab 需求时为关键。
   */
  critical: boolean;
}

// ─── 静态注册表 ────────────────────────────────────────────

/**
 * Energy 资源定义。
 * 安全储备 0 = 由 economy 系统按 storageCapacity × 0.2 动态计算。
 */
const ENERGY_DEFINITION: ResourceDefinition = {
  resource: "energy",
  category: "energy",
  displayName: "Energy",
  stackable: true,
  tradable: true,
  storable: true,
  carryable: true,
  defaultSafetyReserve: 0, // 动态计算
  critical: true,
};

/**
 * 矿物资源定义工厂。
 * 所有基础矿物共享相同属性，仅 displayName 和 resource 不同。
 */
function mineralDefinition(
  resource: MineralConstant,
  displayName: string,
): ResourceDefinition {
  return {
    resource,
    category: "mineral",
    displayName,
    stackable: true,
    tradable: true,
    storable: true,
    carryable: true,
    defaultSafetyReserve: 1000, // 矿物保留 1000 单位自用
    critical: false, // 默认非关键（有 lab 需求时动态升级）
  };
}

/**
 * 全量资源定义注册表。

 * 后续阶段（A4.4+）在此扩展化合物 / 商品定义。
 */
export const RESOURCE_DEFINITIONS: Readonly<Record<string, ResourceDefinition>> = {
  // Energy
  energy: ENERGY_DEFINITION,

  // 基础矿物（7 种）
  U: mineralDefinition("U" as MineralConstant, "Utrium"),
  L: mineralDefinition("L" as MineralConstant, "Lemergium"),
  K: mineralDefinition("K" as MineralConstant, "Keanium"),
  Z: mineralDefinition("Z" as MineralConstant, "Zynthium"),
  O: mineralDefinition("O" as MineralConstant, "Oxygen"),
  H: mineralDefinition("H" as MineralConstant, "Hydrogen"),
  X: mineralDefinition("X" as MineralConstant, "Catalyst"),
} as const;

// ─── 查询函数 ──────────────────────────────────────────────

/**
 * 获取资源定义。未知资源返回 energy 定义作为安全回退。
 * 纯函数。
 */
export function getResourceDefinition(resource: ResourceType): ResourceDefinition {
  return RESOURCE_DEFINITIONS[resource] ?? ENERGY_DEFINITION;
}

/**
 * 获取资源大类。纯函数。
 */
export function getResourceCategory(resource: ResourceType): ResourceCategory {
  return getResourceDefinition(resource).category;
}

/**
 * 判断资源是否可交易。纯函数。
 */
export function isTradable(resource: ResourceType): boolean {
  return getResourceDefinition(resource).tradable;
}

/**
 * 判断资源是否为关键资源。纯函数。
 */
export function isCriticalResource(resource: ResourceType): boolean {
  return getResourceDefinition(resource).critical;
}

/**
 * 获取资源默认安全储备量。纯函数。
 */
export function defaultSafetyReserve(resource: ResourceType): number {
  return getResourceDefinition(resource).defaultSafetyReserve;
}

/**
 * 判断资源是否为矿物类型。纯函数。
 */
export function isMineral(resource: ResourceType): boolean {
  return getResourceCategory(resource) === "mineral";
}

/**
 * 判断资源是否为能量。纯函数。
 */
export function isEnergy(resource: ResourceType): boolean {
  return resource === "energy";
}

/**
 * 获取所有已注册的资源类型列表。纯函数。
 */
export function getAllResourceTypes(): ResourceType[] {
  return Object.keys(RESOURCE_DEFINITIONS) as ResourceType[];
}

/**
 * 获取所有矿物类型列表。纯函数。
 */
export function getAllMineralTypes(): MineralConstant[] {
  return (Object.values(RESOURCE_DEFINITIONS)
    .filter(d => d.category === "mineral")
    .map(d => d.resource)) as MineralConstant[];
}
