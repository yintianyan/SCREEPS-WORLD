/** Phase 1：FlowPlan → deliver 任务映射与 distributor 认领规则。 */
import { describe, expect, it } from "vitest";
import {
  buildFlowDeliverTasks,
  flowDeliverTaskId,
  type FlowDeliverContext,
} from "../../../src/domain/assignment/flow-tasks";
import { chooseTaskForRole } from "../../../src/domain/assignment/service";
import type { RoomFlowPlan } from "../../../src/domain/logistics/flow-types";

const plan: RoomFlowPlan = {
  tick: 100,
  allocations: [
    {
      lane: "upgrade",
      groupId: "upgrade",
      via: "link",
      fromId: "st",
      toId: "cl",
      rate: 20,
      carriersNeeded: 1,
      priority: 2,
    },
    {
      lane: "upgrade",
      groupId: "upgrade",
      via: "creep",
      fromId: "stor",
      toId: "upgrade",
      rate: 9,
      carriersNeeded: 2,
      priority: 2,
    },
  ],
  unmet: [],
  totalCreepRate: 9,
};

const ctx: FlowDeliverContext = {
  roomName: "W8N3",
  lane: "upgrade",
  priority: 2,
  linkFeederSourceId: "stor",
  linkFeederTargetId: "st",
  linkFeederPos: { x: 22, y: 18 },
  creepSourceId: "stor",
  creepTargetId: "cc",
  creepTargetPos: { x: 22, y: 41 },
};

describe("buildFlowDeliverTasks", () => {
  it("link 与 creep 分配各生成 1 条 deliver 任务，id/源/目标/maxWorkers 正确", () => {
    const tasks = buildFlowDeliverTasks(plan, ctx);
    expect(tasks).toHaveLength(2);

    const linkTask = tasks.find(t => t.id.endsWith(":link"))!;
    expect(linkTask.id).toBe(flowDeliverTaskId("W8N3", "upgrade", "upgrade", "link"));
    expect(linkTask.kind).toBe("deliver");
    expect(linkTask.sourceId).toBe("stor");
    expect(linkTask.targetId).toBe("st");
    expect(linkTask.maxWorkers).toBe(1);
    expect(linkTask.priority).toBe(2);

    const creepTask = tasks.find(t => t.id.endsWith(":creep"))!;
    expect(creepTask.sourceId).toBe("stor");
    expect(creepTask.targetId).toBe("cc");
    expect(creepTask.maxWorkers).toBe(2);
  });

  it("缺失任一端的 context → 不生成对应任务", () => {
    const linkOnly = buildFlowDeliverTasks(plan, {
      ...ctx,
      creepSourceId: undefined,
      creepTargetId: undefined,
    });
    expect(linkOnly).toHaveLength(1);
    expect(linkOnly[0]!.id.endsWith(":link")).toBe(true);

    const creepOnly = buildFlowDeliverTasks(plan, {
      ...ctx,
      linkFeederSourceId: undefined,
      linkFeederTargetId: undefined,
    });
    expect(creepOnly).toHaveLength(1);
    expect(creepOnly[0]!.id.endsWith(":creep")).toBe(true);
  });

  it("carriersNeeded=0 的分配被跳过", () => {
    const zeroPlan: RoomFlowPlan = {
      ...plan,
      allocations: [{ ...plan.allocations[0]!, carriersNeeded: 0 }],
    };
    expect(buildFlowDeliverTasks(zeroPlan, ctx)).toEqual([]);
  });

  it("Phase 2 core 汇组任务：targetGroup=core、targetId 缺省；distributor 优先认领 core", () => {
    const corePlan: RoomFlowPlan = {
      tick: 100,
      allocations: [
        {
          lane: "core",
          groupId: "core",
          via: "creep",
          fromId: "stor",
          toId: "core",
          rate: 20,
          carriersNeeded: 2,
          priority: 0,
        },
        ...plan.allocations,
      ],
      unmet: [],
      totalCreepRate: 20,
    };
    const coreTasks = buildFlowDeliverTasks(corePlan, {
      roomName: "W8N3",
      lane: "core",
      priority: 0,
      groupId: "core",
      creepSourceId: "stor",
      creepTargetGroup: "core",
      creepTargetPos: { x: 17, y: 15 },
    });
    expect(coreTasks).toHaveLength(1);
    expect(coreTasks[0]!.targetGroup).toBe("core");
    expect(coreTasks[0]!.targetId).toBeUndefined();
    expect(coreTasks[0]!.kind).toBe("deliver");
    expect(chooseTaskForRole("distributor", coreTasks)?.targetGroup).toBe("core");
  });

  it("distributor 按距离认领 deliver；hauler 不接 deliver", () => {
    const tasks = buildFlowDeliverTasks(plan, ctx);
    expect(chooseTaskForRole("distributor", tasks)?.kind).toBe("deliver");
    expect(chooseTaskForRole("distributor", tasks, { x: 22, y: 41 })?.targetId).toBe("cc");
    expect(chooseTaskForRole("hauler", tasks)).toBeUndefined();
    expect(chooseTaskForRole("builder", tasks)).toBeUndefined();
  });
});
