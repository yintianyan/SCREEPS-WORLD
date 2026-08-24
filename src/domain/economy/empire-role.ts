/**
 * Empire Room Role — A4.0 Phase 1：房间经济职能分工枚举与角色特征。
 *
 * 合同锚点：A4.0 Architecture Audit §1–§8（EmpireRoomRole 正交于 RoomEconomicClass）。
 *
 * 设计意图：
 *   `RoomEconomicClass`（room-profile.ts）回答「这个房间发展到了什么阶段」，
 *   是基于 RCL/storage/colonyState 的能力门槛分类。
 *   `EmpireRoomRole` 回答「这个房间在帝国经济中最适合做什么」，
 *   是基于比较优势的经济职能分工。
 *   两者正交——一个 RCL6 的 `core` 房间可能被分配为 PRODUCTION（高产能）
 *   或 SUPPORT（物流枢纽）或 CORE（帝国基座），取决于其特征剖面。
 *
 * 角色定义：
 *   - CORE：帝国基座，高 RCL + 高产能 + 高储备，可承担调拨源/代孵/sponsor。
 *     核心特征：RCL≥6 + storage + 高净产出 + 稳定经济。
 *   - PRODUCTION：产能中心，高效率 + 高 source 数，优先产出能量。
 *     核心特征：高 estimatedIncome + 高 efficiency + 低风险。
 *   - SUPPORT：物流枢纽，位于帝国地理中心或多条调拨路径交汇处。
 *     核心特征：terminal + 高 neighborCount + 低距离均值。
 *   - REMOTE：远矿运营基地，以远矿产出为主要经济来源。
 *     核心特征：高 remoteOps 数 + 高远矿净收益 + 低本地产能。
 *
 * 纯函数律（DEP_GRAPH §3-5，SYSTEM_BOUNDARIES §2.3-3）：
 *   - 不引用 Game / Memory / RawMemory（lint 红线）
 *   - 全部输入由参数注入
 *   - 不写任何状态——只读计算
 */

// ─── Empire Room Role 枚举 ───────────────────────────────

/**
 * Empire Room Role — 房间在帝国经济中的职能分工。
 *
 * 与 `RoomEconomicClass` 正交：
 * - RoomEconomicClass = 发展阶段（能力门槛）
 * - EmpireRoomRole = 经济职能（比较优势）
 *
 * 一个房间在同一 RoomEconomicClass 下可以有不同的 EmpireRoomRole，
 * 反之亦然。Role 由 Role Evaluation 纯函数从多维特征推导。
 */
export type EmpireRoomRole = "core" | "production" | "support" | "remote";

/**
 * 所有 Empire Room Role 值（用于遍历/初始化）。
 */
export const EMPIRE_ROOM_ROLES: readonly EmpireRoomRole[] = [
  "core",
  "production",
  "support",
  "remote",
] as const;

// ─── Role Characteristics ────────────────────────────────

/**
 * Role Characteristic — 角色特征描述。
 *
 * 定义每个 Role 的核心特征、前置条件、职责和能力限制。
 * 供 Role Evaluation 评分时参考，也供 Dashboard 可观测性展示。
 */
export interface RoleCharacteristic {
  /** 角色名。 */
  role: EmpireRoomRole;
  /** 人类可读描述。 */
  description: string;
  /** 核心职责（这个角色在帝国经济中做什么）。 */
  responsibilities: string[];
  /** 前置条件（必须满足才能被分配此角色）。 */
  prerequisites: string[];
  /** 经济行为倾向（影响 Allocation / Logistics / Spawn 策略）。 */
  economicBehavior: {
    /** 是否应优先获得 hauler 配额。 */
    priorityHauler: boolean;
    /** 是否应优先获得 production 预算。 */
    priorityProductionBudget: boolean;
    /** 是否应作为 Supply Contract 的 producer。 */
    canBeProducer: boolean;
    /** 是否应作为 Supply Contract 的 consumer。 */
    canBeConsumer: boolean;
    /** 是否应作为物流中继节点。 */
    canBeLogisticsHub: boolean;
    /** 是否应优先扩张周边（形成产业集群）。 */
    priorityExpansion: boolean;
  };
}

/**
 * 各角色的特征定义。
 *
 * 这些是静态描述，不随运行时变化。
 * Role Evaluation 纯函数消费这些特征来计算评分。
 */
