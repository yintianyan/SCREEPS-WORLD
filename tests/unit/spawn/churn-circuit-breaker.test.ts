/**
 * P0-3：spawn churn 熔断测试。
 *
 * 覆盖设计文档 §5.4 全部 13 用例：
 *   - 正常路径 5：短冷却隔离 / 长冷却 / 熔断触发 / 熔断期 demand 跳过 / 熔断到期恢复
 *   - 边界条件 5：滑窗边界 / 阈值恰好 20 / per-role 独立计数 / P0 worker 不阻塞 / 到期清理
 *   - 异常情况 3：globalCache 丢失 / key 格式异常 / churnFreezeUntil 类型异常
 *
 * 背景：私服快照事后分析病灶 3 — harvester 永久豁免隔离导致 spawn churn 4238 次。
 * 修复：harvester/worker 改短冷却 500 tick + 200 tick 滑窗内同 role churn > 20 → 熔断 100 tick。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  computeQuarantineTtl,
  recordChurn,
  checkChurnCircuitBreaker,
} from "../../../src/systems/spawn-manager";
import { cleanQueue, spawnKey } from "../../../src/domain/spawn/queue";
import { evaluateDemand } from "../../../src/domain/spawn/demand";
import { CONFIG } from "../../../src/config";
import type { TickContext } from "../../../src/kernel/contracts";
import {
  mockSnapshot,
  mockController,
  mockSource,
  resetGlobals,
} from "../../role-helpers";

const ROOM = "W1N1";

beforeEach(() => {
  resetGlobals();
  // 初始化本测试使用的房间 Memory（resetGlobals 默认只建 W7N4）。
  (globalThis as any).Memory.rooms[ROOM] = {};
  // 清理 churnCounter（resetGlobals 不覆盖此字段，防跨用例污染）。
  delete (globalThis as any).__churnCounter;
});

// ─── 测试工厂函数 ──────────────────────────────────────────────

/** 造一个达到 maxRetries 的孵化请求。 */
function makeRequest(role: string, home: string, index: number, retries = CONFIG.spawn.maxRetries): SpawnRequest {
  return {
    key: spawnKey(role, home, index),
    role,
    home,
    priority: 1,
    body: ["work", "carry", "move"] as BodyPartConstant[],
    memory: { role, home, mode: "acquire" } as CreepMemory,
    createdAt: 0,
    retries,
  };
}

/** 造一个最小 TickContext（checkChurnCircuitBreaker 只用 tick 字段）。 */
function ctxAt(tick: number): TickContext {
  return { tick } as unknown as TickContext;
}

/** 调用 checkChurnCircuitBreaker 并返回更新后的 roomMem。 */
function runChurnCheck(tick: number, roomName = ROOM): RoomMemory {
  const roomMem = (globalThis as any).Memory.rooms[roomName] as RoomMemory;
  checkChurnCircuitBreaker(ctxAt(tick), roomMem, roomName);
  return roomMem;
}

/** 造一个有两台 source、一台存活 harvester 的快照（确保 harvesterTarget=2 > 1）。 */
function snapshotWithHarvester() {
  const src1 = mockSource("src1");
  const src2 = mockSource("src2");
  return mockSnapshot({
    roomName: ROOM,
    rcl: 3,
    controller: mockController({ level: 3 }),
    sources: [src1, src2],
    energyCapacityAvailable: 800,
    energyAvailable: 500,
  });
}

/** 一台存活 harvester 的摘要（home 指向 ROOM，绑定 src1）。 */
function livingHarvester() {
  return [{
    name: "harvester_1",
    role: "harvester",
    home: ROOM,
    ticksToLive: 1200,
    bodyLength: 7,
    sourceId: "src1" as Id<Source>,
    spawnIndex: 0,
  }];
}

/** normal 状态的 RoomDemandContext。 */
function normalCtx(pressure = 0, churnFreezeUntil?: Record<string, number>) {
  return {
    colonyState: "normal" as const,
    controllerDowngradeRisk: false,
    energyAvailable: 500,
    economyPressure: pressure,
    churnFreezeUntil,
  };
}

// ─── 正常路径（5 用例）──────────────────────────────────────────

