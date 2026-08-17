/**
 * war/planning — 战争目标选择纯函数测试。
 *
 * 覆盖：
 *   - 合法目标被选中（普通房 + 有主 + 情报新鲜 + 塔数达标 + 未占用）
 *   - 多候选选通勤最近（pathCost；缺失回退线性距离）
 *   - 过滤：SK 房 / 无主房 / 己方房 / 情报过期 / tower ≥ 上限 / 已被占用
 *   - 无合格目标 → undefined
 *   - decideSquadSize 编队规模
 */
import { describe, expect, it } from "vitest";
import {
  decideSquadSize,
  decideHealerCount,
  evaluateBoostGate,
  evaluateWarOutcome,
  isAttritionLost,
  nextWavePhase,
  selectWarTarget,
  shouldLaunchNuke,
} from "../../../src/domain/war/planning";

const BASE_INPUT = {
  tick: 1000,
  myUsername: "Me",
  freshness: 1500,
  maxTowers: 3,
} as const;

/** 快速构造候选。 */
function candidate(overrides: Partial<{
  roomName: string;
  home: string;
  kind: string;
  owner: string | undefined;
  lastSeen: number;
  towers: number | undefined;
  pathCost: number | undefined;
  occupied: boolean;
}> = {}): any {
  return {
    roomName: "W6N4",
    home: "W7N4",
    kind: "normal",
    owner: "Enemy",
    lastSeen: 900,
    towers: 0,
    pathCost: 400,
    occupied: false,
    ...overrides,
  };
}

describe("selectWarTarget", () => {
  it("合法目标被选中，sponsor = 情报归属的 home", () => {
    const target = selectWarTarget({ ...BASE_INPUT, candidates: [candidate()] });
    expect(target).toEqual({ roomName: "W6N4", sponsor: "W7N4", towersSeen: 0, distance: 400 });
  });

  it("多候选选通勤成本最低者", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ roomName: "W6N5", home: "W7N4", pathCost: 800 }),
        candidate({ roomName: "W6N4", home: "W7N4", pathCost: 400 }),
        candidate({ roomName: "W5N5", home: "W7N4", pathCost: 600 }),
      ],
    });
    expect(target?.roomName).toBe("W6N4");
  });

  it("pathCost 缺失回退线性距离", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ roomName: "W8N8", pathCost: undefined }), // 距 W7N4 较远
        candidate({ roomName: "W6N4", pathCost: undefined }), // 距 W7N4 最近
      ],
    });
    // 线性距离更近的 W6N4 应胜出。
    expect(target?.roomName).toBe("W6N4");
  });

  it("过滤 SK / center / highway 房", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ roomName: "W5N5", kind: "sk" }), // 双 5 → sk
        candidate({ roomName: "W6N4", kind: "center" }),
      ],
    });
    expect(target).toBeUndefined();
  });

  it("过滤无主房（owner undefined）", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [candidate({ owner: undefined })],
    });
    expect(target).toBeUndefined();
  });

  it("过滤己方房（owner === myUsername）", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [candidate({ owner: "Me" })],
    });
    expect(target).toBeUndefined();
  });

  it("过滤情报过期目标（超过 freshness 窗口）", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ lastSeen: 1000 - 1600 }), // 距今 1600 > 1500
        candidate({ roomName: "W6N5", lastSeen: 900 }), // 新鲜
      ],
    });
    expect(target?.roomName).toBe("W6N5");
  });

  it("过滤 tower 数 ≥ 上限的目标", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      maxTowers: 3,
      candidates: [
        candidate({ towers: 1 }),
        candidate({ roomName: "W6N5", towers: 3 }), // 3 ≥ 3 → 不可攻击
        candidate({ roomName: "W5N4", towers: 2 }), // 有塔但允许 → 追加编队
      ],
    });
    expect(target?.roomName).toBe("W6N4"); // towers=1 更近（第一个候选仍是 400 路径）
  });

  it("过滤已被我方占用的房", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ occupied: true }),
        candidate({ roomName: "W6N5", occupied: false }),
      ],
    });
    expect(target?.roomName).toBe("W6N5");
  });

  it("无合格目标 → undefined", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ owner: undefined }),
        candidate({ kind: "sk" }),
        candidate({ occupied: true }),
      ],
    });
    expect(target).toBeUndefined();
  });
});

