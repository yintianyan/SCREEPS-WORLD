/** v46 → v47 Schema Migration Test — RemoteOp.ledger 畸形自愈 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

const GOOD = { d: 3000, s: 1000, r: 200, i: 100, w: 12345 };

function memWith(remoteOps: Record<string, unknown>): unknown {
  return {
    schemaVersion: 46,
    creeps: {},
    rooms: { W1N1: { remoteOps } },
  };
}

function opsOf(): Record<string, any> {
  return (globalThis as any).Memory.rooms.W1N1.remoteOps;
}

beforeEach(() => {
  resetGlobals();
});

describe("migration v46 → v47（RemoteOp.ledger 畸形自愈）", () => {
  it("无 remoteOps 时不崩溃，schemaVersion 升至当前", () => {
    (globalThis as any).Memory = { schemaVersion: 46, creeps: {}, rooms: {} };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("无 ledger 时不新增键（可选字段，惰性写入）", () => {
    (globalThis as any).Memory = memWith({ W1N2: { state: "active", sources: 2 } });

    runMigrations();

    expect("ledger" in opsOf().W1N2).toBe(false);
    expect(opsOf().W1N2.sources).toBe(2);
  });

  it("合法 ledger 原样保留", () => {
    (globalThis as any).Memory = memWith({ W1N2: { state: "active", ledger: { ...GOOD } } });

    runMigrations();

    expect(opsOf().W1N2.ledger).toEqual(GOOD);
  });

  it("畸形 ledger（字符串 / 数组 / null）被删除", () => {
    (globalThis as any).Memory = memWith({
      A: { ledger: "bad" },
      B: { ledger: [1, 2] },
      C: { ledger: null },
    });

    runMigrations();

    expect("ledger" in opsOf().A).toBe(false);
    expect("ledger" in opsOf().B).toBe(false);
    expect("ledger" in opsOf().C).toBe(false);
  });

  it("字段缺失或非数字的 ledger 被删除（防 NaN 喂进净营收）", () => {
    (globalThis as any).Memory = memWith({
      A: { ledger: { s: 1, r: 2, i: 3, w: 4 } }, // 缺 d
      B: { ledger: { d: "x", s: 1, r: 2, i: 3, w: 4 } }, // d 非数字
      C: { ledger: { d: 1, s: 1, r: 2, i: 3, w: Number.NaN } }, // w 为 NaN
    });

    runMigrations();

    expect("ledger" in opsOf().A).toBe(false);
    expect("ledger" in opsOf().B).toBe(false);
    expect("ledger" in opsOf().C).toBe(false);
  });

  it("同房多 op：畸形条目删除不影响合法条目", () => {
    (globalThis as any).Memory = memWith({
      W1N2: { ledger: { ...GOOD } },
      W2N1: { ledger: "bad" },
    });

    runMigrations();

    expect(opsOf().W1N2.ledger).toEqual(GOOD);
    expect("ledger" in opsOf().W2N1).toBe(false);
  });

  it("幂等：重复执行无副作用", () => {
    (globalThis as any).Memory = memWith({ W1N2: { ledger: { ...GOOD } } });

    runMigrations();
    (globalThis as any).Memory.schemaVersion = 46;
    runMigrations();

    expect(opsOf().W1N2.ledger).toEqual(GOOD);
  });
});
