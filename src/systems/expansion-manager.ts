/** Expansion Manager — run 门禁编排；状态机见 ./expansion/state-machine，Plan 消费见 ./expansion/plan-adapter。 */
import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { log } from "../kernel/log";
import {
  evaluateExpansionCooldown,
  DEFAULT_COOLDOWN_CONFIG,
} from "../domain/expansion/expansion-cooldown";
import { runBootstrapLane } from "./expansion/bootstrap-lane";
import { tryConsumePlan } from "./expansion/plan-adapter";
import { advanceExecutionStateMachine } from "./expansion/state-machine";

// 保留既有导入面（消费者从 expansion-manager 引用编队召回）。
export { reclaimExpeditionCreeps } from "./expansion/uoem-events";

/** 状态机认识的全部分支 — Memory 中不在此列的 state 为旧版残留值。 */
const EXECUTION_STATES: ReadonlySet<string> = new Set([
  "validating",
  "preparing",
  "claiming",
  "claimed",
  "bootstrapping",
  "economic_startup",
  "integrating",
  "completed",
  "failed",
  "aborted",
]);

export const expansionManagerSystem: System = {
  name: "expansion-manager",
  priority: 3 as Priority,
  interval: CONFIG.expansion.interval,
  run(ctx: TickContext): void {
    if (!Memory.kernel) Memory.kernel = {};
    // 旧版残留状态防护：状态机没有对应分支的 state（如旧版 pioneering）每 tick
    // 静默穿透，扩张记录永不消失，hasOtherExpansion 恒真挡住后续新扩张计划。
    // 残留记录直接离场，扩张管道不因旧数据卡死。
    const pending = Memory.kernel.expansion;
    if (pending && !EXECUTION_STATES.has(pending.state)) {
      log.info(
        "expansion",
        `[${ctx.tick}] expansion: 清理旧版残留状态 ${pending.state}（target=${pending.target}）`,
      );
      Memory.kernel.expansion = undefined;
    }
    // 自举车道（W38S59 事故实证）：owned 无 spawn 的房不在扩张状态机
    // 覆盖内 —— 任务 success/aborted 即离场，本地 spawnQueue 无 spawn 永不可孵化，
    // 建造无 builder 可用，唯一活路是姊妹房代孵 bootstrap 组。生存级，独立于
    // 姿态与扩张任务；CPU 极轻（仅快照字段 + 已有房间的免费查询）。
    runBootstrapLane(ctx);
    const expansion = Memory.kernel.expansion;

    if (!expansion) {
      // CPU 门禁只裁决「是否开启新行动」— 扩张是纯发展行为，CPU 紧张时不开新局。
      if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
      if ((Game.cpu.bucket ?? 0) < 5000) return;
      // 连续失败暂停止损 — 「失败→立刻再试」是烧 GCL 窗口的循环。
      if ((Memory.kernel.expansionPausedUntil ?? 0) > ctx.tick) return;
      // 战略门禁：是否扩张由 empire-strategy 的姿态裁决（Strategy 层）— 本系统只在
      // 获得授权时评选目标，不自行判断时机。姿态未就绪（reset 首 tick）默认不扩张。
      if (Memory.kernel.strategy?.expansionAllowed !== true) return;
      // Expansion Cooldown 检查 — 防止扩张级联
      const cooldownResult = evaluateExpansionCooldown({
        lastCompletedTick: Memory.kernel.lastExpansionCompletedTick,
        activeExpansionCount: Memory.kernel.expansion ? 1 : 0,
        currentTick: ctx.tick,
        config: DEFAULT_COOLDOWN_CONFIG,
      });
      if (!cooldownResult.allowed) {
        log.info("expansion", `[${ctx.tick}] expansion: ${cooldownResult.evidence}`);
        return;
      }
      // 从 expansionPlans[] 消费 WAITING_EXECUTION Plan
      tryConsumePlan(ctx);
      return;
    }

    // 进行中的扩张行动不因姿态回落而中断 — claimer/拓荒编队已是沉没投资，
    // 半途而废比完成更贵；姿态只裁决「是否开启新行动」。
    const spawningAllowed =
      (ctx.budget.tier === "healthy" || ctx.budget.tier === "guarded") &&
      (Game.cpu.bucket ?? 0) >= 5000;

    // 完整状态机推进
    advanceExecutionStateMachine(ctx, expansion, spawningAllowed);
  },
};
