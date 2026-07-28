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
 * onFlee 钩子（P0-2 修复）：
 *   威胁检测后、通用 flee 移动之前调用 policy.onFlee。
 *   角色可在此实现"安全区行为"（如 hauler 在防御圈内安全充能）。
 *   返回 true 表示已处理，跳过通用 flee；返回 false 表示需要通用 flee 接管。
 *   这将 flee 的角色专属逻辑从引擎层（lifecycle.ts）移回角色层（RolePolicy），
 *   消除引擎层对具体角色的硬编码。
 *
 * 状态指示灯（drawStatusLight）：在 try/finally 的 finally 块统一绘制，
 * 覆盖所有 return 路径（含异常）——出错 creep 也会亮灯，便于定位故障单位。
 *
 * 角色文件只需声明 RolePolicy，不再包含生命周期样板。
 */
import type { CreepRole, Priority, TickContext } from "../../kernel/contracts";
import type { ActionContext, RolePolicy } from "./action-types";
import { ensureHome, flee, getAssignment, shouldFlee, shouldFleeForeignRoom, fleeToHome, shelterAtCore, updateMode, releaseAssignment } from "../support";
import { parkIdleCreep } from "../movement";
import { drawStatusLight } from "./status-light";
import { interceptForBoost } from "./boost-report";
import { CONFIG } from "../../config";
import { recordActionCpu } from "../../kernel/safe-run";

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
        // 战斗角色（policy.combat）豁免 — 它们的职责就是接敌，逃跑检测只适用于经济角色。
        // 按 creep 实际所在房间选择威胁来源：
        //   - 外部房间（远矿房 / 过境中间房）：无 snapshot，直接扫描当前房（shouldFleeForeignRoom）。
        //     修复 transit 盲区——必须排在 ensureHome 之前，否则过境 creep 被 ensureHome
        //     短路导航（返回 false 提前 return），永远轮不到威胁检测。
        //   - home 房：使用 home snapshot 的 threatCreeps（shouldFlee）。
        const inForeignRoom = creep.room.name !== creep.memory.home;
        if (!policy.combat && inForeignRoom && shouldFleeForeignRoom(creep)) {
          creep.memory.mode = "flee";
          fleeToHome(creep);
          return;
        }
        // M11 战时集结避险：小队威胁在场时非战斗角色全员撤入核心集结区。
        // 不限 fleeRange — 小队会主动追猎，散布全房各自逃跑就是被逐个点名；
        // 撤入塔火力圈后敌人追进来吃满塔伤，不追则收割失败。
        if (!policy.combat && !inForeignRoom && snapshot.squadThreat) {
          creep.memory.mode = "flee";
          shelterAtCore(creep, snapshot);
          return;
        }
        if (!policy.combat && !inForeignRoom && shouldFlee(creep, snapshot)) {
          creep.memory.mode = "flee";
          // G-SM-05: flee 期间释放普通 assignment，仅移动到安全位置。
          if (creep.memory.assignment) {
            releaseAssignment(creep);
          }
          // P0-2: 调用角色级 onFlee 钩子 — 角色可自行处理安全区行为（如防御圈内充能）。
          // 返回 true 表示已处理，跳过通用 flee 移动；返回 false 表示需要通用 flee 接管。
          const fleeAc: ActionContext = {
            creep,
            snapshot,
            assignment: undefined,
            budget: ctx.budget,
            ctx,
          };
          if (policy.onFlee) {
            if (CONFIG.debug.actionProfiling) {
              const before = Game.cpu.getUsed();
              const handled = policy.onFlee(fleeAc);
              recordActionCpu(`${name}/onFlee`, Game.cpu.getUsed() - before);
              if (!handled) flee(creep, snapshot);
            } else {
              if (!policy.onFlee(fleeAc)) flee(creep, snapshot);
            }
          } else {
            flee(creep, snapshot);
          }
          return;
        }

        // ── 3.5 威胁消除后重置 flee mode ──
        // ensureHome 在 updateMode 之前执行。如果 mode=flee（上一 tick 残留），
        // ensureHome 看到 flee → goHome=true → 导航回 home → return false → updateMode 不执行 →
        // mode 永远不被重置。导致 remoteHarvester 到达 source 后不采集（mode=flee → 一直走回 home）。
        // 修复：shouldFleeForeignRoom/shouldFlee 返回 false = 当前无威胁 → 重置 flee mode。
        if (creep.memory.mode === "flee") {
          creep.memory.mode = undefined;
        }

        // ── 3.7 Boost 报到 ──
        // 新生 creep（报到窗口内）若被 lab-system 分配了 boost lab，
        // 引导其到 lab 旁等待 boostCreep 执行。排在 flee 之后（安全优先）、
        // 正常工作流之前（boost 是即时战力放大，先强化再上岗）。
        if (interceptForBoost(creep)) return;

        // ── 4. 确认在目标房间（home 或 remoteTarget）──
        if (!ensureHome(creep)) {
          // 远矿角色通勤中保持原 mode（acquire/work）——ensureHome 对 idle 模式
          // 会导航回 home，导致 remote creep 在 home↔remoteTarget 之间振荡，
          // 永远到不了目标房。本地角色（无 remoteTarget）仍切 idle 防止在异房作业。
          if (!creep.memory.remoteTarget) {
            creep.memory.mode = "idle";
          }
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
        // resolve 模式：resolve 返回非 undefined 即执行，目标传入 execute。
        // 目标只解析一次，消除 predicate-execute 重复计算。
        //
        // actionProfiling 分支：开关关闭时走原始路径（零开销）；
        // 开启时每个 resolve/execute 调用用 Game.cpu.getUsed() 测量并记录到 globalCache。
        const candidates = creep.memory.mode === "work" ? policy.work : policy.acquire;
        if (CONFIG.debug.actionProfiling) {
          for (const candidate of candidates) {
            const key = `${name}/${candidate.name}`;
            let target: unknown;
            {
              const before = Game.cpu.getUsed();
              target = candidate.resolve?.(ac);
              recordActionCpu(`${key}/resolve`, Game.cpu.getUsed() - before);
            }
            if (target !== undefined) {
              const before = Game.cpu.getUsed();
              candidate.execute(ac, target);
              recordActionCpu(`${key}/execute`, Game.cpu.getUsed() - before);
              return;
            }
          }
        } else {
          for (const candidate of candidates) {
            const target = candidate.resolve?.(ac);
            if (target !== undefined) {
              candidate.execute(ac, target);
              return;
            }
          }
        }

        // ── 10. 无匹配候选 → idle（移动角色先归位再 idle）──
        if (policy.park) {
          parkIdleCreep(creep, snapshot);
        }
        // 远矿角色不在目标房间时不切 idle——idle 会导致 ensureHome 导航回 home，
        // 形成 idle→updateMode→acquire→action fail→idle 死循环，永远到不了 remoteTarget。
        // remoteHauler work 模式在 home 房无 action 时可以 idle（ensureHome 会保持在家）。
        const remoteTarget = creep.memory.remoteTarget;
        const haulerWorkAtHome = remoteTarget && creep.memory.role === "remoteHauler" &&
          creep.memory.mode === "work" && creep.room.name === creep.memory.home;
        if (!remoteTarget || creep.room.name === remoteTarget || haulerWorkAtHome) {
          creep.memory.mode = "idle";
        }
      } finally {
        drawStatusLight(creep);
      }
    },
  };
}
