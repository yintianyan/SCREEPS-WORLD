/**
 * 远矿 container 维修闭环集成场景（RM-2，技术债「远矿 container 维修链缺失」闭环）。
 *
 * 场景还原远矿房的真实衰减环境：
 *   - source s1 (12,12) 旁预置 container（初始 hits 150k = 60%，低于 80% 触发线）；
 *   - containerDecay(1) = 引擎真实衰减率（5000 hits / 5000 tick）；
 *   - 一只 remoteHarvester（1 WORK）站桩采集 — 远矿房无 builder/tower 兜底，
 *     采集者是 container 唯一维护者。
 *
 * 断言（600 tick 内）：
 *   1. container 存活（hits > 0）；
 *   2. 维修净生效：hits > 初始值（600 tick 衰减 600 hits，无维修时终点
 *      149400 < 150000 — 维修链必须补回衰减并净增）；
 *   3. 维修不吞噬产能：source 被持续开采（energy < 3000）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioBuilder, TickRunner, Assertions } from "../framework";
import { CONFIG } from "../../../src/config";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
  // 生产语义：traffic 开启（站桩锚定/意图集中解算都在此路径下）。
  (CONFIG.movement as { trafficManager: boolean }).trafficManager = true;
});

afterAll(() => {
  (CONFIG.movement as { trafficManager: boolean }).trafficManager = false;
});

const ROOM = "W1N1";
const INITIAL_HITS = 150000;

/** 站桩矿工身体：1 work（采 2/tick、修 100 hits/tick）+ 基础移动件。 */
const MINER_BODY = [
  { type: "work" },
  { type: "carry" },
  { type: "move" },
  { type: "move" },
];

describe("远矿 container 维修闭环 — 衰减中自维护，不吞噬产能", () => {
  it("container 在持续衰减下被采集者维护，血量净增且 source 持续开采", () => {
    const world = new ScenarioBuilder(ROOM)
      .rcl(4, 100000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 38)
      .source("s1", 12, 12)
      // source 旁 container（range 1），初始血量 60% — 低于 80% 触发维修。
      .container(13, 12, 0, INITIAL_HITS, "cont-1")
      .containerDecay(1) // 引擎真实衰减率：1 hit/tick
      // regen 0：source 单调下降使「持续开采」可观测（regen ≥ 采集均速时
      // source 恒钉 3000 封顶，断言失效）。3000 初始能量 >> 600 tick 采集量。
      .sourceRegen(0)
      .cpu(10000)
      .preseedRoomState()
      // 采集者站桩矿位（12,13）：距 source 1（采集）、距 container 1（维修射程内）。
      .creep("rh1", "remoteHarvester", 12, 13, MINER_BODY, {
        memory: { remoteTarget: ROOM, sourceId: "s1" },
      })
      .build();

    const container = world.containers.find((c) => c.id === "cont-1")!;
    const source = world.sources.find((s) => s.id === "s1")!;
    expect(container.hits).toBe(INITIAL_HITS);

    const runner = new TickRunner();
    runner.setLoop(loop);
    const result = runner.run(world, 600);

    const assertions = new Assertions(world, result.records);
    // 1. 存活：维修链必须跟上衰减（无维修时 150000 - 600 = 149400，仍存活；
    //    本断言防的是更慢衰减率下的回归）。
    assertions.assertContainersAlive("remote container decay self-repair");
    // 2. 维修净生效：血量高于初始值 — 600 tick 衰减 600 hits 被维修补回并净增
    //    （每 repair tick +100 hits/1 energy，背包 50 → 单轮维修期 +5000 hits）。
    expect(container.hits).toBeGreaterThan(INITIAL_HITS);
    // 3. 维修不吞噬产能：source 持续被开采（3000 → 净下降）。
    expect(source.energy).toBeLessThan(3000);
  });
});
