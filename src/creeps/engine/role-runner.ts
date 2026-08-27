/** RoleRunner — 共享角色生命周期 + Action-Candidate 评估引擎。 */
import type { CreepRole, Priority, TickContext } from "../../kernel/contracts";
import type { ActionContext, RolePolicy } from "./action-types";
import { ensureHome, flee, getAssignment, shouldFlee, shouldFleeForeignRoom, fleeToHome, shelterAtCore, updateMode, releaseAssignment } from "../support";
import { parkIdleCreep } from "../movement";
import { drawStatusLight } from "./status-light";
import { interceptForBoost } from "./boost-report";
import { CONFIG } from "../../config";
import { recordActionCpu } from "../../kernel/safe-run";

/** 创建一个由 RolePolicy 驱动的 CreepRole。 */
export function defineRole(name: string, priority: Priority, policy: RolePolicy): CreepRole {
  return {
    name,
    priority,
    // R3a：recovery 豁免从 RolePolicy 透传（builder/mineralMiner 自报）。
    recoveryEligible: policy.recoveryEligible === true,
    // 战斗标志透传：供 kernel recovery 门禁紧急旁路（war/真实入侵时不冻结作战单位）。
    combat: policy.combat === true,
    run(creep: Creep, ctx: TickContext): void {
      // finally 块在 CONFIG.debug.statusLight 关闭时为零开销（函数内首行即 return）。
      try {
        const snapshot = ctx.getSnapshot(creep.memory.home!);
        if (!snapshot) return;

        // B1：已标记回收的 creep 停止角色工作（移动由 spawn-manager 接管）。
        if (creep.memory.recycle) {
          creep.memory.mode = "idle";
          return;
        }

        // 敌人检测先于导航（遇袭即逃，无论是否在通勤途中）；战斗角色豁免——职责是接敌。
        // 威胁来源按实际所在房选择：外部房（远矿房/过境中间房）无 snapshot，直接扫当前房
        // （shouldFleeForeignRoom，修复 transit 盲区——必须排在 ensureHome 之前）；
        // home 房用 snapshot 的 threatCreeps（shouldFlee）。
        const inForeignRoom = creep.room.name !== creep.memory.home;
        // pushThrough（recon scout）：跳过过境房威胁逃跑检测，继续向侦察目标推进。
        // 否则 scout 钻进敌方房（如 Aguia 的 W38S58）即 flee 回 home，永远到不了 remoteTarget。
        if (!policy.combat && !policy.pushThrough && inForeignRoom && shouldFleeForeignRoom(creep)) {
          creep.memory.mode = "flee";
          fleeToHome(creep);
          return;
        }
        // M11 战时集结避险：小队威胁在场时非战斗角色全员撤入核心集结区。
        // 不限 fleeRange——小队会主动追猎，散布全房各自逃跑就是被逐个点名；撤入塔火力圈反杀。
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

        // 威胁消除后重置 flee mode：ensureHome 先于 updateMode，残留 mode=flee 会触发
        // ensureHome 回 home 导航并短路 updateMode，mode 永不被重置（remoteHarvester 到站不采集）。
        if (creep.memory.mode === "flee") {
          creep.memory.mode = undefined;
        }

        // Boost 报到：新生 creep（报到窗口内）被 lab-system 分配 boost lab 时引导其到 lab 旁
        // 等待 boostCreep 执行。排在 flee 之后（安全优先）、正常工作流之前（先强化再上岗）。
        if (interceptForBoost(creep)) return;

        // 战备集结（hold）：角色声明集结条件（如 attacker 在 war build 阶段）时接管本 tick。
        // 必须排在 ensureHome 之前：否则集结中的角色被 ensureHome 直接导航进目标房 —
        // attacker「散兵逐个送」的添油战术正源于此。
        if (policy.hold && policy.hold(creep, ctx)) return;

        // 确认在目标房间（home 或 remoteTarget）。
        if (!ensureHome(creep)) {
          // 远矿角色通勤中保持原 mode——ensureHome 对 idle 模式会导航回 home，
          // 导致 home↔remoteTarget 振荡；本地角色（无 remoteTarget）仍切 idle 防止在异房作业。
          if (!creep.memory.remoteTarget) {
            creep.memory.mode = "idle";
          }
          return;
        }

        updateMode(creep);
        const assignment = getAssignment(creep, ctx);
        const ac: ActionContext = {
          creep,
          snapshot,
          assignment,
          budget: ctx.budget,
          ctx,
        };

        // 角色级门禁（gate）：不通过则切 idle。
        if (policy.gate && !policy.gate(ac)) {
          creep.memory.mode = "idle";
          return;
        }

        // 按 mode 选择候选列表：resolve 返回非 undefined 即执行，目标只解析一次，
        // 消除 predicate-execute 重复计算。actionProfiling 开启时测量每个 resolve/execute
        // 并记录到 globalCache；关闭时走原始路径（零开销）。
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

        // 无匹配候选 → idle（移动角色先归位）。
        if (policy.park) {
          parkIdleCreep(creep, snapshot);
        }
        // 远矿角色不在目标房间时不切 idle——idle 会让 ensureHome 导航回 home，
        // 形成 idle→updateMode→acquire→fail→idle 死循环，永远到不了 remoteTarget。
        // P2-M：原 remoteHauler work-at-home 硬编码下沉为 RolePolicy 钩子，
        // 由角色 policy 声明"无候选时是否切 idle"，引擎不再感知角色名。
        const remoteTarget = creep.memory.remoteTarget;
        if (!remoteTarget || creep.room.name === remoteTarget || policy.shouldIdleWhenNoCandidate?.(ac) === true) {
          creep.memory.mode = "idle";
        }
      } finally {
        drawStatusLight(creep);
      }
    },
  };
}
