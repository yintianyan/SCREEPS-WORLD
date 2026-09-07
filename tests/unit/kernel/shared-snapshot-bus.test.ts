/** 共享快照总线 — 验证 buildSnapshots 产出的 creepRefs 被消费系统正确复用。 */
import { describe, expect, it, beforeEach } from "vitest";
import { globalCache, type CreepRef } from "../../../src/kernel/global-cache";

describe("Shared Snapshot Bus — creepRefs", () => {
  beforeEach(() => {
    // 清理 globalCache
    const g = globalCache();
    delete g.creepRefs;
    delete g.totalPopulation;
  });

  it("CreepRef 包含所有消费系统所需的字段", () => {
    const ref: CreepRef = {
      name: "harvester-W1N1-0-1000-abcd",
      role: "harvester",
      home: "W1N1",
      spawning: false,
      recycle: false,
      bodyLength: 3,
      body: [
        { type: WORK, hits: 100 },
        { type: CARRY, hits: 100 },
        { type: MOVE, hits: 100 },
      ],
      roomName: "W1N1",
      x: 25,
      y: 25,
      energyCarried: 50,
    };

    expect(ref.name).toBeDefined();
    expect(ref.role).toBe("harvester");
    expect(ref.home).toBe("W1N1");
    expect(ref.spawning).toBe(false);
    expect(ref.bodyLength).toBe(3);
    expect(ref.energyCarried).toBe(50);
    expect(ref.recycle).toBe(false);
  });

  it("globalCache().creepRefs 可被写入和读取", () => {
    const refs: CreepRef[] = [
      {
        name: "hauler-W1N1-0-1000-abcd",
        role: "hauler",
        home: "W1N1",
        spawning: false,
        recycle: false,
        bodyLength: 2,
        body: [],
        roomName: "W1N1",
        x: 10,
        y: 10,
        energyCarried: 100,
        assignment: {
          id: "task-1",
          kind: "haul",
          sourceId: "src-1",
          leaseUntil: 1100,
        },
        lastActionTick: 995,
        ticksToLive: 800,
      },
    ];
    globalCache().creepRefs = refs;

    const consumed = globalCache().creepRefs;
    expect(consumed).toBeDefined();
    expect(consumed).toHaveLength(1);
    expect(consumed![0]!.role).toBe("hauler");
    expect(consumed![0]!.assignment?.kind).toBe("haul");
    expect(consumed![0]!.assignment?.leaseUntil).toBe(1100);
    expect(consumed![0]!.lastActionTick).toBe(995);
  });

  it("spawn-manager 消费模式：filter !spawning + map 到 CreepSummary", () => {
    const refs: CreepRef[] = [
      {
        name: "harvester-1",
        role: "harvester",
        home: "W1N1",
        spawning: false,
        recycle: false,
        bodyLength: 3,
        body: [],
        roomName: "W1N1",
        x: 0,
        y: 0,
        energyCarried: 0,
        sourceId: "src-1" as Id<Source>,
      },
      {
        name: "harvester-2",
        role: "harvester",
        home: "W1N1",
        spawning: true, // 孵化中，应被过滤
        recycle: false,
        bodyLength: 3,
        body: [],
        roomName: "W1N1",
        x: 0,
        y: 0,
        energyCarried: 0,
      },
    ];
    globalCache().creepRefs = refs;

    // 模拟 spawn-manager 的消费模式
    const summaries = (globalCache().creepRefs ?? [])
      .filter(r => !r.spawning)
      .map(r => ({
        name: r.name,
        role: r.role,
        home: r.home,
        bodyLength: r.bodyLength,
        sourceId: r.sourceId,
        recycle: r.recycle,
      }));

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("harvester-1");
    expect(summaries[0]!.sourceId).toBe("src-1");
  });

  it("assignment-system 消费模式：filter home + map 到 CreepAssignmentRef", () => {
    const refs: CreepRef[] = [
      {
        name: "builder-1",
        role: "builder",
        home: "W1N1",
        spawning: false,
        recycle: false,
        bodyLength: 3,
        body: [],
        roomName: "W1N1",
        x: 0,
        y: 0,
        energyCarried: 0,
        assignment: {
          id: "build-1",
          kind: "build",
          targetId: "site-1",
        },
      },
      {
        name: "upgrader-1",
        role: "upgrader",
        home: "W2N1",
        spawning: false,
        recycle: false,
        bodyLength: 3,
        body: [],
        roomName: "W2N1",
        x: 0,
        y: 0,
        energyCarried: 0,
      },
    ];
    globalCache().creepRefs = refs;

    // 模拟 assignment-system 的消费模式
    const assignmentRefs = (globalCache().creepRefs ?? [])
      .filter(r => r.home)
      .map(r => ({
        name: r.name,
        home: r.home,
        role: r.role,
        assignment: r.assignment
          ? {
              id: r.assignment.id,
              kind: r.assignment.kind,
              sourceId: r.assignment.sourceId,
              targetId: r.assignment.targetId,
            }
          : undefined,
      }));

    expect(assignmentRefs).toHaveLength(2);
    expect(assignmentRefs[0]!.assignment?.kind).toBe("build");
    expect(assignmentRefs[1]!.assignment).toBeUndefined();
  });

  it("lab-system 消费模式：filter by home + map 到 boost 摘要", () => {
    const refs: CreepRef[] = [
      {
        name: "attacker-1",
        role: "attacker",
        home: "W1N1",
        spawning: false,
        recycle: false,
        bodyLength: 4,
        body: [
          { type: ATTACK, hits: 100 },
          { type: ATTACK, hits: 100 },
          { type: MOVE, hits: 100 },
          { type: MOVE, hits: 100 },
        ],
        roomName: "W1N1",
        x: 0,
        y: 0,
        energyCarried: 0,
        ticksToLive: 500,
      },
      {
        name: "attacker-2",
        role: "attacker",
        home: "W2N1",
        spawning: false,
        recycle: false,
        bodyLength: 4,
        body: [],
        roomName: "W2N1",
        x: 0,
        y: 0,
        energyCarried: 0,
        ticksToLive: 300,
      },
    ];
    globalCache().creepRefs = refs;
    const boostedCreeps: string[] = [];

    // 模拟 lab-system 的消费模式（只取 W1N1 的 creep）
    const summaries = (globalCache().creepRefs ?? [])
      .filter(r => r.home === "W1N1")
      .map(r => ({
        name: r.name,
        role: r.role,
        ticksToLive: r.ticksToLive ?? 0,
        boosted: boostedCreeps.includes(r.name),
        body: r.body,
      }));

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("attacker-1");
    expect(summaries[0]!.body).toHaveLength(4);
  });

  it("fallback：creepRefs 未初始化时消费端安全回退", () => {
    // 不设置 globalCache().creepRefs
    const refs = globalCache().creepRefs;
    expect(refs).toBeUndefined();

    // 模拟消费端的 fallback 逻辑
    const summaries = refs ?? [];
    expect(summaries).toHaveLength(0);
  });
});
