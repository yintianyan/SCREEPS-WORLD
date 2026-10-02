/**
 * #82 + #75 —— 布局可观测通道**重新接线**后的两块新读数。
 *
 * 立案理由（都在同一批读数里）：
 *  · `computeLayoutMetrics` 曾经**零调用点**（dist 里连 "layoutMetrics" 字样都没有），
 *    而 `Memory.kernel.layoutMetrics` 里躺着旧二进制的化石值 ⇒ 读者会把它当现值。
 *    现在 `recordLayoutMetrics()` 在每次规划收尾写入，且只写有真实来源的字段。
 *  · #74 摘掉不可满足的 `linkHub` 虚期望之后，真实现场形状（6 只 link 里 3 只挤在
 *    controller range≤2 内、两只恒 0 能量）在账上仍无处可计 —— 缺口审计按
 *    `Math.max(0, expected - have)` 把超配截成 0，而死资产检测只认 role=source。
 *
 * ⚠️本文件最重要的一条是**回归护栏**：超配只进仪表，**绝不进 `shouldPlan` 消费的缺口字典** ——
 *  否则等于把 #74 刚拆掉的那根 gap-force 钉重新钉回去（这次以"死资产"的名义）。
 */
import { describe, expect, it } from "vitest";
import {
  auditLinkRoleGaps,
  auditLinkRoleSurplus,
  mergeLinkRoleGaps,
} from "../../../src/domain/layout/gaps";
import { computeLayoutMetrics } from "../../../src/domain/layout/metrics";
import { mockSnapshot, mockStructure, mockSource, mockController } from "../../support/factories";

function linkAt(x: number, y: number, id: string): any {
  const link = mockStructure("link", { id });
  link.pos = { x, y, roomName: "W7N4" };
  return link;
}

/** 2 source + controller + storage 的分散锚点（与 gaps.test.ts 同口径）。 */
function snapRcl8(links: any[]): any {
  const src1 = mockSource("src1");
  src1.pos = { x: 10, y: 10, roomName: "W7N4" };
  const src2 = mockSource("src2");
  src2.pos = { x: 40, y: 40, roomName: "W7N4" };
  const ctrl = mockController({ level: 8 });
  ctrl.pos = { x: 20, y: 20, roomName: "W7N4" };
  const storage = mockStructure("storage", { id: "stor1" });
  storage.pos = { x: 30, y: 30, roomName: "W7N4" };
  return mockSnapshot({
    rcl: 8,
    controller: ctrl,
    sources: [src1, src2],
    storage: storage as any,
    links: links as any,
  });
}

/** W37S58 现场指纹：6 只 link 全建满，其中 3 只落进 controller range≤2。 */
const FINGERPRINT = [
  linkAt(10, 11, "l_src1"),
  linkAt(40, 41, "l_src2"),
  linkAt(30, 31, "l_stor"),
  linkAt(22, 20, "l_ctrl1"),
  linkAt(20, 18, "l_ctrl2"),
  linkAt(18, 20, "l_ctrl3"),
];

describe("#75 auditLinkRoleSurplus —— 角色超配", () => {
  it("W37S58 指纹：controller 建 3 只要 1 ⇒ 超配 2", () => {
    expect(auditLinkRoleSurplus(snapRcl8(FINGERPRINT), [])).toBe(2);
  });

  it("分布正确时超配为 0（不把'建满了'误报成超配）", () => {
    const balanced = [
      linkAt(10, 11, "a"),
      linkAt(40, 41, "b"),
      linkAt(30, 31, "c"),
      linkAt(22, 20, "d"),
    ];
    expect(auditLinkRoleSurplus(snapRcl8(balanced), [])).toBe(0);
  });

  it("队列里 queued/blocked 的 link 任务计入（避免把'正要建'算成超配）", () => {
    const queue = [
      {
        key: "k1",
        pos: { x: 21, y: 21, roomName: "W7N4" },
        structureType: STRUCTURE_LINK,
        priority: 1,
        state: "queued",
        attempts: 0,
        retryAt: 0,
      },
    ] as never;
    // 已有 3 只 controller 角色 + 队列再来 1 只 controller 角色 ⇒ 超配 3
    expect(auditLinkRoleSurplus(snapRcl8(FINGERPRINT), queue)).toBe(3);
  });

  /**
   * ⚠️回归护栏：超配**不得**变成规划触发器。
   * #74 的病灶就是"不可满足的期望"把 gap-force 永久钉住；超配同样不可由"再建结构"解决
   * （名额已满，出路只有拆/迁＝人工排产），所以它只能进仪表。
   */
  it("超配不进入 shouldPlan 消费的缺口字典（不得把 #74 拆掉的钉钉回去）", () => {
    const snap = snapRcl8(FINGERPRINT);
    expect(auditLinkRoleSurplus(snap, [])).toBe(2); // 仪表看得见
    const roleGaps = auditLinkRoleGaps(snap, []);
    const gaps: Record<string, number> = {};
    mergeLinkRoleGaps(gaps, roleGaps);
    expect(gaps).toEqual({}); // 缺口字典必须为空 ⇒ gap-force 不被触发
  });
});

describe("#82 computeLayoutMetrics —— 新字段的来源标记", () => {
  it("超配数透传；割集未完成时 defenseCutComplete=false 且防御值是占位", () => {
    const snap = snapRcl8(FINGERPRINT);
    const m = computeLayoutMetrics(
      snap,
      {},
      2,
      0,
      0,
      false,
      { cutPositions: [], complete: false },
      "v4",
    );
    expect(m.linkRoleSurplus).toBe(2);
    expect(m.defenseCutComplete).toBe(false);
    expect(m.mvcGapCount).toBe(0);
  });

  it("割集算完 ⇒ defenseCutComplete=true（读者能分辨测量值与占位值）", () => {
    const snap = snapRcl8(FINGERPRINT);
    const m = computeLayoutMetrics(
      snap,
      {},
      0,
      0,
      0,
      false,
      { cutPositions: [{ x: 10, y: 10 }], complete: true },
      "v4",
    );
    expect(m.defenseCutComplete).toBe(true);
    expect(m.linkRoleSurplus).toBe(0);
  });
});
