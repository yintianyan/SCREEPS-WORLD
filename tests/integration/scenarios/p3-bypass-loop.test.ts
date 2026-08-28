/**
 * P3 饥饿旁路（E2）整环集成测试。
 *
 * 验证自愈闭环全链（真实 kernel 循环 + 真实注册系统）：
 *   ①前馈预测硬拒（cpuMax10 触顶）→ P2+/P3 全拒 → P3 系统 lastRun 停摆
 *   ②E2 期望自检检出 P3 饥饿 → 记 ExpectationViolation + 置 p3StarveBypassUntil
 *   ③旁路生效：scheduler 跳过前馈拒绝 → P3 系统复活运行
 *   ④telemetry-collector 以真实用量刷新 cpuAvg10/cpuMax10 → 前馈窗口回落
 *   ⑤E2 违例清除 → 旁路标志撤销（自愈闭环收口）
 *
 * 编排约束：TickRunner.run() 每次调用会 installGlobals() 重建 Memory ——
 * 所有状态注入必须在单次 run 内经 onTick 回调按 tick 相位完成。
 * 旁路守卫语义（bucket ≥ 3000 才生效）由 scheduler 单测覆盖，此处不重复。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import { registry } from "../../../src/bootstrap";
import { globalCache } from "../../../src/kernel/global-cache";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

const g = () => globalThis as any;

describe("P3 饥饿旁路（E2）— 自愈闭环", () => {
  it("前馈硬拒致 P3 停摆 → E2 检出置旁路 → P3 复活刷新窗口 → 违例清除旁路撤销", () => {
    const world = new ScenarioBuilder("W1N1")
      .rcl(3, 50000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 35)
      .source("s1", 15, 15)
      .source("s2", 35, 15)
      .sourceRegen(10)
      .containerDecay(0)
      .cpu(10000)
      .preseedRoomState()
      .build();

    const p3Names = registry
      .getSystems()
      .filter((s) => s.priority === 3)
      .map((s) => s.name);
    expect(p3Names.length, "注册表中应存在 P3 系统").toBeGreaterThan(0);

    const WARM = 60;
    const STARVE = 3;
    const RECOVER = 1100;
    const TOTAL = WARM + STARVE + RECOVER;

    /** 饥饿相位观测（onTick 内收集，run 结束后断言）。 */
    let captured: { violations: string[]; bypass: number; tick: number } | undefined;
    let injected = false;

    const runner = new TickRunner();
    runner.setLoop(loop);
    runner.run(world, TOTAL, {
      onTick: (w, t) => {
        if (t === 1) {
          // TestWorld 预置 sv=4 + legacy phase 字符串会让迁移链每 tick 中断——
          // 本测试按当前 schema 起步，禁用迁移链。
          g().Memory.schemaVersion = 43;
          // E5 rclStale 的年龄基准（fixture 无真实升级流，补种为刚变化）。
          g().Memory.rooms.W1N1.lastRcl = g().Game.time;
        }
        if (t === WARM) {
          // ── 注入饥饿态（对下一 tick 生效）──
          // 前馈窗口触顶：hardLimit = min(20*ratio, 20-0.8) < 19.5 → P2+ 硬拒。
          g().Memory.kernel.stats = {
            ...(g().Memory.kernel.stats ?? {}),
            cpuMax10: 19.5,
            cpuAvg10: 18,
          };
          // boot 宽限与 P3 停摆宽限均已远超（E2 立即生效）。
          g().Memory.kernel.bootTick = (g().Game.time as number) - 6000;
          const stale = globalCache().systemLastRun ?? {};
          for (const name of p3Names) stale[name] = (g().Game.time as number) - 9999;
          globalCache().systemLastRun = stale;
          injected = true;
        }
        if (injected && t === WARM + STARVE) {
          // 饥饿已发生数 tick：E2 应已检出并置旁路。
          captured = {
            violations: [...(g().Memory.kernel.expectations?.violations ?? [])],
            bypass: g().Memory.kernel.p3StarveBypassUntil as number,
            tick: g().Game.time as number,
          };
        }
      },
    });

    // ── 断言 ①②：E2 检出 + 旁路置位 ──
    expect(injected, "饥饿注入应已执行").toBe(true);
    expect(captured, "onTick 编排应捕获饥饿相位状态（tick 数不足）").toBeDefined();
    const cap = captured!;
    expect(
      cap.violations.some((v) => v.startsWith("p3Starved:")),
      `E2 应检出 P3 饥饿，实际违例: ${JSON.stringify(cap.violations)}`,
    ).toBe(true);
    expect(
      cap.bypass,
      "E2 检出后应置 p3StarveBypassUntil（前馈旁路窗口）",
    ).toBeGreaterThan(cap.tick);

    // ── 断言 ③④：旁路生效 → P3 复活 + 前馈窗口回落 ──
    const lastRun = globalCache().systemLastRun ?? {};
    for (const name of p3Names) {
      expect(
        lastRun[name] as number,
        `旁路生效后 P3 系统 ${name} 应恢复运行（lastRun 刷新）`,
      ).toBeGreaterThan(100000 + WARM);
    }
    const stats = g().Memory.kernel.stats;
    expect(
      stats?.cpuMax10,
      "telemetry 复活后 cpuMax10 应回落（真实用量远低于触顶值 19.5）",
    ).toBeLessThan(19.5);

    // ── 断言 ⑤：违例清除 → 旁路撤销 ──
    expect(
      g().Memory.kernel.expectations?.violations ?? [],
      `E2 违例应清空: ${JSON.stringify(g().Memory.kernel.expectations?.violations)}`,
    ).toEqual([]);
    expect(
      g().Memory.kernel.p3StarveBypassUntil,
      "P3 饥饿解除后旁路标志应被撤销（不留常开旁路）",
    ).toBeUndefined();
  });
});
