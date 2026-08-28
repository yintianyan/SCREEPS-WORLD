/** Intelligence 系统（IntelState 唯一写者）：legacy 采用 / 被动威胁 / 老化 / 查询 API。 */
import { describe, expect, it, beforeEach } from "vitest";
import { mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";
import { systemPhase } from "../../../src/kernel/phase";
import {
  intelligenceSystem,
  getRoomIntel,
  getPlayerIntel,
  intelActionUsable,
  intelNeedsRescout,
  intelConfidence,
  intelSize,
} from "../../../src/systems/intelligence";
import { ROOM_DYNAMIC_TTL, ROOM_THREAT_TTL } from "../../../src/domain/intel";

/** 老化门触发 tick：(tick - PARENT_PHASE) % 100 === 0。 */
const PARENT_PHASE = systemPhase("intelligence", 10);
function agingTick(base: number): number {
  return base + ((PARENT_PHASE - base) % 100 + 100) % 100;
}

function setMemoryIntel(room: string, subject: string, intel: Record<string, unknown>): void {
  ((globalThis as any).Memory.rooms[room] ??= {}).intel = { [subject]: intel };
}

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Game.time = 1_000_000;
  (globalThis as any).Memory.rooms = {};
});

describe("Intelligence — legacy 输入桥采用", () => {
  it("Memory.rooms[].intel 被上采为 IntelEntry，消费者可查询置信度与硬门槛", () => {
    const tick = (globalThis as any).Game.time as number;
    setMemoryIntel("W7N4", "W5N7", {
      kind: "normal", status: "normal", owner: "Enemy", lastSeen: tick - 100,
    });
    intelligenceSystem.run(mockContext(mockSnapshot()));
    expect(getRoomIntel("W5N7")).toBeDefined();
    expect(getRoomIntel("W5N7")!.observedAt).toBe(tick - 100);
    expect(intelConfidence("W5N7", tick)).toBe("fact");
    expect(intelActionUsable("W5N7", tick)).toBe(true);
    expect(intelNeedsRescout("W5N7", tick)).toBe(false);
  });

  it("威胁字段（towers）走短窗——超窗后 stale 且拒绝行动、驱动侦察", () => {
    const tick = (globalThis as any).Game.time as number;
    setMemoryIntel("W7N4", "W5N8", {
      kind: "normal", status: "normal", towers: 3, lastSeen: tick - ROOM_THREAT_TTL - 1,
    });
    intelligenceSystem.run(mockContext(mockSnapshot()));
    expect(intelConfidence("W5N8", tick)).toBe("stale");
    expect(intelActionUsable("W5N8", tick)).toBe(false);
    expect(intelNeedsRescout("W5N8", tick)).toBe(true);
  });

  it("无情报房 = 未知：needsRescout 驱动侦察、行动拒绝", () => {
    const tick = (globalThis as any).Game.time as number;
    intelligenceSystem.run(mockContext(mockSnapshot()));
    expect(intelConfidence("W1N1", tick)).toBe("unknown");
    expect(intelNeedsRescout("W1N1", tick)).toBe(true);
  });

  it("玩家域：legacy owner 记录 + 黑名单命中记敌对", () => {
    const tick = (globalThis as any).Game.time as number;
    (globalThis as any).Memory.kernel = { warBlacklist: { W5N9: tick + 1_000 } };
    setMemoryIntel("W7N4", "W5N9", {
      kind: "normal", status: "normal", owner: "HostileCorp", lastSeen: tick - 10,
    });
    intelligenceSystem.run(mockContext(mockSnapshot()));
    const player = getPlayerIntel("HostileCorp");
    expect(player).toBeDefined();
    expect(player!.lastHostileAt).toBe(tick - 10);
    expect(player!.rooms.W5N9).toBe(tick - 10);
  });

  it("NPC Invader 不进玩家威胁记忆", () => {
    const tick = (globalThis as any).Game.time as number;
    setMemoryIntel("W7N4", "W5N9", {
      kind: "sk", status: "normal", owner: "Invader", lastSeen: tick,
    });
    intelligenceSystem.run(mockContext(mockSnapshot()));
    expect(getPlayerIntel("Invader")).toBeUndefined();
  });

  it("被动威胁信号：自有房可见敌对 creep → 玩家域敌对记忆", () => {
    const tick = (globalThis as any).Game.time as number;
    const snap = mockSnapshot({
      threatCreeps: [{ owner: { username: "Raider" } }] as any,
    });
    intelligenceSystem.run(mockContext(snap));
    const player = getPlayerIntel("Raider");
    expect(player).toBeDefined();
    expect(player!.lastHostileAt).toBe(tick);
  });
});

describe("Intelligence — 低频老化与容量", () => {
  it("老化门 tick 清理超期条目并驱动 intelSize 收缩", () => {
    const base = (globalThis as any).Game.time as number;
    const adoptedAt = base - ROOM_DYNAMIC_TTL - 1_000;
    setMemoryIntel("W7N4", "W3N3", {
      kind: "normal", status: "normal", lastSeen: adoptedAt,
    });
    intelligenceSystem.run(mockContext(mockSnapshot()));
    expect(getRoomIntel("W3N3")).toBeDefined(); // 采用即写入（虽已超期）
    const atAging = agingTick(base);
    (globalThis as any).Game.time = atAging;
    intelligenceSystem.run(mockContext(mockSnapshot()));
    expect(getRoomIntel("W3N3")).toBeUndefined(); // 老化清理为未知
    expect(getRoomIntel("W5N7")).toBeDefined(); // 未超期条目不受影响（文件内模块态跨用例保留）
  });

  it("预算车道耗尽时采集跳过（canStart(P2) false 不崩溃，下周期重采）", () => {
    const tick = (globalThis as any).Game.time as number;
    setMemoryIntel("W7N4", "W5N7", { kind: "normal", status: "normal", lastSeen: tick });
    const ctx = mockContext(mockSnapshot());
    const budget = ctx.budget as { canStart: (p: number) => boolean };
    budget.canStart = (p: number) => p < 2; // P2 车道禁用
    expect(() => intelligenceSystem.run(ctx)).not.toThrow();
  });
});
