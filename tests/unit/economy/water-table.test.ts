/** 水位权限表矩阵测试（Batch 2 — 病理②「水位刻度碎片化」修复回归）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgraderRole } from "../../../src/creeps/roles/upgrader";
import { builderRole } from "../../../src/creeps/roles/builder";
import { distributorRole } from "../../../src/creeps/roles/distributor";
import { evaluateDemand } from "../../../src/domain/spawn/demand";
import { getSource } from "../../../src/creeps/support/targeting";
import { roomStateSystem } from "../../../src/systems/room-state";
import {
  mockContext,
  mockController,
  mockCreep,
  mockSnapshot,
  mockSource,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

// ─── U-1/U-2：upgrader storage 取能限额（绝对刻度） ─────────────

describe("水位表 — upgrader storage 限额（U-1/U-2）", () => {
  /** capacity 600 让各档限额（600/500/200）可区分。 */
  function runUpgrader(storageEnergy: number, opts: { containers?: any[] } = {}) {
    const storage = mockStructure("storage", { id: "st1", energy: storageEnergy, capacity: 1000000 });
    const snap = mockSnapshot({
      rcl: 4,
      storage,
      controller: mockController(),
      containers: opts.containers ?? [],
      energyAvailable: 800,
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 600, mode: "acquire" });
    upgraderRole.run(creep, mockContext(snap));
    return { creep, storage };
  }

  it("≥ sprintStorage(50k)：carry 满载取能", () => {
    const { creep, storage } = runUpgrader(60000);
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 600);
  });

  it("≥ sustainedStorage(10k)：限 500/趟", () => {
    const { creep, storage } = runUpgrader(20000);
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 500);
  });

  it("≥ floor(1k)：限 200/趟", () => {
    const { creep, storage } = runUpgrader(5000);
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
  });

  it("U-1：< floor(1k) 时 resolve 拒绝 — gate 因 container 有能量放行也抽不穿 storage", () => {
    // 非 source container 有能量 → gate 放行（替代能量源存在）。
    // 修复前：withdrawStorageCapped 无 floor 检查，storage 800 照样被抽。
    const container = mockStructure("container", { id: "c1", energy: 500, capacity: 2000 });
    container.pos.getRangeTo = vi.fn(() => 5); // 远离 source — 非 source container
    const { creep } = runUpgrader(800, { containers: [container] });
    // storage 不被碰，取的是 container（fallthrough）。
    expect(creep.withdraw).toHaveBeenCalled();
    expect(creep.withdraw.mock.calls[0][0].id).toBe("c1");
  });
});

// ─── B-1：builder storage 取能限额（绝对刻度） ─────────────────

describe("水位表 — builder storage 限额（B-1）", () => {
  function runBuilder(storageEnergy: number) {
    const storage = mockStructure("storage", { id: "st1", energy: storageEnergy, capacity: 1000000 });
    const source = mockSource("s1");
    const snap = mockSnapshot({
      rcl: 4,
      storage,
      sources: [source],
      sourceOccupancy: new Map([["s1", 0]]),
    });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 0, capacity: 600, mode: "acquire" });
    builderRole.run(creep, mockContext(snap));
    return { creep, storage };
  }

  it("≥ full(50k)：carry 满载", () => {
    const { creep, storage } = runBuilder(60000);
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 600);
  });

  it("≥ sustained(10k)：限 200/趟（修复前比例制此档要 10 万库存）", () => {
    const { creep, storage } = runBuilder(20000);
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
  });

  it("≥ low(2k)：限 50/趟", () => {
    const { creep, storage } = runBuilder(5000);
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 50);
  });

  it("< low(2k)：拒取 storage，fallthrough 到直采", () => {
    const { creep } = runBuilder(1500);
    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalled();
  });
});

// ─── D-1：terminal 备货 deposit 相水位门禁 ────────────────────

