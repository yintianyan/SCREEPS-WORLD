/**
 * Power Creeps 决策纯函数测试 — planGplSpending（GPL 消费规划）+
 * selectPowerAction（PC 单 tick 运营动作裁决）。
 *
 * 覆盖：
 *   planGplSpending：
 *   - 正常：GPL1 无 PC → create；有 PC → 沿 build order 升级
 *   - 边界：free=0 → none；PC level 不足门禁 → 顺延；build order 全满 → none
 *   - 异常：名字占位递增；gplLevel=0 → none
 *   selectPowerAction：
 *   - 正常：renew/enableRoom/generateOps/三类 operate 各自命中
 *   - 边界：ops 不足时退化；效果未过期不续杯；未升 power 不可选
 *   - 异常：未孵化（TTL undefined）→ idle
 */
import { describe, expect, it } from "vitest";
import {
  OPS_COST,
  POWER_LEVEL_REQUIREMENTS,
  planGplSpending,
  selectPowerAction,
  type PcSummary,
  type PcStateInput,
  type PcRoomInput,
  type PowerCreepThresholds,
} from "../../../src/domain/strategy/power-creeps";

/** 测试阈值（与方案 CONFIG.powerCreeps 基线一致）。 */
const T: PowerCreepThresholds = {
  renewBelowTicks: 1000,
  opsBuffer: 200,
  extensionFillGap: 0.5,
  effectRefreshMargin: 250,
};

// ─── 引擎事实常量（与 typings PWR_* 数值一致）───────────────────
const PWR_GENERATE_OPS = 1;
const PWR_OPERATE_SPAWN = 2;
const PWR_OPERATE_EXTENSION = 6;
const PWR_OPERATE_STORAGE = 4;

/** 基准 PC：level 与 powers 由参数覆盖。 */
function pc(name: string, overrides: Partial<PcSummary> = {}): PcSummary {
  return { name, level: 0, powers: {}, ...overrides };
}

describe("planGplSpending — 正常路径", () => {
  it("GPL1 无 PC → create（确定性命名）", () => {
    const plan = planGplSpending(1, [], []);
    expect(plan).toEqual({ action: "create", pcName: "pc-op-0" });
  });

  it("GPL2 单 PC(level1) → 升 build order 下一项 OPERATE_SPAWN", () => {
    // GPL1 时已 create（PC level 0）+ upgrade GOPS（→PC level 1）。
    const sole = pc("pc-op-0", { level: 1, powers: { [PWR_GENERATE_OPS]: 1 } });
    const plan = planGplSpending(2, [sole], ["pc-op-0"]);
    expect(plan).toEqual({ action: "upgrade", pcName: "pc-op-0", power: PWR_OPERATE_SPAWN });
  });

  it("build order 深化 — GOPS lv1 后第二项 OPERATE_SPAWN lv1，第三项 OPERATE_EXTENSION lv1", () => {
    // level 2 = GOPS1 + OPS1；level 3 = +EXT1；验证顺序遵循 build order。
    const p = pc("pc-op-0", {
      level: 2,
      powers: { [PWR_GENERATE_OPS]: 1, [PWR_OPERATE_SPAWN]: 1 },
    });
    expect(planGplSpending(3, [p], ["pc-op-0"]).power).toBe(PWR_OPERATE_EXTENSION);
  });
});

