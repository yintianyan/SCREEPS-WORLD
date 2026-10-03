/**
 * #89 合并链末端：过期 override 不参与合并 ⇒ 有效值回落 CONFIG/DEFAULT。
 *
 * 为什么测这一层而不是跑系统：`empire-strategy` 由 `safeRun` 包住，异常会被吞 ⇒
 * 集成用例可能"绿着什么也没断言"；而且若在用例里手拼合并链，测的就是夹具不是代码。
 * 这里直接调**真正被合并链使用的那个函数**（`resolveStrategyOverrides`），
 * 断言两件事：过滤结果，以及 `{...DEFAULT, ...CONFIG.posture, ...resolved}` 这个真实合并形状。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { resolveStrategyOverrides } from "../../../src/systems/empire/empire-strategy";
import { DEFAULT_POSTURE_OPTIONS } from "../../../src/domain/strategy/posture";
import { STRATEGY_OVERRIDE_TTL_TICKS } from "../../../src/domain/strategy/strategy-reviewer";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

const TICK = 83_391_000;
type Overrides = Record<string, { value: number; adjustedAt: number; reason: string }>;
const writtenAgo = (value: number, ageTicks: number) => ({
  value,
  adjustedAt: TICK - ageTicks,
  reason: "fixture",
});
/** 合并链的真实形状（empire-strategy 里就是这个展开顺序）。 */
const mergedMinDwell = (overrides: Overrides | undefined) =>
  ({ ...DEFAULT_POSTURE_OPTIONS, ...CONFIG.posture, ...resolveStrategyOverrides(overrides, TICK) })
    .minDwell;

describe("#89 — strategyOverrides 在合并链末端的生效/失效", () => {
  it("控制组：新鲜 override 生效并剥掉 `posture.` 前缀（过滤没把活条目一起吃掉）", () => {
    expect(resolveStrategyOverrides({ "posture.minDwell": writtenAgo(999, 0) }, TICK)).toEqual({
      minDwell: 999,
    });
    expect(mergedMinDwell({ "posture.minDwell": writtenAgo(999, 0) })).toBe(999);
  });

  it("过期一条即回落：合并结果取 CONFIG/DEFAULT 值，而不是 override 值", () => {
    const stale = { "posture.minDwell": writtenAgo(999, STRATEGY_OVERRIDE_TTL_TICKS + 1) };
    expect(resolveStrategyOverrides(stale, TICK)).toEqual({});
    expect(mergedMinDwell(stale)).not.toBe(999);
    expect(mergedMinDwell(stale)).toBe({ ...DEFAULT_POSTURE_OPTIONS, ...CONFIG.posture }.minDwell);
  });

  it("混合两条：只摘过期的，新鲜的照常进合并", () => {
    const resolved = resolveStrategyOverrides(
      {
        "posture.minDwell": writtenAgo(999, STRATEGY_OVERRIDE_TTL_TICKS + 1),
        "posture.warPatience": writtenAgo(8000, 0),
      },
      TICK,
    );
    expect(resolved).toEqual({ warPatience: 8000 });
  });

  it("线上现场那两条（`minDwell@82993339`、`warPatience@83287039`）在本拍都判过期", () => {
    expect(
      resolveStrategyOverrides(
        {
          "posture.minDwell": { value: 1400, adjustedAt: 82_993_339, reason: "oscillation" },
          "posture.warPatience": { value: 8000, adjustedAt: 83_287_039, reason: "thrashing" },
        },
        TICK,
      ),
    ).toEqual({});
  });

  it("畸形条目跳过：value 非数字、条目为空", () => {
    const bad = {
      "posture.minDwell": { value: "999", adjustedAt: TICK, reason: "x" },
      "posture.warPatience": undefined,
    } as unknown as Overrides;
    expect(resolveStrategyOverrides(bad, TICK)).toEqual({});
  });

  it("无 override ⇒ 空对象（合并链行为逐字不变）", () => {
    expect(resolveStrategyOverrides(undefined, TICK)).toEqual({});
  });
});
