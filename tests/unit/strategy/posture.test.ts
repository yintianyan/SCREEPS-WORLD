/**
 * 帝国姿态评估器测试。
 *
 * 覆盖：默认固本、扩张条件全集、威胁即时升级（紧急旁路）、
 * fortify→war 耐心窗口与经济门槛、降级滞回（驻留期）、
 * war 不直接回 expand、指令派生正确性。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateEmpirePosture,
  DEFAULT_POSTURE_OPTIONS,
  type PostureInput,
  type RoomStrategyInput,
} from "../../../src/domain/strategy/posture";

const tick = 100000;

function room(overrides: Partial<RoomStrategyInput> = {}): RoomStrategyInput {
  return {
    colonyState: "normal",
    economyPressure: 0.1,
    rcl: 6,
    ...overrides,
  };
}

function input(overrides: Partial<PostureInput> = {}): PostureInput {
  return {
    tick,
    rooms: [room()],
    gclLevel: 2,
    bucket: 9000,
    ...overrides,
  };
}

describe("empire posture — 和平姿态选择", () => {
  it("全面健康 + GCL 余量 + bucket 富余 → expand", () => {
    const r = evaluateEmpirePosture(input());
    expect(r.posture).toBe("expand");
    expect(r.expansionAllowed).toBe(true);
    expect(r.newRemoteOpsAllowed).toBe(true);
  });

  it("GCL 无余量 → develop（扩张指令关闭）", () => {
    const r = evaluateEmpirePosture(input({ gclLevel: 1 }));
    expect(r.posture).toBe("develop");
    expect(r.expansionAllowed).toBe(false);
    expect(r.newRemoteOpsAllowed).toBe(true);
  });

  it("bucket 不足 / 经济压力高 / 有房非 normal → 均不扩张", () => {
    expect(evaluateEmpirePosture(input({ bucket: 3000 })).posture).toBe("develop");
    expect(
      evaluateEmpirePosture(input({ rooms: [room({ economyPressure: 0.8 })] })).posture,
    ).toBe("develop");
    expect(
      evaluateEmpirePosture(input({ rooms: [room({ colonyState: "recovery" })] })).posture,
    ).toBe("develop");
  });
});

describe("empire posture — 威胁升级（紧急旁路）", () => {
  it("任一房近期受袭 → 立即 fortify，扩张与新远矿点全部关停", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room(), room({ lastHostileAt: tick - 100 })],
        prev: { posture: "expand", since: tick - 50 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.expansionAllowed).toBe(false);
    expect(r.newRemoteOpsAllowed).toBe(false);
  });

  it("威胁超过记忆窗口 → 不再触发 fortify", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - DEFAULT_POSTURE_OPTIONS.threatWindow - 1 })],
      }),
    );
    expect(r.posture).toBe("expand");
  });
});

describe("empire posture — fortify → war 升级", () => {
  it("设防超过耐心窗口且敌情未消且经济扛得住 → war", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("war");
  });

  it("经济压力高时不升 war（打不起就不打）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100, economyPressure: 0.9 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });

  it("耐心窗口未满 → 维持 fortify", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });
});

describe("empire posture — 降级滞回", () => {
  it("威胁消退但驻留期未满 → 维持 fortify（防抖）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room()],
        prev: { posture: "fortify", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });

  it("威胁消退且驻留期满 → 回落 develop（不直接跳 expand）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room()],
        prev: { posture: "war", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.posture).toBe("develop");
  });
});

describe("empire posture — since 语义", () => {
  it("姿态不变时 since 保持，变更时刷新", () => {
    const kept = evaluateEmpirePosture(
      input({ prev: { posture: "expand", since: tick - 500 } }),
    );
    expect(kept.since).toBe(tick - 500);

    const changed = evaluateEmpirePosture(
      input({ gclLevel: 1, prev: { posture: "expand", since: tick - 500 } }),
    );
    expect(changed.posture).toBe("develop");
    expect(changed.since).toBe(tick);
  });
});