describe("planGplSpending — 边界条件", () => {
  it("free levels=0（GPL 全部已消费）→ none", () => {
    const sole = pc("pc-op-0", { level: 1, powers: { [PWR_GENERATE_OPS]: 1 } });
    expect(planGplSpending(1, [sole], ["pc-op-0"])).toEqual({ action: "none" });
  });

  it("PC level 不足门禁 → 顺延 build order 下一项（不空转）", () => {
    // build order 第 5 项是 GOPS lv2（需 PC level 2），第 6 项 EXT lv2（需 level 2），
    // 第 7 项 SPAWN lv2（需 level 6）。PC level 4 时：5、6 均可升，应选第 5 项。
    const p = pc("pc-op-0", {
      level: 4,
      powers: {
        [PWR_GENERATE_OPS]: 1,
        [PWR_OPERATE_SPAWN]: 1,
        [PWR_OPERATE_EXTENSION]: 1,
        [PWR_OPERATE_STORAGE]: 1,
      },
    });
    const plan = planGplSpending(5, [p], ["pc-op-0"]);
    expect(plan).toEqual({ action: "upgrade", pcName: "pc-op-0", power: PWR_GENERATE_OPS });
  });

  it("build order 全部完成 → none（free levels 攒着）", () => {
    // build order 7 项全满：PC level = 1+1+1+1+2+2+2 = 10。
    const maxed = pc("pc-op-0", {
      level: 10,
      powers: {
        [PWR_GENERATE_OPS]: 2,
        [PWR_OPERATE_SPAWN]: 2,
        [PWR_OPERATE_EXTENSION]: 2,
        [PWR_OPERATE_STORAGE]: 1,
      },
    });
    expect(planGplSpending(11, [maxed], ["pc-op-0"])).toEqual({ action: "none" });
  });
});

describe("planGplSpending — 异常情况", () => {
  it("名字占位被占 → 序号递增直到空闲", () => {
    expect(planGplSpending(1, [], ["pc-op-0", "pc-op-1"]).pcName).toBe("pc-op-2");
  });

  it("gplLevel=0 → none", () => {
    expect(planGplSpending(0, [], [])).toEqual({ action: "none" });
  });

  it("PC level 与 powers 之和不一致时以 level 为准（free 计算容错）", () => {
    // powers 合计 1 但 level 声明 2（数据畸形）→ free = 3-2 = 1，
    // 仍按 build order 正常升级，不因畸形数据卡死。
    const odd = pc("pc-op-0", { level: 2, powers: { [PWR_GENERATE_OPS]: 1 } });
    const plan = planGplSpending(3, [odd], ["pc-op-0"]);
    expect(plan.action).toBe("upgrade");
  });
});

// ─── selectPowerAction ─────────────────────────────────────────

/** 基准输入：健康已孵化 PC，GOPS lv1，房间已启用 power。 */
function baseInput(
  pcOverrides: Partial<PcStateInput> = {},
  roomOverrides: Partial<PcRoomInput> = {},
): { pc: PcStateInput; room: PcRoomInput } {
  return {
    pc: {
      ticksToLive: 5000,
      opsCarried: 500,
      powerLevels: { [PWR_GENERATE_OPS]: 1, [PWR_OPERATE_SPAWN]: 1, [PWR_OPERATE_EXTENSION]: 1 },
      cooldowns: {},
      ...pcOverrides,
    },
    room: {
      powerEnabled: true,
      energyAvailable: 300,
      energyCapacity: 1300,
      storageEnergy: 100_000,
      storageNearFull: false,
      spawnIds: ["spawn1"],
      storageId: "storage1",
      spawnEffectRemaining: undefined,
      ...roomOverrides,
    },
  };
}

