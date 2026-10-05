/**
 * 遗留物回收账本（#131 的 C1/C2）——「零头那一支到底跑没跑」必须被记下来。
 *
 * 立案理由（见 CAPABILITY-MATRIX §23 / 巡检 R345 补）：`pickup.ts` 里
 * 「大额遗留值得专程，零头由链尾无阈值实例顺手清理」是**注释里的设计意图**，不是执行证据。
 * 引擎的掉落衰减律 `ceil(amount/1000)/拍` 与小堆**相对**寿命成反比，而排序键是"最多者优先"，
 * 于是"缓解是否真在跑"直接决定该不该改排序——但今天两个链位混在一列里，
 * 「阈值档什么都没筛掉」与「兜底档从没跑过」长得一模一样。这份账本分桶量它们。
 *
 * 只测仪器，不改行为：下面每一支都断言"选中/放弃的是同一个目标"，
 * 以及自洽闭合式成立（闭合式不成立＝仪器坏了，不是世界变了）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lootRemains } from "../../../src/creeps/engine/actions/pickup";
import { remainsBlindCounters, remainsLootBucket } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;

/** 遗留物夹具：容量可设，矿物存量单独一档。 */
function remains(capacity: number, opts: { mineral?: number } = {}): any {
  const amounts: Record<string, number> = {};
  const energy = capacity - (opts.mineral ?? 0);
  if (energy > 0) amounts[RESOURCE_ENERGY] = energy;
  if (opts.mineral) amounts["OH"] = opts.mineral;
  // 真 store 的键就是资源名（`Object.keys(store)` 要能枚举出来），
  // 所以 getUsedCapacity 必须做成**不可枚举**——否则它自己会被当成一种资源。
  const store: any = { ...amounts };
  Object.defineProperty(store, "getUsedCapacity", {
    value: (res?: string) => (res === undefined ? capacity : (amounts[res] ?? 0)),
    enumerable: false,
  });
  return { pos: { x: 10, y: 10, roomName: "W37S58" }, store };
}

/** creep 站在 (0,0)；range 一律算作 1（在脚边），便于断言"最多者优先"选中了谁。 */
function acOf(opts: { tombstones?: any[]; ruins?: any[]; storage?: any; terminal?: any }): any {
  return {
    creep: {
      room: { name: "W37S58" },
      pos: { getRangeTo: () => 1, findClosestByRange: (list: any[]) => list[0] },
      store: { getFreeCapacity: vi.fn(() => 500) },
      memory: {},
      withdraw: vi.fn(() => OK),
    },
    snapshot: {
      tombstones: opts.tombstones ?? [],
      ruins: opts.ruins ?? [],
      storage: opts.storage,
      terminal: opts.terminal,
    },
  };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  g().remainsLootLedger = undefined;
  g().remainsBlindLedger = undefined;
});

describe("remainsLootBucket — 建行必须是完整零行（旧条目缺键会被 += 写成 NaN）", () => {
  it("首次建行三列齐、且同房同桶取回同一对象", () => {
    const b = remainsLootBucket("W37S58", 500);
    expect(Object.keys(b).sort()).toEqual(
      [
        "belowThreshold",
        "eligible",
        "executed",
        "resolved",
        "seen",
        "skippedMineralNoBank",
        "skippedNoResource",
      ].sort(),
    );
    expect(Object.values(b).every(v => typeof v === "number" && v === 0)).toBe(true);
    expect(remainsLootBucket("W37S58", 500)).toBe(b);
    expect(remainsLootBucket("W37S58", 0)).not.toBe(b);
  });
});

