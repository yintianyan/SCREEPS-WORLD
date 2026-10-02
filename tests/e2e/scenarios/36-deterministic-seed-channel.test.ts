/**
 * E2E-036 探索种子的注入通路（#62 的端到端那一半）。
 *
 * 为什么必须单独有一例：`#62` 的修复是"让长 soak 可复现"，而它的根因是
 * **bot 跑在 @screeps/driver 的 isolated-vm isolate 里** —— 测试进程替换 `Math.random`
 * 到不了被测物（10-01 实测同 seed 两跑仍分叉）。唯一通道是 bot 的 console 写 Memory。
 * 于是这条通道本身要有人看着：
 *   ① 给了 `E2E_RANDOM_SEED` ⇒ 种子必须真的落到 isolate 里的 `Memory.kernel`（不然"可复现"是假的）；
 *   ② 没给 ⇒ **绝对不许出现**该字段（否则就等于给生产链路悄悄换个随机源，那是我最反对的一类改动）。
 * 两例一起才算这条接缝"有用且无害"。
 *
 * ⚠️边界说清：本例只验**通路**。isolate 里的消费方（`kernel/deterministic-random.ts` 经
 * tuning-engine 注入 exploreParameter）要生效，得是**含该改动的 dist** —— 那由批次4 的全量 e2e 覆盖。
 */
import { afterAll, describe, expect, it } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";

describe("E2E-036 探索种子注入通路（#62）", () => {
  const runners: ScenarioRunner[] = [];

  async function bootWith(seedEnv: string | undefined) {
    const runner = new ScenarioRunner();
    runners.push(runner);
    if (seedEnv === undefined) {
      delete process.env.E2E_RANDOM_SEED;
    } else {
      process.env.E2E_RANDOM_SEED = seedEnv;
    }
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 1)],
      maxTicks: 40,
    });
    // console 命令在下一个 tick 执行 ⇒ 至少跑几拍才谈"落没落到 Memory"
    await runner.runTicks(5);
    const memory = await runner.bot.getMemory();
    return { seed: memory?.kernel?.testRandomSeed, calls: memory?.kernel?.testRandomCalls };
  }

  afterAll(async () => {
    for (const r of runners) {
      try {
        await r.teardown();
      } catch {
        // teardown 失败不影响判定（mockup storage 挂起是已知问题，由 global-setup 兜底）
      }
    }
    delete process.env.E2E_RANDOM_SEED;
  });

  it("未给 E2E_RANDOM_SEED ⇒ bot Memory 里不该出现该字段（无害性）", async () => {
    const { seed } = await bootWith(undefined);
    expect(seed, "没给种子却出现了 testRandomSeed ⇒ 等于偷偷换掉生产的随机源").toBeUndefined();
  }, 180000);

  it("给了 E2E_RANDOM_SEED ⇒ 种子穿过 isolate 落到 Memory.kernel（有用性）", async () => {
    const { seed, calls } = await bootWith("7");
    expect(seed, "种子没落到 isolate 的 Memory ⇒ “可复现”是假的，接缝没接通").toBe(7);
    expect(calls).toBe(0);
  }, 180000);
});
