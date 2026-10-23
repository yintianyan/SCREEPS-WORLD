/** R590 贫困闸：远矿编制补员在 home storage < roomMinStorage(8,000) 时暂停；survival 豁免。 */
import { describe, expect, it } from "vitest";
import { remoteSpawnPovertyBlocked } from "../../../src/systems/room/spawn-manager";
import { CONFIG } from "../../../src/config";

const FLOOR = CONFIG.remote.roomMinStorage;

describe("remoteSpawnPovertyBlocked", () => {
  it("远矿角色 + storage 低于地板 → 暂停", () => {
    expect(remoteSpawnPovertyBlocked("remoteHauler", FLOOR - 1, false)).toBe(true);
    expect(remoteSpawnPovertyBlocked("remoteHarvester", 0, false)).toBe(true);
    expect(remoteSpawnPovertyBlocked("reserver", 100, false)).toBe(true);
  });

  it("达到地板即放行（控制组）", () => {
    expect(remoteSpawnPovertyBlocked("remoteHauler", FLOOR, false)).toBe(false);
    expect(remoteSpawnPovertyBlocked("reserver", FLOOR + 10000, false)).toBe(false);
  });

  it("非远矿角色不受影响", () => {
    expect(remoteSpawnPovertyBlocked("harvester", 0, false)).toBe(false);
    expect(remoteSpawnPovertyBlocked("builder", 0, false)).toBe(false);
  });

  it("survival 请求豁免（生存优先）", () => {
    expect(remoteSpawnPovertyBlocked("remoteHauler", 0, true)).toBe(false);
  });
});
