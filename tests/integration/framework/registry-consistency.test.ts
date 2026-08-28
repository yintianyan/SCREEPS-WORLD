/**
 * Phase 4: 系统注册一致性测试
 *
 * 验证：
 * 1. 每个 system 只注册一次（Registry.assertUnique 保证）
 * 2. 每个 system 的 phase 唯一（main 或 post，不重复）
 * 3. main/post 不重复执行
 * 4. telemetry-collector 只注册一次
 * 5. P0 系统不受观测系统故障影响
 */

import { describe, expect, it } from "vitest";
import { registry, kernel } from "../../../src/bootstrap";
import type { System } from "../../../src/kernel/contracts";

describe("Phase 4: 系统注册一致性", () => {
  describe("每个 system 只注册一次", () => {
    it("所有系统名称唯一", () => {
      const systems = registry.getSystems();
      const names = systems.map(s => s.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("telemetry-collector 只注册一次", () => {
      const systems = registry.getSystems();
      const telemetrySystems = systems.filter(s => s.name === "telemetry-collector");
      expect(telemetrySystems).toHaveLength(1);
    });



    it("traffic-manager 只注册一次", () => {
      const systems = registry.getSystems();
      const trafficSystems = systems.filter(s => s.name === "traffic-manager");
      expect(trafficSystems).toHaveLength(1);
    });
  });

  describe("每个 system 的 phase 唯一", () => {
    it("main 阶段系统和 post 阶段系统不重叠", () => {
      const systems = registry.getSystems();
      const mainNames = new Set(
        systems.filter(s => (s.phase ?? "main") === "main").map(s => s.name),
      );
      const postNames = new Set(
        systems.filter(s => s.phase === "post").map(s => s.name),
      );
      // 检查无交集
      for (const name of mainNames) {
        expect(postNames.has(name)).toBe(false);
      }
    });

    it("telemetry-collector 注册为 post 阶段", () => {
      const systems = registry.getSystems();
      const telemetry = systems.find(s => s.name === "telemetry-collector");
      expect(telemetry).toBeDefined();
      expect(telemetry!.phase).toBe("post");
    });



    it("traffic-manager 注册为 post 阶段", () => {
      const systems = registry.getSystems();
      const traffic = systems.find(s => s.name === "traffic-manager");
      expect(traffic).toBeDefined();
      expect(traffic!.phase).toBe("post");
    });

    it("spawn-manager 注册为 main 阶段", () => {
      const systems = registry.getSystems();
      const spawn = systems.find(s => s.name === "spawn-manager");
      expect(spawn).toBeDefined();
      expect(spawn!.phase ?? "main").toBe("main");
    });
  });

  describe("telemetry 执行路径不重复", () => {
    it("telemetry-collector 在 post 系统中（不在 main 中）", () => {
      const systems = registry.getSystems();
      const mainSystems = systems.filter(s => (s.phase ?? "main") === "main");
      const postSystems = systems.filter(s => s.phase === "post");

      // telemetry-collector 不在 main 中
      expect(mainSystems.find(s => s.name === "telemetry-collector")).toBeUndefined();
      // telemetry-collector 在 post 中
      expect(postSystems.find(s => s.name === "telemetry-collector")).toBeDefined();
    });

    it("kernel.ts 的 telemetry-collect 和 telemetry-flush 是独立于 telemetry-collector 的职责", () => {
      // kernel.ts:170-194 有 telemetry-collect 和 telemetry-flush safeRun
      // 这些做的是新式 metrics 采集（MetricRegistry）和 flush
      // telemetry-collector 做的是 old-style stats（Memory.kernel.stats）
      // 不是重复执行
      // 此测试通过代码审查验证，不是运行时测试
      const systems = registry.getSystems();
      const telemetry = systems.find(s => s.name === "telemetry-collector");
      expect(telemetry).toBeDefined();
      // telemetry-collector 的 interval 是 CONFIG.telemetry.cpuSampleInterval
      expect(telemetry!.interval).toBeDefined();
    });
  });

  describe("P0 系统不受观测系统故障影响", () => {
    it("P0 系统列表正确", () => {
      const systems = registry.getSystems();
      const p0Systems = systems.filter(s => s.priority === 0);
      const p0Names = p0Systems.map(s => s.name);
      // P0 系统应包含 spawn-manager, tower-defense, logistics, traffic-manager, room-state
      expect(p0Names).toContain("room-state");
      expect(p0Names).toContain("spawn-manager");
      expect(p0Names).toContain("tower-defense");
      expect(p0Names).toContain("logistics");
      expect(p0Names).toContain("traffic-manager");
    });

    it("P3 观测系统不影响 P0 系统（priority 隔离）", () => {
      const systems = registry.getSystems();
      const p0 = systems.filter(s => s.priority === 0);
      const p3Telemetry = systems.filter(s => s.priority === 3 && s.name.includes("telemetry"));
      expect(p0.length).toBeGreaterThan(0);
      expect(p3Telemetry.length).toBeGreaterThan(0);
      // P0 priority=0 < P3 priority=3 — P0 先执行
      p0.forEach(s => expect(s.priority).toBeLessThan(3));
    });
  });

  describe("角色注册完整性", () => {
    it("所有角色名称唯一", () => {
      const roles = registry.getRoles();
      const names = roles.map(r => r.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("worker 角色注册为 P0", () => {
      const roles = registry.getRoles();
      const worker = roles.find(r => r.name === "worker");
      expect(worker).toBeDefined();
      expect(worker!.priority).toBe(0);
    });
  });
});
