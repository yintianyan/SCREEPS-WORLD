/**
 * Scout 过境房威胁行为测试（R6b 扩张修复 Fix #3：pushThrough）。
 *
 * 复现场景：scout 钻进敌方过境房（如 Aguia 的 W38S58）时，旧逻辑 foreign-room flee
 * 让其逃回 home，永远到不了 remoteTarget（recon 永不完成 → 占领链卡死）。pushThrough 标志
 * 跳过该 flee 检测，使其继续向侦察目标推进。
 *
 * 对照：同场景下一个无 pushThrough 的普通远矿角色会 flee 回 home（验证检测本身有效，
 * 仅 scout 被放行）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoutRole } from "../../../src/creeps/roles/scout";
import { defineRole } from "../../../src/creeps/engine/role-runner";
import type { Priority } from "../../../src/kernel/contracts";
import type { RolePolicy } from "../../../src/creeps/engine/action-types";
import { mockContext, mockCreep, mockPos, resetGlobals } from "../../role-helpers";

/** 带攻击 body 的敌方 creep（classifyThreats 才判为威胁，触发 foreign-room flee）。 */
function hostileWithAttack(): any {
  return {
    id: "hostile_1",
    name: "hostile_1",
    owner: { username: "enemy" },
    pos: mockPos(23, 23, "W8N4"), // 在 fleeRange(10) 内，scout 在 (25,25)
    body: [{ type: "attack", hits: 100 }],
  };
}

function scoutInForeignHostile(): any {
  const creep = mockCreep({
    name: "scout_1",
    role: "scout",
    mode: "acquire",
    home: "W7N4",
    pos: mockPos(25, 25, "W8N4"),
  });
  creep.memory.remoteTarget = "W6N4"; // 侦察目标（与过境房 W8N4 不同）
  creep.room = {
    name: "W8N4",
    findExitTo: vi.fn(() => 3),
    find: vi.fn((kind: number) => (kind === FIND_HOSTILE_CREEPS ? [hostileWithAttack()] : [])),
    lookForAt: vi.fn(() => []),
  };
  // getRoomThreats 读 Game.rooms[roomName].find — 必须把过境房登记进去，否则威胁探测拿空房。
  (globalThis as any).Game.rooms = { W8N4: creep.room };
  return creep;
}

describe("scout 过境房威胁 — pushThrough 放行", () => {
  beforeEach(() => resetGlobals());

  it("scout 在敌方过境房不 flee，继续向 remoteTarget 推进", () => {
    const creep = scoutInForeignHostile();
    (globalThis as any).Game.creeps = { scout_1: creep };

    scoutRole.run(creep, mockContext());

    expect(creep.memory.mode).not.toBe("flee");
    // 导航朝向侦察目标 W6N4，而非 home W7N4（证明不是 fleeToHome）。
    expect(creep.room.findExitTo).toHaveBeenCalledWith("W6N4");
  });

  it("对照：无 pushThrough 的远矿角色在敌方过境房会 flee 回 home", () => {
    const creep = scoutInForeignHostile();
    creep.memory.role = "plain";
    (globalThis as any).Game.creeps = { plain_1: creep };
    const plainPolicy: RolePolicy = { acquire: [], work: [] };
    const plainRole = defineRole("plain", 3 as Priority, plainPolicy);

    plainRole.run(creep, mockContext());

    expect(creep.memory.mode).toBe("flee");
    // fleeToHome → moveTowardRoom(home) → findExitTo 朝向 home W7N4。
    expect(creep.room.findExitTo).toHaveBeenCalledWith("W7N4");
  });
});
