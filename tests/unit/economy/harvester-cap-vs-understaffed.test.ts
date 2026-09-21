/**
 * 编制上限 × 欠员判据的冲突 —— 已修（2026-09-21），本文件从"缺陷证据复现"改成"修法守卫"。
 *
 * 冲突面：`CONFIG.roles.harvester.maxCount` 是孵化侧硬顶，而欠员判据原先写成
 * `understaffed = harvesterCount < max(1, sourceCount)` —— 拿编制跟**世界给的 source 数**比。
 * 真实房间普遍 4~6 source，所以 `maxCount < sourceCount` 是常态：这种房把 harvester 孵到顶
 * 也仍然"欠员"，永远停在 bootstrap。而 bootstrap 与 crisis/recovery 同归经济生存带，
 * 生存带又封掉战争授权、扩张健康门、远矿运营 —— **一间资源更好的房，反而永远拿不到正常相位。**
 *
 * 实测触发路径（E2E 夹具把 warRoom 的 source 从 2 补到 5，其余一律不动）：9000 tick 里
 * harvesters 峰值恰好 = maxCount(4)，phase 落在危机带 8730 tick（97%）；srcRatio 强制 crisis
 * 通道的驻留计数 ≥50 持续 8730 tick，而 drain>0 仅 191 tick、liq>0 仅 150 tick。
 * 也就是说把富室钉死在生存带的是两条叠在一起：欠员判据本身，加上 forceCrisis 用"最满
 * source"填充率（欠员时那颗没被派人的 source 必然满 ⇒ 把欠员伪装成采集塌方）。
 *
 * 修法（两条一起，缺一不可）：
 *  - 欠员改成与孵化侧下限同源：`harvesterCount < clamp(minCount, 1, sourceCount)`。
 *    **只按上限截断不够**：实测同一套夹具 2-source 房 growth 2500/2500，而 5-source 房
 *    仍 bootstrap 2489/2500（需求侧自然只保持 ~2 只），反常激励原封不动。
 *  - srcRatio 口径改成**平均**填充率（`averageSourceFillRatio`），room-state 与
 *    tuning-engine 两处生产者共用这一个定义（原先各写一份"取最满"）。
 * "采不动"这层含义仍归 srcRatio + storage 流失的 P0-1 通道，与欠员不重叠。
 */
