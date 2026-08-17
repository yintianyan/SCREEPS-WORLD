/**
 * 远矿锁死自愈集成场景（R12，线上 W36S58/W37S57 产能损失复现）。
 *
 * 场景还原「两人挤一源、另一源空缺」的真实机制：
 *   - source s1 (12,12) 的 8 个相邻格中 7 个是地形墙，唯一开口 (13,12)；
 *   - 两只 remoteHarvester 都绑定 s1（同 tick 首绑哈希碰撞的线上形态）；
 *   - rh1 已站桩唯一矿位开采，rh2 到达后距离 2 格、永远够不到 s1 —
 *     旧实现下 rh2 终身锁死，s2 无人开采；
 *   - 修复后：rh2 连续卡位（stuck≥3）触发改绑自愈 → 改绑无主 source s2 →
 *     双源同时被开采。
 *
 * 顺带锁定第二条产能链：rh2 满载后 work 链必须能走到 dropEnergy（R12 补丁 —
 * stationaryMine 满载且无 container 时让位），否则满载永久停摆、s2 停止下探。
 *
 * 注意：集成环境 setup 默认关闭 trafficManager（存量单测行为），本场景显式
 * 开启并在 afterAll 恢复 — 生产语义（意图账本+集中解算+站桩锚定）才是
 * 本次修复的运行环境。
 *
 * 断言（400 tick 内）：
 *   1. rh2.memory.sourceId 由 s1 改为 s2（改绑发生）；
 *   2. s2.energy < 3000（空缺源恢复开采）；
 *   3. s1.energy < 3000（唯一矿位持续开采，无回归）。
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
  // 恢复集成环境默认（setup 关闭），不影响其他场景测试。
  (CONFIG.movement as { trafficManager: boolean }).trafficManager = false;
});

const ROOM = "W1N1";

/** 站桩矿工身体：1 work 采 2/tick + 基础移动件。 */
const MINER_BODY = [
  { type: "work" },
  { type: "carry" },
  { type: "move" },
  { type: "move" },
];

describe("远矿锁死自愈 — 双绑同一源 → 改绑空缺源 → 双源全开采", () => {
  it("rh2 从锁死中改绑 s2，双源恢复开采", () => {
    const world = new ScenarioBuilder(ROOM)
      .rcl(4, 100000)
      .flat()
      .spawn("Spawn1", 25, 25)
      .controllerAt(30, 38)
      .source("s1", 12, 12)
      .source("s2", 35, 15)
      // s1 的 8 个相邻格封死 7 个，只留 (13,12) 一个矿位。
      .walls([
        { x: 11, y: 11 }, { x: 12, y: 11 }, { x: 13, y: 11 },
        { x: 11, y: 12 }, { x: 11, y: 13 }, { x: 12, y: 13 }, { x: 13, y: 13 },
      ])
      .sourceRegen(1) // 采 2/tick > 再生 1/tick → 能量净下降，可观测开采
      .cpu(10000)
      .preseedRoomState()
      // rh1：已站桩唯一矿位，绑定 s1。
      .creep("rh1", "remoteHarvester", 13, 12, MINER_BODY, {
        memory: { remoteTarget: ROOM, sourceId: "s1" },
      })
      // rh2：双绑 s1，从远处入房 — 到达后矿位被占、地形封死，锁死。
      .creep("rh2", "remoteHarvester", 20, 20, MINER_BODY, {
        memory: { remoteTarget: ROOM, sourceId: "s1" },
      })
      .build();

    const s1 = world.sources.find((s) => s.id === "s1")!;
    const s2 = world.sources.find((s) => s.id === "s2")!;
    expect(s1.energy).toBe(3000);
    expect(s2.energy).toBe(3000);

    const runner = new TickRunner();
    runner.setLoop(loop);
    const result = runner.run(world, 400);

    const assertions = new Assertions(world, result.records);
    assertions.assertNoRuntimeError("remote lockout selfheal");

    const rh2 = world.creeps.find((c) => c.name === "rh2")!;
    // 1. 改绑发生：rh2 放弃锁死的 s1，改绑空缺的 s2。
    expect(rh2.memory.sourceId).toBe("s2");
    // 2. 空缺源恢复开采（3000 → 净下降）。
    expect(s2.energy).toBeLessThan(3000);
    // 3. 唯一矿位持续开采，无回归。
    expect(s1.energy).toBeLessThan(3000);
  });
});
