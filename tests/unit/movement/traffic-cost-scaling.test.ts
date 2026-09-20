/**
 * 交通解算成本标定 — resolveTraffic 的耗时随人口/意图数的增长曲线。
 *
 * 动机：真引擎 E2E-029 实测 traffic-manager 占 0.616 CPU/tick，而它每 tick 只处理约 2.9 个
 * 移动意图。1 CPU ≈ 1 ms，即约 212 µs/意图 —— 解算器本身是否为该成本来源，必须在改算法前
 * 先定责。本基准用纯函数直测，给出各规模下的 µs/调用与增长形态。
 */
import { describe, expect, it } from "vitest";
import {
  resolveTraffic,
  type MoveIntent,
  type ResolveInput,
} from "../../../src/creeps/movement/traffic-resolver";

const pack = (x: number, y: number): number => x * 50 + y;

interface RoomShape {
  /** 意图数。 */
  intents: number;
  /** 房内 creep 总数（含静止者）。 */
  population: number;
  /** 拥挤度：意图目标格被静止 creep 占据的比例 —— 触发推挤链的根源。 */
  congestion: number;
}

/**
 * 构造一个可信的拥挤房间：creep 密集分布在 source 邻域，意图把它们往彼此身上推。
 * shoveCandidates 返回 8 邻域（与 traffic-manager 的 NEIGHBOR_DELTAS 同口径）。
 */
function buildRoom(shape: RoomShape): ResolveInput {
  const { intents, population, congestion } = shape;
  // 以 (20,20) 为中心的 6×6 密集块，模拟双 source 前的聚集。
  const cellAt = (i: number): number => pack(20 + (i % 6), 20 + (Math.floor(i / 6) % 6));
  const occupancy = new Map<number, string>();
  for (let i = 0; i < population; i++) occupancy.set(cellAt(i), `c${i}`);

  const intentList: MoveIntent[] = [];
  const blockedTargets = Math.floor(intents * congestion);
  // 被推挤者必须自己静止（无意图），否则解算器只做跟车等待而非推挤。
  // 因此指向已占格的意图，其出发格取自无意图的静止 creep 所占据的格。
  const stationaryCellAt = (i: number): number =>
    cellAt(intents + (i % Math.max(population - intents, 1)));
  for (let i = 0; i < intents; i++) {
    const from = cellAt(i);
    const to = i < blockedTargets ? stationaryCellAt(i) + 50 : pack(45, 45) + i;
    intentList.push({ name: `c${i}`, from, to, priority: (i % 5) * 10 });
  }

  const anchors = new Map<string, number>();
  for (let i = intents; i < population; i += 3) anchors.set(`c${i}`, 20);

  return {
    intents: intentList,
    anchors,
    occupancy,
    immovable: new Set<string>(),
    shoveCandidates: (tile: number) => {
      const x = Math.floor(tile / 50);
      const y = tile % 50;
      const out: number[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
          out.push(pack(nx, ny));
        }
      }
      return out;
    },
  };
}

/** warm-up + 多次采样取中位数，消除 JIT 抖动（与既有 CPU 基准测试同策略）。 */
function measure(input: ResolveInput, iterations: number): number {
  for (let i = 0; i < 300; i++) resolveTraffic(input);
  const samples: number[] = [];
  for (let s = 0; s < 7; s++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) resolveTraffic(input);
    samples.push(Number(process.hrtime.bigint() - start) / 1e3 / iterations);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

const SHAPES: RoomShape[] = [
  { intents: 3, population: 9, congestion: 0 },
  { intents: 3, population: 9, congestion: 0.6 },
  { intents: 10, population: 30, congestion: 0.6 },
  { intents: 30, population: 60, congestion: 0.6 },
  { intents: 60, population: 100, congestion: 0.8 },
  { intents: 60, population: 100, congestion: 1 },
];

describe("交通解算成本标定 — resolveTraffic 规模曲线", () => {
  const rows = SHAPES.map(shape => ({ shape, us: measure(buildRoom(shape), 2000) }));

  for (const { shape, us } of rows) {
     
    console.log(
      `[TRAFFIC-BENCH] intents=${String(shape.intents).padStart(2)} pop=${String(shape.population).padStart(3)} congestion=${shape.congestion} -> ${us.toFixed(2)} us/call (~${(us / 1000).toFixed(4)} CPU/tick)`,
    );
  }

  it("E2E 实测规模（3 意图 / 9 creep）解算耗时远低于 10 µs", () => {
    const light = rows[0]!;
    // 若这条被打破，说明 0.616 CPU/tick 的来源就在解算器本身，P1 定责直接收敛。
    expect(light.us).toBeLessThan(10);
  });

  it("增长不是病态超线性（60 意图 / 100 creep < 5 ms）", () => {
    const heavy = rows[rows.length - 1]!;
    // 5 ms = 0.005 CPU，相对单房每 tick 预算仍可接受；超出即说明推挤链存在放大。
    expect(heavy.us).toBeLessThan(5000);
  });
});
