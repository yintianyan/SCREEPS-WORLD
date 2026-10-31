/** R674 效用仲裁器 — 评分/老化/承诺窗/缓存隔离/有界饥饿。 */
import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { runUtilityArbitration } from "../../../src/creeps/engine/arbiter";
import { globalCache } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../support/factories";

interface CandidateOpts {
  name: string;
  target?: string | undefined;
  utility?: number;
  executeLog: string[];
  resolveCount?: { n: number };
  onResolve?: (ac: any) => void;
}

function candidate(opts: CandidateOpts): any {
  return {
    name: opts.name,
    resolve: (ac: any) => {
      if (opts.resolveCount) opts.resolveCount.n++;
      opts.onResolve?.(ac);
      return opts.target === undefined ? undefined : opts.target;
    },
    execute: (_ac: any) => opts.executeLog.push(opts.name),
    utility: () => opts.utility ?? 1,
  };
}

function makeAc(name = "builder_1") {
  const creep: any = {
    name,
    memory: {},
    store: { getFreeCapacity: () => 0, getUsedCapacity: () => 50 },
    pos: { getRangeTo: () => 1 },
  };
  return { ac: { creep, snapshot: {}, assignment: undefined, budget: {}, ctx: {} } as any, creep };
}

const advance = (ticks: number) => {
  (globalThis as any).Game.time += ticks;
};

beforeEach(() => {
  resetGlobals();
});

describe("效用仲裁 — 基础选择", () => {
  it("首次决策选 utility 最高者并写入状态", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    runUtilityArbitration(ac, [
      candidate({ name: "a", target: "ta", utility: 10, executeLog: log }),
      candidate({ name: "b", target: "tb", utility: 20, executeLog: log }),
    ]);
    expect(log).toEqual(["b"]);
    expect(ac.creep.memory.utility.task).toBe("b");
    expect(ac.creep.memory.utility.lastAt).toBe(1000);
    expect(ac.creep.memory.utility.neglect.a).toBe(CONFIG.arbitration.decisionInterval);
  });

  it("决策间隔内只复核当前任务，不重扫落选候选", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    const counts = { a: { n: 0 }, b: { n: 0 } };
    const cands = [
      candidate({ name: "a", target: "ta", utility: 10, executeLog: log, resolveCount: counts.a }),
      candidate({ name: "b", target: "tb", utility: 20, executeLog: log, resolveCount: counts.b }),
    ];
    runUtilityArbitration(ac, cands);
    advance(2);
    runUtilityArbitration(ac, cands);
    expect(log).toEqual(["b", "b"]);
    expect(counts.a.n).toBe(1); // 只有首次评分解析过
    expect(counts.b.n).toBe(3); // 首次评分 + 赢家重解析 + 间隔内复核
  });

  it("当前任务失效后立即重评", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    let bValid = true;
    const cands = [
      candidate({ name: "a", target: "ta", utility: 10, executeLog: log }),
      {
        name: "b",
        resolve: () => (bValid ? "tb" : undefined),
        execute: () => log.push("b"),
        utility: () => 20,
      },
    ];
    runUtilityArbitration(ac, cands);
    bValid = false;
    advance(1);
    runUtilityArbitration(ac, cands);
    expect(log).toEqual(["b", "a"]);
    expect(ac.creep.memory.utility.task).toBe("a");
  });

  it("无候选时清空任务", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    let valid = true;
    const cands = [
      {
        name: "a",
        resolve: () => (valid ? "ta" : undefined),
        execute: () => log.push("a"),
        utility: () => 10,
      },
    ];
    runUtilityArbitration(ac, cands);
    valid = false;
    advance(CONFIG.arbitration.decisionInterval);
    expect(runUtilityArbitration(ac, cands)).toBeUndefined();
    expect(ac.creep.memory.utility.task).toBe("");
  });
});

describe("效用仲裁 — 有界饥饿", () => {
  it("低价值候选最多等 agingCap 拍就会被服务一次（与 base 差距无关）", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    const cands = [
      candidate({ name: "high", target: "th", utility: 100, executeLog: log }),
      candidate({ name: "low", target: "tl", utility: 5, executeLog: log }),
    ];
    const decisions =
      Math.ceil(CONFIG.arbitration.agingCap / CONFIG.arbitration.decisionInterval) + 10;
    for (let i = 0; i < decisions; i++) {
      runUtilityArbitration(ac, cands);
      advance(CONFIG.arbitration.decisionInterval);
    }
    expect(log[0]).toBe("high");
    expect(log.filter(n => n === "low").length).toBeGreaterThanOrEqual(1);
  });

  it("不可执行的候选不积累老化；恢复可执行后从零开始", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    let lowValid = false;
    const cands = [
      candidate({ name: "high", target: "th", utility: 100, executeLog: log }),
      {
        name: "low",
        resolve: () => (lowValid ? "tl" : undefined),
        execute: () => log.push("low"),
        utility: () => 5,
      },
    ];
    for (let i = 0; i < 10; i++) {
      runUtilityArbitration(ac, cands);
      advance(CONFIG.arbitration.decisionInterval);
    }
    expect(ac.creep.memory.utility.neglect.low).toBeUndefined();
    lowValid = true;
    runUtilityArbitration(ac, cands);
    expect(log[log.length - 1]).toBe("high"); // 刚恢复时可执行但未积累等待，不插队
    expect(ac.creep.memory.utility.neglect.low).toBe(CONFIG.arbitration.decisionInterval);
  });
});

