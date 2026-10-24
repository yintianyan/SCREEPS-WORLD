/** R590 贫困闸：远矿编制补员在 home storage < roomMinStorage(8,000) 时暂停；survival 豁免。 */
import { describe, expect, it } from "vitest";
import { remoteSpawnPovertyBlocked } from "../../../src/systems/room/spawn-manager";
import { CONFIG } from "../../../src/config";

const FLOOR = CONFIG.remote.roomMinStorage;

describe("remoteSpawnPovertyBlocked", () => {
  it("远矿角色 + storage 低于地板 → 暂停", () => {
    expect(remoteSpawnPovertyBlocked("remoteHauler", FLOOR - 1, false, "remoteHauler:A:B:1")).toBe(
      true,
    );
    expect(remoteSpawnPovertyBlocked("remoteHarvester", 0, false, "remoteHarvester:A:B:0")).toBe(
      true,
    );
    expect(remoteSpawnPovertyBlocked("reserver", 100, false, "reserver:A:B:0")).toBe(true);
  });

  it("达到地板即放行（控制组）", () => {
    expect(remoteSpawnPovertyBlocked("remoteHauler", FLOOR, false, "remoteHauler:A:B:1")).toBe(
      false,
    );
    expect(remoteSpawnPovertyBlocked("reserver", FLOOR + 10000, false, "reserver:A:B:0")).toBe(
      false,
    );
  });

  it("非远矿角色不受影响", () => {
    expect(remoteSpawnPovertyBlocked("harvester", 0, false, "harvester:A:0")).toBe(false);
    expect(remoteSpawnPovertyBlocked("builder", 0, false, "builder:A:0")).toBe(false);
  });

  it("替换请求：轻度贫困（4,000–8,000）放行，深贫困（<4,000）也停", () => {
    // 轻度贫困：替换放行，保住现有线收入。
    expect(
      remoteSpawnPovertyBlocked("remoteHauler", 5000, false, "remoteHauler:A:B:repl:old-creep"),
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
});
