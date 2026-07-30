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
import {
  getDistributorFillTarget,
  hasDistributorFillDemand,
} from "../../../src/creeps/support/targeting";
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

  it("有正在供能的 controller link（有能量）时不碰 controller container", () => {
    const cc = struct("container", 10, 10, 0, 2000); // 空，free>0
    const tower = struct("tower", 20, 20, 0, 1000);
    const controllerLink = struct("link", 11, 11, 400, 800); // 有能量=正在供能，距 controller(10,10) 为 1
    const snap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [cc, tower] as any,
      controllerContainer: cc as any,
      links: [controllerLink] as any,
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    // spawn/extension 无空闲 → 应选 tower，绝不选 controller container（link 供能）。
    const target = getDistributorFillTarget(creep as any, snap);
    expect(target?.id).toBe(tower.id);
  });

  it("无 spawn/extension 时选 tower（防御次之）", () => {
    const tower = struct("tower", 20, 20, 0, 1000);
    const cc = struct("container", 10, 10, 0, 2000);
    const controllerLink = struct("link", 11, 11, 400, 800); // 供能中
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

describe("getDistributorFillTarget — 水位档位过滤", () => {
  it("tier 3 仍服务 extension（extension 与 spawn 同属孵化能量池）", () => {
    const ext = struct("extension", 28, 28, 0, 50);
    const tower = struct("tower", 20, 20, 0, 1000);
    const snap = mockSnapshot({ fillTargets: [tower, ext] as any, links: [] });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    const target = getDistributorFillTarget(creep as any, snap, 3);
    expect(target?.id).toBe(ext.id);
  });

  it("tier 1-2 战备线：tower 低于弹药地板时补给（战后弹药真空解除不等满仓）", () => {
    const tower = struct("tower", 20, 20, 70, 1000); // 70 < 地板 500
    const snap = mockSnapshot({ fillTargets: [tower] as any, links: [] });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    expect(getDistributorFillTarget(creep as any, snap, 1)?.id).toBe(tower.id);
    expect(getDistributorFillTarget(creep as any, snap, 2)?.id).toBe(tower.id);
  });

  it("tier 1-2 战备线：tower 已达地板则不补（补满是 tier 0 的事）", () => {
    const tower = struct("tower", 20, 20, 600, 1000); // 600 ≥ 地板 500
    const snap = mockSnapshot({ fillTargets: [tower] as any, links: [] });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    expect(getDistributorFillTarget(creep as any, snap, 1)).toBeUndefined();
  });

  it("tier 3 跳过 tower（生存优先，即使低于地板）", () => {
    const tower = struct("tower", 20, 20, 0, 1000);
    const snap = mockSnapshot({ fillTargets: [tower] as any, links: [] });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    expect(getDistributorFillTarget(creep as any, snap, 3)).toBeUndefined();
  });

  it("tier 1 兜底 controller container（与 upgrader 的 sustainedStorage 调度对齐）", () => {
    const cc = struct("container", 10, 10, 0, 2000);
    const snap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [cc] as any,
      controllerContainer: cc as any,
      links: [],
    });
    const creep = mockCreep({ pos: mockPos(25, 25) });

    expect(getDistributorFillTarget(creep as any, snap, 1)?.id).toBe(cc.id);
    // tier 2（storage < sustained）不再兜底 — 该水位不该养站桩升级。
    expect(getDistributorFillTarget(creep as any, snap, 2)).toBeUndefined();
  });
});

describe("hasDistributorFillDemand — 取能门禁口径", () => {
  it("spawn/extension 需求在所有档位都成立", () => {
    const ext = struct("extension", 28, 28, 0, 50);
    const snap = mockSnapshot({ fillTargets: [ext] as any, links: [] });

    expect(hasDistributorFillDemand(snap, 0)).toBe(true);
    expect(hasDistributorFillDemand(snap, 3)).toBe(true);
  });

  it("仅 tower 需求：tier 0 恒成立；tier 1-2 按弹药地板判定；tier 3 不成立", () => {
    const emptyTower = struct("tower", 20, 20, 70, 1000); // 70 < 地板 500
    const armedTower = struct("tower", 22, 22, 600, 1000); // 600 ≥ 地板
    const belowFloor = mockSnapshot({ fillTargets: [emptyTower] as any, links: [] });
    const atFloor = mockSnapshot({ fillTargets: [armedTower] as any, links: [] });

    expect(hasDistributorFillDemand(belowFloor, 0)).toBe(true);
    expect(hasDistributorFillDemand(belowFloor, 1)).toBe(true);
    expect(hasDistributorFillDemand(belowFloor, 3)).toBe(false);
    // 已达战备线：tier 0 仍要补满，tier 1-2 无需求（不为满弹塔取能防携能 idle）。
    expect(hasDistributorFillDemand(atFloor, 0)).toBe(true);
    expect(hasDistributorFillDemand(atFloor, 1)).toBe(false);
  });

  it("controller container 兜底需求：tier 0-1 且无「正在供能的」controller link 时成立", () => {
    const cc = struct("container", 10, 10, 0, 2000);
    const servingLink = struct("link", 11, 11, 400, 800); // 有能量 = 正在供能
    const deadLink = struct("link", 11, 11, 0, 800);       // 空 = 网络未通
    const noLinkSnap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [] as any,
      controllerContainer: cc as any,
      links: [],
    });
    const servingLinkSnap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [] as any,
      controllerContainer: cc as any,
      links: [servingLink] as any,
    });
    const deadLinkSnap = mockSnapshot({
      controller: { pos: mockPos(10, 10) } as any,
      fillTargets: [] as any,
      controllerContainer: cc as any,
      links: [deadLink] as any,
    });

    expect(hasDistributorFillDemand(noLinkSnap, 0)).toBe(true);
    expect(hasDistributorFillDemand(noLinkSnap, 1)).toBe(true);
    // tier 2（storage < sustained）不兜底 — 与 upgrader 调度水位对齐。
    expect(hasDistributorFillDemand(noLinkSnap, 2)).toBe(false);
    // 正在供能的 controller link（有能量）→ container 由 link 网络供能，不构成需求。
    expect(hasDistributorFillDemand(servingLinkSnap, 0)).toBe(false);
    // link 在场但空（网络未通）→ distributor 接管 cc，构成需求（① 核心行为）。
    expect(hasDistributorFillDemand(deadLinkSnap, 0)).toBe(true);
  });

  it("无任何需求时不成立", () => {
    const snap = mockSnapshot({ fillTargets: [] as any, links: [] });
    expect(hasDistributorFillDemand(snap, 0)).toBe(false);
  });
});
