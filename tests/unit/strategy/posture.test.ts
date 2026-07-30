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
    rcl: 7,
    storageEnergy: 150000,
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

  // Phase 1a：殖民门加"核心成熟度 + 最新房自立"。
  it("无成熟 sponsor（房仅 RCL6）→ develop（不殖民）", () => {
    const r = evaluateEmpirePosture(input({ rooms: [room({ rcl: 6 })] }));
    expect(r.posture).toBe("develop");
  });

  it("sponsor 达 RCL7 但 storage 不足 → develop（代孵能力不够）", () => {
    const r = evaluateEmpirePosture(input({ rooms: [room({ rcl: 7, storageEnergy: 50000 })] }));
    expect(r.posture).toBe("develop");
  });

  it("有嫩房（RCL4 未自立）→ develop（即便有成熟 sponsor、GCL 有余量）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ rcl: 8, storageEnergy: 200000 }), room({ rcl: 4, storageEnergy: 0 })],
        gclLevel: 3,
      }),
    );
    expect(r.posture).toBe("develop");
  });

  it("成熟 sponsor（RCL8/storage 足）+ 最新房已自立（RCL6）+ GCL 余量 → expand", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ rcl: 8, storageEnergy: 200000 }), room({ rcl: 6, storageEnergy: 80000 })],
        gclLevel: 3,
      }),
    );
    expect(r.posture).toBe("expand");
    expect(r.expansionAllowed).toBe(true);
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

  // 防永冻：单波 invader 击退后，威胁记忆超出 threatWindow → 不再冻结，回 develop。
  // （历史 bug：threatWindow=10000 令一波已击退的 invader 冻结扩张上万 tick，
  //  活跃帝国周期性遇 invader → 扩张近乎永久冻结。缩短窗口后陈旧威胁及时老化。）
  it("陈旧威胁（超出 threatWindow）+ 上一态 war → 回 develop（不永冻扩张）", () => {
    const staleAgo = DEFAULT_POSTURE_OPTIONS.threatWindow + 500;
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - staleAgo })],
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
