/** 远矿 op 账本 Memory ↔ heap 同步 — global reset 恢复语义。 */
import { beforeEach, describe, expect, it } from "vitest";
import { syncOpLedger } from "../../../src/systems/remote-mining-manager";
import {
  bumpRemoteOpLedger,
  peekRemoteOpLedger,
  pruneRemoteOpLedgers,
  setRemoteOpLedger,
} from "../../../src/kernel/global-cache";
import { emptyOpLedger } from "../../../src/domain/remote/op-ledger";
import { resetGlobals } from "../../support/factories";

const HOME = "W7N4";
const TARGET = "W7N3";

beforeEach(() => {
  // resetGlobals 已清 heap 账本，等价于一次 global reset（Memory 由用例自行设置）。
  resetGlobals();
});

describe("syncOpLedger — 持久化恢复", () => {
  it("heap 与 Memory 都为空 → 从当前 tick 起算的新窗口", () => {
    const l = syncOpLedger(HOME, TARGET, undefined, 500);
    expect(l.delivered).toBe(0);
    expect(l.windowStart).toBe(500);
    expect(peekRemoteOpLedger(HOME, TARGET)).toBe(l);
  });

  it("heap 缺失但 Memory 有账本（reset 后首见）→ 从 Memory 恢复", () => {
    const l = syncOpLedger(HOME, TARGET, { d: 3000, s: 1000, r: 200, i: 100, w: 12345 }, 99999);
    expect(l.delivered).toBe(3000);
    expect(l.spawnCost).toBe(1000);
    expect(l.windowStart).toBe(12345);
  });

  it("reset 后首个 tick 已先记一笔 → 仍按窗口起点不一致恢复（不丢整窗）", () => {
    // 模拟：reset 后 creeps 层先 bump，heap 出现一个 windowStart=99999 的新壳。
    bumpRemoteOpLedger(HOME, TARGET, "delivered", 50);
    expect(peekRemoteOpLedger(HOME, TARGET)?.windowStart).toBe(1000); // Game.time mock

    const l = syncOpLedger(HOME, TARGET, { d: 3000, s: 1000, r: 200, i: 100, w: 12345 }, 99999);

    expect(l.delivered).toBe(3000); // 持久化数据胜出，而非只剩 50
    expect(l.windowStart).toBe(12345);
  });

  it("正常运行时（窗口起点一致）不覆盖 heap 的实时累计", () => {
    syncOpLedger(HOME, TARGET, undefined, 1000);
    bumpRemoteOpLedger(HOME, TARGET, "delivered", 700);
    bumpRemoteOpLedger(HOME, TARGET, "spawnCost", 300);

    const l = syncOpLedger(HOME, TARGET, { d: 3000, s: 1000, r: 200, i: 100, w: 1000 }, 2000);

    // 窗口起点相同 → heap 权威：交付 700（而非 Memory 的 3000）
    expect(l.delivered).toBe(700);
    expect(l.spawnCost).toBe(300);
  });

  it("开点播种后回写 Memory，再同步保持稳定（幂等）", () => {
    const first = syncOpLedger(HOME, TARGET, undefined, 1000);
    expect(first).toEqual(emptyOpLedger(1000));

    const snap = { d: 0, s: 0, r: 0, i: 0, w: first.windowStart };
    const second = syncOpLedger(HOME, TARGET, snap, 1000);
    expect(second).toBe(first); // 同一对象，未重建
  });
});

describe("账本 GC — 按 op 记录存在性清理", () => {
  it("op 记录仍在（含 abandoned）→ 账本保留，供复盘", () => {
    setRemoteOpLedger(HOME, TARGET, emptyOpLedger(1000));

    pruneRemoteOpLedgers(HOME, new Set([TARGET]));

    expect(peekRemoteOpLedger(HOME, TARGET)).toBeDefined();
  });

  it("op 记录已删除 → 账本丢弃（防重开同一目标房继承旧计数）", () => {
    setRemoteOpLedger(HOME, TARGET, emptyOpLedger(1000));

    pruneRemoteOpLedgers(HOME, new Set());

    expect(peekRemoteOpLedger(HOME, TARGET)).toBeUndefined();
  });

  it("只清本母房，不误伤兄弟房的同名目标", () => {
    setRemoteOpLedger(HOME, TARGET, emptyOpLedger(1000));
    setRemoteOpLedger("W8N8", TARGET, emptyOpLedger(1000));

    pruneRemoteOpLedgers(HOME, new Set());

    expect(peekRemoteOpLedger(HOME, TARGET)).toBeUndefined();
    expect(peekRemoteOpLedger("W8N8", TARGET)).toBeDefined();
  });
});
