/**
 * R3 — 跨系统执行顺序契约。
 *
 * 背景：`Kernel` 并不二次排序（`sortedSystems` 只是按 phase / 观测层过滤），
 * 所以一个 tick 内的有效顺序 = Registry 的 priority 升序 + 同优先级靠注册先后。
 * `bootstrap.ts` 的注释里声明了若干"谁必须先于谁"，但**没有任何测试钉住其中任何
 * 一条**：把注册链整体挪到末尾，全仓测试照样全绿（三个独立审计单元都记了这条）。
 *
 * 这里只钉"确实是数据依赖"的边 —— 不复制一份完整长列表，否则每加一个系统都要
 * 改测试，那种测试会被人直接改掉而不是去核对顺序。
 */
import { describe, expect, it } from "vitest";
import { registry } from "../../../src/bootstrap";
import type { System } from "../../../src/kernel/contracts";
import { Registry } from "../../../src/kernel/registry";

const order = registry.getSystems().map(s => s.name);

function pos(name: string): number {
  const i = order.indexOf(name);
  expect(i, `系统 ${name} 不在注册表里（实际：${order.join(", ")}）`).toBeGreaterThanOrEqual(0);
  return i;
}

describe("R3 — bootstrap 声明的运行顺序边", () => {
  const edges: ReadonlyArray<readonly [string, string, string]> = [
    [
      "room-state",
      "spawn-manager",
      "spawn-manager 吃 room-state 同 tick 写的 colonyState/economyPressure",
    ],
    ["room-state", "construction-manager", "发展门禁的 economyPressure 由 room-state 落盘"],
    ["room-state", "recovery-execution", "恢复执行按 colonyState 判驻留/放行"],
    ["logistics", "assignment-service", "物流请求池须先合并进任务槽，否则搬运需求整轮漏掉"],
    ["empire-strategy", "empire-health", "姿态与专业化裁决是健康度维度的输入"],
    ["empire-health", "recovery-execution", "recovery 消费 empire-health 产出的 recoveryActions"],
    ["empire-strategy", "war-planner", "姿态先于战争裁决（war/fortify 决定打不打）"],
    [
      "war-planner",
      "tactical-runtime-pipeline",
      "战术 pipeline（4 阶段合并注册）消费 warPlan 与其目标",
    ],
  ];

  for (const [earlier, later, why] of edges) {
    it(`${earlier} 先于 ${later}`, () => {
      expect(pos(earlier), `${earlier} → ${later} 顺序颠倒：${why}`).toBeLessThan(pos(later));
    });
  }
});

describe("R3 — 排序契约本身", () => {
  it("注册表按 priority 非降序给出系统（P0 一定在 P1/P2/P3 之前）", () => {
    const systems = registry.getSystems();
    for (let i = 1; i < systems.length; i++) {
      expect(systems[i]!.priority).toBeGreaterThanOrEqual(systems[i - 1]!.priority);
    }
  });

  it("同优先级的相对顺序 = 注册先后（tie-break 稳定性，kernel 全靠它）", () => {
    const r = new Registry();
    const a: System = { name: "a-first", priority: 1, run: () => undefined };
    const b: System = { name: "b-second", priority: 1, run: () => undefined };
    const c: System = { name: "c-third", priority: 1, run: () => undefined };
    r.registerSystem(c).registerSystem(a).registerSystem(b);
    // 注册序是 c,a,b 且三者同优先级 —— 排序必须保持这个相对次序。bootstrap 里
    // "在 X 之后运行" 的注释全靠这个稳定性，否则运行期毫无意义。
    expect(r.getSystems().map(s => s.name)).toEqual(["c-third", "a-first", "b-second"]);
  });
});