describe("效用仲裁 — 承诺窗与切换余量", () => {
  it("承诺窗内小幅优势不切换，窗结束后才切换", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    let bUtility = 140;
    const cands = [
      candidate({ name: "a", target: "ta", utility: 200, executeLog: log }),
      {
        name: "b",
        resolve: () => "tb",
        execute: () => log.push("b"),
        utility: () => bUtility,
      },
    ];
    runUtilityArbitration(ac, cands); // 选 a，since=1000
    advance(CONFIG.arbitration.decisionInterval);
    runUtilityArbitration(ac, cands); // 窗内：b 140×1.05 < a 200×1.35×1.15
    expect(ac.creep.memory.utility.task).toBe("a");

    // 窗结束后再给足优势
    bUtility = 300;
    advance(CONFIG.arbitration.dwellTicks);
    runUtilityArbitration(ac, cands);
    expect(ac.creep.memory.utility.task).toBe("b");
  });

  it("承诺窗内紧急任务（远高于余量）仍可抢占", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    const cands = [
      candidate({ name: "build", target: "ts", utility: 50, executeLog: log }),
      candidate({ name: "urgent", target: "tu", utility: 500, executeLog: log }),
    ];
    runUtilityArbitration(ac, cands); // 选 urgent
    expect(ac.creep.memory.utility.task).toBe("urgent");
    const cands2 = [
      candidate({ name: "build", target: "ts", utility: 500, executeLog: log }),
      candidate({ name: "urgent", target: "tu", utility: 50, executeLog: log }),
    ];
    advance(CONFIG.arbitration.decisionInterval);
    runUtilityArbitration(ac, cands2);
    expect(ac.creep.memory.utility.task).toBe("build");
  });
});

describe("效用仲裁 — 目标缓存隔离", () => {
  it("评分阶段落选候选写的目标缓存被还原，最终只保留赢家", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    const cands = [
      candidate({
        name: "a",
        target: "ta",
        utility: 10,
        executeLog: log,
        onResolve: c => {
          c.creep.memory.targetId = "a";
          c.creep.memory.repairTargetId = "ra";
        },
      }),
      candidate({
        name: "b",
        target: "tb",
        utility: 20,
        executeLog: log,
        onResolve: c => {
          c.creep.memory.targetId = "b";
          c.creep.memory.repairTargetId = "rb";
        },
      }),
    ];
    runUtilityArbitration(ac, cands);
    expect(log).toEqual(["b"]);
    expect(ac.creep.memory.targetId).toBe("b");
    expect(ac.creep.memory.repairTargetId).toBe("rb");
  });

  it("评估落选候选不会残留 fillTargetId", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    const cands = [
      candidate({
        name: "fill",
        target: "tf",
        utility: 10,
        executeLog: log,
        onResolve: c => {
          c.creep.memory.fillTargetId = "loser";
        },
      }),
      candidate({ name: "build", target: "ts", utility: 20, executeLog: log }),
    ];
    runUtilityArbitration(ac, cands);
    expect(ac.creep.memory.fillTargetId).toBeUndefined();
  });

  it("评分不消耗共享 fill 预约：落选者预约被还原，只留赢家目标", () => {
    const { ac } = makeAc();
    const log: string[] = [];
    const withReservation = (name: string, id: string, utility: number) => ({
      name,
      resolve: () => {
        const g = globalCache();
        if (!g.fillReservations || g.fillReservationTick !== (globalThis as any).Game.time) {
          g.fillReservations = new Set();
          g.fillReservationTick = (globalThis as any).Game.time;
        }
        g.fillReservations.add(id);
        return id;
      },
      execute: () => log.push(name),
      utility: () => utility,
    });
    runUtilityArbitration(ac, [withReservation("a", "ta", 10), withReservation("b", "tb", 20)]);
    expect(log).toEqual(["b"]);
    expect([...(globalCache().fillReservations ?? [])]).toEqual(["tb"]);
  });
});
