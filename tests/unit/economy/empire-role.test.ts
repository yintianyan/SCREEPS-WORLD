/**
 * A4.0 Phase 1 — Empire Room Role 单元测试。
 *
 * 覆盖：
 * - empire-role.ts：枚举、特征、序列化/反序列化
 * - role-evaluation.ts：四角色评分、前置条件门控、推荐角色选择
 * - role-stability.ts：Hysteresis、Min Duration、Re-evaluation Threshold
 * - role-transition.ts：转换路径验证、影响评估、触发推断
 * - room-profile.ts：empireRole 字段扩展
 * - room-registry.ts：empireRole 字段扩展
 */
import { describe, it, expect } from "vitest";
import {
  EMPIRE_ROOM_ROLES,
  ROLE_CHARACTERISTICS,
  getRoleCharacteristic,
  canRoleProduce,
  canRoleConsume,
  isLogisticsHubRole,
  roleToCode,
  codeToRole,
  type EmpireRoomRole,
} from "../../../src/domain/economy/empire-role";
import {
  evaluateRoomRole,
  meetsPrerequisites,
  type RoleEvaluationInput,
} from "../../../src/domain/economy/role-evaluation";
import {
  decideRoleStability,
  createInitialRoleStability,
  serializeRoleStability,
  deserializeRoleStability,
  DEFAULT_ROLE_STABILITY_CONFIG,
  type RoleStabilityState,
} from "../../../src/domain/economy/role-stability";
import {
  validateRoleTransition,
  inferTransitionTrigger,
  getRoleTier,
  isRoleUpgrade,
  isRoleDowngrade,
} from "../../../src/domain/economy/role-transition";
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";
import type { RoomCapacityProfile } from "../../../src/domain/economy/capacity-profile";
import { makeRegistryEntry } from "../../../src/domain/strategy/room-registry";

// ─── 辅助构造函数 ─────────────────────────────────────────

function makeProfile(over?: Partial<RoomEconomicProfile>): RoomEconomicProfile {
  return {
    roomName: "W7N4",
    rcl: 7, hasSpawn: true, hasStorage: true, hasTerminal: true,
    netFlow: 5, contractReserve: 50000, riskBuffer: 1000,
    estimatedIncome: 14, efficiency: 0.7, drift: 0, economyTick: 1000,
    storageEnergy: 50000, storageCapacity: 1_000_000, storageRatio: 0.5,
    energyAvailable: 500, energyCapacityAvailable: 1000,
    storageNearFull: false, sourceCount: 2,
    colonyPhase: "growth", colonyState: "normal",
    economyPressure: 0.1, lastHostileAt: undefined, hasLiveThreat: false,
    controllerDowngradeRisk: false, claimSecure: false,
    economicClass: "core", netFlowPositive: true,
    selfSufficiency: 0.64, isStruggling: false,
    ...over,
  };
}

function makeCapacity(over?: Partial<RoomCapacityProfile>): RoomCapacityProfile {
  return {
    roomName: "W7N4",
    sourceCount: 2, nominalCapacity: 20, efficiency: 0.7,
    effectiveCapacity: 14, utilization: 0.7,
    storageCapacity: 1_000_000, terminalCapacity: 30000, linkCapacity: 2000,
    totalReserveCapacity: 1_032_000, reserveUtilization: 0.05,
    spawnCapacity: 1000, spawnUtilization: 0.5, spawnCount: 1,
    haulerCount: 3, referenceCarry: 300, logisticsThroughput: 18,
    builderCount: 2, constructionThroughput: 100,
    bottleneck: "none",
    ...over,
  };
}

function makeRoleInput(over?: Partial<RoleEvaluationInput>): RoleEvaluationInput {
  return {
    roomName: "W7N4",
    profile: makeProfile(),
    capacity: makeCapacity(),
    avgDistanceToOthers: 1.5,
    otherRoomCount: 2,
    hasTerminal: true,
    activeRemoteOps: 0,
    remoteNetScore: 0,
    remoteProductionRatio: 0,
    empireAvgIncome: 12,
    empireAvgEfficiency: 0.65,
    tick: 1000,
    ...over,
  };
}

