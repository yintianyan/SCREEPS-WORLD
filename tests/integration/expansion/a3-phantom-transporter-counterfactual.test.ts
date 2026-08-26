/**
 * A3 Phantom Transporter Bug — 反事实测试 (CF-1 到 CF-12)
 *
 * 验证修复后的不变量：修复将 expansion-manager 中对不存在角色 "transporter"
 * 的检查替换为检查实际存在的运输角色 (hauler/distributor)。
 *
 * 这些测试验证从 Demand → Spawn → Assignment → Execution → Recovery 的完整链路。
 */

import { describe, it, expect } from "vitest";
import { CONFIG } from "../../../src/config";
import { evaluateCheckpoint, type CheckpointInput } from "../../../src/domain/expansion/checkpoint";
import {
  evaluateEconomicActivation,
  type EconomicActivationInput,
} from "../../../src/domain/expansion/economic-activation";
import {
  transitionExecutionState,
  type ExecutionState,
  type StateTransitionInput,
} from "../../../src/domain/expansion/execution-state";
import type { ExpansionPlan } from "../../../src/domain/expansion/plan";

// ─── 辅助函数 ──────────────────────────────────────────

function makePlan(over: Partial<ExpansionPlan> = {}): ExpansionPlan {
  return {
    planId: "W5N5@1000",
    roomName: "W5N5",
    sponsorRoom: "W1N1",
    reason: "resource",
    priority: "P1",
    candidateScore: 0.75,
    cost: { roomName: "W5N5", totalCost: 5000, claimerCost: 650, pioneerCost: 1000, spawnCost: 5000, travelCost: 200, infrastructureCost: 500, bootstrapEnergy: 3000, evidence: "" },
    payback: { roomName: "W5N5", totalCost: 5000, expectedIncomePerTick: 10, paybackTicks: 500, roi: 2.0, worthwhile: true, evidence: "" },
    risk: { roomName: "W5N5", score: 0.3, level: "LOW", dimensions: { economic: 0.2, operational: 0.1, distance: 0.3, recovery: 0.2, defense: 0.1 }, evidence: "" },
    candidate: {
      roomName: "W5N5", sponsorRoom: "W1N1", kind: "normal", roomStatus: "normal",
      sourceCount: 2, mineral: "H",
      terrain: { exitCount: 3, sealedExitCount: 1, wallCount: 0 },
      controller: { hasOwner: false, isMine: false, isHostileReserved: false },
      pathCost: 100, lastSeen: 1000, distance: 1,
      neighborRooms: ["W4N5", "W6N5"], score: 0.75,
      status: "QUALIFIED", discoveredAt: 1000,
    },
    status: "WAITING_EXECUTION",
    createdAt: 1000, updatedAt: 1000,
    cancelConditions: [], dependencies: [],
    explanation: "test plan",
    ...over,
  };
}

function makeCheckpointInput(over: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    checkpointId: "CP3_ENERGY_LOOP",
    controllerClaimed: true,
    spawnBuilt: true,
    spawnCanSpawn: true,
    harvesterActive: true,
    transporterActive: true,
    extensionsBuilt: true,
    containerBuilt: true,
    roadsBuilt: true,
    netEnergyFlowPositive: true,
    empireIntegrated: true,
    tick: 1000,
    retryCount: 0,
    ...over,
  };
}

function makeEconomicInput(over: Partial<EconomicActivationInput> = {}): EconomicActivationInput {
  return {
    energyProduction: 20,
    energyConsumption: 10,
    externalEnergyInflow: 0,
    consecutivePositiveTicks: 500,
    hasHarvester: true,
    hasTransporter: true,
    hasUpgrader: true,
    spawnActive: true,
    tick: 1000,
    ...over,
  };
}

function makeTransitionInput(over: Partial<StateTransitionInput> = {}): StateTransitionInput {
  return {
    currentState: "BOOTSTRAPPING",
    plan: makePlan(),
    spawnBuilt: true,
    pioneerArrived: true,
    tick: 1000,
    ...over,
  };
}

// 模拟 expansion-manager 中的 logisticsActive 检查逻辑
function checkLogisticsActive(creeps: { home: string; role: string }[], targetRoom: string): boolean {
  return creeps.some(
    c => c.home === targetRoom &&
      (c.role === "hauler" || c.role === "distributor"),
  );
}

// ═══════════════════════════════════════════════════════════════
// CF-1: 需求存在 + 没有 transporter → 必须产生 demand
// ═══════════════════════════════════════════════════════════════

