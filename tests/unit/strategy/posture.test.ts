/** 帝国姿态评估器测试。 */
import { EventKind, packEventPayload } from "../../../src/kernel/event-log";
import { describe, expect, it } from "vitest";
import {
  evaluateEmpirePosture,
  postureTransitionEventData,
  POSTURE_BRANCH_EVENT_CODE,
  POSTURE_EVENT_CODE,
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
    expect(evaluateEmpirePosture(input({ rooms: [room({ economyPressure: 0.8 })] })).posture).toBe(
      "develop",
    );
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
  it("任一房近期玩家敌意且有活威胁 → 立即 fortify，扩张与新远矿点全部关停", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room(), room({ lastPlayerHostileAt: tick - 100, hasLiveThreat: true })],
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
        rooms: [room({ lastPlayerHostileAt: tick - DEFAULT_POSTURE_OPTIONS.threatWindow - 1 })],
      }),
    );
    expect(r.posture).toBe("expand");
  });
});

describe("empire posture — 冻结跟随真实在房威胁（恐吓税修复）", () => {
  it("近期受袭但敌已撤离（无活威胁）→ 姿态 fortify，但远矿物流与扩张均恢复", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastPlayerHostileAt: tick - 100 })], // 记忆窗口内但无 hasLiveThreat（敌已撤离）
        prev: { posture: "expand", since: tick - 50 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.newRemoteOpsAllowed).toBe(true); // 关键修复：不再为过期记忆付恐吓税
    expect(r.expansionAllowed).toBe(true); // 扩张侧同构解耦：fortify 记忆不封锁殖民
  });

  it("扩张侧恐吓税修复：fortify 无活威胁 + 全面健康 → expansionAllowed true", () => {
    // 复现线上 Aguia 边境游荡：lastPlayerHostileAt 在窗口内（posture 钉 fortify），但此刻无活敌、
    // 帝国全面健康 → 殖民授权应开放（殖民目标 W36S56 远离 Aguia 边境 W38S58，安全）。
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastPlayerHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - 200 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.expansionAllowed).toBe(true);
  });

  it("来源不明（无分尺盖章）的近期威胁不再支撑 war —— 静默期满回 develop", () => {
    // 威胁写读分轨后姿态机只认玩家敌意；classifyThreatOwners 保证非 Invader 一律记
    // player，「来源不明」在实践中不存在（本例钉住混合口径 lastHostileAt 单独存在时
    // 姿态机不再读它——这正是分轨要消除的语义）。
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastHostileAt: tick - 100 })],
        prev: { posture: "war", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.posture).toBe("develop");
    expect(r.reason).toBe("silence-elapsed");
    expect(r.newRemoteOpsAllowed).toBe(true);
    expect(r.expansionAllowed).toBe(true);
  });

  // NPC 过境间隔≈威胁窗，若与玩家宣战同价，war 占空比≈100% ⇒ 扩张永久冻结。
  // 威胁写读分轨后：war 期间玩家敌意出窗、仅 invader 记忆在窗 ⇒ 立即降 fortify
  //（npc-deescalate），不再让 NPC 噪声续命战争机器。
  it("war 姿态 + 玩家敌意出窗、仅 NPC 近期 → npc-deescalate 降 fortify，扩张解锁", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastInvaderHostileAt: tick - 100 })],
        prev: { posture: "war", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("npc-deescalate");
    expect(r.newRemoteOpsAllowed).toBe(true);
    expect(r.expansionAllowed).toBe(true); // fortify 不封锁扩张（健康门通过）
  });

  it("war 姿态 + 玩家近期敌意（即便同时有 NPC）→ 维持 war，扩张关闭", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [
          room({
            lastInvaderHostileAt: tick - 100,
            lastPlayerHostileAt: tick - 50,
          }),
        ],
        prev: { posture: "war", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.posture).toBe("war");
    expect(r.reason).toBe("war-sustain");
    expect(r.expansionAllowed).toBe(false);
  });

  it("war 姿态 + 仅 NPC 近期但在房活敌 → npc-deescalate 降 fortify，冻结优先", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [
          room({
            lastInvaderHostileAt: tick - 100,
            hasLiveThreat: true,
          }),
        ],
        prev: { posture: "war", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("npc-deescalate");
    expect(r.newRemoteOpsAllowed).toBe(false); // liveThreat 冻结优先于降轨
    expect(r.expansionAllowed).toBe(false);
  });

  it("war 姿态但无活威胁 → 远矿物流恢复（现役运营不受影响，仅新 op 放开）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastPlayerHostileAt: tick - 100 })],
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
        rooms: [room({ lastPlayerHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("war");
  });

  it("经济压力高时不升 war（打不起就不打）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastPlayerHostileAt: tick - 100, economyPressure: 0.9 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });

  it("耐心窗口未满 → 维持 fortify", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastPlayerHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });

  it("仅 NPC 近期（无玩家敌意）→ 不升 war（NPC 不触发紧急旁路，防御在 room 级）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastInvaderHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("develop"); // 玩家敌意出窗 → 走静默路径，不驻留 fortify
    expect(r.reason).toBe("silence-elapsed");
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

describe("empire posture — war 可持续退出（经济止损）", () => {
  const pressureRoom = (pressure: number) =>
    room({ lastPlayerHostileAt: tick - 100, economyPressure: pressure });

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
        rooms: [room({ lastPlayerHostileAt: tick - 100 })],
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
    const kept = evaluateEmpirePosture(input({ prev: { posture: "expand", since: tick - 500 } }));
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
        rooms: [room({ lastPlayerHostileAt: tick - 100, colonyState: "recovery" })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("fortify");
  });

  it("bootstrap 态同理：不发动进攻性战争", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastPlayerHostileAt: tick - 100, colonyState: "bootstrap" })],
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
        rooms: [
          room({ colonyState: "recovery", hasLiveThreat: true, lastPlayerHostileAt: tick - 100 }),
        ],
        prev: { posture: "war", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("war");
    expect(r.reason).toBe("war-sustain");
  });

  it("正常态（normal）下战争升级链不受影响（对照：recovery 才拦截）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ lastPlayerHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("war");
  });
});