describe("水位表 — terminal 备货双相门禁（D-1）", () => {
  function runDistributor(storageEnergy: number) {
    // D-1 水位门禁测试模拟「有市场」服务器 — stockTerminalEnergy 的 no-market
    // 守卫（W7 止血）不应干扰本用例；无市场行为由 terminal-energy-rescue 专项测试覆盖。
    (globalThis as any).Game.market = { getAllOrders: () => [], credits: 0 };
    const storage = mockStructure("storage", { id: "st1", energy: storageEnergy, capacity: 1000000 });
    const terminal = mockStructure("terminal", { id: "tm1", energy: 0, capacity: 300000 });
    const snap = mockSnapshot({ rcl: 6, storage, terminal, fillTargets: [] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 300, capacity: 300, mode: "work" });
    distributorRole.run(creep, mockContext(snap));
    return { creep, terminal };
  }

  it("storage < storageEnergyFloor(20k)：携能 distributor 不喂 terminal", () => {
    const { creep, terminal } = runDistributor(5000);
    expect(creep.transfer).not.toHaveBeenCalledWith(terminal, "energy");
  });

  it("storage ≥ storageEnergyFloor(20k)：deposit 相照常", () => {
    const { creep, terminal } = runDistributor(30000);
    expect(creep.transfer).toHaveBeenCalledWith(terminal, "energy");
  });
});

// ─── D-3/B-5：demand 编制信号对齐水位表 ───────────────────────

describe("水位表 — demand 编制信号（D-3/B-5）", () => {
  const livingHarvester = () => [{
    name: "harvester_1", role: "harvester", home: "W7N4",
    ticksToLive: 1200, bodyLength: 7, sourceId: "source_1" as Id<Source>, spawnIndex: 0,
  }];
  const ctx = { colonyState: "normal" as const, controllerDowngradeRisk: false, energyAvailable: 2000, economyPressure: 0 };

  it("D-3：storage < full(50k) 时 tower 不计入 distributor 需求信号", () => {
    // tier ≥ 1 时 distributor 拒服 tower — 信号也不得计入。
    const storage = mockStructure("storage", { id: "st", energy: 20000, capacity: 1000000 });
    const tower = mockStructure("tower", { id: "tw", energy: 0, capacity: 1000 });
    const spawn = mockStructure("spawn", { id: "sp", energy: 0, capacity: 300 });
    const manyTowers = [tower, { ...tower, id: "tw2" }, { ...tower, id: "tw3" }, { ...tower, id: "tw4" }];
    const snapWithTowers = mockSnapshot({
      rcl: 5, storage, energyCapacityAvailable: 1300,
      fillTargets: [spawn, ...manyTowers] as any,
    });
    const snapSpawnOnly = mockSnapshot({
      rcl: 5, storage, energyCapacityAvailable: 1300,
      fillTargets: [spawn] as any,
    });
    (globalThis as any).Memory.rooms.W7N4 = {};

    const withTowers = evaluateDemand(snapWithTowers, [], "normal", livingHarvester(), [], ctx, 1000)
      .requests.filter(r => r.role === "distributor").length;
    (globalThis as any).Memory.rooms.W7N4 = {}; // 重置 distScaleUpSince
    const spawnOnly = evaluateDemand(snapSpawnOnly, [], "normal", livingHarvester(), [], ctx, 1000)
      .requests.filter(r => r.role === "distributor").length;

    // tower 被过滤 → 两个场景需求信号一致。
    expect(withTowers).toBe(spawnOnly);
  });

  it("B-5：storage < low(2k) 时 builder 编制封顶 minCount（site 再多也不扩）", () => {
    const storage = mockStructure("storage", { id: "st", energy: 1500, capacity: 1000000 });
    const sites = Array.from({ length: 5 }, (_, i) => ({ id: `site${i}`, structureType: "extension", pos: { x: 10 + i, y: 10 }, my: true }));
    const snap = mockSnapshot({
      rcl: 4, storage, energyCapacityAvailable: 1300,
      myConstructionSites: sites as any,
    });
    // 充足采集编制（economyCap 不设限）。
    const creeps = [
      ...livingHarvester(),
      { name: "harvester_2", role: "harvester", home: "W7N4", ticksToLive: 1200, bodyLength: 7, sourceId: "source_1" as Id<Source>, spawnIndex: 1 },
      { name: "worker_1", role: "worker", home: "W7N4", ticksToLive: 1200, bodyLength: 3, spawnIndex: 0 },
    ];
    const { requests } = evaluateDemand(snap, [], "normal", creeps, [], ctx, 1000);

    // minCount（builder 默认地板）以内 — 5 site 也不孵一队。
    const builders = requests.filter(r => r.role === "builder").length;
    expect(builders).toBeLessThanOrEqual(1);
  });

  it("B-5 回归：storage 健康时 site 驱动编制不受影响", () => {
    const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
    const sites = Array.from({ length: 3 }, (_, i) => ({ id: `site${i}`, structureType: "extension", pos: { x: 10 + i, y: 10 }, my: true }));
    const snap = mockSnapshot({
      rcl: 4, storage, energyCapacityAvailable: 1300,
      myConstructionSites: sites as any,
    });
    const creeps = [
      ...livingHarvester(),
      { name: "harvester_2", role: "harvester", home: "W7N4", ticksToLive: 1200, bodyLength: 7, sourceId: "source_1" as Id<Source>, spawnIndex: 1 },
      { name: "worker_1", role: "worker", home: "W7N4", ticksToLive: 1200, bodyLength: 3, spawnIndex: 0 },
    ];
    const { requests } = evaluateDemand(snap, [], "normal", creeps, [], ctx, 1000);

    expect(requests.filter(r => r.role === "builder").length).toBeGreaterThanOrEqual(3);
  });
});