// ─── empire-role.ts 测试 ──────────────────────────────────

describe("empire-role.ts", () => {
  describe("EMPIRE_ROOM_ROLES", () => {
    it("包含四个角色", () => {
      expect(EMPIRE_ROOM_ROLES).toHaveLength(4);
      expect(EMPIRE_ROOM_ROLES).toContain("core");
      expect(EMPIRE_ROOM_ROLES).toContain("production");
      expect(EMPIRE_ROOM_ROLES).toContain("support");
      expect(EMPIRE_ROOM_ROLES).toContain("remote");
    });
  });

  describe("ROLE_CHARACTERISTICS", () => {
    it("每个角色都有完整特征", () => {
      for (const role of EMPIRE_ROOM_ROLES) {
        const c = ROLE_CHARACTERISTICS[role];
        expect(c.role).toBe(role);
        expect(c.description.length).toBeGreaterThan(0);
        expect(c.responsibilities.length).toBeGreaterThan(0);
        expect(c.prerequisites.length).toBeGreaterThan(0);
        expect(c.economicBehavior).toBeDefined();
      }
    });

    it("CORE 可做 producer 和 logistics hub，不可做 consumer", () => {
      const c = ROLE_CHARACTERISTICS.core;
      expect(c.economicBehavior.canBeProducer).toBe(true);
      expect(c.economicBehavior.canBeConsumer).toBe(false);
      expect(c.economicBehavior.canBeLogisticsHub).toBe(true);
    });

    it("SUPPORT 可做 producer、consumer 和 logistics hub", () => {
      const c = ROLE_CHARACTERISTICS.support;
      expect(c.economicBehavior.canBeProducer).toBe(true);
      expect(c.economicBehavior.canBeConsumer).toBe(true);
      expect(c.economicBehavior.canBeLogisticsHub).toBe(true);
    });

    it("PRODUCTION 优先 hauler 和 production budget", () => {
      const c = ROLE_CHARACTERISTICS.production;
      expect(c.economicBehavior.priorityHauler).toBe(true);
      expect(c.economicBehavior.priorityProductionBudget).toBe(true);
    });
  });

  describe("辅助函数", () => {
    it("getRoleCharacteristic 返回正确特征", () => {
      expect(getRoleCharacteristic("core").role).toBe("core");
      expect(getRoleCharacteristic("remote").role).toBe("remote");
    });

    it("canRoleProduce — 所有角色都可 produce", () => {
      for (const role of EMPIRE_ROOM_ROLES) {
        expect(canRoleProduce(role)).toBe(true);
      }
    });

    it("canRoleConsume — 只有 SUPPORT 可 consume", () => {
      expect(canRoleConsume("support")).toBe(true);
      expect(canRoleConsume("core")).toBe(false);
      expect(canRoleConsume("production")).toBe(false);
      expect(canRoleConsume("remote")).toBe(false);
    });

    it("isLogisticsHubRole — CORE 和 SUPPORT 是 hub", () => {
      expect(isLogisticsHubRole("core")).toBe(true);
      expect(isLogisticsHubRole("support")).toBe(true);
      expect(isLogisticsHubRole("production")).toBe(false);
      expect(isLogisticsHubRole("remote")).toBe(false);
    });
  });

  describe("序列化", () => {
    it("roleToCode / codeToRole 双向转换", () => {
      const roles: EmpireRoomRole[] = ["core", "production", "support", "remote"];
      for (const role of roles) {
        const code = roleToCode(role);
        expect(codeToRole(code)).toBe(role);
      }
    });

    it("codeToRole 对未知代码返回 undefined", () => {
      expect(codeToRole("X")).toBeUndefined();
      expect(codeToRole(undefined)).toBeUndefined();
    });
  });
});

// ─── role-evaluation.ts 测试 ──────────────────────────────

