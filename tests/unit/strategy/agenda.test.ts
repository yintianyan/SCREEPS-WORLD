/**
 * 帝国议程纯函数测试（R6a 主动自治）。
 *
 * 覆盖：优先级（recovery > defense-readiness > rcl-push > develop）、
 * 紧急目标立即生效、普通切换最短驻留滞回、rcl-push 门槛全集、边界。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENDA_OPTIONS,
  evaluateAgenda,
  type AgendaInput,
  type AgendaRoomInput,
} from "../../../src/domain/strategy/agenda";

const TICK = 100000;

function room(overrides: Partial<AgendaRoomInput> = {}): AgendaRoomInput {
  return {
    colonyState: "normal",
    economyPressure: 0.1,
    rcl: 6,
    storageEnergy: 40000,
    ...overrides,
  };
}

function input(overrides: Partial<AgendaInput> = {}): AgendaInput {
  return {
    tick: TICK,
    rooms: [room()],
    ...overrides,
  };
}

describe("agenda — 目标选择优先级", () => {
  it("任一房危机 → recovery（最高优先级）", () => {
    const r = evaluateAgenda(input({ rooms: [room({ colonyState: "crisis" })] }));
    expect(r.initiative).toBe("recovery");
  });

  it("近期受袭 → defense-readiness（压过冲级条件）", () => {
    const r = evaluateAgenda(
      input({ rooms: [room({ lastHostileAt: TICK - 100, storageEnergy: 100000 })] }),
    );
    expect(r.initiative).toBe("defense-readiness");
  });

  it("无威胁 + 健康 + storage 达标 + 全房 RCL<8 → rcl-push", () => {
    const r = evaluateAgenda(input({ rooms: [room({ storageEnergy: 50000, rcl: 6 })] }));
    expect(r.initiative).toBe("rcl-push");
  });

  it("storage 不足 → develop（不冲级）", () => {
    const r = evaluateAgenda(input({ rooms: [room({ storageEnergy: 5000 })] }));
    expect(r.initiative).toBe("develop");
  });

  it("平均压力过高 → develop（打不起不冲）", () => {
    const r = evaluateAgenda(input({ rooms: [room({ economyPressure: 0.9 })] }));
    expect(r.initiative).toBe("develop");
  });

  it("有房 RCL8 → develop（无级可冲）", () => {
    const r = evaluateAgenda(input({ rooms: [room({ rcl: 8, storageEnergy: 100000 })] }));
    expect(r.initiative).toBe("develop");
  });

  it("受袭记忆超出窗口 → 恢复可冲级", () => {
    const staleAgo = DEFAULT_AGENDA_OPTIONS.threatWindow + 100;
    const r = evaluateAgenda(
      input({ rooms: [room({ lastHostileAt: TICK - staleAgo, storageEnergy: 80000 })] }),
    );
    expect(r.initiative).toBe("rcl-push");
  });
});

describe("agenda — 滞回", () => {
  it("紧急目标（recovery/defense-readiness）进入立即生效，不等驻留", () => {
    const r = evaluateAgenda(
      input({
        rooms: [room({ lastHostileAt: TICK - 10 })],
        prev: { initiative: "develop", since: TICK - 5 },
      }),
    );
    expect(r.initiative).toBe("defense-readiness");
    expect(r.since).toBe(TICK);
  });

  it("普通切换（develop → rcl-push）驻留未满 → 保持原目标", () => {
    const r = evaluateAgenda(
      input({
        rooms: [room({ storageEnergy: 90000 })],
        prev: { initiative: "develop", since: TICK - 50 },
      }),
    );
    expect(r.initiative).toBe("develop");
    expect(r.since).toBe(TICK - 50);
  });

  it("普通切换驻留期满 → 切换并刷新 since", () => {
    const r = evaluateAgenda(
      input({
        rooms: [room({ storageEnergy: 90000 })],
        prev: { initiative: "develop", since: TICK - DEFAULT_AGENDA_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.initiative).toBe("rcl-push");
    expect(r.since).toBe(TICK);
  });

  it("目标不变时 since 保持", () => {
    const r = evaluateAgenda(
      input({
        rooms: [room({ storageEnergy: 90000 })],
        prev: { initiative: "rcl-push", since: TICK - 500 },
      }),
    );
    expect(r.initiative).toBe("rcl-push");
    expect(r.since).toBe(TICK - 500);
  });
});
