/** R683：塔火圈外的 perimeter rampart 只维持 bootstrap 线；覆盖内的正常维护。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { builderRole } from "../../../src/creeps/roles/builder";
import {
  mockContext,
  mockCreep,
  mockPos,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

function setup(opts: { covered: boolean }) {
  const tower = mockStructure("tower", { id: "tw", energy: 1000, capacity: 1000 });
  tower.pos.x = 25;
  tower.pos.y = 20;
  const rampart = mockStructure("rampart", { id: "rp1", hits: 50000, hitsMax: 300000 });
  if (opts.covered) {
    rampart.pos.x = 26;
    rampart.pos.y = 26; // 距塔 (25,20) 6 格
  } else {
    rampart.pos.x = 46;
    rampart.pos.y = 20; // 距塔 21 格，塔外
  }
  const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
  const snap = mockSnapshot({
    rcl: 4,
    storage,
    towers: [tower],
    ramparts: [rampart],
    fillTargets: [],
    myConstructionSites: [],
  });
  const creep = mockCreep({
    name: "builder_1",
    role: "builder",
    used: 50,
    capacity: 50,
    mode: "work",
    pos: mockPos(opts.covered ? 25 : 45, opts.covered ? 25 : 20),
  });
  return { rampart, creep, ctx: mockContext(snap) };
}

describe("repairFortifications — R683 塔覆盖维护帽", () => {
  it("覆盖内 perimeter：正常 100K 目标，50K rampart 会被修", () => {
    const { rampart, creep, ctx } = setup({ covered: true });
    builderRole.run(creep, ctx);
    expect(creep.repair).toHaveBeenCalledWith(rampart);
  });

  it("塔外的 perimeter：只维持 10K，50K 不再往 100K 修", () => {
    const { rampart, creep, ctx } = setup({ covered: false });
    builderRole.run(creep, ctx);
    expect(creep.repair).not.toHaveBeenCalledWith(rampart);
  });
});
