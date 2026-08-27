/** MVC link 角色缺口端到端测试（link 角色期望表）。 */
import { describe, expect, it } from "vitest";
import { auditStructureGaps, auditLinkRoleGaps, mergeLinkRoleGaps } from "../../../src/domain/layout/gaps";
import type { RoomSnapshot } from "../../../src/kernel/contracts";
import { mockSnapshot } from "../../role-helpers";

// ── 位置布局（W3N7 复刻）──
// source1 @ (10,10)、source2 @ (40,40)
// controller @ (20,40)
// link 紧邻对应结构（Chebyshev≤2 才被 classifyLinkRole 识别）
const SRC1 = { x: 10, y: 10 };
const SRC2 = { x: 40, y: 40 };
const CTRL = { x: 20, y: 40 };

function linkAt(x: number, y: number, id: string, energy = 0): StructureLink {
  return {
    id,
    pos: { x, y, roomName: "W3N7" },
    structureType: STRUCTURE_LINK,
    store: {
      getUsedCapacity: () => energy,
      getCapacity: () => 800,
      getFreeCapacity: () => 800 - energy,
    },
  } as unknown as StructureLink;
}

function linkTaskAt(x: number, y: number, state: BuildTask["state"] = "queued"): BuildTask {
  return {
    key: `link.W3N7.${x}.${y}`,
    pos: { x, y, roomName: "W3N7" },
    structureType: STRUCTURE_LINK,
    priority: 1,
    state,
    attempts: 0,
    retryAt: 0,
  };
}

/** 端到端：审计结构缺口 + 合并 link 角色缺口，返回最终 gaps 字典。 */
function auditFull(snapshot: RoomSnapshot, queue: BuildTask[] = []): Record<string, number> {
  const gaps = auditStructureGaps(snapshot, queue);
  mergeLinkRoleGaps(gaps, auditLinkRoleGaps(snapshot, queue));
  return gaps;
}

