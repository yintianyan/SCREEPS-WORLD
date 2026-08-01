/**
 * harvester source-link 挖矿站位测试。
 *
 * 回归：当 source container 与 source link 分居 source 两侧时，harvester 站 container 上
 * 够不到 link（range 2），只能灌 container → 满仓 → 靠 hauler 远搬（线上 W7N4 source#1 病灶）。
 * 修复后：harvester 改站到「贴 source 且贴 link」的格，同 tick 倒进 link（免远搬）；
 * 已够到 link 则不再重定位（稳定），无 link 则维持 container 站位（不受影响）。
 *
 * 几何（W7N4 source#1）：source@12,31、container@12,30、link@12,32（垂直排列，
 * container/link 分居 source 两侧）；13,31 同时贴三者，是理想 link 站位。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { harvesterRole } from "../../../src/creeps/roles/harvester";
import {
  mockSnapshot,
  mockCreep,
  mockContext,
  mockSource,
  mockStructure,
  mockController,
  resetGlobals,
} from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 带真实切比雪夫 getRangeTo 的位置（默认 mockPos.getRangeTo 恒 1，无法辨距）。 */
function posAt(x: number, y: number) {
  return {
    x,
    y,
    roomName: "W7N4",
    getRangeTo(t: { x?: number; y?: number; pos?: { x: number; y: number } }): number {
      const tx = t.x ?? t.pos?.x ?? 0;
      const ty = t.y ?? t.pos?.y ?? 0;
      return Math.max(Math.abs(x - tx), Math.abs(y - ty));
    },
    getDirectionTo(): number {
      return 3; // RIGHT（重定位方向，测试不关心具体值）
    },
  };
}

/** 构建 source#1 几何 + creep（站位由入参决定），返回运行所需对象。 */
function setup(creepX: number, creepY: number, withLink = true) {
  const source = mockSource("src1");
  source.pos = posAt(12, 31);
  const container = mockStructure("container", { id: "cont1", energy: 0, capacity: 2000, hits: 2000, hitsMax: 2000 });
  container.pos = posAt(12, 30);
  const link = mockStructure("link", { id: "link1", energy: 0, capacity: 800 });
  link.pos = posAt(12, 32);
  // 完整网络（2026-08-01）：link 出口判定要求 controller link / storage link 存在，
  // 否则 source link 视为无出口死资产（rcl8-endgame 回归）。补 controller + ctrlLink。
  const controller = mockController({ level: 3, ticksToDowngrade: 20000 });
  controller.pos = posAt(40, 40);
  const ctrlLink = mockStructure("link", { id: "ctrlLink", energy: 0, capacity: 800 });
  ctrlLink.pos = posAt(41, 40);

  const snap = mockSnapshot({
    sources: [source],
    containers: [container],
    links: withLink ? [link, ctrlLink] : [ctrlLink],
    controller,
  });
  const creep = mockCreep({ name: "harvester_1", role: "harvester", used: 40, capacity: 50, mode: "work" });
  creep.memory.sourceId = "src1";
  creep.pos = posAt(creepX, creepY) as never;
  // x<13 为墙（模拟 W7N4 source#1 西侧墙体），迫使 link 站位落到 13,31。
  creep.room.getTerrain = () => ({ get: (x: number, _y: number) => (x < 13 ? 1 : 0) });

  return { creep, ctx: mockContext(snap), source, container, link };
}

describe("harvester — source link 挖矿站位", () => {
  it("站在贴 source+link 的格（13,31）→ 同 tick 倒进 link", () => {
    const { creep, ctx, link } = setup(13, 31);
    harvesterRole.run(creep, ctx);
    // 够到 link（range 1）→ 不重定位，直接倒 link。
    expect(creep.transfer).toHaveBeenCalledWith(link, "energy");
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("站 container 位（13,30）够不到 link → 重定位到 link 站位（同时照常倒 container 不断流）", () => {
    const { creep, ctx, container } = setup(13, 30);
    harvesterRole.run(creep, ctx);
    // 重定位（range-1 move → creep.move）+ 本 tick 仍倒进 container（link range 2 够不到）——采集吞吐不损失。
    expect(creep.move).toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalledWith(container, "energy");
  });

  it("无 source link → 维持 container 站位，不重定位", () => {
    const { creep, ctx, container } = setup(13, 30, false);
    harvesterRole.run(creep, ctx);
    expect(creep.transfer).toHaveBeenCalledWith(container, "energy");
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("range2 source link（container 隔在中间）→ 站 container 上同 tick 倒进 link（(40,44) 场景）", () => {
    // 几何：source@41,46、container@40,45（贴 source，range1）、link@40,44（距 source range2、距 container range1）。
    // 旧口径 sourceAdjacentLink 用 range≤1 到 source → 认不出此 link → 死 link 只灌 container。
    // 新口径 range≤anchorRange(2) + role===source → 识别，harvester 站 container 上即 range1 够到 link → 倒 link。
    const source = mockSource("src2");
    source.pos = posAt(41, 46) as never;
    const container = mockStructure("container", { id: "c2", energy: 0, capacity: 2000, hits: 2000, hitsMax: 2000 });
    container.pos = posAt(40, 45) as never;
    const link = mockStructure("link", { id: "lk2", energy: 0, capacity: 800 });
    link.pos = posAt(40, 44) as never;
    // 完整网络：controller + ctrlLink 提供出口（RCL3 → target=160 > 0）。
    const controller = mockController({ level: 3, ticksToDowngrade: 20000 });
    controller.pos = posAt(30, 30) as never;
    const ctrlLink = mockStructure("link", { id: "ctrlLink2", energy: 0, capacity: 800 });
    ctrlLink.pos = posAt(31, 30) as never;
    const snap = mockSnapshot({
      sources: [source], containers: [container], links: [link, ctrlLink], controller,
    });
    const creep = mockCreep({ name: "harvester_2", role: "harvester", used: 40, capacity: 50, mode: "work" });
    creep.memory.sourceId = "src2";
    creep.pos = posAt(40, 45) as never; // 站在 container 上（贴 source range1、贴 link range1）
    creep.room.getTerrain = () => ({ get: () => 0 }) as never;

    harvesterRole.run(creep, mockContext(snap));

    // range2 的 link 被识别为 source link 并被灌能（link 优先于 container），无需重定位。
    expect(creep.transfer).toHaveBeenCalledWith(link, "energy");
    expect(creep.moveTo).not.toHaveBeenCalled();
  });
});
