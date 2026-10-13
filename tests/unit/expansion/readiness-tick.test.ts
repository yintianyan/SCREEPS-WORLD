/**
 * `expansionDashboard.readinessTick` 的不变量 —— 立案过程见 roadmap #178（commit 0a1be15e）。
 *
 * 为什么需要这一列：仪表盘每拍给自己盖 `tick`，可 `failedGates` 里的闸门值来自 empire-economy
 * 的 heap 缓存（`expansion-planner.ts:47` → `queryEmpirePlannerInput()` → `empire-economy.ts:206/214`）。
 * 两者不同时刻，而缓存的构建拍号以前从没落过盘 ⇒ 读数人无法区分"刚算的"与"旧账"。
 * ⚠️立案时曾用 `kernel.strategy.since` 反推出"闸门值旧 2,251 拍"——那把尺用错了对象（`since` 是**姿态翻档拍**，
 * 不是这个布尔位的成立时刻；作废过程见 roadmap `补294⑥` 与 §3.5 #178）。本列正是它的合法替代尺。
 *
 * 为什么这个文件不直接跑 planner：这一列的**语义**（未知怎么表示、年龄怎么算、两条分支是否同源）
 * 全部可在纯函数与源码形状上钉住；跑一趟 planner 需要整套 EmpireResourceView 夹具，
 * 那部分留给集成面与 e2e 的 claim 链场景（它们已在跑真实管线）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { queryEmpirePlannerInputTick } from "../../../src/systems/empire/empire-economy";

/** 本 boot 里 empire-economy 还没跑过一趟时的标记值（沿用 `unsampledTicks=-1` 的"未知"约定）。 */
const UNKNOWN = -1;

/** 年龄＝仪表盘盖章拍 − 闸门值来源拍。仅当来源拍已知时才有意义。 */
function readinessAge(dashboardTick: number, readinessTick: number): number | null {
  if (readinessTick < 0) return null;
  return dashboardTick - readinessTick;
}

/**
 * 已知情形下取年龄；"不可解释"当场抛错，而不是让 `null` 流进断言。
 * （第一版这里写的是 `readinessAge(...)!`：vitest 运行时全绿，`tsc --noEmit` 却把它判死 ——
 *  类型侧的 null 不该被非空断言吞掉，所以显式收窄。）
 */
function mustAge(dashboardTick: number, readinessTick: number): number {
  const age = readinessAge(dashboardTick, readinessTick);
  if (age === null) throw new Error("来源拍未知 ⇒ 年龄不可解释");
  return age;
}

describe("readinessTick 的语义", () => {
  it("缓存不存在时返回未知标记，且**必须不是 0**", () => {
    // 在本测试的运行环境里，empire-economy 从未跑过任何一趟 ⇒ 拿到的一定是标记值。
    const tick = queryEmpirePlannerInputTick();
    expect(tick).toBe(UNKNOWN);
    // 这一条是本例的全部价值所在：0 是一个**合法拍号**，用它当"未知"会把
    // "没有缓存"伪装成"缓存来自第 0 拍"，于是年龄算式仍然给出一个数，只是那个数是假的。
    expect(tick).not.toBe(0);
  });

  it("标记值下年龄不可解释（返回 null，而不是一个大数）", () => {
    expect(readinessAge(83_617_305, UNKNOWN)).toBeNull();
  });

  it("已知时年龄非负，且缓存越老年龄越大", () => {
    const built = 83_615_034;
    for (const now of [built, built + 27, built + 100, built + 2_251]) {
      const age = mustAge(now, built);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBe(now - built);
    }
    expect(mustAge(built + 2_251, built)).toBeGreaterThan(mustAge(built + 27, built));
  });

  it("常态年龄上限：两系统 interval 都是 100 ⇒ 两个 interval 内必然闭合", () => {
    const INTERVAL = 100;
    const built = 83_615_034;
    // 相位差实测 ≈27（EE≡57、planner≡84），故健康状态下 readinessAge ≤ 2×interval。
    expect(mustAge(built + 27, built)).toBeLessThanOrEqual(2 * INTERVAL);
    // 而"仪表盘很新、闸门值可能很旧"这种形状（立案时无法判定，见文件头那条作废记），只有这一列存在时才量得出来。
    expect(mustAge(built + 2_251, built)).toBeGreaterThan(2 * INTERVAL);
  });
});

describe("readinessTick 的落盘形状", () => {
  const src = readFileSync("src/systems/empire/expansion-planner.ts", "utf8");

  it("两条分支都落这一列（早退分支不能缺席，否则那趟的年龄不可查）", () => {
    const writes = src
      .split("\n")
      .filter(l => l.trim() === "readinessTick: queryEmpirePlannerInputTick(),");
    expect(writes).toHaveLength(2);
  });

  it("落盘的是取值调用，不是常量或 `ctx.tick` 的别名", () => {
    // 若写成 `ctx.tick`，两列恒等、年龄恒为 0，这一列就失去意义 —— 反向实验守的就是这条。
    expect(src).not.toMatch(/readinessTick:\s*ctx\.tick/);
    expect(src).toMatch(/readinessTick:\s*queryEmpirePlannerInputTick\(\)/);
  });

  it("heap 副本里不写这一列（那一侧本就有 cache 的 tick，不该出现两套口径）", () => {
    const heapBlock = src.slice(src.indexOf("g0.expansionDashboard"));
    expect(heapBlock.slice(0, 900)).not.toContain("readinessTick");
  });
});