describe("selectPowerAction — 正常路径", () => {
  it("TTL 低于续命阈值 → renew（最高优先级）", () => {
    const { pc: p, room: r } = baseInput({ ticksToLive: 800 });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "renew" });
  });

  it("房间未启用 power → enableRoom", () => {
    const { pc: p, room: r } = baseInput({}, { powerEnabled: false });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "enableRoom" });
  });

  it("ops 低于缓冲线且 GOPS 就绪 → generateOps", () => {
    const { pc: p, room: r } = baseInput({ opsCarried: 50 });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "generateOps" });
  });

  it("spawn 效果缺失 → operateSpawn（返回第一个 spawn）", () => {
    const { pc: p, room: r } = baseInput();
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "operateSpawn", targetId: "spawn1" });
  });

  it("能量缺口超过门禁 → operateExtension（从 storage 灌）", () => {
    // spawn 效果仍在（剩 800 tick）→ 跳过 operateSpawn，落到 extension。
    const { pc: p, room: r } = baseInput({}, {
      spawnEffectRemaining: 800,
      energyAvailable: 300,
      energyCapacity: 1300,
    });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "operateExtension", targetId: "storage1" });
  });

  it("storage 满仓信号 → operateStorage 扩容", () => {
    const { pc: p, room: r } = baseInput(
      { powerLevels: { [PWR_GENERATE_OPS]: 1, [PWR_OPERATE_STORAGE]: 1 } },
      { spawnEffectRemaining: 800, energyAvailable: 1300, storageNearFull: true },
    );
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "operateStorage", targetId: "storage1" });
  });
});

describe("selectPowerAction — 边界条件", () => {
  it("spawn 效果剩余 > 续杯提前量 → 不续杯（落到下一优先级）", () => {
    // 剩 900 > margin 250；无 extension 缺口、无 nearFull → idle。
    const { pc: p, room: r } = baseInput({}, {
      spawnEffectRemaining: 900,
      energyAvailable: 1300,
    });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "idle" });
  });

  it("spawn 效果剩余 < 续杯提前量 → 续杯", () => {
    const { pc: p, room: r } = baseInput({}, {
      spawnEffectRemaining: 200,
      energyAvailable: 1300,
    });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "operateSpawn", targetId: "spawn1" });
  });

  it("ops 不够 100 → operateSpawn 不可选，退化到便宜动作或 idle", () => {
    // 能量补满排除 extension 分支；GOPS 冷却中排除补 ops 分支 —
    // 只剩 operateSpawn（100 ops 门禁）可触发，ops 80 不够 → idle。
    const { pc: p, room: r } = baseInput(
      { opsCarried: 80, cooldowns: { [PWR_GENERATE_OPS]: 30 } },
      { energyAvailable: 1300 },
    );
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "idle" });
  });

  it("未升 OPERATE_SPAWN → 不可选（无该 power 动作全部跳过）", () => {
    const { pc: p, room: r } = baseInput(
      { powerLevels: { [PWR_GENERATE_OPS]: 1 } },
      { energyAvailable: 1300 },
    );
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "idle" });
  });

  it("extension 缺口但 storage 无货 → operateExtension 跳过", () => {
    const { pc: p, room: r } = baseInput({}, {
      spawnEffectRemaining: 800,
      energyAvailable: 300,
      storageEnergy: 0,
    });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "idle" });
  });
});

describe("selectPowerAction — 异常情况", () => {
  it("PC 未孵化（TTL undefined）→ idle（防御性，系统层不应调用）", () => {
    const { pc: p, room: r } = baseInput({ ticksToLive: undefined });
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "idle" });
  });

  it("无 spawn 无 storage → 仅有 GOPS 时仍可补 ops", () => {
    const { pc: p, room: r } = baseInput(
      { opsCarried: 10 },
      { spawnIds: [], storageId: undefined, storageEnergy: undefined },
    );
    expect(selectPowerAction(p, r, T)).toEqual({ kind: "generateOps" });
  });
});

describe("引擎事实常量自检", () => {
  it("POWER_LEVEL_REQUIREMENTS 与 typings 数值一致（0/2/7/14/22）", () => {
    for (const req of Object.values(POWER_LEVEL_REQUIREMENTS)) {
      expect(req).toEqual([0, 2, 7, 14, 22]);
    }
  });

  it("OPS_COST 与官方文档一致", () => {
    expect(OPS_COST[PWR_OPERATE_SPAWN]).toBe(100);
    expect(OPS_COST[PWR_OPERATE_EXTENSION]).toBe(2);
    expect(OPS_COST[PWR_OPERATE_STORAGE]).toBe(100);
  });
});