describe("role-evaluation.ts", () => {
  describe("meetsPrerequisites", () => {
    it("困难房不满足任何角色前置条件", () => {
      const input = makeRoleInput({
        profile: makeProfile({ isStruggling: true, colonyState: "recovery" }),
      });
      for (const role of EMPIRE_ROOM_ROLES) {
        expect(meetsPrerequisites(role, input)).toBe(false);
      }
    });

    it("CORE 前置条件：RCL≥6 + storage + 正净流", () => {
      // RCL5 → 不满足
      expect(meetsPrerequisites("core", makeRoleInput({
        profile: makeProfile({ rcl: 5 }),
      }))).toBe(false);
      // RCL6 + storage + 正净流 → 满足
      expect(meetsPrerequisites("core", makeRoleInput({
        profile: makeProfile({ rcl: 6, hasStorage: true, netFlowPositive: true }),
      }))).toBe(true);
      // 负净流 → 不满足
      expect(meetsPrerequisites("core", makeRoleInput({
        profile: makeProfile({ netFlowPositive: false }),
      }))).toBe(false);
    });

    it("PRODUCTION 前置条件：RCL≥4 + storage + 产能>0", () => {
      expect(meetsPrerequisites("production", makeRoleInput({
        profile: makeProfile({ rcl: 3 }),
      }))).toBe(false);
      expect(meetsPrerequisites("production", makeRoleInput({
        profile: makeProfile({ rcl: 4, hasStorage: true, estimatedIncome: 10 }),
      }))).toBe(true);
    });

    it("REMOTE 前置条件：有活跃远矿 + 净收益>0", () => {
      expect(meetsPrerequisites("remote", makeRoleInput({
        activeRemoteOps: 0, remoteNetScore: 0,
      }))).toBe(false);
      expect(meetsPrerequisites("remote", makeRoleInput({
        activeRemoteOps: 2, remoteNetScore: 15,
      }))).toBe(true);
    });
  });

  describe("evaluateRoomRole", () => {
    it("高 RCL + 高储备 + 正净流 → 推荐 CORE", () => {
      const input = makeRoleInput({
        profile: makeProfile({
          rcl: 8, storageRatio: 0.7, netFlow: 10, riskBuffer: 2000,
        }),
        activeRemoteOps: 0, remoteNetScore: 0,
      });
      const result = evaluateRoomRole(input);
      expect(result.recommendedRole).toBe("core");
      expect(result.recommendedScore).toBeGreaterThan(0.5);
    });

    it("高效率 + 高产能 → 推荐 PRODUCTION（当 CORE 分数低时）", () => {
      const input = makeRoleInput({
        profile: makeProfile({
          rcl: 5, efficiency: 0.9, estimatedIncome: 18,
          netFlow: 3, storageRatio: 0.3, riskBuffer: 300,
        }),
        empireAvgIncome: 10,
        empireAvgEfficiency: 0.5,
        activeRemoteOps: 0, remoteNetScore: 0,
      });
      const result = evaluateRoomRole(input);
      // RCL5 → CORE 前置条件不满足 → PRODUCTION 应该胜出
      expect(result.scores.core.prerequisitesMet).toBe(false);
      expect(result.scores.core.totalScore).toBe(0);
      expect(result.recommendedRole).toBe("production");
    });

    it("有 terminal + 位于地理中心 → 推荐 SUPPORT", () => {
      const input = makeRoleInput({
        profile: makeProfile({
          rcl: 6, efficiency: 0.5, estimatedIncome: 10,
          netFlow: 1, storageRatio: 0.3, riskBuffer: 300,
        }),
        hasTerminal: true,
        avgDistanceToOthers: 0.5, // 非常中心
        otherRoomCount: 4,
        empireAvgIncome: 14,
        empireAvgEfficiency: 0.7,
        activeRemoteOps: 0, remoteNetScore: 0,
      });
      const result = evaluateRoomRole(input);
      // SUPPORT 分数应该高于 PRODUCTION（因为效率/产能低但位置中心）
      expect(result.scores.support.totalScore).toBeGreaterThan(result.scores.production.totalScore);
      expect(result.recommendedRole).toBe("support");
    });

    it("多远矿 + 高远矿收益 → 推荐 REMOTE", () => {
      const input = makeRoleInput({
        profile: makeProfile({
          rcl: 6, efficiency: 0.5, estimatedIncome: 8,
          netFlow: 1, storageRatio: 0.3, riskBuffer: 300,
        }),
        activeRemoteOps: 3,
        remoteNetScore: 25,
        remoteProductionRatio: 0.75,
        empireAvgIncome: 12,
        empireAvgEfficiency: 0.7,
      });
      const result = evaluateRoomRole(input);
      expect(result.scores.remote.totalScore).toBeGreaterThan(0.5);
      // REMOTE 应该胜出
      expect(result.recommendedRole).toBe("remote");
    });

    it("所有前置条件不满足 → fallback 到 CORE", () => {
      const input = makeRoleInput({
        profile: makeProfile({
          rcl: 2, hasStorage: false, isStruggling: true,
          colonyState: "bootstrap",
        }),
      });
      const result = evaluateRoomRole(input);
      expect(result.recommendedRole).toBe("core");
      expect(result.recommendedScore).toBe(0);
    });

    it("hasRoleChange 检测正确", () => {
      const input = makeRoleInput({
        profile: makeProfile({ rcl: 8, storageRatio: 0.7, netFlow: 10, riskBuffer: 2000 }),
      });
      const result1 = evaluateRoomRole(input);
      expect(result1.hasRoleChange).toBe(false); // currentRole undefined

      const result2 = evaluateRoomRole(input, "production");
      expect(result2.hasRoleChange).toBe(true); // production → core
    });

    it("评分结果包含可解释证据", () => {
      const result = evaluateRoomRole(makeRoleInput());
      expect(result.summary).toContain("W7N4");
      expect(result.summary).toContain("core=");
      expect(result.summary).toContain("prod=");
      expect(result.summary).toContain("supp=");
      expect(result.summary).toContain("remote=");
    });

    it("维度评分包含 evidence", () => {
      const result = evaluateRoomRole(makeRoleInput());
      const coreScore = result.scores.core;
      expect(coreScore.dimensions.length).toBeGreaterThan(0);
      for (const dim of coreScore.dimensions) {
        expect(dim.dimension.length).toBeGreaterThan(0);
        expect(dim.evidence.length).toBeGreaterThan(0);
        expect(dim.score).toBeGreaterThanOrEqual(0);
        expect(dim.score).toBeLessThanOrEqual(1);
      }
    });
  });
});

