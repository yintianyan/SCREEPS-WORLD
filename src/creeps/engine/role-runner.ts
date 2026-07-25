/**
 * RoleRunner — 共享角色生命周期 + Action-Candidate 评估引擎。
 *
 * 所有角色共享的 tick 管线：
 *   1. getSnapshot — 获取 home 房快照（home 恒为自有房）
 *   2. recycle — 已标记回收则停止角色工作
 *   3. shouldFlee — 敌人检测 → flee（先于导航：外部房间扫当前房，home 房用 snapshot）
 *   4. ensureHome — 确认在目标房间（home 或 remoteTarget），不在则导航
 *   5. updateMode — FSM 状态转换
 *   6. getAssignment — 获取/续约任务
 *   7. gate — 角色级门禁（CPU tier / 能量地板等）
 *   8. 按 mode 选择 policy 分支 → 遍历 candidates → 执行第一个匹配的
 *   9. 无匹配 → idle（移动角色先归位）
 *
 * 威胁检测排在导航之前是关键：远矿角色在过境中间房遇袭时，ensureHome 会短路导航
 * （返回 false 提前 return），若威胁检测在其后则永远轮不到——故必须先检测威胁再导航。
 *
 * 状态指示灯（drawStatusLight）：在 try/finally 的 finally 块统一绘制，
 * 覆盖所有 return 路径（含异常）——出错 creep 也会亮灯，便于定位故障单位。
 *
 * 角色文件只需声明 RolePolicy，不再包含生命周期样板。
 */
import type { CreepRole, Priority, TickContext } from "../../kernel/contracts";
import type { ActionContext, RolePolicy } from "./action-types";
import { ensureHome, flee, getAssignment, moveToTarget, shouldFlee, shouldFleeForeignRoom, fleeToHome, updateMode } from "../support";
import { parkIdleCreep } from "../movement";
import { drawStatusLight } from "./status-light";

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
      // try/finally 保证所有 return 路径（含异常）都绘制状态指示灯。
      // finally 块在 CONFIG.debug.statusLight 关闭时为零开销（函数内首行即 return）。
      try {
        // ── 1. 获取 home 房快照（home 恒为自有房，快照必存在）──
        const snapshot = ctx.getSnapshot(creep.memory.home!);
        if (!snapshot) return;

        // ── 2. B1：已标记回收的 creep 停止角色工作（移动由 spawn-manager 接管）──
        if (creep.memory.recycle) {
          creep.memory.mode = "idle";
          return;
        }

        // ── 3. 敌人检测 → flee（先于导航：遇袭即逃，无论是否在通勤途中）──
        // 按 creep 实际所在房间选择威胁来源：
        //   - 外部房间（远矿房 / 过境中间房）：无 snapshot，直接扫描当前房（shouldFleeForeignRoom）。
        //     修复 transit 盲区——必须排在 ensureHome 之前，否则过境 creep 被 ensureHome
        //     短路导航（返回 false 提前 return），永远轮不到威胁检测。
        //   - home 房：使用 home snapshot 的 threatCreeps（shouldFlee）。
        const inForeignRoom = creep.room.name !== creep.memory.home;
        if (inForeignRoom && shouldFleeForeignRoom(creep)) {
          creep.memory.mode = "flee";
          fleeToHome(creep);
          return;
        }
        if (!inForeignRoom && shouldFlee(creep, snapshot)) {
          creep.memory.mode = "flee";
          flee(creep, snapshot);
          return;
        }

        // ── 4. 确认在目标房间（home 或 remoteTarget）──
        if (!ensureHome(creep)) {
          creep.memory.mode = "idle";
          return;
        }

        // ── 5. FSM 状态转换 ──
        updateMode(creep);

        // ── 6. 获取/续约任务 ──
        const assignment = getAssignment(creep, ctx);

        // ── 7. 构建 ActionContext ──
        const ac: ActionContext = {
          creep,
          snapshot,
          assignment,
          budget: ctx.budget,
          ctx,
        };

        // ── 8. 角色级门禁 ──
        if (policy.gate && !policy.gate(ac)) {
          creep.memory.mode = "idle";
          return;
        }

        // ── 9. 按 mode 选择候选列表并评估 ──
        const candidates = creep.memory.mode === "work" ? policy.work : policy.acquire;
        for (const candidate of candidates) {
          if (candidate.predicate(ac)) {
            candidate.execute(ac);
            return;
          }
        }

        // ── 10. 无匹配候选 → idle（移动角色先归位再 idle）──
        if (policy.park) {
          parkIdleCreep(creep, snapshot);
        }
        creep.memory.mode = "idle";
      } finally {
        drawStatusLight(creep);
      }
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