import { describe, it, expect } from "vitest";
import {
  averageSourceFillRatio,
  DEFAULT_PHASE_OPTIONS,
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

/**
 * 本文件钉的是「欠员判据的轴」（下限 vs source 数）与 srcRatio 的口径，两者都与
 * bootstrap 驻留闸无关 —— 而闸会让单次评估拿不到 bootstrap 标签。所以这里统一用
 * `bootstrapEnterTicks: 1` 把闸拆开，驻留闸本身在 phase.test.ts 有专属用例。
 */
function evalOnce(input: PhaseInput, prev: PhaseState) {
  return evaluateColonyPhase(input, prev, {
    ...DEFAULT_PHASE_OPTIONS,
    bootstrapEnterTicks: 1,
  });
}

describe("欠员判据按编制上限截断（#10-a）", () => {
  it("顶格编制的 5-source 房拿得到 growth —— 旧判据在这里恒判 bootstrap", () => {
    // 这条就是当年那条「缺陷修好时会红」的反向引线，方向已翻正：
    // 若有人把判据改回「人头数 < source 数」，它立刻红。
    const r = evalOnce(healthy(), GROWING);
    expect(r.reserveDelta).toBeGreaterThan(0); // 经济在盈余，不是在失血
    expect(r.drainScore).toBe(0);
    expect(r.liquidityScore).toBe(0);
    expect(r.phase).toBe("growth");
    // 而 CAP 确实低于 source 数 —— 判据不可能靠"孵得下那么多"糊过去。
    expect(CAP).toBeLessThan(REAL_ROOM_SOURCES);
  });

  it("编制没到顶时仍判欠员 —— 截断不等于放弃这条生存判据", () => {
    const r = evalOnce(healthy({ harvesterCount: 1 }), GROWING);
    expect(r.phase).toBe("bootstrap");
  });

  it("欠员与 source 数脱钩：只看最低编制（反常激励的正解）", () => {
    // 2 source 的房（e2e 夹具的常态）：1 只 harvester 仍算欠员。
    expect(evalOnce(healthy({ sourceCount: 2, harvesterCount: 1 }), GROWING).phase).toBe(
      "bootstrap",
    );
    expect(evalOnce(healthy({ sourceCount: 2, harvesterCount: 2 }), GROWING).phase).toBe("growth");
    // 单 source 房：下限被 source 数截断，1 只就算站住人。
    expect(evalOnce(healthy({ sourceCount: 1, harvesterCount: 1 }), GROWING).phase).toBe("growth");
    // 9 source 的房：要的还是最低编制（CAP 只用来证明"顶格"这件事已无关）。
    expect(evalOnce(healthy({ sourceCount: 9, harvesterCount: 2 }), GROWING).phase).toBe("growth");
  });

  it("下限与孵化侧同源（两处脱钩就会重新制造永久 bootstrap）", () => {
    expect(DEFAULT_PHASE_OPTIONS.harvesterMinStaffing).toBe(CONFIG.roles.harvester.minCount);
  });

  it("bootstrap 与 crisis 同落经济生存带（所以这条冲突当年会顺带封掉战争/扩张授权）", () => {
    expect(phaseToColonyState("bootstrap", false)).toBe("bootstrap");
    expect(phaseToColonyState("crisis", false)).toBe("recovery");
    const survival = (cs: string): boolean => cs === "recovery" || cs === "bootstrap";
    expect(survival(phaseToColonyState("bootstrap", false))).toBe(true);
  });
});

describe("srcRatio 改平均口径（#10-b：欠员不再被伪装成采集塌方）", () => {
  const src = (energy: number): { energy: number; energyCapacity: number } => ({
    energy,
    energyCapacity: 3000,
  });

  it("5 source 里 4 颗被采着、1 颗没人派：平均 0.2 ⇒ 不算塌方", () => {
    // 旧口径在这里取最满 = 1.0 ⇒ P0-1 通道常驻，实测 stall 8730/9000 tick。
    const ratio = averageSourceFillRatio([src(0), src(0), src(0), src(0), src(3000)]);
    expect(ratio).toBeCloseTo(0.2, 5);
    expect(ratio).toBeLessThan(DEFAULT_PHASE_OPTIONS.srcRatioTrap);
  });

  it("真塌方（全员 body 退化/死绝）时所有 source 一起满 ⇒ 平均照样越过阈值", () => {
    const ratio = averageSourceFillRatio([src(3000), src(3000), src(3000)]);
    expect(ratio).toBe(1);
    expect(ratio).toBeGreaterThanOrEqual(DEFAULT_PHASE_OPTIONS.srcRatioTrap);
  });

  it("单 source 房：平均 == 最满，灵敏度与旧口径一致", () => {
    expect(averageSourceFillRatio([src(2700)])).toBeCloseTo(0.9, 5);
  });

  it("无 source / 容量异常时给 0 而不是 NaN", () => {
    expect(averageSourceFillRatio([])).toBe(0);
    expect(averageSourceFillRatio([{ energy: 100, energyCapacity: 0 }])).toBe(0);
  });

  it("forceCrisis 仍需要双条件：塌方但不流失 ⇒ 不进危机带", () => {
    // 平均口径放宽了 srcRatio，但 P0-1 通道本就是 srcRatio + storage 流失双条件；
    // 这条钉住"塌方信号单独不再足够"，防止改口径时被顺手放宽成单条件。
    const r = evalOnce(healthy({ srcRatio: 1, storageDrainRate: 0 }), GROWING);
    expect(r.srcStallTicks).toBe(0);
    expect(r.phase).toBe("growth");
  });
});
