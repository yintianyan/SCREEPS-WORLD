/** R674 效用仲裁 — 角色级轮转：链尾任务在有界时间内得到服务。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../../src/config";
import { builderRole } from "../../../src/creeps/roles/builder";
import { workerRole } from "../../../src/creeps/roles/worker";
import {
  mockConstructionSite,
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

/** 以决策间隔推进时钟并运行角色，返回本次观察窗口内的调用情况。 */
function runFor(
  role: { run: (c: any, ctx: any) => void },
  creep: any,
  ctx: any,
  decisions: number,
) {
  for (let i = 0; i < decisions; i++) {
    role.run(creep, ctx);
    (globalThis as any).Game.time += CONFIG.arbitration.decisionInterval;
  }
}

describe("builder — 建造与常规修路都被服务", () => {
  it("工地长期存在时，<40% 的道路不会被饿死", () => {
    const site = mockConstructionSite("extension", { id: "site_1" });
    const road = mockStructure("road", { id: "r1", hits: 1000, hitsMax: 5000 }); // 20%
    const snap = mockSnapshot({
      myConstructionSites: [site],
      roads: [road],
      fillTargets: [],
    });
    const creep = mockCreep({
      name: "builder_1",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
    });
    const ctx = mockContext(snap);

    runFor(builderRole, creep, ctx, 30); // 150 tick

    expect(creep.build).toHaveBeenCalledWith(site);
    expect(creep.repair).toHaveBeenCalledWith(road);
    // 决策确实记录了轮转状态
    expect(creep.memory.utility).toBeDefined();
  });
});

describe("worker — 填充与升级都被服务", () => {
  it("spawn 长期未满时，升级不会被无限饿死", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn] });
    const creep = mockCreep({
      name: "worker_1",
      role: "worker",
      used: 50,
      capacity: 50,
      mode: "work",
    });
    const ctx = mockContext(snap);

    // agingCap 200 tick = 40 个决策；跑 60 个决策（300 tick）覆盖硬性公平插队。
    runFor(workerRole, creep, ctx, 60);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
    expect(creep.upgradeController).toHaveBeenCalled();
    expect(creep.memory.utility).toBeDefined();
  });
});
