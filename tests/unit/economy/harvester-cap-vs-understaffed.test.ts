/**
 * 编制上限 × 欠员判据的冲突（已知缺陷的证据复现；修好任一侧都要回来改本文件）。
 *
 * 冲突面：`CONFIG.roles.harvester.maxCount` 是孵化侧的硬顶，而相位机的欠员判据
 * `understaffed = harvesterCount < max(1, sourceCount)` 拿它和**世界给的 source 数**比。
 * 真实房间普遍 4~6 个 source，所以 `maxCount < sourceCount` 是常态而非边缘：这种房子
 * 把 harvester 孵到顶也仍然"欠员"，于是永远停在 bootstrap。而 bootstrap 与 crisis/recovery
 * 一样被 `phaseToColonyState` 归入经济生存带，生存带又封掉战争授权、扩张健康门、远矿运营 ——
 * 换句话说：**一间资源更好的房，反而永远拿不到"正常相位"的资格。**
 *
 * 实测触发路径（E2E 夹具把 warRoom 的 source 从 2 补到 5，其余一律不动）：9000 tick 里
 * harvesters 峰值恰好 = maxCount(4)，phase 落在危机带 8730 tick（97%）；其中 srcRatio
 * 强制 crisis 通道的驻留计数 ≥50 持续 8730 tick，而 drain>0 仅 191 tick、liq>0 仅 150 tick。
 * 即把富室钉死在生存带的既不是赤字也不是物流，而是"欠员"这条判据本身（外加 forceCrisis
 * 用"最满 source"的填充率，欠员时那个没开发的 source 必然满，于是把欠员伪装成采集塌方）。
 *
 * 修法选项（都属领域决策，未擅自改 src）：
 *  1. 抬 `maxCount` 到真实房间的 source 数级（≥6）；
 *  2. 欠员判据从"人头数 < source 数"改成吞吐口径 —— 1 只 4W 的 harvester 轮询 2 个 source
 *     是够用的，现判据等于假设 1 harvester 只能喂 1 source；
 *  3. `srcRatio` 改用多数/平均 source 填充率，并给 forceCrisis 加"储备未在涨"前提，
 *     让欠员照实显示为 bootstrap 而不是被伪装成塌方。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateColonyPhase,
  phaseToColonyState,
  type PhaseInput,
  type PhaseState,
} from "../../../src/domain/economy/phase";
import { CONFIG } from "../../../src/config";

const CAP = CONFIG.roles.harvester.maxCount;
/** 真实房间的常见 source 数（Screeps 房间普遍 4~6 个）。 */
const REAL_ROOM_SOURCES = 5;

/** 一间"什么都健康"的房：储备在涨、口袋满、container 空、无采集塌方。 */
function healthy(overrides: Partial<PhaseInput> = {}): PhaseInput {
  return {
    reserve: 120000,
    spendable: 120000,
    spendableRatio: 1,
    frozenRatio: 0,
    harvesterCount: CAP,
    sourceCount: REAL_ROOM_SOURCES,
    rcl: 6,
    srcRatio: 0,
    storageDrainRate: 0,
    storageRatio: 0.12,
    ...overrides,
  };
}

const GROWING: PhaseState = {
  phase: "growth",
  prevReserve: 119000,
  drainScore: 0,
  liquidityScore: 0,
};

describe("编制上限与欠员判据互斥（harvester.maxCount vs understaffed）", () => {
  it("顶格编制的 5-source 房：储备在涨、口袋满、无塌方，仍判 bootstrap", () => {
    const r = evaluateColonyPhase(healthy(), GROWING);
    expect(r.reserveDelta).toBeGreaterThan(0); // 经济在盈余，不是在失血
    expect(r.drainScore).toBe(0);
    expect(r.liquidityScore).toBe(0);
    expect(r.srcStallTicks).toBe(0);
    expect(r.phase).toBe("bootstrap");
  });

  it("同一间房只多一只 harvester 就回 growth —— 判据看人头，不看吞吐", () => {
    const r = evaluateColonyPhase(healthy({ harvesterCount: REAL_ROOM_SOURCES }), GROWING);
    expect(r.phase).toBe("growth");
  });

  it("bootstrap 与 crisis 同落经济生存带（所以这条冲突会顺带封掉战争/扩张授权）", () => {
    expect(phaseToColonyState("bootstrap", false)).toBe("bootstrap");
    expect(phaseToColonyState("crisis", false)).toBe("recovery");
    // posture 的 anyRecovery 口径：两者都算"打不起战争"。
    const survival = (cs: string): boolean => cs === "recovery" || cs === "bootstrap";
    expect(survival(phaseToColonyState("bootstrap", false))).toBe(true);
  });

  it("缺陷修好时这一条会红 —— 逼回来更新本文件", () => {
    // 今天成立：顶格编制仍小于真实房间的 source 数，所以顶格即欠员。
    expect(CAP).toBeLessThan(REAL_ROOM_SOURCES);
  });
});
