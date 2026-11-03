/** R682：RCL4 无玩家威胁时，外围 rampart 维护只到 bootstrap 线；核心/玩家威胁不受影响。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { builderRole } from "../../../src/creeps/roles/builder";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

function setup(playerThreat: boolean) {
  const rampart = mockStructure("rampart", { id: "rp1", hits: 50000, hitsMax: 300000 });
  rampart.pos.x = 26;
  rampart.pos.y = 26;
  const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
  const snap = mockSnapshot({
    rcl: 4,
    storage,
    ramparts: [rampart],
    fillTargets: [],
    myConstructionSites: [],
  });
  if (playerThreat) (Memory.rooms.W7N4 as any).lastPlayerHostileAt = Game.time;
  const creep = mockCreep({
    name: "builder_1",
    role: "builder",
    used: 50,
    capacity: 50,
    mode: "work",
  });
  return { rampart, creep, ctx: mockContext(snap) };
}

describe("repairFortifications — R682 RCL4 外围维护帽", () => {
  it("无玩家威胁：50K 的外围 rampart 不再往 100K 维护", () => {
    const { rampart, creep, ctx } = setup(false);
    builderRole.run(creep, ctx);
    expect(creep.repair).not.toHaveBeenCalledWith(rampart);
  });

  it("玩家威胁在场：恢复正常 100K 目标，50K rampart 会被修", () => {
    const { rampart, creep, ctx } = setup(true);
    builderRole.run(creep, ctx);
    expect(creep.repair).toHaveBeenCalledWith(rampart);
  });
});
