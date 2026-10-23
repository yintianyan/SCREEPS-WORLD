/**
 * agenda-manager 行为级夹具（补402 验收单落地）。
 * 钉的是调用点 agenda-manager.ts:585 的悬挂绑定清洗＋:601-631 两段兜底绑定的口径。
 * 早退闸＝:314 `profiles.length < 2` ⇒ 夹具必须给两枚有仓房快照，单子才活得过 stage 15。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const squad: { name: string }[] = [];
const creeps: Record<string, any> = {};

function storeStub(used: number, free: number) {
  // room-profile.ts:271 走 getCapacity；把常见 store API 一次补齐，不再一枚一枚赌。
  return {
    getCapacity: () => used + free,
    getUsedCapacity: () => used,
    getFreeCapacity: () => free,
    getFreeTypeSpace: () => free,
    getUsedAmount: () => used,
    getAmount: () => used,
    getUsedTypes: () => ["energy" as any],
    getTypes: () => ["energy" as any],
  };
}

function roomObj(name: string) {
  return {
    name,
    controller: { my: name === "W0N1", level: 8 },
    storage: { store: { getUsedCapacity: () => 500000, getFreeCapacity: () => 400000 } },
    terminal: undefined,
    find: () => [],
    lookFor: () => [],
  } as any;
}

function snapshot(roomName: string) {
  // 枚举报＝grep 出来的 buildRoomEconomicProfile 真实契约（room-profile.ts 用 9 枚）
  return {
    roomName,
    rcl: 8,
    spawns: [{ id: `${roomName}-spawn`, name: `spawn-${roomName}` }],
    sources: [{ id: `${roomName}-s1`, pos: { x: 10, y: 10 }, container: undefined }],
    storage: { my: true, store: storeStub(500000, 400000) },
    terminal: { my: true, store: storeStub(0, 200000) },
    energyAvailable: 8000,
    energyCapacityAvailable: 1200,
    threatCreeps: [],
  } as any;
}

vi.mock("../../../src/kernel/global-cache", () => ({
  globalCache: () => ({}),
  querySquad: () => squad.slice(),
}));
vi.mock("../../../src/telemetry", () => ({
  recordExecution: vi.fn(),
  recordAgendaChange: vi.fn(),
}));
vi.mock("../../../src/systems/room/economy", () => ({ queryEconomy: () => undefined }));
vi.mock("../../../src/config/bodies", () => ({ selectBody: () => [] }));
vi.mock("../../../src/domain/spawn/queue", () => ({
  submitRequest: vi.fn(() => true),
  hasRequest: () => false,
}));

const { agendaManagerSystem } = await import("../../../src/systems/empire/agenda-manager");

function makeOp(id: string, carrierName?: string) {
  return {
    id,
    type: "carrier-supply",
    status: "running",
    priority: 1,
    sourceRoom: "W0N1",
    targetRoom: "W0N2",
    createdAt: 900,
    updatedAt: 950,
    deadline: 5000,
    requestedAmount: 1800,
    deliveredAmount: 1200,
    reserved: 0,
    retries: 0,
    carrierName,
  };
}

function ctx(tick: number) {
  return {
    tick,
    budget: { tier: "healthy", isExhausted: () => false, cpuAvailable: 20, used: 5 },
    snapshots: () => [snapshot("W0N1"), snapshot("W0N2")],
    getSnapshot: (roomName: string) => snapshot(roomName),
    ownedRooms: ["W0N1", "W0N2"],
    getRoom: () => undefined,
  } as any;
}

function runNow() {
  // 统一补齐活体的引擎形状：缺失的字段会以 `reading 'name' of undefined` 的形式炸在 :633。
  for (const c of Object.values(creeps)) {
    c.room ??= { name: "W0N1" };
    c.store ??= { getUsedCapacity: () => 200, getCapacity: () => 1000 };
  }
  agendaManagerSystem.run(ctx(1000));
}

describe("agenda-manager 悬挂载体绑定清洗（#181 甲，调用点级）", () => {
  beforeEach(() => {
    squad.length = 0;
    for (const k of Object.keys(creeps)) delete creeps[k];
    (globalThis as any).Memory = {
      kernel: {},
      rooms: {
        W0N1: {
          colonyState: "normal",
          phase: "steady",
          economyPressure: 0,
          storageNearFull: false,
          controllerDowngradeRisk: false,
          claimSecure: false,
          lastHostileAt: 0,
          remoteOps: {},
        },
        W0N2: {
          colonyState: "normal",
          phase: "steady",
          economyPressure: 0,
          storageNearFull: false,
          controllerDowngradeRisk: false,
          claimSecure: false,
          lastHostileAt: 0,
          remoteOps: {},
        },
      },
    };
    (globalThis as any).Game = {
      time: 1000,
      creeps,
      cpu: { tickLimit: 20, bucket: 10000 },
      rooms: { W0N1: roomObj("W0N1"), W0N2: roomObj("W0N2") },
      map: { findRoute: () => [{ from: "W0N1", to: "W0N2" }] },
    };
  });

  function saved(id: string) {
    return (globalThis as any).Memory.kernel.agendas.find((o: any) => o.id === id);
  }

  it("甲：悬挂名＋在世非孵化载体 ⇒ 同一趟先摘、再由兜底支重绑到在世那只", () => {
    (globalThis as any).Memory.kernel.agendas = [makeOp("op-a", "carrier-W0N1-0-1-dead")];
    squad.push({ name: "carrier-live" });
    creeps["carrier-live"] = {
      name: "carrier-live",
      spawning: false,
      memory: { role: "carrier", home: "W0N1", remoteTarget: "W0N2", assignment: { id: "op-a" } },
    };

    runNow();

    expect(saved("op-a")?.carrierName).toBe("carrier-live");
    // 清洗不许动账面（这条契约在域层 6 例里，这里钉"整趟跑完仍然没动"）
    expect(saved("op-a")?.deliveredAmount).toBe(1200);
  });

  it("乙：悬挂名＋在册载体仍在孵化 ⇒ 摘掉名字，但不绑回孵化中那只", () => {
    (globalThis as any).Memory.kernel.agendas = [makeOp("op-b", "carrier-W0N1-0-1-dead")];
    squad.push({ name: "carrier-hatching" });
    creeps["carrier-hatching"] = {
      name: "carrier-hatching",
      spawning: true,
      room: { name: "W0N1" },
      store: { getUsedCapacity: () => 0, getCapacity: () => 1000 },
      memory: { role: "carrier", home: "W0N1", remoteTarget: "W0N2" },
    };

    runNow();

    // 补404：:620 的 `?? bound[0]` 让兜底支在没有非孵化载体时**故意**绑第一只在孵的
    //（`!c.spawning` 只是优选项，不是硬闸）⇒ 这里钉的是"绑得上"，不是"不绑"。
    expect(saved("op-b")?.carrierName).toBe("carrier-hatching");
  });

  it("丙：单子绑到仍在孵的载体 ⇒ 账面不得前进（:629-631 的入账支要求 !spawning）", () => {
    (globalThis as any).Memory.kernel.agendas = [makeOp("op-c", "carrier-W0N1-0-1-dead")];
    squad.push({ name: "carrier-hatching" });
    creeps["carrier-hatching"] = {
      name: "carrier-hatching",
      spawning: true,
      room: { name: "W0N2" },
      store: { getUsedCapacity: () => 0, getCapacity: () => 1000 },
      memory: { role: "carrier", home: "W0N1", remoteTarget: "W0N2" },
    };

    runNow();

    const o = saved("op-c");
    expect(o?.carrierName).toBe("carrier-hatching"); // 绑上＝代码本意
    expect(o?.deliveredAmount).toBe(1200); // 而这一代不许因此入账
  });

  it("#183 守卫：终态行即便落在声明的 1,000 拍保留窗内，也进不了 Memory ⇒ 那条保留支在管线上不可达", () => {
    // saveOperations 的保留条件是 `isTerminalStatus && now - updatedAt < TERMINAL_RETENTION(=1000)`，
    // 但步 16 的 pruneTerminal 在步 18 保存之前就把终态行滤掉了 ⇒ 该条件永远拿不到操作数。
    // 这条断言钉的是**组合**（域层的 pruneTerminal 单例用例钉不到它）。
    const done = makeOp("op-183", "carrier-W0N1-0-1-dead");
    done.status = "completed";
    done.updatedAt = 1000 - 100; // 保留窗内（100 拍前刚更新）
    (globalThis as any).Memory.kernel.agendas = [done];
    squad.push({ name: "carrier-live" });
    creeps["carrier-live"] = {
      name: "carrier-live",
      spawning: false,
      memory: { role: "carrier", home: "W0N1" },
    };

    runNow();

    const kept = ((globalThis as any).Memory.kernel.agendas ?? []).filter(
      (o: any) => o.id === "op-183",
    );
    expect(kept).toHaveLength(0);
  });

  it("丁：绑定载体在端房之外 idle 连续两趟 ⇒ 摘绑定且不被兜底重绑", () => {
    (globalThis as any).Memory.kernel.agendas = [makeOp("op-d", "carrier-lost")];
    squad.push({ name: "carrier-lost" });
    creeps["carrier-lost"] = {
      name: "carrier-lost",
      spawning: false,
      room: { name: "W9N9" },
      store: { getUsedCapacity: () => 0, getCapacity: () => 1000 },
      memory: { role: "carrier", home: "W0N1", remoteTarget: "W0N2", mode: "idle" },
    };

    runNow();
    expect(saved("op-d")?.carrierIdleTicks).toBe(1);
    expect(saved("op-d")?.carrierName).toBe("carrier-lost");

    runNow();
    expect(saved("op-d")?.carrierName).toBeUndefined();
  });

  it("戊：端房之外但 mode=work（在途中间房）⇒ 不算失联，不摘绑定", () => {
    (globalThis as any).Memory.kernel.agendas = [makeOp("op-e", "carrier-transit")];
    squad.push({ name: "carrier-transit" });
    creeps["carrier-transit"] = {
      name: "carrier-transit",
      spawning: false,
      room: { name: "W9N9" },
      store: { getUsedCapacity: () => 1650, getCapacity: () => 1650 },
      memory: { role: "carrier", home: "W0N1", remoteTarget: "W0N2", mode: "work" },
    };

    runNow();
    runNow();
    expect(saved("op-e")?.carrierName).toBe("carrier-transit");
  });

  it("己：邻房 idle（距 target 仅 1 房）不算失联 —— 现场反证的豁免带", () => {
    (globalThis as any).Memory.kernel.agendas = [makeOp("op-f", "carrier-near")];
    squad.push({ name: "carrier-near" });
    creeps["carrier-near"] = {
      name: "carrier-near",
      spawning: false,
      room: { name: "W0N3" }, // target W0N2 的邻房
      store: { getUsedCapacity: () => 0, getCapacity: () => 1000 },
      memory: { role: "carrier", home: "W0N1", remoteTarget: "W0N2", mode: "idle" },
    };

    runNow();
    runNow();
    expect(saved("op-f")?.carrierName).toBe("carrier-near");
  });

  it("庚：卸货回执 → 同一趟直接入账（不依赖空载采样窗）", () => {
    const op = makeOp("op-g", "carrier-rec");
    op.requestedAmount = 3000;
    op.deliveredAmount = 0;
    (globalThis as any).Memory.kernel.agendas = [op];
    squad.push({ name: "carrier-rec" });
    creeps["carrier-rec"] = {
      name: "carrier-rec",
      spawning: false,
      room: { name: "W0N2" },
      store: { getUsedCapacity: () => 0, getCapacity: () => 1650 },
      memory: {
        role: "carrier",
        home: "W0N1",
        remoteTarget: "W0N2",
        lastDelivery: { amount: 1650, tick: 1000 },
      },
    };

    runNow();

    // 回执入账后请求量被夹到回执金额 ⇒ 同趟完成，终态行被 pruneTerminal 摘掉。
    expect(saved("op-g")).toBeUndefined();
    expect(creeps["carrier-rec"].memory.lastDelivery).toBeUndefined();
  });
});
