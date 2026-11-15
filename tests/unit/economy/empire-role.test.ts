/**  */
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
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";
import { makeRegistryEntry } from "../../../src/domain/strategy/room-registry";

// ─── 辅助构造函数 ─────────────────────────────────────────

function makeProfile(over?: Partial<RoomEconomicProfile>): RoomEconomicProfile {
  return {
    roomName: "W7N4",
    rcl: 7,
    hasSpawn: true,
    hasStorage: true,
    hasTerminal: true,
    netFlow: 5,
    netFlowWindow: "room",
    contractReserve: 50000,
    riskBuffer: 1000,
    estimatedIncome: 14,
    efficiency: 0.7,
    drift: 0,
    economyTick: 1000,
    storageEnergy: 50000,
    storageCapacity: 1_000_000,
    storageRatio: 0.5,
    energyAvailable: 500,
    energyCapacityAvailable: 1000,
    storageNearFull: false,
    sourceCount: 2,
    colonyPhase: "growth",
    colonyState: "normal",
    economyPressure: 0.1,
    lastHostileAt: undefined,
    hasLiveThreat: false,
    controllerDowngradeRisk: false,
    claimSecure: false,
    economicClass: "core",
    netFlowPositive: true,
    selfSufficiency: 0.64,
    isStruggling: false,
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
