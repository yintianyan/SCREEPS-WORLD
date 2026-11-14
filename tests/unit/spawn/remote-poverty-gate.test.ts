/** R590 贫困闸 + Phase 2.5 低储节流：远矿首孵/扩编需 storage ≥ expansionMinStorage(100K)；替换只受深贫困地板(4,000)约束。 */
import { describe, expect, it } from "vitest";
import { remoteSpawnPovertyBlocked } from "../../../src/systems/room/spawn-manager";
import { CONFIG } from "../../../src/config";

const EXPANSION_FLOOR = CONFIG.remote.expansionMinStorage;

describe("remoteSpawnPovertyBlocked", () => {
  it("远矿角色 + storage 低于扩张水位 → 首孵/扩编暂停", () => {
    expect(
      remoteSpawnPovertyBlocked("remoteHauler", EXPANSION_FLOOR - 1, false, "remoteHauler:A:B:1"),
    ).toBe(true);
    expect(remoteSpawnPovertyBlocked("remoteHarvester", 0, false, "remoteHarvester:A:B:0")).toBe(
      true,
    );
    expect(remoteSpawnPovertyBlocked("reserver", 100, false, "reserver:A:B:0")).toBe(true);
    // 旧开点地板 roomMinStorage(8,000) 已不足以放行首孵 —— 需要回到 100K。
    expect(
      remoteSpawnPovertyBlocked(
        "remoteHauler",
        CONFIG.remote.roomMinStorage,
        false,
        "hauler:A:B:1",
      ),
    ).toBe(true);
  });

  it("达到扩张水位即放行（控制组）", () => {
    expect(
      remoteSpawnPovertyBlocked("remoteHauler", EXPANSION_FLOOR, false, "remoteHauler:A:B:1"),
    ).toBe(false);
    expect(
      remoteSpawnPovertyBlocked("reserver", EXPANSION_FLOOR + 10000, false, "reserver:A:B:0"),
    ).toBe(false);
  });

  it("非远矿角色不受影响", () => {
    expect(remoteSpawnPovertyBlocked("harvester", 0, false, "harvester:A:0")).toBe(false);
    expect(remoteSpawnPovertyBlocked("builder", 0, false, "builder:A:0")).toBe(false);
  });

  it("替换请求：轻度贫困（≥4,000）放行，深贫困（<4,000）也停", () => {
    // 轻度贫困：替换放行，保住现有线收入（不受 100K 扩张水位影响）。
    expect(
      remoteSpawnPovertyBlocked("remoteHauler", 5000, false, "remoteHauler:A:B:repl:old-creep"),
    ).toBe(false);
    expect(
      remoteSpawnPovertyBlocked(
        "remoteHauler",
        EXPANSION_FLOOR - 1,
        false,
        "remoteHauler:A:B:repl:old-creep",
      ),
    ).toBe(false);
    // 深贫困：连替换也停，避免维持成本把 storage 继续往下拉。
    expect(
      remoteSpawnPovertyBlocked("remoteHauler", 0, false, "remoteHauler:A:B:repl:old-creep"),
    ).toBe(true);
    expect(
      remoteSpawnPovertyBlocked("remoteHauler", 3999, false, "remoteHauler:A:B:repl:old-creep"),
    ).toBe(true);
  });

  it("survival 请求豁免（生存优先）", () => {
    expect(remoteSpawnPovertyBlocked("remoteHauler", 0, true, "remoteHauler:A:B:0")).toBe(false);
  });

  it("coreClearer 只受深贫困地板约束 —— 低储期也必须能拆核", () => {
    // 47K：普通远矿被 100K 闸挡住，但清核是一次性军事投资 → 放行。
    // 回归锚：若把 coreClearer 重新并入扩张水位，Invader op 会陷入
    // 「开点 → clearer 永远孵不出 → 1500t 空转废弃 → 豁免重开」死循环。
    expect(remoteSpawnPovertyBlocked("coreClearer", 47_000, false, "coreClearer:A:B:0")).toBe(
      false,
    );
    expect(
      remoteSpawnPovertyBlocked("coreClearer", EXPANSION_FLOOR - 1, false, "coreClearer:A:B:0"),
    ).toBe(false);
    // 深贫困地板仍是硬约束。
    expect(remoteSpawnPovertyBlocked("coreClearer", 3_999, false, "coreClearer:A:B:0")).toBe(true);
    expect(remoteSpawnPovertyBlocked("coreClearer", 4_000, false, "coreClearer:A:B:0")).toBe(false);
  });
});