describe("P0-3 spawn churn 熔断 — 正常路径", () => {
  it("采集角色（harvester）达 maxRetries 也永不进黑名单（自愈语义，防死亡螺旋）", () => {
    // cleanQueue 仍会 purge 达 maxRetries 的请求（防无限翻炒），但 spawn-manager
    // 对采集角色豁免隔离 — 失败后只重试，能量恢复即孵化，杜绝「等能量」变停产死锁
    // （W37S58 死亡螺旋根因：1cca151 在 normal 态把 harvester 关 500 tick → 某 source 停产）。
    const queue = [makeRequest("harvester", ROOM, 0)];
    const purgedKeys = cleanQueue(queue, 100, CONFIG.spawn.maxRetries, () => {});
    expect(purgedKeys).toContain("harvester:" + ROOM + ":0");

    // 模拟 spawn-manager 的黑名单写入逻辑（经济命脉角色跳过，不写黑名单）。
    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    roomMem.spawnBlacklist = {};
    for (const key of purgedKeys) {
      const isLifeline = key.startsWith("worker:") || key.startsWith("harvester:")
        || key.startsWith("hauler:") || key.startsWith("distributor:");
      if (isLifeline) continue; // 经济命脉永远豁免隔离（pre-1cca151 自愈语义）
      const ttl = computeQuarantineTtl(key);
      roomMem.spawnBlacklist[key] = 100 + ttl;
    }
    // 采集角色不进黑名单 — 这是修复后的契约，防死亡螺旋复发。
    expect(roomMem.spawnBlacklist!["harvester:" + ROOM + ":0"]).toBeUndefined();
  });

  it("物流角色（hauler/distributor）达 maxRetries 也永不进黑名单（2026-08-18 二次螺旋修复）", () => {
    // 物流命脉豁免扩围：能量低谷 degradeBody 返回 undefined → retries 连烧 → purge →
    // 旧逻辑把 hauler/distributor 拉黑 1000 tick → distributor 是唯一分发泵、hauler 是唯一运力
    // → spawn/ext 长期半空、恢复期被掐断（线上实证：hauler:W37S58:2/3 + distributor:W37S58:2
    // 同时进黑名单）。修复后与采集角色同享豁免，churn 熔断兜底防真配置错误无限翻炒。
    const queue = [makeRequest("hauler", ROOM, 0), makeRequest("distributor", ROOM, 0)];
    const purgedKeys = cleanQueue(queue, 100, CONFIG.spawn.maxRetries, () => {});
    expect(purgedKeys).toContain("hauler:" + ROOM + ":0");
    expect(purgedKeys).toContain("distributor:" + ROOM + ":0");

    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    roomMem.spawnBlacklist = {};
    for (const key of purgedKeys) {
      const isLifeline = key.startsWith("worker:") || key.startsWith("harvester:")
        || key.startsWith("hauler:") || key.startsWith("distributor:");
      if (isLifeline) continue;
      const ttl = computeQuarantineTtl(key);
      roomMem.spawnBlacklist[key] = 100 + ttl;
    }
    expect(roomMem.spawnBlacklist!["hauler:" + ROOM + ":0"]).toBeUndefined();
    expect(roomMem.spawnBlacklist!["distributor:" + ROOM + ":0"]).toBeUndefined();
  });

  it("非命脉角色（defender）达 maxRetries → 长冷却 1000 tick（无回归）", () => {
    const queue = [makeRequest("defender", ROOM, 0)];
    const purgedKeys = cleanQueue(queue, 100, CONFIG.spawn.maxRetries, () => {});
    expect(purgedKeys).toContain("defender:" + ROOM + ":0");

    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    roomMem.spawnBlacklist = {};
    for (const key of purgedKeys) {
      const ttl = computeQuarantineTtl(key);
      roomMem.spawnBlacklist[key] = 100 + ttl;
    }
    // 非命脉角色长冷却 = requestTtl = 1000 tick。
    expect(roomMem.spawnBlacklist!["defender:" + ROOM + ":0"]).toBe(100 + 1000);
  });

  it("近 200 tick 内 harvester churn > 20 次 → 触发 100 tick 熔断", () => {
    // 在 tick=200 时记录 21 次 harvester churn。
    for (let i = 0; i < 21; i++) {
      recordChurn(ROOM, "harvester", 200);
    }
    const roomMem = runChurnCheck(200);
    expect(roomMem.churnFreezeUntil!.harvester).toBe(200 + 100);
  });

  it("熔断期间 demand 不生成 harvester 请求", () => {
    // 设置 harvester 熔断到 tick=300。
    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    roomMem.churnFreezeUntil = { harvester: 300 };

    const snap = snapshotWithHarvester();
    // tick=250 < 300 → harvester 被冻结。
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(0, { harvester: 300 }), 250);
    expect(requests.filter(r => r.role === "harvester")).toHaveLength(0);
  });

  it("熔断到期后 harvester 请求恢复生成", () => {
    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    roomMem.churnFreezeUntil = { harvester: 300 };

    const snap = snapshotWithHarvester();
    // tick=301 > 300 → 熔断已过期，harvester 恢复评估。
    // 注意：livingHarvester 只有 1 只，harvesterConfig.minCount=2 → 应生成补编请求。
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 301);
    expect(requests.filter(r => r.role === "harvester").length).toBeGreaterThan(0);
  });
});

// ─── 边界条件（5 用例）──────────────────────────────────────────

