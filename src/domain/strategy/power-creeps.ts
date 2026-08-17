/**
 * Power Creeps 决策层 — 纯函数，执行层在 systems/power-creep-manager.ts。
 * 战略定位：powerSpawn processPower 攒 GPL（factory-manager 已落地），
 * 此处消费 GPL——create（账号级创建）→ upgrade（按 build order 升技能），
 * 以及已孵化 PC 的单 tick 运营动作裁决。
 *
 * 引擎事实自包含：power 升级门禁与 ops 消耗硬编码于此（与 typings
 * POWER_INFO / 官方文档一致，测试自检锁定），domain 层不依赖运行时常量表 —
 * 测试环境无需 mock PWR_* 全局常量。
 */

/** Power ID（与引擎 PWR_* 常量数值一致）。 */
export type PowerId = number;

// ─── 引擎事实常量（自检测试锁定，防 API 演化静默漂移）──────────────

/** 本模块覆盖的 power ID（执行层与测试共用，避免魔法数字）。 */
export const PWR = {
  GENERATE_OPS: 1,
  OPERATE_SPAWN: 2,
  OPERATE_STORAGE: 4,
  OPERATE_EXTENSION: 6,
} as const;

/** 各 power 升到 lv1-5 所需的 PC level（typings POWER_INFO.level 列）。 */
export const POWER_LEVEL_REQUIREMENTS: Readonly<Record<number, readonly number[]>> = {
  1: [0, 2, 7, 14, 22], // GENERATE_OPS
  2: [0, 2, 7, 14, 22], // OPERATE_SPAWN
  4: [0, 2, 7, 14, 22], // OPERATE_STORAGE
  6: [0, 2, 7, 14, 22], // OPERATE_EXTENSION
};

/** usePower 各动作的 ops 消耗（官方 Power 文档）。 */
export const OPS_COST: Readonly<Record<number, number>> = {
  2: 100, // OPERATE_SPAWN
  4: 100, // OPERATE_STORAGE
  6: 2,   // OPERATE_EXTENSION
};

/** 决策阈值 — 由调用方（power-creep-manager）经 CONFIG 注入。 */
export interface PowerCreepThresholds {
  /** TTL 低于此值优先续命（PC 走到 powerSpawn renew 免费）。 */
  renewBelowTicks: number;
  /** ops 库存低于此值先补 ops（ops 断供会让所有 operate 动作停摆）。 */
  opsBuffer: number;
  /** 能量缺口（1 - available/capacity）超过此比例才值得用 OPERATE_EXTENSION。 */
  extensionFillGap: number;
  /** 目标效果剩余 tick 低于此值才续杯（OPERATE_SPAWN dur1000/cd300 → 250）。 */
  effectRefreshMargin: number;
}

// ─── GPL 消费规划 ─────────────────────────────────────────────

/**
 * GPL build order — 广度优先：先每个高价值 power 各 1 级形成覆盖，再深化。
 * 顺序即升级顺序；重复出现表示深化到该等级。第一增量只覆盖运营类
 * （GOPS/SPAWN/EXT/STORAGE），战斗类 power 属军事编制增量，YAGNI。
 */
export const POWER_BUILD_ORDER: readonly PowerId[] = [
  1, // GENERATE_OPS lv1：ops 自给基础（多数 power 要 ops）
  2, // OPERATE_SPAWN lv1：孵化提速 10%
  6, // OPERATE_EXTENSION lv1：2 ops 即时灌 extension
  4, // OPERATE_STORAGE lv1：满仓期扩容 500K
  1, // GENERATE_OPS lv2：ops 产量翻倍（PC level 2 达标）
  6, // OPERATE_EXTENSION lv2：灌 40%
  2, // OPERATE_SPAWN lv2：提速 30%（PC level 6 达标）
];

/** GPL 消费决策输入中的 PC 摘要。 */
export interface PcSummary {
  name: string;
  /** PC 当前等级（= 各 power 等级之和；free 计算以此为准）。 */
  level: number;
  /** powerId → 已升等级（未含的视为 0）。 */
  powers: Readonly<Record<number, number>>;
}

/** 一笔 GPL 消费决策。 */
export interface GplSpendPlan {
  action: "create" | "upgrade" | "none";
  /** create 的名字（确定性序号）/ upgrade 的目标 PC。 */
  pcName?: string;
  /** upgrade 的 power。 */
  power?: PowerId;
}

/**
 * 规划本 tick 的 GPL 消费。free levels = gplLevel - Σ(PC level)；
 * ≤0 → none；无 PC → create；否则沿 build order 找第一个
 * 「未升满且 PC level 达门禁」的项（不达标顺延，不空转）。
 * 单 PC 策略：多 PC 时只投资第一个（跨 PC 调度属后续增量）。
 */