describe("MVC link 角色缺口 — RCL5 端到端", () => {
  it("完美配置：1 source link + 1 controller link → 无 link 缺口", () => {
    // source1 link @ (10,11) 紧邻 source1，controller link @ (20,41) 紧邻 controller。
    // 注意：mockSource 默认 pos=(25,25)，需覆盖 source 位置才能让 link 角色被识别。
    const snap = mockSnapshot({
      roomName: "W3N7",
      rcl: 5,
      sources: [
        { id: "src1", pos: SRC1 } as unknown as Source,
        { id: "src2", pos: SRC2 } as unknown as Source,
      ],
      controller: { id: "ctrl", pos: CTRL, level: 5, my: true } as unknown as StructureController,
      links: [linkAt(10, 11, "link_src1"), linkAt(20, 41, "link_ctrl")],
      storage: undefined,
    });

    const gaps = auditFull(snap, []);

    // link 总数 2 = CONTROLLER_STRUCTURES[link][5]，且角色分布正确 → 无 link 缺口。
    expect(gaps[STRUCTURE_LINK]).toBeUndefined();
    expect(gaps.linkSource).toBeUndefined();
    expect(gaps.linkController).toBeUndefined();
  });

  it("W3N7 死资产场景：2 source link + 0 controller → controller 缺口暴露", () => {
    // 2 个 source link（死资产，energy=0），总数满足但 controller link 缺失。
    const snap = mockSnapshot({
      roomName: "W3N7",
      rcl: 5,
      sources: [
        { id: "src1", pos: SRC1 } as unknown as Source,
        { id: "src2", pos: SRC2 } as unknown as Source,
      ],
      controller: { id: "ctrl", pos: CTRL, level: 5, my: true } as unknown as StructureController,
      links: [linkAt(10, 11, "link_src1"), linkAt(40, 41, "link_src2")],
      storage: undefined,
    });

    const gaps = auditFull(snap, []);

    // 关键断言：角色感知暴露 controller 缺口（旧 auditStructureGaps 会报 link:0）。
    expect(gaps[STRUCTURE_LINK]).toBeUndefined(); // 总缺口被角色缺口替换
    expect(gaps.linkController).toBe(1); // controller link 缺 1
    expect(gaps.linkSource).toBeUndefined(); // source 已有 2（超过 MVC 期望 1）
  });

  it("队列有 controller link 任务 → 缺口闭合（queued 任务计入已有）", () => {
    // 2 source link 已建 + controller link 在队列中（queued）。
    const snap = mockSnapshot({
      roomName: "W3N7",
      rcl: 5,
      sources: [
        { id: "src1", pos: SRC1 } as unknown as Source,
        { id: "src2", pos: SRC2 } as unknown as Source,
      ],
      controller: { id: "ctrl", pos: CTRL, level: 5, my: true } as unknown as StructureController,
      links: [linkAt(10, 11, "link_src1"), linkAt(40, 41, "link_src2")],
      storage: undefined,
    });
    const queue: BuildTask[] = [linkTaskAt(20, 41, "queued")];

    const gaps = auditFull(snap, queue);

    // controller link 任务在队列中 → 角色缺口闭合。
    expect(gaps.linkController).toBeUndefined();
    expect(gaps[STRUCTURE_LINK]).toBeUndefined();
  });

  it("done 状态任务不计入已有（替代已建成但死资产仍在 → 应报缺口）", () => {
    // 2 source link 已建 + controller link 任务状态=done（已建成但可能也是死资产）。
    // done 任务不应计入已有 —— 实际结构若存在会被 snapshot.links 覆盖，
    // done 任务代表"替代已建成但旧死资产仍在"，应走 fallback 而非隐藏缺口。
    const snap = mockSnapshot({
      roomName: "W3N7",
      rcl: 5,
      sources: [
        { id: "src1", pos: SRC1 } as unknown as Source,
        { id: "src2", pos: SRC2 } as unknown as Source,
      ],
      controller: { id: "ctrl", pos: CTRL, level: 5, my: true } as unknown as StructureController,
      links: [linkAt(10, 11, "link_src1"), linkAt(40, 41, "link_src2")],
      storage: undefined,
    });
    const queue: BuildTask[] = [linkTaskAt(20, 41, "done")];

    const gaps = auditFull(snap, queue);

    // done 任务不计入 → controller 缺口仍报。
    expect(gaps.linkController).toBe(1);
  });

  it("单 source 房 → source 缺口上限 1（min(MVC, sources.length)）", () => {
    // 单 source 房 RCL5：MVC 表期望 source=1，但若 0 个 source link → source 缺口 1。
    // 不会因 MVC 表硬要 2 个 source link 而虚报缺口（RCL8 时才期望 2）。
    const snap = mockSnapshot({
      roomName: "W1N1",
      rcl: 5,
      sources: [{ id: "src1", pos: SRC1 } as unknown as Source],
      controller: { id: "ctrl", pos: CTRL, level: 5, my: true } as unknown as StructureController,
      links: [], // 无任何 link
      storage: undefined,
    });

    const gaps = auditFull(snap, []);

    // source 缺口 = min(1, sources.length=1) - 0 = 1（不虚报 2）。
    expect(gaps.linkSource).toBe(1);
    expect(gaps.linkController).toBe(1);
  });

  it("RCL5 几何受限标记不影响缺口报告（linkConstrained 是拆改侧标记）", () => {
    // linkConstrained 标记由 link-system 在拆改 fallback 时设置，
    // 语义是"controller+storage link 都几何放不下，不再尝试拆改"。
    // 但缺口审计应继续报告真实缺口 —— 受限不等于不需要，只是无法满足。
    const snap = mockSnapshot({
      roomName: "W3N7",
      rcl: 5,
      sources: [
        { id: "src1", pos: SRC1 } as unknown as Source,
        { id: "src2", pos: SRC2 } as unknown as Source,
      ],
      controller: { id: "ctrl", pos: CTRL, level: 5, my: true } as unknown as StructureController,
      links: [linkAt(10, 11, "link_src1")], // 只有 1 source link
      storage: undefined,
    });

    // 即使外部标记了 linkConstrained（这里不实际调用 markLinkConstrained，
    // 因为缺口审计是纯函数，不读取 linkConstrained 状态），缺口仍应报告。
    const gaps = auditFull(snap, []);

    expect(gaps.linkController).toBe(1); // controller 仍缺
    // source 缺口：MVC 期望 1，已有 1 → 0（不报）
    expect(gaps.linkSource).toBeUndefined();
  });
});