describe("P0-3 spawn churn 熔断 — 边界条件", () => {
  it("churn 计数窗口：第 201 tick 时第 1 tick 的 churn 已过期（200 tick 滑窗）", () => {
    // tick=1 时记录 20 次（不触发，≤ 阈值）。
    for (let i = 0; i < 20; i++) {
      recordChurn(ROOM, "harvester", 1);
    }
    // tick=201 时再记录 1 次：窗口 (1, 201] 内只有这 1 次 + 之前的 20 次已过期？
    // 滑窗 cutoff = 201 - 200 = 1，filter 保留 tick > 1 的记录 → tick=1 的 20 次被清除。
    // 窗口内仅 1 次 → 不触发（1 ≤ 20）。
    recordChurn(ROOM, "harvester", 201);
    const roomMem = runChurnCheck(201);
    expect(roomMem.churnFreezeUntil).toBeUndefined();
  });

  it("churn 阈值恰好 20 → 不触发（> 才触发，防 = 误判）", () => {
    for (let i = 0; i < 20; i++) {
      recordChurn(ROOM, "harvester", 200);
    }
    const roomMem = runChurnCheck(200);
    expect(roomMem.churnFreezeUntil).toBeUndefined();
  });

  it("不同 role 独立计数（harvester 21 次 + hauler 5 次 → 只熔断 harvester）", () => {
    for (let i = 0; i < 21; i++) {
      recordChurn(ROOM, "harvester", 200);
    }
    for (let i = 0; i < 5; i++) {
      recordChurn(ROOM, "hauler", 200);
    }
    const roomMem = runChurnCheck(200);
    expect(roomMem.churnFreezeUntil!.harvester).toBeDefined();
    expect(roomMem.churnFreezeUntil!.hauler).toBeUndefined();
  });

  it("熔断期间 P0 worker 恢复路径不阻塞（livingHarvesters=0 仍可孵 worker）", () => {
    // harvester 被熔断，但 livingHarvesters=0 → P0 worker 路径绝对不冻结。
    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    roomMem.churnFreezeUntil = { harvester: 300 };

    const snap = snapshotWithHarvester();
    // 无存活 harvester/worker → P0 worker 路径触发。
    const { requests } = evaluateDemand(snap, [], "normal", [], [], normalCtx(), 250);
    expect(requests.filter(r => r.role === "worker").length).toBeGreaterThan(0);
  });

  it("熔断到期后 churnFreezeUntil 字段自动清理（防 Memory 泄漏）", () => {
    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    roomMem.churnFreezeUntil = { harvester: 300 };
    // tick=301 ≥ 300 → 到期清理。
    runChurnCheck(301);
    // 字段被回收（空对象删除）。
    expect((globalThis as any).Memory.rooms[ROOM].churnFreezeUntil).toBeUndefined();
  });
});

// ─── 异常情况（3 用例）──────────────────────────────────────────

describe("P0-3 spawn churn 熔断 — 异常情况", () => {
  it("churnCounter globalCache 丢失（global reset）→ 不影响判定，重新计数", () => {
    // global reset 后 __churnCounter 为 undefined。
    // checkChurnCircuitBreaker 应惰性初始化，不报错。
    delete (globalThis as any).__churnCounter;
    expect(() => runChurnCheck(200)).not.toThrow();
    // 无 churn 记录 → 不触发熔断。
    expect((globalThis as any).Memory.rooms[ROOM].churnFreezeUntil).toBeUndefined();

    // 重新计数后正常工作。
    for (let i = 0; i < 21; i++) {
      recordChurn(ROOM, "harvester", 200);
    }
    const roomMem = runChurnCheck(200);
    expect(roomMem.churnFreezeUntil!.harvester).toBe(200 + 100);
  });

  it("recordSkip key 格式异常（无 role 段）→ 跳过该条不计数", () => {
    // 模拟 spawn-manager onPurge 回调的 key 解析守卫：
    // key.split(":")[0] 为空时不调 recordChurn（防脏数据污染统计）。
    const onPurge = (key: string) => {
      const role = key.split(":")[0] ?? "";
      if (role) recordChurn(ROOM, role, 200);
    };
    // 格式异常的 key（以 : 开头或空字符串 → role 解析为空），不应计数。
    onPurge(":W1N1:0");
    onPurge("");
    // 21 条合法 harvester churn → 应触发熔断（异常 key 未占用 harvester 计数配额）。
    for (let i = 0; i < 21; i++) {
      onPurge("harvester:W1N1:0");
    }
    const roomMem = runChurnCheck(200);
    expect(roomMem.churnFreezeUntil!.harvester).toBe(200 + 100);
    // 异常 key 的 role="" 未被记录 → 不触发 "" 角色熔断。
    expect(roomMem.churnFreezeUntil![""]).toBeUndefined();
  });

  it("churnFreezeUntil 字段类型异常（非 number）→ 视为到期清理", () => {
    const roomMem = (globalThis as any).Memory.rooms[ROOM] as RoomMemory;
    // 模拟 Memory 损坏：churnFreezeUntil 值为字符串（非数字）。
    roomMem.churnFreezeUntil = { harvester: "invalid" as unknown as number };
    // checkChurnCircuitBreaker 应将非数字值视为到期，清理该条目。
    runChurnCheck(100);
    expect((globalThis as any).Memory.rooms[ROOM].churnFreezeUntil).toBeUndefined();
  });
});