export function planGplSpending(
  gplLevel: number,
  pcs: readonly PcSummary[],
  existingNames: readonly string[],
): GplSpendPlan {
  const freeLevels = gplLevel - pcs.reduce((sum, p) => sum + p.level, 0);
  if (freeLevels <= 0) return { action: "none" };

  if (pcs.length === 0) {
    // 确定性命名：序号递增到第一个空闲位（ERR_NAME_EXISTS 免重试）。
    let seq = 0;
    while (existingNames.includes(`pc-op-${seq}`)) seq++;
    return { action: "create", pcName: `pc-op-${seq}` };
  }

  const target = pcs[0]!;
  // 遍历 build order，累计每个 power 的期望等级（第 n 次出现 → lv n）。
  const expected = new Map<PowerId, number>();
  for (const power of POWER_BUILD_ORDER) {
    const wantLevel = (expected.get(power) ?? 0) + 1;
    expected.set(power, wantLevel);
    const current = target.powers[power] ?? 0;
    if (current >= wantLevel) continue;
    // PC level 门禁：升 lv n 需要 level ≥ REQUIREMENTS[n-1]；不满足顺延。
    const required = POWER_LEVEL_REQUIREMENTS[power]?.[wantLevel - 1];
    if (required === undefined || target.level < required) continue;
    return { action: "upgrade", pcName: target.name, power };
  }
  return { action: "none" };
}

// ─── 运营动作裁决 ─────────────────────────────────────────────

/** PC 侧输入（从 PowerCreep 对象采集）。 */
export interface PcStateInput {
  /** 未孵化为 undefined（决策层防御性返回 idle）。 */
  ticksToLive: number | undefined;
  /** PC 自身携带的 ops（usePower 从这里扣）。 */
  opsCarried: number;
  /** powerId → 已升等级（0 = 未拥有，动作不可选）。 */
  powerLevels: Readonly<Record<number, number>>;
  /** powerId → 剩余冷却（未孵化时 undefined；就绪视为 0）。 */
  cooldowns: Readonly<Record<number, number | undefined>>;
}

/** 房间侧输入（从 RoomSnapshot / Game 层采集）。 */
export interface PcRoomInput {
  /** controller.isPowerEnabled。 */
  powerEnabled: boolean;
  energyAvailable: number;
  energyCapacity: number;
  /** storage 能量（无 storage 为 undefined）。 */
  storageEnergy: number | undefined;
  /** room-state 的满仓信号（OPERATE_STORAGE 触发条件）。 */
  storageNearFull: boolean;
  spawnIds: readonly string[];
  storageId: string | undefined;
  /** 第一个 spawn 的 OPERATE_SPAWN 效果剩余 tick（无效果 undefined）。 */
  spawnEffectRemaining: number | undefined;
}

/** PC 单 tick 运营动作。 */
export type PowerAction =
  | { kind: "renew" }
  | { kind: "generateOps" }
  | { kind: "enableRoom" }
  | { kind: "operateSpawn"; targetId: string }
  | { kind: "operateExtension"; targetId: string }
  | { kind: "operateStorage"; targetId: string }
  | { kind: "idle" };

/**
 * PC 单 tick 动作裁决。优先级：renew > enableRoom > generateOps >
 * operateSpawn > operateExtension > operateStorage > idle。
 * 决策无状态（效果/冷却全在 Game 层每 tick 现查）；
 * range 检查归执行层（moveTo 到 range 3 / 1）。
 */
export function selectPowerAction(
  pc: PcStateInput,
  room: PcRoomInput,
  t: PowerCreepThresholds,
): PowerAction {
  if (pc.ticksToLive === undefined) return { kind: "idle" };
  if (pc.ticksToLive < t.renewBelowTicks) return { kind: "renew" };
  if (!room.powerEnabled) return { kind: "enableRoom" };

  // ops 补给优先于一切消耗 ops 的动作（断供连锁停摆）。
  const gopsLevel = pc.powerLevels[1] ?? 0;
  const gopsCooldown = pc.cooldowns[1];
  if (gopsLevel > 0 && pc.opsCarried < t.opsBuffer && !(gopsCooldown !== undefined && gopsCooldown > 0)) {
    return { kind: "generateOps" };
  }

  const hasLevel = (p: PowerId): boolean => (pc.powerLevels[p] ?? 0) > 0;
  const opsReady = (p: PowerId): boolean => pc.opsCarried >= (OPS_COST[p] ?? Infinity);

  // OPERATE_SPAWN：效果缺失或临期续杯（dur1000，剩 < margin 续）。
  if (hasLevel(2) && opsReady(2) && room.spawnIds.length > 0) {
    const remaining = room.spawnEffectRemaining ?? 0;
    if (remaining < t.effectRefreshMargin) {
      return { kind: "operateSpawn", targetId: room.spawnIds[0]! };
    }
  }

  // OPERATE_EXTENSION：能量缺口超门禁且 storage 有货（能量从目标结构扣）。
  if (
    hasLevel(6) && opsReady(6) && room.storageId !== undefined &&
    room.energyCapacity > 0 &&
    1 - room.energyAvailable / room.energyCapacity > t.extensionFillGap &&
    (room.storageEnergy ?? 0) > 0
  ) {
    return { kind: "operateExtension", targetId: room.storageId };
  }

  // OPERATE_STORAGE：满仓信号（容量压力来自 room-state，效果检测靠引擎
  // ERR_TIRED/ERR_FULL 静默兜底 — cd800/dur1000 操作频率天然低）。
  if (hasLevel(4) && opsReady(4) && room.storageId !== undefined && room.storageNearFull) {
    return { kind: "operateStorage", targetId: room.storageId };
  }

  return { kind: "idle" };
}