describe("lootRemains 的 resolve — 分桶漏斗与闭合式", () => {
  it("阈值档把零头记进 belowThreshold，且 seen === belowThreshold + eligible", () => {
    const action = lootRemains(500);
    const ac = acOf({
      tombstones: [remains(100), remains(900)],
      ruins: [remains(400)],
    });
    const picked = action.resolve!(ac);

    const b = remainsLootBucket("W37S58", 500);
    expect(b.seen).toBe(3);
    expect(b.belowThreshold).toBe(2); // 100 与 400 都是零头
    expect(b.eligible).toBe(1); // 只有 900 过阈
    expect(b.seen).toBe(b.belowThreshold + b.eligible);
    expect(b.resolved).toBe(1);
    expect(picked).toBeDefined();
  });

  it("兜底档（minAmount=0）与阈值档分开计——混列分不出是谁在干活", () => {
    const thresholded = lootRemains(500);
    const tail = lootRemains(0);
    const small = { tombstones: [remains(100)], ruins: [] };

    expect(thresholded.resolve!(acOf(small))).toBeUndefined();
    expect(tail.resolve!(acOf(small))).toBeDefined();

    const big = remainsLootBucket("W37S58", 500);
    const zero = remainsLootBucket("W37S58", 0);
    expect([big.seen, big.belowThreshold, big.eligible, big.resolved]).toEqual([1, 1, 0, 0]);
    expect([zero.seen, zero.belowThreshold, zero.eligible, zero.resolved]).toEqual([1, 0, 1, 1]);
    // 阈值档一个都没选中 ⇒ 它今天不可能在清零头；这是 C1 要的那个"正面读数"的形状。
    expect(big.resolved).toBe(0);
  });

  it("没有任何遗留时三列全零（首次空≠仪器坏）", () => {
    const action = lootRemains(0);
    expect(action.resolve!(acOf({}))).toBeUndefined();
    const b = remainsLootBucket("W37S58", 0);
    expect([b.seen, b.belowThreshold, b.eligible, b.resolved]).toEqual([0, 0, 0, 0]);
  });
});

describe("lootRemains 的 execute — 两次「有意放弃」必须与「没跑」分得开", () => {
  it("无 storage 且无 terminal ⇒ 矿物分支放弃，记 skippedMineralNoBank 而不发 withdraw", () => {
    const action = lootRemains(0);
    const mineralOnly = remains(200, { mineral: 200 }); // 能量 0、矿物 200
    const ac = acOf({ tombstones: [mineralOnly], storage: undefined, terminal: undefined });

    // 走完一支完整的链（resolve→execute），否则闭合式里的 resolved 无从谈起。
    const target = action.resolve!(ac);
    expect(target).toBeDefined();
    action.execute!(ac, target!);

    const b = remainsLootBucket("W37S58", 0);
    expect(b.skippedMineralNoBank).toBe(1);
    expect(b.executed).toBe(0);
    expect(ac.creep.withdraw).not.toHaveBeenCalled();
    // 闭合式：resolved = executed + 两支放弃
    expect(b.resolved).toBe(b.executed + b.skippedMineralNoBank + b.skippedNoResource);
  });

  it("有 storage ⇒ 同一目标真的发出 withdraw，记 executed", () => {
    const action = lootRemains(0);
    const mineralOnly = remains(200, { mineral: 200 });
    const ac = acOf({ tombstones: [mineralOnly], storage: {} });

    const target = action.resolve!(ac);
    action.execute!(ac, target!);

    const b = remainsLootBucket("W37S58", 0);
    expect(b.executed).toBe(1);
    expect(b.skippedMineralNoBank).toBe(0);
    expect(ac.creep.withdraw).toHaveBeenCalledTimes(1);
    expect(ac.creep.withdraw.mock.calls[0][1]).toBe("OH"); // 取的是矿物，不是能量
    expect(b.resolved).toBe(b.executed + b.skippedMineralNoBank + b.skippedNoResource);
  });

  it("目标取不出任何资源 ⇒ 记 skippedNoResource（第三支，也不是「没跑」）", () => {
    const action = lootRemains(0);
    const empty = remains(0); // store 为空 ⇒ getUsedCapacity 返回 0
    const ac = acOf({ tombstones: [empty], storage: {} });

    // 这里直接喂一个 execute 的目标：resolve 本来就会把零容量候选筛掉（那是 belowThreshold
    // 那一支），本用例要钉的是"执行侧第三支出口"，不是"它会不会被选中"。
    action.execute!(ac, empty);

    const b = remainsLootBucket("W37S58", 0);
    expect(b.skippedNoResource).toBe(1);
    expect(b.executed).toBe(0);
    expect(ac.creep.withdraw).not.toHaveBeenCalled();
  });
});

describe("remainsBlindCounters — 盲点体量的建行（分子分母同处建行）", () => {
  it("三列齐为 0，且同房取回同一对象", () => {
    const c = remainsBlindCounters("W37S58");
    expect(c).toEqual({ snapshotTicks: 0, inSnapshot: 0, blindFiltered: 0 });
    expect(remainsBlindCounters("W37S58")).toBe(c);
    c.snapshotTicks++;
    c.inSnapshot += 2;
    c.blindFiltered += 3;
    expect(remainsBlindCounters("W37S58").blindFiltered).toBe(3);
  });
});
