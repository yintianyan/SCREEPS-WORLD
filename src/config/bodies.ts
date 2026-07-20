/** 孵化请求的 body 模板和生成约束。 */

export type BodyTier = "recovery" | "basic" | "standard" | "extended";

interface BodyTemplate {
  /** 有序 body 部件（Screeps 按数组顺序生成）。 */
  parts: BodyPartConstant[];
  /** 完整 body 所需的最小 energyCapacityAvailable。 */
  minCapacity: number;
}

/**
 * 按角色 → 档位索引的 body 目录。
 * 从高到低尝试各档位，第一个满足 energyCapacityAvailable 的即为选中结果。
 * "recovery" 档位始终可在 200 能量内生成，用于 P0 紧急孵化。
 *
 * 使用字符串字面量而非 Screeps 全局常量（WORK, CARRY, MOVE），
 * 使模块在无 Screeps 运行时的情况下也可测试。
 */
export const BODY_TEMPLATES: Readonly<Record<string, readonly BodyTemplate[]>> = {
  worker: [
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  harvester: [
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  hauler: [
    { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
    { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
  ],
  upgrader: [
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  builder: [
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
};

/** P0 恢复用的最小可用 body — 始终为 [WORK, CARRY, MOVE]，成本 200 能量。 */
export const RECOVERY_BODY: BodyPartConstant[] = ["work", "carry", "move"];

/** 各 body 部件的成本。使用与 BodyPartConstant 值匹配的字符串键。 */
const PART_COST: Readonly<Record<string, number>> = {
  move: 50,
  work: 100,
  carry: 50,
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  claim: 600,
  tough: 10,
};

export function bodyCost(body: readonly BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + (PART_COST[part] ?? 0), 0);
}

/**
 * 选择适合 spawn 能量容量的最佳 body。
 * 最后回退到恢复 body，确保 P0 孵化不会因 body 选择而阻塞。
 */
export function selectBody(
  role: string,
  energyCapacityAvailable: number,
): BodyPartConstant[] {
  const templates = BODY_TEMPLATES[role];
  if (templates) {
    for (const t of templates) {
      if (energyCapacityAvailable >= t.minCapacity) return [...t.parts];
    }
  }
  return [...RECOVERY_BODY];
}

/**
 * 将 body 降级以适应当前可用能量。
 * 从末尾移除部件直到成本满足，至少保留 requiredParts 中列出的部件。
 * 默认要求 [WORK, CARRY, MOVE]；hauler 等纯 CARRY+MOVE 角色可传入 ["carry", "move"]。
 * 如果连最小 body 也无法满足，返回 undefined（调用方应推迟请求）。
 */
export function degradeBody(
  body: readonly BodyPartConstant[],
  energyAvailable: number,
  requiredParts: readonly BodyPartConstant[] = ["work", "carry", "move"],
): BodyPartConstant[] | undefined {
  const minLen = requiredParts.length;
  const parts = [...body];
  while (bodyCost(parts) > energyAvailable && parts.length > minLen) {
    parts.pop();
  }
  // 确保最小可用组合：包含所有 requiredParts。
  for (const part of requiredParts) {
    if (!parts.includes(part)) return undefined;
  }
  if (bodyCost(parts) > energyAvailable) return undefined;
  return parts;
}
