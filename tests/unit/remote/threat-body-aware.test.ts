/**
 * 远矿威胁探测 body-aware 口径测试（组④ / F-2）。
 *
 * 修复前 collectRemoteThreats "任何非盟友即威胁"，会为纯 MOVE 斥候空孵 defender
 * + 停产 300t，而经济角色 flee 用的 getRoomThreats 是 body-aware —— 两个探测器
 * 口径分裂。修复后统一走 classifyThreats（同一 THREAT_PARTS）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectRemoteThreats } from "../../../src/systems/remote-mining-manager";
import { resetGlobals } from "../../role-helpers";

const targetRoom = "W2N1";

beforeEach(() => {
  resetGlobals();
});

function hostile(bodyParts: string[]) {
  return { owner: { username: "enemy" }, body: bodyParts.map((type) => ({ type })) };
}

function roomWith(creeps: unknown[]) {
  return { name: targetRoom, find: vi.fn((t: number) => (t === FIND_HOSTILE_CREEPS ? creeps : [])) };
}

const ops = { [targetRoom]: { state: "active", createdAt: 0, lastSeen: 0 } } as never;

describe("remote-mining-manager — collectRemoteThreats body-aware（F-2）", () => {
  it("纯 MOVE 斥候不算威胁（不触发 defender/停产）", () => {
    (globalThis as any).Game.rooms[targetRoom] = roomWith([hostile(["move", "move"])]);
    expect(collectRemoteThreats(ops)[targetRoom]).toBe(false);
  });

  it("带 ATTACK 的敌 creep 算威胁", () => {
    (globalThis as any).Game.rooms[targetRoom] = roomWith([hostile(["attack", "move"])]);
    expect(collectRemoteThreats(ops)[targetRoom]).toBe(true);
  });

  it("带 WORK/CLAIM 的敌 creep（NPC reserver/dismantler）算威胁", () => {
    (globalThis as any).Game.rooms[targetRoom] = roomWith([hostile(["claim", "move"])]);
    expect(collectRemoteThreats(ops)[targetRoom]).toBe(true);
  });

  it("无视野（Game.rooms 无该房）不写威胁键", () => {
    expect(collectRemoteThreats(ops)[targetRoom]).toBeUndefined();
  });
});
