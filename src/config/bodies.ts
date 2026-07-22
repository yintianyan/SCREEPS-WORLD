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
    // 开局优化：RCL1 起始 300 能量直接用满，2 WORK 采集速度翻倍，大幅缩短 bootstrap。
    { parts: ["work", "work", "carry", "move"], minCapacity: 300 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  harvester: [
    // 站桩矿工：5 WORK 恰好匹配 source 再生速率 (3000/300=10/tick)，1 MOVE 仅用于通勤到工位。
    // 每多 1 WORK 成本 +100，按容量平滑降级（1W=200 / 2W=300 / 3W=400 / 4W=500 / 5W=600），
    // 避免低容量时卡在 1 WORK（2/tick，远低于 source 再生）拖垮经济。
    { parts: ["work", "work", "work", "work", "work", "carry", "move"], minCapacity: 600 },
    { parts: ["work", "work", "work", "work", "carry", "move"], minCapacity: 500 },
    { parts: ["work", "work", "work", "carry", "move"], minCapacity: 400 },
    { parts: ["work", "work", "carry", "move"], minCapacity: 300 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  hauler: [
    // RCL3+ 大运力档：同样吞吐用更少 creep，省 CPU/寻路/spawn 孵化窗。
    {
      parts: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move"],
      minCapacity: 600,
    },
    { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
    { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
  ],
  upgrader: [
    // 站桩升级：1 CARRY 承接 withdraw，2 MOVE 通勤，其余全 WORK。
    // [15W] @1650：RCL5(1800) 起可孵；RCL8 时单 creep 恰好顶满官方 15 energy/tick 上限。
    {
      parts: [
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work",
        "carry", "move", "move",
      ],
      minCapacity: 1650,
    },
    // [8W,1C,2M] @950：RCL4(1300) 主力档。
    {
      parts: ["work", "work", "work", "work", "work", "work", "work", "work", "carry", "move", "move"],
      minCapacity: 950,
    },
    // [4W] @500：RCL2-3(550/800) 过渡档。
    { parts: ["work", "work", "work", "work", "carry", "move"], minCapacity: 500 },
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  builder: [
    // [8W,4C,6M] @1300：RCL4 主力档。MOVE ≥ 非 MOVE/2，道路上满速；
    // 大工地（storage/tower）几下拍完，减少往返取能次数。
    {
      parts: [
        "work", "work", "work", "work", "work", "work", "work", "work",
        "carry", "carry", "carry", "carry",
        "move", "move", "move", "move", "move", "move",
      ],
      minCapacity: 1300,
    },
    // [4W,2C,3M] @650：RCL3(800) 过渡档。
    {
      parts: ["work", "work", "work", "work", "carry", "carry", "move", "move", "move"],
      minCapacity: 650,
    },
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
};

/**
 * 道路优化 body 变体（约束 HA-10）。
 * RCL4+ 核心物流路已铺设时使用：1 MOVE 可在道路上带动 2 CARRY（fatigue-free）。
 * 道路未覆盖时使用默认模板保证移动效率。
 * 按容量从高到低选档：同样吞吐用更少 creep，省 CPU 与 spawn 孵化窗。
 */
const ROAD_OPTIMIZED_BODIES: Readonly<Record<string, readonly BodyTemplate[]>> = {
  hauler: [
    // [16C,8M] @1200：RCL4(1300) 顶档。
    {
      parts: [
        "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
        "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
        "move", "move", "move", "move", "move", "move", "move", "move",
      ],
      minCapacity: 1200,
    },
    // [8C,4M] @600：RCL3(800) 档。
    {
      parts: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move"],
      minCapacity: 600,
    },
    { parts: ["carry", "carry", "carry", "carry", "move", "move"], minCapacity: 300 },
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
 *
 * options.rcl：RCL4+ 时 hauler 优先使用道路优化变体（约束 HA-10）。
 */
export function selectBody(
  role: string,
  energyCapacityAvailable: number,
  options?: { rcl?: number },
): BodyPartConstant[] {
  // RCL4+ 核心物流路已铺设时，hauler 使用道路优化变体。
  if (options?.rcl !== undefined && options.rcl >= 4) {
    const roadTiers = ROAD_OPTIMIZED_BODIES[role];
    if (roadTiers) {
      for (const t of roadTiers) {
        if (energyCapacityAvailable >= t.minCapacity) return [...t.parts];
      }
    }
  }

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
 * 每次移除最贵的可移除部件（优先砍 WORK=100，保留 CARRY/MOVE），
 * 直到成本满足或无可移除部件。至少保留 requiredParts 中每种各一个。
 * 默认要求 [WORK, CARRY, MOVE]；hauler 等纯 CARRY+MOVE 角色可传入 ["carry", "move"]。
 * 如果连最小 body 也无法满足，返回 undefined（调用方应推迟请求）。
 */
export function degradeBody(
  body: readonly BodyPartConstant[],
  energyAvailable: number,
  requiredParts: readonly BodyPartConstant[] = ["work", "carry", "move"],
): BodyPartConstant[] | undefined {
  const parts = [...body];

  while (bodyCost(parts) > energyAvailable) {
    // 统计每种部件当前数量。
    const counts = new Map<string, number>();
    for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1);

    // 找最贵的可移除部件（移除后该类型数量仍 >= 所需最低数量）。
    let worstIdx = -1;
    let worstCost = -1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const cost = PART_COST[p] ?? 0;
      if (cost < worstCost) continue;
      // 检查移除后是否仍满足 requiredParts 约束。
      const isRequired = requiredParts.includes(p);
      const currentCount = counts.get(p) ?? 0;
      if (isRequired && currentCount <= 1) continue; // 最后一个不可移除
      worstIdx = i;
      worstCost = cost;
    }

    if (worstIdx === -1) break; // 无可移除部件
    parts.splice(worstIdx, 1);
  }

  // 确保最小可用组合：包含所有 requiredParts。
  for (const part of requiredParts) {
    if (!parts.includes(part)) return undefined;
  }
  if (bodyCost(parts) > energyAvailable) return undefined;
  return parts;
}
