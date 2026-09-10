/** 角色自报分类接口 — 验证角色通过标签自报属性，kernel 不硬编码角色名。 */
import { describe, expect, it } from "vitest";
import { harvesterRole } from "../../../src/creeps/roles/harvester";
import { workerRole } from "../../../src/creeps/roles/worker";
import { haulerRole } from "../../../src/creeps/roles/hauler";
import { distributorRole } from "../../../src/creeps/roles/distributor";
import { builderRole } from "../../../src/creeps/roles/builder";
import { upgraderRole } from "../../../src/creeps/roles/upgrader";
import type { CreepRole } from "../../../src/kernel/contracts";

describe("角色自报分类接口 — CreepRole 标签", () => {
  describe("isLifeLine（ESM 生命线）", () => {
    it("harvester 自报 isLifeLine", () => {
      expect(harvesterRole.isLifeLine).toBe(true);
    });
    it("hauler 自报 isLifeLine", () => {
      expect(haulerRole.isLifeLine).toBe(true);
    });
    it("distributor 自报 isLifeLine", () => {
      expect(distributorRole.isLifeLine).toBe(true);
    });
    it("worker 不自报 isLifeLine", () => {
      expect(workerRole.isLifeLine).toBeFalsy();
    });
  });

  describe("isRepairWorker（维修角色）", () => {
    it("worker 自报 isRepairWorker", () => {
      expect(workerRole.isRepairWorker).toBe(true);
    });
    it("builder 自报 isRepairWorker", () => {
      expect(builderRole.isRepairWorker).toBe(true);
    });
    it("harvester 不自报 isRepairWorker", () => {
      expect(harvesterRole.isRepairWorker).toBeFalsy();
    });
  });

  describe("isSourceWorker（采矿角色）", () => {
    it("harvester 自报 isSourceWorker", () => {
      expect(harvesterRole.isSourceWorker).toBe(true);
    });
    it("worker 自报 isSourceWorker", () => {
      expect(workerRole.isSourceWorker).toBe(true);
    });
    it("upgrader 不自报 isSourceWorker", () => {
      expect(upgraderRole.isSourceWorker).toBeFalsy();
    });
  });

  describe("isHauler（运力角色）", () => {
    it("hauler 自报 isHauler", () => {
      expect(haulerRole.isHauler).toBe(true);
    });
    it("distributor 不自报 isHauler", () => {
      expect(distributorRole.isHauler).toBeFalsy();
    });
  });

  describe("isDistributor（分配泵角色）", () => {
    it("distributor 自报 isDistributor", () => {
      expect(distributorRole.isDistributor).toBe(true);
    });
    it("hauler 不自报 isDistributor", () => {
      expect(haulerRole.isDistributor).toBeFalsy();
    });
  });

  describe("executionOrder（执行顺序）", () => {
    it("worker 最先执行 (0)", () => {
      expect(workerRole.executionOrder).toBe(0);
    });
    it("harvester 第二执行 (1)", () => {
      expect(harvesterRole.executionOrder).toBe(1);
    });
    it("hauler 第三执行 (2)", () => {
      expect(haulerRole.executionOrder).toBe(2);
    });
    it("upgrader 第四执行 (3)", () => {
      expect(upgraderRole.executionOrder).toBe(3);
    });
    it("builder 第五执行 (4)", () => {
      expect(builderRole.executionOrder).toBe(4);
    });
    it("执行顺序符合 ROLE_EXECUTION_ORDER 原始值", () => {
      const roles: CreepRole[] = [workerRole, harvesterRole, haulerRole, upgraderRole, builderRole];
      const sorted = [...roles].sort((a, b) => (a.executionOrder ?? 99) - (b.executionOrder ?? 99));
      expect(sorted.map(r => r.name)).toEqual([
        "worker",
        "harvester",
        "hauler",
        "upgrader",
        "builder",
      ]);
    });
  });

  describe("kernel 不硬编码角色名", () => {
    // 验证 buildSnapshots 中的角色分类逻辑不依赖角色名字符串比较。
    // 这里的测试确保角色定义可以通过标签查询，而非名字匹配。
    it("可通过 isRepairWorker 标签找到所有维修角色", () => {
      const allRoles: CreepRole[] = [
        harvesterRole,
        workerRole,
        haulerRole,
        distributorRole,
        builderRole,
        upgraderRole,
      ];
      const repairWorkers = allRoles.filter(r => r.isRepairWorker);
      expect(repairWorkers.map(r => r.name).sort()).toEqual(["builder", "worker"]);
    });

    it("可通过 isSourceWorker 标签找到所有采矿角色", () => {
      const allRoles: CreepRole[] = [
        harvesterRole,
        workerRole,
        haulerRole,
        distributorRole,
        builderRole,
        upgraderRole,
      ];
      const sourceWorkers = allRoles.filter(r => r.isSourceWorker);
      expect(sourceWorkers.map(r => r.name).sort()).toEqual(["harvester", "worker"]);
    });

    it("可通过 isHauler + isDistributor 标签找到所有物流角色", () => {
      const allRoles: CreepRole[] = [
        harvesterRole,
        workerRole,
        haulerRole,
        distributorRole,
        builderRole,
        upgraderRole,
      ];
      const logistics = allRoles.filter(r => r.isHauler || r.isDistributor);
      expect(logistics.map(r => r.name).sort()).toEqual(["distributor", "hauler"]);
    });
  });
});
