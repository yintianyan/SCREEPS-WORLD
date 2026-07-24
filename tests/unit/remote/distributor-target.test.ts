/**
 * getDistributorFillTarget 单测 — distributor 专用填充目标优先级。
 *
 * 修复背景：distributor 旧实现复用 hauler 专用的 getHaulFillTarget，其 #0 优先是
 * controller container（< 半满即派），导致 distributor 被 divert 去喂升级无底洞，
 * spawn/extension 长期排第二。本函数确立 distributor 的正确优先级：
 *   1. spawn / extension（生产引擎，绝对最高，威胁下也不让位 tower）
 *   2. tower（防御）
 *   3. controller container（仅当无 controller link 时兜底）
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getDistributorFillTarget } from "../../../src/creeps/support/targeting";
import { resetGlobals, mockSnapshot, mockStructure, mockCreep, mockPos } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 构建带指定位置与能量的结构 mock（位置可控，便于断言选择结果）。 */
function struct(type: string, x: number, y: number, energy = 0, capacity = 1000) {
  const s = mockStructure(type, { energy, capacity });
  s.pos = mockPos(x, y);
  return s;
}

describe("getDistributorFillTarget — 优先级", () => {
  it("spawn 有空闲时优先 spawn，即使 controller container 空且无 link", () => {
    const spawn = struct("spawn", 30, 30, 0, 300);
    const cc = struct("container", 10, 10, 0, 2000); // 空 controller container（free>0）
    const snap = mockSnapshot({
      fillTargets: [cc, spawn] as any, // cc 排在前面，验证优先级而非顺序
      controllerContainer: cc as any,
      links: [], // 无 controller link
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    const target = getDistributorFillTarget(creep as any, snap);
    expect(target?.id).toBe(spawn.id);
  });

  it("extension 有空闲时优先 extension 而非 controller container", () => {
    const ext = struct("extension", 28, 28, 0, 50);
    const cc = struct("container", 10, 10, 0, 2000);
    const snap = mockSnapshot({
      fillTargets: [cc, ext] as any,
      controllerContainer: cc as any,
      links: [],
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    const target = getDistributorFillTarget(creep as any, snap);
    expect(target?.id).toBe(ext.id);
  });

  it("有 controller link 时完全不碰 controller container（即使它空着）", () => {
    const cc = struct("container", 10, 10, 0, 2000); // 空，free>0
    const tower = struct("tower", 20, 20, 0, 1000);
    const controllerLink = struct("link", 11, 11, 0, 800); // 距 controller(10,10) 为 1 <= 2
    const snap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [cc, tower] as any,
      controllerContainer: cc as any,
      links: [controllerLink] as any,
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    // spawn/extension 无空闲 → 应选 tower，绝不选 controller container（link 独占供能）。
    const target = getDistributorFillTarget(creep as any, snap);
    expect(target?.id).toBe(tower.id);
  });

  it("无 spawn/extension 时选 tower（防御次之）", () => {
    const tower = struct("tower", 20, 20, 0, 1000);
    const cc = struct("container", 10, 10, 0, 2000);
    const controllerLink = struct("link", 11, 11, 0, 800);
    const snap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [cc, tower] as any,
      controllerContainer: cc as any,
      links: [controllerLink] as any,
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    const target = getDistributorFillTarget(creep as any, snap);
    expect(target?.id).toBe(tower.id);
  });

  it("威胁存在时仍优先 spawn/extension（生产引擎不让位 tower）", () => {
    const spawn = struct("spawn", 30, 30, 0, 300);
    const tower = struct("tower", 20, 20, 0, 1000);
    const hostile = { id: "h1", name: "h1", pos: mockPos(15, 15), owner: { username: "enemy" } };
    const snap = mockSnapshot({
      fillTargets: [spawn, tower] as any,
      threatCreeps: [hostile] as any,
      links: [],
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    // 与 hauler 不同：distributor 在威胁下仍先喂 spawn（产不出防御 creep 才是真灾难）。
    const target = getDistributorFillTarget(creep as any, snap);
    expect(target?.id).toBe(spawn.id);
  });

  it("无 controller link 时兜底填 controller container（RCL4 无 link 窗口期）", () => {
    const cc = struct("container", 10, 10, 0, 2000); // 空，free>0
    const snap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [cc] as any, // 仅 controller container 需填充
      controllerContainer: cc as any,
      links: [], // 无 link → 兜底生效
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    const target = getDistributorFillTarget(creep as any, snap);
    expect(target?.id).toBe(cc.id);
  });

  it("controller container 已满时不选它（无空闲）", () => {
    const cc = struct("container", 10, 10, 2000, 2000); // 满，free=0
    const snap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [] as any, // room-snapshot 已按 free>0 过滤，满的不在 fillTargets
      controllerContainer: cc as any,
      links: [],
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    // fillTargets 空 → 直接返回 undefined。
    const target = getDistributorFillTarget(creep as any, snap);
    expect(target).toBeUndefined();
  });

  it("fillTargets 为空时返回 undefined", () => {
    const snap = mockSnapshot({ fillTargets: [] as any });
    const creep = mockCreep({ pos: mockPos(25, 25) });
    expect(getDistributorFillTarget(creep as any, snap)).toBeUndefined();
  });
});