export const ROLE_CHARACTERISTICS: Record<EmpireRoomRole, RoleCharacteristic> = {
  core: {
    role: "core",
    description: "帝国基座 — 高 RCL + 高储备 + 稳定经济的核心房间",
    responsibilities: [
      "作为帝国调拨的主要能量来源",
      "代孵新房（colonize sponsor）",
      "远矿运营 sponsor",
      "战争动员的后勤基地",
    ],
    prerequisites: [
      "RCL ≥ 6",
      "有 storage",
      "colonyState = normal",
      "净流为正且稳定",
    ],
    economicBehavior: {
      priorityHauler: false,
      priorityProductionBudget: true,
      canBeProducer: true,
      canBeConsumer: false,
      canBeLogisticsHub: true,
      priorityExpansion: false,
    },
  },

  production: {
    role: "production",
    description: "产能中心 — 高效率 + 高 source 数的产出型房间",
    responsibilities: [
      "最大化能量产出",
      "为帝国提供净能量盈余",
      "支持 CORE 房间的调拨需求",
    ],
    prerequisites: [
      "RCL ≥ 4",
      "有 storage",
      "colonyState = normal",
      "estimatedIncome 高于帝国均值",
    ],
    economicBehavior: {
      priorityHauler: true,
      priorityProductionBudget: true,
      canBeProducer: true,
      canBeConsumer: false,
      canBeLogisticsHub: false,
      priorityExpansion: true,
    },
  },

  support: {
    role: "support",
    description: "物流枢纽 — 地理中心或调拨路径交汇处的中继房间",
    responsibilities: [
      "作为跨房调拨的中继节点",
      "承担 terminal 转运",
      "降低帝国平均运输成本",
    ],
    prerequisites: [
      "有 terminal（或 RCL ≥ 6 可建 terminal）",
      "位于帝国地理中心或多房之间",
      "colonyState = normal",
    ],
    economicBehavior: {
      priorityHauler: true,
      priorityProductionBudget: false,
      canBeProducer: true,
      canBeConsumer: true,
      canBeLogisticsHub: true,
      priorityExpansion: false,
    },
  },

  remote: {
    role: "remote",
    description: "远矿基地 — 以远矿产出为主要经济来源的房间",
    responsibilities: [
      "运营远矿网络",
      "将远矿能量汇入帝国经济",
      "扩展帝国资源触达范围",
    ],
    prerequisites: [
      "有活跃远矿运营（remoteOps ≥ 1）",
      "远矿净收益为正",
      "colonyState = normal",
    ],
    economicBehavior: {
      priorityHauler: true,
      priorityProductionBudget: false,
      canBeProducer: true,
      canBeConsumer: false,
      canBeLogisticsHub: false,
      priorityExpansion: true,
    },
  },
};

// ─── 辅助函数 ─────────────────────────────────────────────

/**
 * 获取角色特征。
 * 纯函数 — 直接索引 ROLE_CHARACTERISTICS。
 */
export function getRoleCharacteristic(role: EmpireRoomRole): RoleCharacteristic {
  return ROLE_CHARACTERISTICS[role];
}

/**
 * 判定角色是否可作为 Supply Contract 的 producer。
 * 纯函数。
 */
export function canRoleProduce(role: EmpireRoomRole): boolean {
  return ROLE_CHARACTERISTICS[role].economicBehavior.canBeProducer;
}

/**
 * 判定角色是否可作为 Supply Contract 的 consumer。
 * 纯函数。
 */
export function canRoleConsume(role: EmpireRoomRole): boolean {
  return ROLE_CHARACTERISTICS[role].economicBehavior.canBeConsumer;
}

/**
 * 判定角色是否可作为物流中继节点。
 * 纯函数。
 */
export function isLogisticsHubRole(role: EmpireRoomRole): boolean {
  return ROLE_CHARACTERISTICS[role].economicBehavior.canBeLogisticsHub;
}

/**
 * 将角色序列化为短代码（用于 Memory 瘦快照）。
 * 纯函数。
 */
export function roleToCode(role: EmpireRoomRole): string {
  switch (role) {
    case "core": return "C";
    case "production": return "P";
    case "support": return "S";
    case "remote": return "R";
  }
}

/**
 * 从短代码反序列化角色。
 * 纯函数 — 未知代码返回 undefined。
 */
export function codeToRole(code: string | undefined): EmpireRoomRole | undefined {
  if (!code) return undefined;
  switch (code) {
    case "C": return "core";
    case "P": return "production";
    case "S": return "support";
    case "R": return "remote";
    default: return undefined;
  }
}
