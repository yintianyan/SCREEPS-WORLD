/** 采购需求信道回归测试（多生产者合并 + 持久化）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalCache, publishProcurementDemands } from "../../../src/kernel/global-cache";
import type { ProcurementDemand } from "../../../src/kernel/global-cache";
import { collectDemands } from "../../../src/domain/industry/procurement";
import { resetGlobals } from "../../role-helpers";

function demand(resource: string, amount: number, priority: number, deadline: number, reason: string): ProcurementDemand {
  return { resource, amount, priority, deadline, reason };
}

beforeEach(() => {
  resetGlobals();
  delete (globalThis as { procurementDemands?: unknown }).procurementDemands;
});

describe("procurement channel — 多生产者合并语义", () => {
  it("不同生产者的异资源需求并存（修复整表覆写）", () => {
    publishProcurementDemands("W37S58", [demand("H", 500, 25, 1250, "lab-reaction")], 1000);
    publishProcurementDemands("W37S58", [demand("U", 300, 12, 1150, "factory-commodity")], 1010);
    const room = globalCache().procurementDemands!.byRoom.W37S58!;
    expect(room).toHaveLength(2);
    expect(room.map((d) => d.resource).sort()).toEqual(["H", "U"]);
  });

  it("同资源新发布覆盖旧条目（取新量与新截止）", () => {
    publishProcurementDemands("W37S58", [demand("H", 500, 25, 1100, "lab-reaction")], 1000);
    publishProcurementDemands("W37S58", [demand("H", 700, 28, 1300, "lab-reaction")], 1020);
    const room = globalCache().procurementDemands!.byRoom.W37S58!;
    expect(room).toHaveLength(1);
    expect(room[0]).toMatchObject({ resource: "H", amount: 700, priority: 28, deadline: 1300 });
  });

  it("写入时丢弃已过期存量（防僵尸需求累积）", () => {
    publishProcurementDemands("W37S58", [demand("H", 500, 25, 1050, "lab-reaction")], 1000);
    // tick 推进到 1100：H 的 deadline=1050 已过期
    publishProcurementDemands("W37S58", [demand("U", 300, 12, 1400, "factory-commodity")], 1100);
    const room = globalCache().procurementDemands!.byRoom.W37S58!;
    expect(room.map((d) => d.resource)).toEqual(["U"]);
  });

  it("跨 tick 持久化：容器不被后续 tick 清空（旧 tick 守卫回归）", () => {
    publishProcurementDemands("W37S58", [demand("H", 500, 25, 1500, "lab-reaction")], 1000);
    // 模拟下一 tick 另一房发布 —— 旧实现会因 tick 守卫重建空容器
    publishProcurementDemands("W38S59", [demand("K", 120, 20, 1600, "boost")], 1001);
    const byRoom = globalCache().procurementDemands!.byRoom;
    expect(byRoom.W37S58).toHaveLength(1);
    expect(byRoom.W38S59).toHaveLength(1);
  });
});

describe("procurement channel — 消费端视图（collectDemands 集成）", () => {
  it("合并后的表经 collectDemands 按 priority 降序输出且过滤过期", () => {
    publishProcurementDemands("W37S58", [
      demand("H", 500, 25, 1600, "lab-reaction"),
      demand("ZK", 80, 30, 1900, "lab-reaction"),
    ], 1000);
    publishProcurementDemands("W37S58", [demand("U", 300, 12, 1700, "factory-commodity")], 1010);
    const all = collectDemands(globalCache().procurementDemands!.byRoom, 1020);
    expect(all.map((d) => d.resource)).toEqual(["ZK", "H", "U"]); // priority 降序
    // deadline 过滤：tick=1750 越过 H(1600)/U(1700)，仅高优先 ZK(1900) 存活
    const later = collectDemands(globalCache().procurementDemands!.byRoom, 1750);
    expect(later.map((d) => d.resource)).toEqual(["ZK"]);
  });
});