describe("decideSquadSize", () => {
  it("无 tower 基数；有 tower 追加", () => {
    expect(decideSquadSize(0, 3, 2)).toBe(3);
    expect(decideSquadSize(1, 3, 2)).toBe(5);
    expect(decideSquadSize(3, 3, 2)).toBe(5);
  });
});

describe("decideHealerCount — heal-tank 治疗配比", () => {
  it("正常：每 2 编制位 1 奶（向上取整）", () => {
    // 编制 3（无塔基数）→ ceil(3/2) = 2；编制 5（1 塔）→ ceil(5/2) = 3。
    expect(decideHealerCount(3, 2)).toBe(2);
    expect(decideHealerCount(5, 2)).toBe(3);
  });

  it("边界：至少 1 个 — 最小编制也有奶", () => {
    expect(decideHealerCount(1, 2)).toBe(1);
    expect(decideHealerCount(2, 2)).toBe(1);
  });

  it("异常：非正编制防御性回 1（不应发生，防 0 奶编队静默送死）", () => {
    expect(decideHealerCount(0, 2)).toBe(1);
    expect(decideHealerCount(-3, 2)).toBe(1);
  });
});

describe("R4 — 失败目标黑名单过滤", () => {
  it("黑名单冷却期内的目标被剔除", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      blacklist: { W6N4: 2000 },
      candidates: [
        candidate(), // W6N4，冷却至 2000 > tick 1000 → 剔除
        candidate({ roomName: "W6N5", pathCost: 800 }), // 次优但合格
      ],
    });
    expect(target?.roomName).toBe("W6N5");
  });

  it("黑名单已到期的目标恢复资格", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      blacklist: { W6N4: 900 }, // 900 ≤ 1000 已到期
      candidates: [candidate()],
    });
    expect(target?.roomName).toBe("W6N4");
  });

  it("无黑名单输入时行为不变（可选参数）", () => {
    const target = selectWarTarget({ ...BASE_INPUT, candidates: [candidate()] });
    expect(target?.roomName).toBe("W6N4");
  });
});

describe("R4 — nextWavePhase 波次相位迟滞", () => {
  it("build：满编才 advance；未满编保持 build", () => {
    expect(nextWavePhase("build", 3, 3, 0.5)).toBe("advance");
    expect(nextWavePhase("build", 2, 3, 0.5)).toBe("build");
    expect(nextWavePhase("build", 0, 3, 0.5)).toBe("build");
  });

  it("advance：低于 regroupRatio × squadSize 才回落 build（迟滞不抖动）", () => {
    expect(nextWavePhase("advance", 1, 3, 0.5)).toBe("build"); // 1 < 1.5
    expect(nextWavePhase("advance", 2, 3, 0.5)).toBe("advance"); // 2 ≥ 1.5
    expect(nextWavePhase("advance", 3, 3, 0.5)).toBe("advance");
  });
});

describe("boost 战前强化 — nextWavePhase boost 门禁", () => {
  it("满编 + boostReady=false（未全员强化）→ 保持 build 集结", () => {
    expect(nextWavePhase("build", 5, 5, 0.5, false)).toBe("build");
  });

  it("满编 + boostReady=true（全员强化）→ advance", () => {
    expect(nextWavePhase("build", 5, 5, 0.5, true)).toBe("advance");
  });

  it("满编 + boostReady=undefined（降级豁免）→ advance", () => {
    // 缺省参数（旧调用方）与显式 undefined 同义 — 门禁不改变既有行为。
    expect(nextWavePhase("build", 5, 5, 0.5, undefined)).toBe("advance");
    expect(nextWavePhase("build", 5, 5, 0.5)).toBe("advance");
  });

  it("未满编时门禁无关紧要（live 优先判）→ build", () => {
    expect(nextWavePhase("build", 3, 5, 0.5, true)).toBe("build");
    expect(nextWavePhase("build", 3, 5, 0.5, false)).toBe("build");
  });

  it("advance 回落判定不受 boost 门禁影响（重组不卡强化）", () => {
    expect(nextWavePhase("advance", 2, 5, 0.5, false)).toBe("build");
    expect(nextWavePhase("advance", 3, 5, 0.5, false)).toBe("advance");
  });
});

