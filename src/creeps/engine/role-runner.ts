/**
 * RoleRunner — 共享角色生命周期 + Action-Candidate 评估引擎。
 *
 * 所有角色共享的 tick 管线：
 *   1. ensureHome — 确认在 home 房间
 *   2. getSnapshot — 获取本 tick 房间快照
 *   3. shouldFlee — 敌人检测 → flee
 *   4. updateMode — FSM 状态转换
 *   5. gate — 角色级门禁（CPU tier / 能量地板等）
 *   6. getAssignment — 获取/续约任务
 *   7. 按 mode 选择 policy 分支 → 遍历 candidates → 执行第一个匹配的
 *   8. 无匹配 → idle
 *
 * 角色文件只需声明 RolePolicy，不再包含生命周期样板。
 */
import type { CreepRole, Priority, TickContext } from "../../kernel/contracts";
import type { ActionContext, RolePolicy } from "./action-types";
import { ensureHome, flee, getAssignment, moveToTarget, shouldFlee, updateMode } from "../support";
import { parkIdleCreep } from "../movement";

/**
 * 创建一个由 RolePolicy 驱动的 CreepRole。
 *
 * @param name     角色名（用于注册和 telemetry）
 * @param priority 调度优先级 P0-P4
 * @param policy   声明式行为策略
 */
export function defineRole(name: string, priority: Priority, policy: RolePolicy): CreepRole {
  return {
    name,
    priority,
    run(creep: Creep, ctx: TickContext): void {
      // ── 1. 确认在 home 房间 ──
      if (!ensureHome(creep)) {
        creep.memory.mode = "idle";
        return;
      }

      // ── 2. 获取房间快照 ──
      const snapshot = ctx.getSnapshot(creep.memory.home!);
      if (!snapshot) return;

      // ── 2.5 B1：已标记回收的 creep 停止一切角色工作（移动由 spawn-manager 接管）──
      if (creep.memory.recycle) {
        creep.memory.mode = "idle";
        return;
      }

      // ── 3. 敌人检测 → flee ──
      if (shouldFlee(creep, snapshot)) {
        creep.memory.mode = "flee";
        flee(creep, snapshot);
        return;
      }

      // ── 4. FSM 状态转换 ──
      updateMode(creep);

      // ── 5. 获取/续约任务 ──
      const assignment = getAssignment(creep, ctx);

      // ── 6. 构建 ActionContext ──
      const ac: ActionContext = {
        creep,
        snapshot,
        assignment,
        budget: ctx.budget,
        ctx,
      };

      // ── 7. 角色级门禁 ──
      if (policy.gate && !policy.gate(ac)) {
        creep.memory.mode = "idle";
        return;
      }

      // ── 8. 按 mode 选择候选列表并评估 ──
      const candidates = creep.memory.mode === "work" ? policy.work : policy.acquire;
      for (const candidate of candidates) {
        if (candidate.predicate(ac)) {
          candidate.execute(ac);
          return;
        }
      }

      // ── 9. 无匹配候选 → idle（移动角色先归位再 idle）──
      if (policy.park) {
        parkIdleCreep(creep, snapshot);
      }
      creep.memory.mode = "idle";
    },
  };
}

// ─── 通用 execute 辅助 ──────────────────────────────────────

/** 对目标执行操作；ERR_NOT_IN_RANGE 时移动。返回操作结果码。 */
export function actOrMove(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
): number {
  const result = action();
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, target);
  }
  return result;
}