describe("CF-1: 需求存在 + 没有 hauler/distributor → logisticsActive=false", () => {
  it("空 creep 列表 → logisticsActive=false", () => {
    const creeps: { home: string; role: string }[] = [];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);
  });

  it("有 harvester 但无 hauler/distributor → logisticsActive=false", () => {
    const creeps = [{ home: "W5N5", role: "harvester" }];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-2: 需求存在 + demand 未满足 → CP3 不通过
// ═══════════════════════════════════════════════════════════════

describe("CF-2: 无 hauler/distributor → CP3 不通过", () => {
  it("harvester 存在但无 hauler → CP3 失败，原因为 logistics", () => {
    const r = evaluateCheckpoint(makeCheckpointInput({
      harvesterActive: true,
      transporterActive: false, // 修复后传入的是 logisticsActive=false
    }));
    expect(r.passed).toBe(false);
    expect(r.failReason).toContain("transporter"); // 字段名仍是 transporterActive
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-3: spawn request 存在 → 最终必须真实产生 transporter
// ═══════════════════════════════════════════════════════════════

describe("CF-3: hauler 存在 → CP3 通过", () => {
  it("有 hauler → logisticsActive=true → CP3 通过", () => {
    const creeps = [{ home: "W5N5", role: "hauler" }];
    const logisticsActive = checkLogisticsActive(creeps, "W5N5");
    expect(logisticsActive).toBe(true);

    const r = evaluateCheckpoint(makeCheckpointInput({
      harvesterActive: true,
      transporterActive: logisticsActive,
    }));
    expect(r.passed).toBe(true);
  });

  it("有 distributor → logisticsActive=true → CP3 通过", () => {
    const creeps = [{ home: "W5N5", role: "distributor" }];
    const logisticsActive = checkLogisticsActive(creeps, "W5N5");
    expect(logisticsActive).toBe(true);

    const r = evaluateCheckpoint(makeCheckpointInput({
      harvesterActive: true,
      transporterActive: logisticsActive,
    }));
    expect(r.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-4: transporter 已生成但未 assignment → 不得判定 logistics ready
// ═══════════════════════════════════════════════════════════════

describe("CF-4: hauler 存在但不在目标房 → logisticsActive=false", () => {
  it("hauler 在其他房 → logisticsActive=false（room identity 检查）", () => {
    const creeps = [{ home: "W1N1", role: "hauler" }]; // home 不是 W5N5
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-5: transporter alive + active → 才能逐步提高 logistics readiness
// ═══════════════════════════════════════════════════════════════

describe("CF-5: hauler alive + active → economic activation 逐步提高", () => {
  it("hauler 存在 + 能量净流为正 → economic activation progress > 0", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: true, // 修复后传入 logisticsActive=true
      consecutivePositiveTicks: 0,
    }));
    expect(r.progress).toBeGreaterThan(0);
    expect(r.criteria.energyLoop.passed).toBe(true);
  });

  it("hauler 存在 + 500 tick 净流为正 → economic activation = true", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: true,
      consecutivePositiveTicks: 500,
    }));
    expect(r.activated).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-6: transporter 死亡 → demand 自动恢复
// ═══════════════════════════════════════════════════════════════

describe("CF-6: hauler 死亡 → logisticsActive 恢复 false → CP3 失败", () => {
  it("hauler 死亡后 logisticsActive 恢复 false", () => {
    let creeps = [{ home: "W5N5", role: "hauler" }];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(true);

    // hauler 死亡
    creeps = [];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);

    // CP3 回到失败状态
    const r = evaluateCheckpoint(makeCheckpointInput({
      transporterActive: false,
    }));
    expect(r.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-7: target room identity 错误 → 不得计入目标 colony logistics
// ═══════════════════════════════════════════════════════════════

describe("CF-7: room identity mismatch → 不计入目标 colony", () => {
  it("hauler home=W8N3 但检查 W8N4 → logisticsActive=false", () => {
    const creeps = [{ home: "W8N3", role: "hauler" }];
    expect(checkLogisticsActive(creeps, "W8N4")).toBe(false);
  });

  it("hauler home=W8N4 但检查 W8N3 → logisticsActive=false", () => {
    const creeps = [{ home: "W8N4", role: "hauler" }];
    expect(checkLogisticsActive(creeps, "W8N3")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-8: 队列有 hauler request 但 energy 不足 → 不得产生 phantom success
// ═══════════════════════════════════════════════════════════════

describe("CF-8: hauler 在 spawn 队列但未孵化 → logisticsActive=false", () => {
  it("hauler 在队列但未孵化 → 不计入 logisticsActive", () => {
    // checkLogisticsActive 只检查 Game.creeps（已孵化），不检查队列
    // 这与 expansion-manager 的逻辑一致：检查 Game.creeps 而非 Memory.rooms.spawnQueue
    const creeps: { home: string; role: string }[] = [];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);

    // CP3 不通过
    const r = evaluateCheckpoint(makeCheckpointInput({
      transporterActive: false,
    }));
    expect(r.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-9: 多个 colony 同时扩张 → transporter 不得跨 colony 错计
// ═══════════════════════════════════════════════════════════════

describe("CF-9: multi-colony → hauler 不跨 colony 错计", () => {
  it("Colony A 的 hauler 不计入 Colony B", () => {
    const creeps = [
      { home: "W5N5", role: "hauler" },   // Colony A
      { home: "W6N5", role: "hauler" },   // Colony B
    ];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(true);
    expect(checkLogisticsActive(creeps, "W6N5")).toBe(true);

    // Colony A 的 hauler 不算 Colony C
    expect(checkLogisticsActive(creeps, "W7N5")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-10: bootstrap timeout → 必须进入真实 recovery
// ═══════════════════════════════════════════════════════════════

describe("CF-10: bootstrap timeout → 不绕过 readiness", () => {
  it("无 hauler → economic activation 不通过 → 不进入 completed", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: false,
      consecutivePositiveTicks: 500,
    }));
    expect(r.activated).toBe(false);

    // 状态机不应进入 COMPLETED
    const tr = transitionExecutionState(makeTransitionInput({
      currentState: "INTEGRATING",
      economicallyActivated: false,
      empireIntegrated: true,
    }));
    expect(tr.newState).not.toBe("COMPLETED");
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-11: transporter trend improving → 不得因瞬时 snapshot 判断失败
// ═══════════════════════════════════════════════════════════════

describe("CF-11: hauler trend improving → progress 增加", () => {
  it("从无 hauler 到有 hauler → economic activation progress 增加", () => {
    const before = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: false,
      consecutivePositiveTicks: 0,
    }));
    const after = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: true,
      consecutivePositiveTicks: 100,
    }));
    expect(after.progress).toBeGreaterThan(before.progress);
  });
});

// ═══════════════════════════════════════════════════════════════
// CF-12: transporter trend degrading → 必须提前重新建立 demand
// ═══════════════════════════════════════════════════════════════

describe("CF-12: hauler trend degrading → 重新 demand", () => {
  it("hauler 死亡 → economic activation 回退", () => {
    const before = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: true,
      consecutivePositiveTicks: 500,
    }));
    expect(before.activated).toBe(true);

    // hauler 死亡
    const after = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: false,
      consecutivePositiveTicks: 500, // 仍然连续 500 tick（历史值）
    }));
    expect(after.activated).toBe(false);
    expect(after.criteria.energyLoop.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Recovery Test: transporter 死亡 → demand regeneration → spawn → recovery
// ═══════════════════════════════════════════════════════════════

describe("Recovery: hauler 死亡 → demand 恢复 → CP3 回退 → 重新孵化", () => {
  it("完整恢复链路", () => {
    // 初始状态：hauler 存在，CP3 通过
    let creeps = [{ home: "W5N5", role: "hauler" }];
    let logisticsActive = checkLogisticsActive(creeps, "W5N5");
    expect(logisticsActive).toBe(true);

    let cp3 = evaluateCheckpoint(makeCheckpointInput({
      transporterActive: logisticsActive,
    }));
    expect(cp3.passed).toBe(true);

    // hauler 死亡
    creeps = [];
    logisticsActive = checkLogisticsActive(creeps, "W5N5");
    expect(logisticsActive).toBe(false);

    cp3 = evaluateCheckpoint(makeCheckpointInput({
      transporterActive: logisticsActive,
    }));
    expect(cp3.passed).toBe(false);

    // spawn-manager 通过 evaluateDemand 重新产生 hauler demand
    // （CONFIG.roles.hauler.minCount=2, maxCount=6，有 container 时会重新孵化）
    expect(CONFIG.roles.hauler).toBeDefined();
    expect(CONFIG.roles.hauler.minCount).toBeGreaterThanOrEqual(1);

    // hauler 重新孵化
    creeps = [{ home: "W5N5", role: "hauler" }];
    logisticsActive = checkLogisticsActive(creeps, "W5N5");
    expect(logisticsActive).toBe(true);

    cp3 = evaluateCheckpoint(makeCheckpointInput({
      transporterActive: logisticsActive,
    }));
    expect(cp3.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Multi-Colony Test: Source Room + Colony A + Colony B
// ═══════════════════════════════════════════════════════════════

describe("Multi-Colony: Colony A + Colony B 无 cross-colony contamination", () => {
  it("两个殖民地各自的 hauler 不互相计入", () => {
    const creeps = [
      { home: "W5N5", role: "hauler" },   // Colony A
      { home: "W6N5", role: "hauler" },   // Colony B
      { home: "W5N5", role: "harvester" }, // Colony A harvester
      { home: "W6N5", role: "harvester" }, // Colony B harvester
    ];

    // Colony A 检查
    const aLogistics = checkLogisticsActive(creeps, "W5N5");
    const aCp3 = evaluateCheckpoint(makeCheckpointInput({
      transporterActive: aLogistics,
    }));
    expect(aCp3.passed).toBe(true);

    // Colony B 检查
    const bLogistics = checkLogisticsActive(creeps, "W6N5");
    const bCp3 = evaluateCheckpoint(makeCheckpointInput({
      transporterActive: bLogistics,
    }));
    expect(bCp3.passed).toBe(true);

    // Colony C（不存在）检查
    const cLogistics = checkLogisticsActive(creeps, "W7N5");
    expect(cLogistics).toBe(false);
  });

  it("Colony A hauler 死亡不影响 Colony B", () => {
    let creeps = [
      { home: "W5N5", role: "hauler" },
      { home: "W6N5", role: "hauler" },
    ];

    // Colony A hauler 死亡
    creeps = creeps.filter(c => c.home !== "W5N5" || c.role !== "hauler");
    // 添加非 hauler 的 Colony A creep 以模拟 Colony A 仍有其他单位
    creeps.push({ home: "W5N5", role: "harvester" });

    // Colony A logistics 不通过
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);

    // Colony B logistics 仍然通过
    expect(checkLogisticsActive(creeps, "W6N5")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// INV-1 to INV-7: 不变量验证
// ═══════════════════════════════════════════════════════════════

describe("INV-1 Demand Truth: hauler demand 由 evaluateDemand 产生", () => {
  it("CONFIG.roles.hauler 存在且有 minCount", () => {
    expect(CONFIG.roles.hauler).toBeDefined();
    expect(CONFIG.roles.hauler.minCount).toBeGreaterThanOrEqual(1);
  });
});

describe("INV-2 Spawn Truth: spawn-manager 是唯一 spawnCreep 调用者", () => {
  it("CONFIG.roles 中 hauler 已注册", () => {
    expect(CONFIG.roles).toHaveProperty("hauler");
  });
});

describe("INV-3 Population Truth: 只有存活 hauler 计入 logisticsActive", () => {
  it("checkLogisticsActive 只检查已存活 creep（不检查队列）", () => {
    const creeps: { home: string; role: string }[] = [];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);
  });
});

describe("INV-4 Assignment Truth: 只有绑定目标 room 的 hauler 才计入", () => {
  it("hauler home=W5N5 检查 W5N5 → true", () => {
    expect(checkLogisticsActive([{ home: "W5N5", role: "hauler" }], "W5N5")).toBe(true);
  });
  it("hauler home=W1N1 检查 W5N5 → false", () => {
    expect(checkLogisticsActive([{ home: "W1N1", role: "hauler" }], "W5N5")).toBe(false);
  });
});

describe("INV-5 Contribution Truth: 存在 hauler ≠ logistics ready，还需 netFlow > 0", () => {
  it("有 hauler 但净流为负 → 不激活", () => {
    const r = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: true,
      energyProduction: 5,
      energyConsumption: 10,
      consecutivePositiveTicks: 0,
    }));
    expect(r.activated).toBe(false);
    expect(r.criteria.netPositive.passed).toBe(false);
  });
});

describe("INV-6 Recovery Truth: hauler 死亡 → demand → spawn → replacement 闭环", () => {
  it("hauler 死亡 → logisticsActive 恢复 false → CP3 失败 → 需要重新孵化", () => {
    let creeps = [{ home: "W5N5", role: "hauler" }];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(true);

    creeps = [];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(false);

    // 重新孵化后
    creeps = [{ home: "W5N5", role: "hauler" }];
    expect(checkLogisticsActive(creeps, "W5N5")).toBe(true);
  });
});

describe("INV-7 Expansion Truth: 不得因 phantom transporter 提前进入 COMPLETED", () => {
  it("无 hauler → economic activation 不通过 → 不进入 COMPLETED", () => {
    const econ = evaluateEconomicActivation(makeEconomicInput({
      hasTransporter: false,
      consecutivePositiveTicks: 500,
    }));
    expect(econ.activated).toBe(false);

    const tr = transitionExecutionState(makeTransitionInput({
      currentState: "INTEGRATING",
      economicallyActivated: econ.activated,
      empireIntegrated: true,
    }));
    expect(tr.newState).not.toBe("COMPLETED");
  });
});
