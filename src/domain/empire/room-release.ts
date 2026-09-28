/**
 * 「放弃一间自有房」的阶段推进判据 —— 释放流程的唯一真相源。
 *
 * 为什么需要单独一层：unclaim 这个动作本身只有一行，但它留下的是一间**不再有主、
 * 却仍在全帝国账本里当自有房**的幽灵房。实测过的后果（本仓库的账本口径）：
 * - 该房名下未 abandoned 的远矿 op 继续把 siteCount/roadSiteCount 计入全帝国配额，
 *   而清零它们的 road-planner 只对「自有主房」跑 —— 配额被一间不存在的房占住；
 * - prospect / war-planner / power-farm 三处都遍历 `Memory.rooms` 把非 abandoned 的
 *   op 目标当作「已被占用」，于是这些房对本帝国剩余房永久不可用；
 * - `Memory.kernel.lostRooms` 的清账宽限是 20,000 tick —— 按本服实测掉速到 3.7 秒/tick
 *   的速率，那是三天以上的幽灵期。
 *
 * 所以释放必须**先排空再断手**：把 op 弃干净、把编制停掉、把该房的 creep 送进回收通道，
 * 最后才 unclaim。本函数只裁决「现在能 unclaim 了吗」，排空动作由执行层做。
 *
 * 迟滞纪律：排空有截止时刻（`CONFIG.territory.drainDeadlineTicks`）。没有截止时，
 * 一只走不动的远程 creep 就能把释放永久挂住 —— 挂住的代价是整间房继续吃编制与 CPU，
 * 比放弃几只 creep 贵得多；超期强行 unclaim，残余无家 creep 交给执行层的事后清扫。
 */
import { CONFIG } from "../../config";

/** 释放归因码（进 Memory，用数字；只能追加，不得重排 —— 历史账本依赖）。 */
export const RELEASE_REASON = {
  /** 人工领土指令：运维边界下达的一次性命令，由系统自行执行到底。 */
  ManualDirective: 0,
  /** 殖民地自身失败（经济/人口判据持续不达标），系统自判放弃。 */
  ColonyFailure: 1,
} as const;

/** 在途释放指令：房名 → 指令。territory-manager 是唯一写者。 */
export interface RoomReleaseDirective {
  /** 首次受理 tick —— draining 计时基准。 */
  startedAt: number;
  /** RELEASE_REASON 码。 */
  reason: number;
  /** 已发起 unclaim 的次数（含失败重试）。 */
  unclaimAttempts?: number;
  /** 最近一次 unclaim 的返回码（观测用，不参与判定）。 */
  lastUnclaimCode?: number;
}

/** planReleaseStep 的输入 —— 全部由执行层从 Game/Memory 读好再传进来（domain 不碰运行时全局）。 */
export interface ReleaseStepInput {
  /** 该房仍归我们且有视野（controller.my 成立 ⟺ territory-manager 认它还在）。 */
  stillOwned: boolean;
  /** 该房名下仍未 abandoned 的远矿 op 数。 */
  activeOps: number;
  /** home 指向该房的存活 creep 数（含身处远矿房的）。 */
  creepsHomedHere: number;
  /** 该房孵化队列长度。spawning 中的在途孵化不计 —— 能量已经花了，撤单无益。 */
  pendingRequests: number;
  /** 已排空多久（tick）。 */
  drainingFor: number;
  /** 已发起过多少次 unclaim。 */
  unclaimAttempts: number;
}

/** 下一步动作。 */
export type ReleaseStep =
  | { action: "keep-draining" }
  | { action: "unclaim" }
  /** 登记重占排除项 + 清账本；指令离场。 */
  | { action: "finalize"; involuntary: boolean }
  /** 放弃释放：房还在手里却反复 unclaim 不动（引擎拒绝/权限异常），别再烧轮次。 */
  | { action: "abort" };

/**
 * 裁决释放的下一步。
 *
 * 判定顺序即优先级：**房不在手里**永远优先于其他分支 —— 无论是不再拥有（被抢）
 * 还是 unclaim 已成交，此时唯一正确的动作都是清账，而不是继续排空一间别人的房。
 */
export function planReleaseStep(input: ReleaseStepInput): ReleaseStep {
  if (!input.stillOwned) {
    return { action: "finalize", involuntary: true };
  }
  // unclaim 喊了太多次仍握着这房：引擎不给放手，继续重试只是白烧 CPU 与日志。
  if (input.unclaimAttempts >= CONFIG.territory.maxUnclaimAttempts) {
    return { action: "abort" };
  }
  if (input.drainingFor >= CONFIG.territory.drainDeadlineTicks) {
    return { action: "unclaim" };
  }
  if (input.activeOps === 0 && input.creepsHomedHere === 0 && input.pendingRequests === 0) {
    return { action: "unclaim" };
  }
  return { action: "keep-draining" };
}