describe("boost 战前强化 — evaluateBoostGate 门禁降级", () => {
  it("全员强化（boosted ≥ live）→ true", () => {
    expect(evaluateBoostGate(5, 5, true, false)).toBe(true);
    expect(evaluateBoostGate(6, 5, true, false)).toBe(true);
  });

  it("未全员强化 → false", () => {
    expect(evaluateBoostGate(4, 5, true, false)).toBe(false);
    expect(evaluateBoostGate(0, 5, true, false)).toBe(false);
  });

  it("sponsor 无 lab（canBoost=false）→ undefined 豁免（裸攻由止损链兜底）", () => {
    expect(evaluateBoostGate(0, 5, false, false)).toBeUndefined();
    // 已强化与否不影响豁免结论。
    expect(evaluateBoostGate(5, 5, false, false)).toBeUndefined();
  });

  it("宽限期过（graceExpired）→ undefined 豁免（防缺矿房永久卡死 build）", () => {
    expect(evaluateBoostGate(0, 5, true, true)).toBeUndefined();
  });
});

describe("R4 — isAttritionLost 战损止损", () => {
  it("spawned 超过 squadSize × 倍数 → 止损；边界值不触发", () => {
    expect(isAttritionLost(8, 3, 2.5)).toBe(true); // 8 > 7.5
    expect(isAttritionLost(7, 3, 2.5)).toBe(false); // 7 ≤ 7.5
    expect(isAttritionLost(3, 3, 2.5)).toBe(false); // 满编未超
  });
});

describe("R4 — evaluateWarOutcome 战后核验", () => {
  it("情报过期（lastSeen 超出 freshness）→ unknown", () => {
    expect(evaluateWarOutcome(2, 0, "Enemy", 1000 - 1600, 1000, 1500)).toBe("unknown");
    expect(evaluateWarOutcome(2, 0, "Enemy", undefined, 1000, 1500)).toBe("unknown");
  });

  it("敌人弃房（owner 消失）→ success", () => {
    expect(evaluateWarOutcome(0, 0, undefined, 900, 1000, 1500)).toBe("success");
  });

  it("目标本有塔网且已清零 → success", () => {
    expect(evaluateWarOutcome(2, 0, "Enemy", 900, 1000, 1500)).toBe("success");
  });

  it("塔网尚存 / 敌主仍在 → failure", () => {
    expect(evaluateWarOutcome(2, 1, "Enemy", 900, 1000, 1500)).toBe("failure");
    // 无塔目标（towersSeen=0）：胜利唯一途径是敌人弃房。
    expect(evaluateWarOutcome(0, 0, "Enemy", 900, 1000, 1500)).toBe("failure");
  });
});

describe("nuker 战略威慑 — shouldLaunchNuke 发射判定", () => {
  /** 基准：满装填无冷却、无在途、塔数达标、射程内 → 授权发射。 */
  const NUKE_BASE = {
    nukerReady: true,
    nukesInFlightToTarget: 0,
    towersSeen: 2,
    towerThreshold: 2,
    linearDistance: 5,
    maxRange: 10,
  } as const;

  it("全条件满足 → true", () => {
    expect(shouldLaunchNuke({ ...NUKE_BASE })).toBe(true);
  });

  it("nuker 未就绪（未满装填或冷却中）→ false（发射必返错，白跑）", () => {
    expect(shouldLaunchNuke({ ...NUKE_BASE, nukerReady: false })).toBe(false);
  });

  it("同目标已有在途核弹 → false（重叠发射只是把当量堆在同一片废墟上）", () => {
    expect(shouldLaunchNuke({ ...NUKE_BASE, nukesInFlightToTarget: 1 })).toBe(false);
  });

  it("塔数低于门槛 → false（轻防目标地面编队足够，核弹留给重防）", () => {
    expect(shouldLaunchNuke({ ...NUKE_BASE, towersSeen: NUKE_BASE.towerThreshold - 1 })).toBe(false);
  });

  it("超射程 → false（保守预检，细判交给 launchNuke 返回码）", () => {
    expect(shouldLaunchNuke({ ...NUKE_BASE, linearDistance: NUKE_BASE.maxRange + 1 })).toBe(false);
    // 恰在射程边界 → 放行。
    expect(shouldLaunchNuke({ ...NUKE_BASE, linearDistance: NUKE_BASE.maxRange })).toBe(true);
  });
});