// 线上 83,708,005→83,708,055（W38S56）实测到一枚 50 拍的 colonyState="defense"（两枚边都由
// colonyStateSince 直读），它关掉了 G2/G5（room-profile 的 struggling 含 defense），却没有动
// 姿态机 —— 因为 anyRecovery 只认 recovery/bootstrap。两列共用一枚分类位却口径不同，靠一次
// "顺手统一一下"的改法就会把撤防条件扩大到防御态（对真实进攻＝一进防御就自动降档）。
// 那枚现场样本的 prev 是 fortify，所以下面这两例是把对照补到 prev=war 与升 war 两支上。
describe("empire posture — defense 不是经济危机（anyRecovery 与 struggling 的分工）", () => {
  it("war + defense 且威胁仍在窗内 → 维持 war（撤防臂不开火，对照 recovery 会降）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ colonyState: "defense", lastPlayerHostileAt: tick - 100 })],
        prev: { posture: "war", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("war");
  });

  it("war + defense 且无活敌（威胁已出窗）→ 仍不因 defense 撤资（走 minDwell 驻留支）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ colonyState: "defense" })],
        prev: { posture: "war", since: tick - 100 },
      }),
    );
    expect(r.posture).toBe("war");
  });

  it("defense 不拦升 war（耐心满 + 经济扛得住 → war；对照 recovery/bootstrap 拦）", () => {
    const r = evaluateEmpirePosture(
      input({
        rooms: [room({ colonyState: "defense", lastPlayerHostileAt: tick - 100 })],
        prev: { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.warPatience - 1 },
      }),
    );
    expect(r.posture).toBe("war");
  });
});

