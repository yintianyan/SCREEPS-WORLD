/** reserver 预约续期节流：余量充足时不重复签发 reserveController。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reserverRole } from "../../../src/creeps/roles/reserver";
import { mockContext, mockCreep, mockSnapshot, resetGlobals } from "../../support/factories";

const HOME = "W7N4";
const TARGET = "W2N1";

function setup(ticksToEnd: number | undefined, username = "me") {
  const g = globalThis as any;
  const controller: any = {
    my: false,
    owner: undefined,
    pos: { x: 25, y: 25 },
    reservation: ticksToEnd === undefined ? undefined : { username, ticksToEnd },
  };
  g.Game.rooms[TARGET] = {
    name: TARGET,
    find: () => [],
    lookForAt: () => [],
    controller,
  };
  const creep = mockCreep({ name: "rs1", role: "reserver", home: HOME });
  creep.memory.remoteTarget = TARGET;
  creep.room = g.Game.rooms[TARGET];
  creep.pos = {
    x: 25,
    y: 25,
    roomName: TARGET,
    getRangeTo: () => 1,
    getDirectionTo: () => 3,
    isEqualTo: () => true,
    inRangeTo: () => true,
  };
  creep.owner = { username: "me" };
  creep.reserveController = vi.fn(() => 0);
  g.Game.creeps = { rs1: creep };
  return { creep, ctx: mockContext(mockSnapshot({ roomName: HOME })) };
}

beforeEach(() => {
  resetGlobals();
});

describe("reserver — 预约续期节流", () => {
  it("自家预约余量 ≥3,000 → 本拍不签发 reserveController", () => {
    const { creep, ctx } = setup(4000);
    reserverRole.run(creep, ctx);
    expect(creep.reserveController).not.toHaveBeenCalled();
  });

  it("自家预约余量 <3,000 → 照常签发", () => {
    const { creep, ctx } = setup(2000);
    reserverRole.run(creep, ctx);
    expect(creep.reserveController).toHaveBeenCalledTimes(1);
  });

  it("敌方预约（余量再高）→ 不节流，进入预定/攻击路径", () => {
    const { creep, ctx } = setup(4000, "enemy");
    reserverRole.run(creep, ctx);
    expect(creep.reserveController).toHaveBeenCalledTimes(1);
  });
});