// ─── role-stability.ts 测试 ───────────────────────────────

describe("role-stability.ts", () => {
  describe("createInitialRoleStability", () => {
    it("创建初始状态", () => {
      const state = createInitialRoleStability("core", 0.8, 1000);
      expect(state.currentRole).toBe("core");
      expect(state.currentScore).toBe(0.8);
      expect(state.assignedAtTick).toBe(1000);
      expect(state.epochsSinceAssignment).toBe(0);
    });
  });

  describe("decideRoleStability", () => {
    it("推荐角色 = 当前角色 → 保持不变", () => {
      const evalResult = evaluateRoomRole(makeRoleInput({
        profile: makeProfile({ rcl: 8, storageRatio: 0.7, netFlow: 10, riskBuffer: 2000 }),
      }));
      const state = createInitialRoleStability("core", 0.5, 1000);
      const decision = decideRoleStability(evalResult, state, DEFAULT_ROLE_STABILITY_CONFIG, 1100);

      expect(decision.roleChanged).toBe(false);
      expect(decision.decidedRole).toBe("core");
    });

    it("Hysteresis 不满足 → 保持当前角色", () => {
      // 当前 CORE 分数 0.6，推荐 PRODUCTION 分数 0.65 → 差 0.05 < 0.15 → 不切换
      const evalResult: any = {
        roomName: "W7N4",
        tick: 1100,
        recommendedRole: "production",
        recommendedScore: 0.65,
        scores: {
          core: { totalScore: 0.6, prerequisitesMet: true },
          production: { totalScore: 0.65, prerequisitesMet: true },
          support: { totalScore: 0.3, prerequisitesMet: true },
          remote: { totalScore: 0, prerequisitesMet: false },
        },
      };
      const state: RoleStabilityState = {
        currentRole: "core",
        assignedAtTick: 500,
        currentScore: 0.6,
        epochsSinceAssignment: 10,
        lastEvaluatedTick: 1000,
      };
      const decision = decideRoleStability(evalResult, state, DEFAULT_ROLE_STABILITY_CONFIG, 1100);
      expect(decision.roleChanged).toBe(false);
      expect(decision.decidedRole).toBe("core");
      expect(decision.reason).toContain("hysteresis");
    });

    it("Hysteresis + Min Duration 都满足 → 切换", () => {
      const evalResult: any = {
        roomName: "W7N4",
        tick: 1100,
        recommendedRole: "production",
        recommendedScore: 0.85,
        scores: {
          core: { totalScore: 0.6, prerequisitesMet: true },
          production: { totalScore: 0.85, prerequisitesMet: true },
          support: { totalScore: 0.3, prerequisitesMet: true },
          remote: { totalScore: 0, prerequisitesMet: false },
        },
      };
      const state: RoleStabilityState = {
        currentRole: "core",
        assignedAtTick: 500,
        currentScore: 0.6,
        epochsSinceAssignment: 10, // ≥ 5
        lastEvaluatedTick: 1000,
      };
      const decision = decideRoleStability(evalResult, state, DEFAULT_ROLE_STABILITY_CONFIG, 1100);
      expect(decision.roleChanged).toBe(true);
      expect(decision.decidedRole).toBe("production");
    });

    it("Min Duration 不满足 → 保持", () => {
      const evalResult: any = {
        roomName: "W7N4",
        tick: 1100,
        recommendedRole: "production",
        recommendedScore: 0.85,
        scores: {
          core: { totalScore: 0.6, prerequisitesMet: true },
          production: { totalScore: 0.85, prerequisitesMet: true },
          support: { totalScore: 0.3, prerequisitesMet: true },
          remote: { totalScore: 0, prerequisitesMet: false },
        },
      };
      const state: RoleStabilityState = {
        currentRole: "core",
        assignedAtTick: 500,
        currentScore: 0.6,
        epochsSinceAssignment: 2, // < 5
        lastEvaluatedTick: 1000,
      };
      const decision = decideRoleStability(evalResult, state, DEFAULT_ROLE_STABILITY_CONFIG, 1100);
      expect(decision.roleChanged).toBe(false);
      expect(decision.reason).toContain("min-duration");
    });

    it("当前角色分数低于重评阈值 → 绕过 hysteresis + minDuration", () => {
      const evalResult: any = {
        roomName: "W7N4",
        tick: 1100,
        recommendedRole: "production",
        recommendedScore: 0.8,
        scores: {
          core: { totalScore: 0.2, prerequisitesMet: true }, // < 0.25
          production: { totalScore: 0.8, prerequisitesMet: true },
          support: { totalScore: 0.3, prerequisitesMet: true },
          remote: { totalScore: 0, prerequisitesMet: false },
        },
      };
      const state: RoleStabilityState = {
        currentRole: "core",
        assignedAtTick: 1050,
        currentScore: 0.2,
        epochsSinceAssignment: 1, // < 5
        lastEvaluatedTick: 1000,
      };
      const decision = decideRoleStability(evalResult, state, DEFAULT_ROLE_STABILITY_CONFIG, 1100);
      expect(decision.roleChanged).toBe(true);
      expect(decision.decidedRole).toBe("production");
      expect(decision.reason).toContain("re-eval");
    });

    it("当前角色分数=0（前置条件丢失）→ 立即切换", () => {
      const evalResult: any = {
        roomName: "W7N4",
        tick: 1100,
        recommendedRole: "production",
        recommendedScore: 0.7,
        scores: {
          core: { totalScore: 0, prerequisitesMet: false },
          production: { totalScore: 0.7, prerequisitesMet: true },
          support: { totalScore: 0.3, prerequisitesMet: true },
          remote: { totalScore: 0, prerequisitesMet: false },
        },
      };
      const state: RoleStabilityState = {
        currentRole: "core",
        assignedAtTick: 1050,
        currentScore: 0.5,
        epochsSinceAssignment: 1,
        lastEvaluatedTick: 1000,
      };
      const decision = decideRoleStability(evalResult, state, DEFAULT_ROLE_STABILITY_CONFIG, 1100);
      expect(decision.roleChanged).toBe(true);
      expect(decision.decidedRole).toBe("production");
      expect(decision.reason).toContain("prerequisites-lost");
    });

    it("所有分数都低于 noRoleThreshold → 保持当前角色", () => {
      const evalResult: any = {
        roomName: "W7N4",
        tick: 1100,
        recommendedRole: "core",
        recommendedScore: 0.1,
        scores: {
          core: { totalScore: 0.1, prerequisitesMet: true },
          production: { totalScore: 0.05, prerequisitesMet: true },
          support: { totalScore: 0.08, prerequisitesMet: true },
          remote: { totalScore: 0, prerequisitesMet: false },
        },
      };
      const state: RoleStabilityState = {
        currentRole: "production",
        assignedAtTick: 500,
        currentScore: 0.5,
        epochsSinceAssignment: 10,
        lastEvaluatedTick: 1000,
      };
      const decision = decideRoleStability(evalResult, state, DEFAULT_ROLE_STABILITY_CONFIG, 1100);
      expect(decision.roleChanged).toBe(false);
      expect(decision.decidedRole).toBe("production");
      expect(decision.reason).toContain("no-role");
    });
  });

  describe("序列化", () => {
    it("serialize/deserialize 双向转换", () => {
      const state: RoleStabilityState = {
        currentRole: "production",
        assignedAtTick: 500,
        currentScore: 0.75,
        epochsSinceAssignment: 3,
        lastEvaluatedTick: 1000,
      };
      const serialized = serializeRoleStability(state);
      expect(serialized.r).toBe("P");
      expect(serialized.s).toBe(75);

      const restored = deserializeRoleStability(serialized, "core", 0);
      expect(restored.currentRole).toBe("production");
      expect(restored.currentScore).toBeCloseTo(0.75, 2);
      expect(restored.epochsSinceAssignment).toBe(3);
    });

    it("deserialize undefined → fallback", () => {
      const restored = deserializeRoleStability(undefined, "core", 1000);
      expect(restored.currentRole).toBe("core");
      expect(restored.assignedAtTick).toBe(1000);
    });
  });
});