// ─── B-4：直采平局去偏置 ──────────────────────────────────────

describe("水位表 — getSource 平局去偏置（B-4）", () => {
  function twoSourceSnapshot() {
    const s1 = mockSource("s1");
    const s2 = mockSource("s2");
    return mockSnapshot({
      sources: [s1, s2],
      sourceOccupancy: new Map([["s1", 0], ["s2", 0]]),
    });
  }

  it("占用平局时不同 creep 散布到不同 source（不再全员涌向 sources[0]）", () => {
    const snap = twoSourceSnapshot();
    const chosen = new Set<string>();
    for (const name of ["builder_a", "builder_b", "builder_c", "builder_d", "builder_e", "builder_f"]) {
      const creep = mockCreep({ name, role: "builder" });
      creep.memory.sourceId = undefined;
      const src = getSource(creep, snap);
      chosen.add(src!.id);
    }
    // 6 个不同名字至少命中两个不同 source（修复前恒为 {s1}）。
    expect(chosen.size).toBeGreaterThan(1);
  });

  it("同一 creep 的选择跨 tick 稳定（哈希起点确定性）", () => {
    // 跨 tick = 不同 snapshot（每 tick room-snapshot 重建 occupancy）。
    // 同 snapshot 多次调用会因同 tick occupancy 更新而变化，这是预期行为。
    const snap1 = twoSourceSnapshot();
    const snap2 = twoSourceSnapshot();
    const c1 = mockCreep({ name: "builder_x", role: "builder" });
    c1.memory.sourceId = undefined;
    const first = getSource(c1, snap1)!.id;
    const c2 = mockCreep({ name: "builder_x", role: "builder" });
    c2.memory.sourceId = undefined;
    expect(getSource(c2, snap2)!.id).toBe(first);
  });

  it("占用有差异时仍选最空者（哈希起点不破坏负载均衡）", () => {
    const s1 = mockSource("s1");
    const s2 = mockSource("s2");
    const snap = mockSnapshot({
      sources: [s1, s2],
      sourceOccupancy: new Map([["s1", 2], ["s2", 0]]),
    });
    // 第一个 creep 必选最空的 s2。
    const first = mockCreep({ name: "a", role: "builder" });
    first.memory.sourceId = undefined;
    expect(getSource(first, snap)!.id).toBe("s2");
    // 后续 creep 因同 tick occupancy 更新（s2 已被预占），会考虑 s1。
    // 4 个 creep 应分散到两个 source，不再全选同一 source。
    const chosen = new Set<string>(["s2"]);
    for (const name of ["b", "c", "d"]) {
      const creep = mockCreep({ name, role: "builder" });
      creep.memory.sourceId = undefined;
      chosen.add(getSource(creep, snap)!.id);
    }
    expect(chosen.size).toBeGreaterThan(1);
  });

  // ─── 振荡回归：拥挤迁移同 tick occupancy 更新 ──────────────────
  // 病因： getSource 拥挤迁移清除 sourceId → 重分配时全员看到相同 occupancy
  // → 全选同一更空 source → 下一 tick 又拥挤 → sourceId 翻转 → creep 1 格摇摆。
  // 修复：拥挤迁移直接迁移 + 同 tick 更新 snapshot.sourceOccupancy 防重复选择。

  it("拥挤迁移不振荡：2 creep 都在 s2 → 一个迁 s1 一个留 s2", () => {
    const s1 = mockSource("s1");
    const s2 = mockSource("s2");
    const snap = mockSnapshot({
      sources: [s1, s2],
      sourceOccupancy: new Map([["s1", 0], ["s2", 2]]),
    });
    // 两个 creep 都分配到 s2（sourceId 已设）
    const c1 = mockCreep({ name: "harvester_a", role: "harvester" });
    c1.memory.sourceId = "s2" as any;
    const c2 = mockCreep({ name: "harvester_b", role: "harvester" });
    c2.memory.sourceId = "s2" as any;
    const r1 = getSource(c1, snap);
    const r2 = getSource(c2, snap);
    // 一个迁到 s1，一个留 s2 — 不再都选同一 source
    expect(new Set([r1!.id, r2!.id])).toEqual(new Set(["s1", "s2"]));
  });

  it("同 tick occupancy 更新：第一个 creep 选完后第二个看到更新", () => {
    const s1 = mockSource("s1");
    const s2 = mockSource("s2");
    const snap = mockSnapshot({
      sources: [s1, s2],
      sourceOccupancy: new Map([["s1", 0], ["s2", 0]]),
    });
    // 无 sourceId 的两个 creep，平局时 nameHash 散布应选不同 source
    const c1 = mockCreep({ name: "harvester_a", role: "harvester" });
    c1.memory.sourceId = undefined;
    const c2 = mockCreep({ name: "harvester_b", role: "harvester" });
    c2.memory.sourceId = undefined;
    const r1 = getSource(c1, snap);
    const r2 = getSource(c2, snap);
    // 同 tick occupancy 更新后，第二个 creep 应看到 r1 已占的 source occupancy+1
    // 两个 creep 应分散到不同 source（不再是平局全选同一 source）
    expect(r1!.id).not.toBe(r2!.id);
  });

  it("跨 tick 稳定：拥挤迁移后下一 tick 不翻转", () => {
    // 模拟两 tick：tick1 拥挤迁移分散，tick2 新 snapshot 验证不再拥挤
    const s1 = mockSource("s1");
    const s2 = mockSource("s2");
    // tick1: 两 creep 都在 s2
    const snap1 = mockSnapshot({
      sources: [s1, s2],
      sourceOccupancy: new Map([["s1", 0], ["s2", 2]]),
    });
    const c1 = mockCreep({ name: "harvester_a", role: "harvester" });
    c1.memory.sourceId = "s2" as any;
    const c2 = mockCreep({ name: "harvester_b", role: "harvester" });
    c2.memory.sourceId = "s2" as any;
    getSource(c1, snap1); // c1 可能迁移到 s1
    getSource(c2, snap1); // c2 可能留在 s2
    // tick2: 基于 c1/c2 的 sourceId 重建 occupancy
    const occ2 = new Map<string, number>([["s1", 0], ["s2", 0]]);
    if (c1.memory.sourceId) occ2.set(c1.memory.sourceId as string, (occ2.get(c1.memory.sourceId as string) ?? 0) + 1);
    if (c2.memory.sourceId) occ2.set(c2.memory.sourceId as string, (occ2.get(c2.memory.sourceId as string) ?? 0) + 1);
    const snap2 = mockSnapshot({ sources: [s1, s2], sourceOccupancy: occ2 });
    // tick2: 两 creep 不再触发拥挤迁移（各 1 个 = fairShare）
    const before1 = c1.memory.sourceId;
    const before2 = c2.memory.sourceId;
    getSource(c1, snap2);
    getSource(c2, snap2);
    expect(c1.memory.sourceId).toBe(before1); // 不翻转
    expect(c2.memory.sourceId).toBe(before2); // 不翻转
  });
});

// ─── RS-1：economyPressure clamp ─────────────────────────────

describe("水位表 — economyPressure clamp（RS-1）", () => {
  it("深度危机（score=150）时 pressure 封顶 1.0（修复前 ~1.42）", () => {
    const snap = mockSnapshot({
      energyAvailable: 90, // spendableRatio 0.1125 < drainSpendableFloor
      energyCapacityAvailable: 800,
    });
    (globalThis as any).Memory.rooms.W7N4 = {
      phase: {
        phase: "crisis", reserve: 10000, reserveDelta: -100,
        drainScore: 150, liquidityScore: 0, bandTicks: 5,
        harvesterCount: 1, sourceCount: 1, rcl: 3,
      },
    };

    roomStateSystem.run(mockContext(snap));

    const pressure = (globalThis as any).Memory.rooms.W7N4.economyPressure;
    expect(pressure).toBeLessThanOrEqual(1.0);
    expect(pressure).toBeGreaterThan(0.9);
  });
});