describe("empire posture — 分支标签（转换那一拍走了哪条 return）", () => {
  const o = DEFAULT_POSTURE_OPTIONS;
  // 节拍常数一律从导出的默认值推，不写死数字（同批的教训：猜常数会让判据红在测试自己身上）。
  const hit = (over: Partial<PostureInput> = {}) => evaluateEmpirePosture(input(over));

  it("和平路径 → peace", () => {
    expect(hit().reason).toBe("peace");
  });

  it("威胁窗口内 + prev=develop → threat-hold-fortify", () => {
    const r = hit({
      rooms: [room({ lastPlayerHostileAt: tick - 1 })],
      prev: { posture: "develop", since: tick - 9999 },
    });
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("threat-hold-fortify");
  });

  it("威胁窗口内 + prev=war + 未达止损 → war-sustain", () => {
    const r = hit({
      rooms: [room({ lastPlayerHostileAt: tick - 1 })],
      prev: { posture: "war", since: tick - 50 },
      warPressureTicks: 0,
    });
    expect(r.posture).toBe("war");
    expect(r.reason).toBe("war-sustain");
  });

  it("威胁窗口内 + prev=war + 压力计满 → war-exit-patience（止损）", () => {
    const r = hit({
      rooms: [room({ lastPlayerHostileAt: tick - 1, economyPressure: o.warMaxPressure + 0.01 })],
      prev: { posture: "war", since: tick - 50 },
      warPressureTicks: o.warExitPatienceTicks - 1,
    });
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("war-exit-patience");
  });

  it("prev=war + 危机房在场 + 无活敌 → war-divest-crisis（危机撤资先于止损判据）", () => {
    const r = hit({
      rooms: [room({ colonyState: "recovery" })],
      prev: { posture: "war", since: tick - 50 },
    });
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("war-divest-crisis");
  });

  it("prev=war + 仅 NPC 记忆在窗 → npc-deescalate（NPC 降轨先于驻留支）", () => {
    const r = hit({
      rooms: [room({ lastInvaderHostileAt: tick - 1 })],
      prev: { posture: "war", since: tick - 50 },
    });
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("npc-deescalate");
  });

  it("prev=fortify + 驻留够 + 打得起 → war-enter-patience（进攻授权）", () => {
    const r = hit({
      rooms: [room({ lastPlayerHostileAt: tick - 1 })],
      prev: { posture: "fortify", since: tick - (o.warPatience + 1) },
    });
    expect(r.posture).toBe("war");
    expect(r.reason).toBe("war-enter-patience");
  });

  it("威胁消退 + 最短驻留未到 → hold-min-dwell（姿态不变但原因可读）", () => {
    const r = hit({
      prev: { posture: "war", since: tick - (o.minDwell - 1) },
    });
    expect(r.posture).toBe("war");
    expect(r.reason).toBe("hold-min-dwell");
  });

  it("威胁消退 + 静默期满 → silence-elapsed 回 develop", () => {
    const r = hit({
      prev: { posture: "war", since: tick - o.minDwell },
    });
    expect(r.posture).toBe("develop");
    expect(r.reason).toBe("silence-elapsed");
  });
});

