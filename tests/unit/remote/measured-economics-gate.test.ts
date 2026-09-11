/** 实测经济门测试（P3）— 用真实账本净营收收缩亏损远矿线。 */
import { beforeEach, describe, expect, it } from "vitest";
import { enforceMeasuredEconomics } from "../../../src/systems/remote-mining-manager";
import { setRemoteOpLedger } from "../../../src/kernel/global-cache";
import { emptyOpLedger } from "../../../src/domain/remote/op-ledger";
import { selectRemoteTargets } from "../../../src/domain/remote/targeting";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

const HOME = "W7N4";
const TARGET = "W7N3";
/** resetGlobals 固定的 Game.time。 */
const NOW = 1000;
/** 一个「已过承诺期」的 op 起点。 */
const MATURE_START = NOW - CONFIG.remote.minDuration - 1;

function makeOp(over?: Partial<RemoteOp>): RemoteOp {
  return {
    state: "active",
    createdAt: MATURE_START,
    lastSeen: NOW,
    ...over,
  } as RemoteOp;
}

/** 播种 heap 账本（窗口起点默认与 op 同起，即终身均值口径）。 */
function seedLedger(over: {
  delivered?: number;
  spawnCost?: number;
  refund?: number;
  infraCost?: number;
  windowStart?: number;
}): void {
  const l = emptyOpLedger(over.windowStart ?? MATURE_START);
  l.delivered = over.delivered ?? 0;
  l.spawnCost = over.spawnCost ?? 0;
  l.refund = over.refund ?? 0;
  l.infraCost = over.infraCost ?? 0;
  setRemoteOpLedger(HOME, TARGET, l);
}

beforeEach(() => {
  resetGlobals();
});

describe("enforceMeasuredEconomics — 实测亏损收缩", () => {
  it("承诺期内不判经济（投入已付、交付未到，判亏会误杀每个新点）", () => {
    const ops = { [TARGET]: makeOp({ createdAt: NOW - 100 }) };
    seedLedger({ delivered: 10, spawnCost: 5000 }); // 严重亏损

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("active");
    expect(ops[TARGET]?.dangerUntil).toBeUndefined();
  });

  it("过承诺期且净营收为负 → 废弃 + 候选冷却", () => {
    const ops = { [TARGET]: makeOp() };
    seedLedger({ delivered: 100, spawnCost: 5000 }); // net −4900

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("abandoned");
    expect(ops[TARGET]?.dangerUntil).toBe(NOW + CONFIG.remote.econCooldown);
  });

  it("净营收为正但低于下限（白干）也废弃", () => {
    const ops = { [TARGET]: makeOp() };
    // net = 5100 − 5000 = 100，窗口 ~5000 tick → rate ≈ 0.02 < closeNetRate(0.5)
    seedLedger({ delivered: 5100, spawnCost: 5000, windowStart: NOW - 5000 });

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("abandoned");
  });

  it("净营收达标 → 保持运营", () => {
    const ops = { [TARGET]: makeOp() };
    seedLedger({ delivered: 20000, spawnCost: 5000, windowStart: NOW - 5000 }); // rate = 3.0

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("active");
    expect(ops[TARGET]?.dangerUntil).toBeUndefined();
  });

  it("回收返还冲销投入后达标 → 不废弃（回收型轮换不是亏损）", () => {
    const ops = { [TARGET]: makeOp() };
    // 孵化 5000、回收返还 4900、交付 600 → net = 600 − 100 = 500，rate = 0.1 … 仍低于下限
    // 改用更大交付：交付 10000 → net = 9900，rate ≈ 1.98
    seedLedger({ delivered: 10000, spawnCost: 5000, refund: 4900, windowStart: NOW - 5000 });

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("active");
  });

  it("从未交付 → 不判经济（属「运不回来」，归空转止损）", () => {
    const ops = { [TARGET]: makeOp() };
    seedLedger({ delivered: 0, spawnCost: 5000 });

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("active");
  });

  it("无账本 → 跳过（尚未播种，不下结论）", () => {
    const ops = { [TARGET]: makeOp() };

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("active");
  });

  it("非 active 的 op 不被本门改写", () => {
    const ops = { [TARGET]: makeOp({ state: "paused" }) };
    seedLedger({ delivered: 10, spawnCost: 5000 });

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("paused");
    expect(ops[TARGET]?.dangerUntil).toBeUndefined();
  });

  it("多 op 隔离：只废弃亏损的那条", () => {
    const other = "W7N5";
    const ops = { [TARGET]: makeOp(), [other]: makeOp() };
    seedLedger({ delivered: 100, spawnCost: 5000 });

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[TARGET]?.state).toBe("abandoned");
    expect(ops[other]?.state).toBe("active"); // 无账本 → 不动
  });

  it("废弃后冷却期内该房不再被评选（防开→废抖动）", () => {
    const ops = { [TARGET]: makeOp() };
    seedLedger({ delivered: 100, spawnCost: 5000 });
    enforceMeasuredEconomics(ops, HOME, NOW);
    expect(ops[TARGET]?.state).toBe("abandoned");

    const picked = selectRemoteTargets({
      homeRoom: HOME,
      intel: {
        [TARGET]: {
          kind: "normal",
          status: "normal",
          lastSeen: NOW,
          sources: 2,
          pathCost: 60, // 近房高分 — 静态门本来会立刻重开
        },
      } as never,
      existingOps: ops,
      tick: NOW,
      staleThreshold: CONFIG.remote.staleThreshold,
      haulerCapacity: 600,
      myUsername: "me",
    });

    expect(picked.find(c => c.roomName === TARGET)).toBeUndefined();
  });
});
