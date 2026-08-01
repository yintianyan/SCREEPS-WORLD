/**
 * harvester source-link 灌能出口判定（2026-08-01 健壮性回归）。
 *
 * 背景：rcl8-endgame 5000t 稳定性测试抓到缺陷——布局只有 source link +
 * controller link、无 storage link 时，RCL8 停供后 source link 能量无处可去
 * → link 积压 → container 满 → drop 衰减 → 能量持续下降（deathSpiral）。
 * 修复：harvester 只在 link 有下游出口（storage link 存在，或 controller
 * 按需求驱动目标仍有需求）时灌 link；否则灌 container 走 hauler 物流。
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
      return 3;
    },
  };
}

/**
 * 几何：source@10,10、source link@11,10、container@9,10（站桩位）、
 * controller@20,20、ctrlLink@21,20、storage@30,30、storageLink@31,30。
 * creep 预置于 link 站位 (10,11)——同时贴 source 与 link，灌 link 路径就绪。
 */
function setup(opts: { withStorageLink: boolean; rcl: number; ctrlLinkEnergy?: number }) {
  const { withStorageLink, rcl, ctrlLinkEnergy = 799 } = opts;
  const source = mockSource("src1");
  source.pos = posAt(10, 10);
  const link = mockStructure("link", { id: "link1", energy: 0, capacity: 800 });
  link.pos = posAt(11, 10);
  const container = mockStructure("container", { id: "cont1", energy: 0, capacity: 2000 });
  container.pos = posAt(9, 10);
  const controller = mockController({ level: rcl, ticksToDowngrade: 20000 });
  controller.pos = posAt(20, 20);
  const ctrlLink = mockStructure("link", { id: "ctrlLink", energy: ctrlLinkEnergy, capacity: 800 });
  ctrlLink.pos = posAt(21, 20);

  const links = [link, ctrlLink];
  let storage: any;
  if (withStorageLink) {
    storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
    storage.pos = posAt(30, 30);
    const storageLink = mockStructure("link", { id: "stLink", energy: 0, capacity: 800 });
    storageLink.pos = posAt(31, 30);
    links.push(storageLink);
  }

  const snap = mockSnapshot({
    rcl,
    sources: [source],
    containers: [container],
    links,
    controller,
    storage,
  });
  // 满载（used=50/50）：harvest 后立即触发同 tick 倒能。
  const creep = mockCreep({ name: "harvester_1", role: "harvester", used: 50, capacity: 50, mode: "acquire" });
  creep.pos = posAt(10, 11) as never;
  creep.room = { name: "W7N4", getTerrain: () => ({ get: () => 0 }), lookForAt: () => [], findExitTo: () => 3 } as never;
  const ctx = mockContext(snap);
  return { creep, container, link, snap, ctx };
}

describe("harvester — source link 灌能出口判定", () => {
  beforeEach(() => resetGlobals());

  it("RCL8 停供 + 无 storage link（rcl8-endgame 回归场景）→ 灌 container 而非死 link", () => {
    const { creep, container, link, ctx } = setup({ withStorageLink: false, rcl: 8 });

    harvesterRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(container, "energy");
    expect(creep.transfer).not.toHaveBeenCalledWith(link, "energy");
  });

  it("有 storage link（能量可瞬移进 hub）→ 正常灌 source link", () => {
    const { creep, link, ctx } = setup({ withStorageLink: true, rcl: 8 });

    harvesterRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(link, "energy");
  });

  it("RCL<8 + controller 有升级需求（target>0）→ 灌 source link", () => {
    const { creep, link, ctx } = setup({ withStorageLink: false, rcl: 6, ctrlLinkEnergy: 0 });

    harvesterRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(link, "energy");
  });
});