describe("empire posture — 威胁写读分轨矩阵（invader-only / player / mixed × prev 姿态）", () => {
  // 矩阵契约（2026-11-21 批次 2）：
  //  - invader-only：不进 war、不驻留 fortify——develop/expand 照常 peace；fortify 走
  //    静默路径回落；war 立即 npc-deescalate 降 fortify（即便 minDwell 未满）。
  //  - player：war 全链照旧（进入/维持/退出），develop/expand 被 threat-hold-fortify 升。
  //  - mixed（player+invader 同窗）：与 player 完全一致——玩家敌意是唯一升级依据。
  // 防御响应不在本矩阵：room 级 tower-defense / colonyState=defense / agenda
  // defense-readiness 独立运行，不受帝国姿态分轨影响。
  const recent = tick - 100;

  function matrixCase(
    threat: Partial<RoomStrategyInput>,
    prev: { posture: "develop" | "expand" | "fortify" | "war"; since: number },
  ) {
    return evaluateEmpirePosture(
      input({
        rooms: [room(threat)],
        prev,
        warPressureTicks: 0,
      }),
    );
  }

  it("invader-only × prev=develop → 和平路径（NPC 不升级帝国姿态，健康门放行 expand）", () => {
    const r = matrixCase(
      { lastInvaderHostileAt: recent },
      { posture: "develop", since: tick - 500 },
    );
    expect(r.posture).toBe("expand"); // room() fixture 全面健康 → peace 路径按 expandHealth 选 expand
    expect(r.reason).toBe("peace");
    expect(r.expansionAllowed).toBe(true);
    expect(r.newRemoteOpsAllowed).toBe(true);
  });

  it("invader-only × prev=expand → 维持 expand（NPC 噪声不收扩张授权）", () => {
    const r = matrixCase(
      { lastInvaderHostileAt: recent },
      { posture: "expand", since: tick - 500 },
    );
    expect(r.posture).toBe("expand");
    expect(r.reason).toBe("peace");
    expect(r.expansionAllowed).toBe(true);
  });

  it("invader-only × prev=fortify（驻留已满）→ 回落 develop（NPC 不驻留 fortify）", () => {
    const r = matrixCase(
      { lastInvaderHostileAt: recent },
      { posture: "fortify", since: tick - DEFAULT_POSTURE_OPTIONS.minDwell },
    );
    expect(r.posture).toBe("develop");
    expect(r.reason).toBe("silence-elapsed");
  });

  it("invader-only × prev=war（驻留未满）→ npc-deescalate 立即降 fortify", () => {
    const r = matrixCase({ lastInvaderHostileAt: recent }, { posture: "war", since: tick - 50 });
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("npc-deescalate");
    expect(r.since).toBe(tick); // 姿态变更刷新 since
    expect(r.warPressureTicks).toBe(0);
  });

  it("player × prev=develop → threat-hold-fortify（玩家敌意升级）", () => {
    const r = matrixCase(
      { lastPlayerHostileAt: recent },
      { posture: "develop", since: tick - 500 },
    );
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("threat-hold-fortify");
  });

  it("player × prev=expand → threat-hold-fortify（升级优先于和平姿态）", () => {
    const r = matrixCase({ lastPlayerHostileAt: recent }, { posture: "expand", since: tick - 500 });
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("threat-hold-fortify");
  });

  it("player × prev=fortify（驻留未满耐心）→ 维持 fortify", () => {
    const r = matrixCase(
      { lastPlayerHostileAt: recent },
      { posture: "fortify", since: tick - 100 },
    );
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("threat-hold-fortify");
  });

  it("player × prev=war → war-sustain（维持战争）", () => {
    const r = matrixCase({ lastPlayerHostileAt: recent }, { posture: "war", since: tick - 50 });
    expect(r.posture).toBe("war");
    expect(r.reason).toBe("war-sustain");
    expect(r.expansionAllowed).toBe(false);
  });

  it("mixed × prev=develop → 与 player 一致（threat-hold-fortify）", () => {
    const r = matrixCase(
      { lastInvaderHostileAt: recent, lastPlayerHostileAt: recent },
      { posture: "develop", since: tick - 500 },
    );
    expect(r.posture).toBe("fortify");
    expect(r.reason).toBe("threat-hold-fortify");
  });

  it("mixed × prev=war → 与 player 一致（war-sustain，不降轨）", () => {
    const r = matrixCase(
      { lastInvaderHostileAt: recent, lastPlayerHostileAt: recent },
      { posture: "war", since: tick - 50 },
    );
    expect(r.posture).toBe("war");
    expect(r.reason).toBe("war-sustain");
  });
});

describe("姿态事件码表", () => {
  it("姿态与分支码各自唯一，三元组与线上口径一致", () => {
    const postures = Object.values(POSTURE_EVENT_CODE);
    const branches = Object.values(POSTURE_BRANCH_EVENT_CODE);
    expect(new Set(postures).size).toBe(postures.length);
    expect(new Set(branches).size).toBe(branches.length);
    // 载荷对象经 packer 打包后逐位等于历史 d 列序（码表与 packed 列序一起钉死）
    expect(
      packEventPayload(
        EventKind.PostureTransition,
        postureTransitionEventData("fortify", "develop", "silence-elapsed"),
      ),
    ).toEqual([2, 0, 6]);
    expect(
      packEventPayload(
        EventKind.PostureTransition,
        postureTransitionEventData("(none)", "expand", "peace"),
      ),
    ).toEqual([4, 1, 7]);
  });

  it("npc-deescalate 只追加不重排（码 8），历史分支码不变", () => {
    expect(POSTURE_BRANCH_EVENT_CODE["npc-deescalate"]).toBe(8);
    expect(POSTURE_BRANCH_EVENT_CODE["war-sustain"]).toBe(2);
    expect(POSTURE_BRANCH_EVENT_CODE.peace).toBe(7);
    expect(
      packEventPayload(
        EventKind.PostureTransition,
        postureTransitionEventData("war", "fortify", "npc-deescalate"),
      ),
    ).toEqual([3, 2, 8]);
  });
});
