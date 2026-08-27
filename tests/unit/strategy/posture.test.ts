/** 帝国姿态评估器测试。 */
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

  it("sponsor 达 RCL7 但 colonyState=recovery → develop（非健康不代孵）", () => {
    const r = evaluateEmpirePosture(input({ rooms: [room({ rcl: 7, colonyState: "recovery" })] }));
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

describe("empire posture — sponsor 门（稳定性模型，取代 100k 库存硬门槛）", () => {
  // 默认 room() = RCL7 / storage 150000 / colonyState normal / 无活威胁 → 满足 sponsor 成熟。
  it("RCL7 + normal + 无活威胁 + storage≥地板 → sponsor 成熟（其余条件满足即 expand）", () => {
    const r = evaluateEmpirePosture(input({ rooms: [room({ rcl: 7, storageEnergy: 9000 })] }));
    expect(r.posture).toBe("expand");
    expect(r.expansionAllowed).toBe(true);
  });

  it("sponsor RCL7 但有活威胁 → 不代孵（develop，战中不殖民）", () => {
    const r = evaluateEmpirePosture(input({ rooms: [room({ rcl: 7, hasLiveThreat: true })] }));
    expect(r.posture).toBe("develop");
  });

  it("sponsor RCL7 但 storage<地板（饿死边缘）→ 不代孵（develop）", () => {
    const r = evaluateEmpirePosture(input({ rooms: [room({ rcl: 7, storageEnergy: 5000 })] }));
    expect(r.posture).toBe("develop");
  });

  it("RCL6 → 不代孵（未达成熟 RCL 门槛）", () => {
    const r = evaluateEmpirePosture(input({ rooms: [room({ rcl: 6 })] }));
    expect(r.posture).toBe("develop");
  });
});

describe("empire posture — 威胁升级（紧急旁路）", () => {
  it("任一房近期受袭且有活威胁 → 立即 fortify，扩张与新远矿点全部关停", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room(), room({ lastHostileAt: tick - 100, hasLiveThreat: true })],
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

describe("empire posture — 冻结跟随真实在房威胁（恐吓税修复）", () => {
  it("近期受袭但敌已撤离（无活威胁）→ 姿态 fortify，但远矿物流与扩张均恢复", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })], // 记忆窗口内但无 hasLiveThreat（敌已撤离）
        prev: { posture: "expand", since: tick - 50 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.newRemoteOpsAllowed).toBe(true); // 关键修复：不再为过期记忆付恐吓税
    expect(r.expansionAllowed).toBe(true); // 扩张侧同构解耦：fortify 记忆不封锁殖民
  });

  it("扩张侧恐吓税修复：fortify 无活威胁 + 全面健康 → expansionAllowed true", () => {
    // 复现线上 Aguia 边境游荡：lastHostileAt 在窗口内（posture 钉 fortify），但此刻无活敌、
    // 帝国全面健康 → 殖民授权应开放（殖民目标 W36S56 远离 Aguia 边境 W38S58，安全）。
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - 200 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.expansionAllowed).toBe(true);
  });

  it("war 姿态（即便无活威胁）→ expansionAllowed false（战争是主动冲突，不殖民）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "war", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.posture).toBe("war");
    expect(r.newRemoteOpsAllowed).toBe(true); // 无活敌 → 现役远矿可继续
    expect(r.expansionAllowed).toBe(false); // 但战争态硬性关闭新殖民
  });

  it("war 姿态但无活威胁 → 远矿物流恢复（现役运营不受影响，仅新 op 放开）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "war", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.posture).toBe("war");
    expect(r.newRemoteOpsAllowed).toBe(true);
  });

  it("活威胁出现（记忆滞后）→ sponsor 不成熟 → 姿态 develop，新远矿立即冻结（安全优先）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ hasLiveThreat: true })], // 无 lastHostileAt：记忆滞后，但此刻有敌
      }),
    );
    expect(r.posture).toBe("develop"); // 活威胁令 sponsor 不成熟，回到 develop
    expect(r.newRemoteOpsAllowed).toBe(false); // 冻结跟随真实视线而非记忆
  });

  it("活威胁 → 扩张与新远矿均关闭（不把殖民队送进战场），姿态 develop", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ hasLiveThreat: true })],
      }),
    );
    expect(r.posture).toBe("develop");
    expect(r.expansionAllowed).toBe(false);
    expect(r.newRemoteOpsAllowed).toBe(false);
  });

  it("expand 态 + 无活威胁 → 扩张与远矿均开放", () => {
    const r = evaluateEmpirePosture(input());
    expect(r.posture).toBe("expand");
    expect(r.expansionAllowed).toBe(true);
    expect(r.newRemoteOpsAllowed).toBe(true);
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

describe("empire posture — R4 war 可持续退出（经济止损）", () => {
  const pressureRoom = (pressure: number) => room({ lastHostileAt: tick - 100, economyPressure: pressure });

  it("war + 压力持续超标达到耐心窗口 → 立即降 fortify（不等 minDwell 驻留期）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [pressureRoom(0.9)],
        prev: { posture: "war", since: tick - 100 }, // 驻留仅 100 < minDwell
        warPressureTicks: DEFAULT_POSTURE_OPTIONS.warExitPatienceTicks - 1,
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.warPressureTicks).toBe(0); // 退出即清零
  });

  it("war + 压力超标未达耐心 → 维持 war，计数递增", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [pressureRoom(0.9)],
        prev: { posture: "war", since: tick - 100 },
        warPressureTicks: 5,
      }),
    );
    expect(r.posture).toBe("war");
    expect(r.warPressureTicks).toBe(6);
  });

  it("war + 压力恢复 → 维持 war，计数清零（防抖动：单 tick 波动不累积）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [pressureRoom(0.2)],
        prev: { posture: "war", since: tick - 100 },
        warPressureTicks: 500,
      }),
    );
    expect(r.posture).toBe("war");
    expect(r.warPressureTicks).toBe(0);
  });

  it("war 压力退出后（fortify）重新升 war 仍需耐心窗口（既有升级链不破坏）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("war");
    expect(r.warPressureTicks).toBe(0); // 新战争计划从零计数
  });

  it("fortify 升 war 时经济扛不住 → 保持 fortify（打不起就不打，计数不启动）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [pressureRoom(0.9)],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.warPressureTicks).toBe(0);
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

describe("empire posture — 能量危机≠战争（recovery/bootstrap 经济前置，R-analysis）", () => {
  // 战争是盈余活动；recovery/bootstrap 表示能量闭环退化，姿态机必须把经济容量作为
  // 战争的硬性前置——否则会像线上 W37S58 那样在危机下仍 war，孵出纯消耗 combat
  // creeps 反而拖死经济。正常态（normal）的升级链不受影响。
  it("recovery 态下 fortify 耐心窗口满 + 经济扛得住 → 仍不升 war（打不起就不打）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100, colonyState: "recovery" })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });

  it("bootstrap 态同理：不发动进攻性战争", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100, colonyState: "bootstrap" })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });

  it("recovery 态下既有 war 且无活敌 → 立即撤资降 fortify（危机养不起战争机器）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ colonyState: "recovery" })],
        prev: { posture: "war", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.warPressureTicks).toBe(0); // 退出即清零
  });

  it("recovery 态下 war 但有真实在房威胁（紧急旁路）→ 维持 war（防御优先于经济收缩）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ colonyState: "recovery", hasLiveThreat: true })],
        prev: { posture: "war", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("war");
  });

  it("正常态（normal）下战争升级链不受影响（对照：recovery 才拦截）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("war");
  });
});