// ─── role-transition.ts 测试 ──────────────────────────────

describe("role-transition.ts", () => {
  describe("validateRoleTransition", () => {
    it("无变更 → allowed=true", () => {
      const decision: any = {
        roleChanged: false,
        decidedRole: "core",
        decidedScore: 0.8,
        newState: { currentRole: "core" },
      };
      const result = validateRoleTransition(decision, "economic_shift", 0);
      expect(result.allowed).toBe(true);
      expect(result.fromRole).toBe("core");
      expect(result.toRole).toBe("core");
    });

    it("CORE → PRODUCTION 直接允许", () => {
      const decision: any = {
        roleChanged: true,
        decidedRole: "production",
        decidedScore: 0.85,
        newState: { currentRole: "core" },
      };
      const result = validateRoleTransition(decision, "economic_shift", 2);
      expect(result.allowed).toBe(true);
      expect(result.intermediateRole).toBeUndefined();
    });

    it("CORE → REMOTE 需要中间角色 PRODUCTION", () => {
      const decision: any = {
        roleChanged: true,
        decidedRole: "remote",
        decidedScore: 0.8,
        newState: { currentRole: "core" },
      };
      const result = validateRoleTransition(decision, "remote_opened", 1);
      expect(result.allowed).toBe(true);
      expect(result.intermediateRole).toBe("production");
    });

    it("REMOTE → CORE 需要中间角色 PRODUCTION", () => {
      const decision: any = {
        roleChanged: true,
        decidedRole: "core",
        decidedScore: 0.9,
        newState: { currentRole: "remote" },
      };
      const result = validateRoleTransition(decision, "rcl_upgrade", 0);
      expect(result.allowed).toBe(true);
      expect(result.intermediateRole).toBe("production");
    });

    it("PRODUCTION → SUPPORT 直接允许", () => {
      const decision: any = {
        roleChanged: true,
        decidedRole: "support",
        decidedScore: 0.7,
        newState: { currentRole: "production" },
      };
      const result = validateRoleTransition(decision, "terminal_built", 0);
      expect(result.allowed).toBe(true);
      expect(result.intermediateRole).toBeUndefined();
    });

    it("影响评估：CORE → PRODUCTION 不影响 producer 能力", () => {
      const decision: any = {
        roleChanged: true,
        decidedRole: "production",
        decidedScore: 0.85,
        newState: { currentRole: "core" },
      };
      const result = validateRoleTransition(decision, "economic_shift", 3);
      expect(result.impact.affectsProducer).toBe(false); // 两者都可 produce
      expect(result.impact.affectsConsumer).toBe(false); // 两者都不可 consume
      expect(result.impact.requiresContractRebuild).toBe(false);
    });

    it("影响评估：PRODUCTION → SUPPORT 影响 consumer 能力", () => {
      const decision: any = {
        roleChanged: true,
        decidedRole: "support",
        decidedScore: 0.7,
        newState: { currentRole: "production" },
      };
      const result = validateRoleTransition(decision, "terminal_built", 1);
      expect(result.impact.affectsConsumer).toBe(true); // SUPPORT 可 consume, PRODUCTION 不可
      expect(result.impact.requiresContractRebuild).toBe(true);
    });
  });

  describe("inferTransitionTrigger", () => {
    it("RCL 升级 → rcl_upgrade", () => {
      expect(inferTransitionTrigger(5, 6, true, true, false, false, 1, 1)).toBe("rcl_upgrade");
    });

    it("RCL 降级 → rcl_downgrade", () => {
      expect(inferTransitionTrigger(7, 6, true, true, false, false, 1, 1)).toBe("rcl_downgrade");
    });

    it("storage 建成 → storage_built", () => {
      expect(inferTransitionTrigger(4, 4, false, true, false, false, 0, 0)).toBe("storage_built");
    });

    it("远矿开点 → remote_opened", () => {
      expect(inferTransitionTrigger(6, 6, true, true, false, false, 1, 2)).toBe("remote_opened");
    });

    it("远矿关闭 → remote_closed", () => {
      expect(inferTransitionTrigger(6, 6, true, true, false, false, 2, 1)).toBe("remote_closed");
    });

    it("无显著变化 → economic_shift", () => {
      expect(inferTransitionTrigger(6, 6, true, true, false, false, 1, 1)).toBe("economic_shift");
    });
  });

  describe("角色层级", () => {
    it("getRoleTier 返回正确层级", () => {
      expect(getRoleTier("core")).toBe(3);
      expect(getRoleTier("production")).toBe(2);
      expect(getRoleTier("support")).toBe(2);
      expect(getRoleTier("remote")).toBe(1);
    });

    it("isRoleUpgrade", () => {
      expect(isRoleUpgrade("remote", "core")).toBe(true);
      expect(isRoleUpgrade("production", "core")).toBe(true);
      expect(isRoleUpgrade("core", "production")).toBe(false);
    });

    it("isRoleDowngrade", () => {
      expect(isRoleDowngrade("core", "remote")).toBe(true);
      expect(isRoleDowngrade("production", "remote")).toBe(true);
      expect(isRoleDowngrade("remote", "core")).toBe(false);
    });
  });
});

// ─── room-profile.ts / room-registry.ts 扩展测试 ─────────

describe("RoomEconomicProfile empireRole 扩展", () => {
  it("empireRole 字段默认为 undefined", () => {
    const profile = makeProfile();
    expect(profile.empireRole).toBeUndefined();
  });

  it("empireRole 可被设置", () => {
    const profile = makeProfile({ empireRole: "production" });
    expect(profile.empireRole).toBe("production");
  });
});

describe("RoomRegistryEntry empireRole 扩展", () => {
  it("makeRegistryEntry 传递 empireRole", () => {
    const profile = makeProfile({ empireRole: "support" });
    const entry = makeRegistryEntry(profile, 5000, 1000);
    expect(entry.empireRole).toBe("support");
  });

  it("makeRegistryEntry empireRole undefined when not set", () => {
    const profile = makeProfile(); // empireRole undefined
    const entry = makeRegistryEntry(profile, 5000, 1000);
    expect(entry.empireRole).toBeUndefined();
  });
});
