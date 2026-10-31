/** R674b：修复目标占用（每 tick 每个目标至多 1 名 creep）。
 *
 * 症状：效用评分给「坏容器」高分时，同房多名 builder 在同一 tick 都选中同一个
 * 容器去修（线上实测 3/3 全压在同一个 50% 容器上），建造被完全饿死。
 * 评分本身没有「目标已有人在修」的概念，链式模式也没有 — 这是缺失的配额层。
 *
 * 语义：占用只在**当前 tick**有效（resolve 阶段读取，execute 阶段写入）。
 * 角色按 kernel 顺序逐个执行，先执行者先占用；后来者在 resolve 里跳过被占目标，
 * 回落到其它候选（通常是建造）。下一 tick 自动清空，不产生跨 tick 租约。
 */
import { globalCache } from "../../kernel/global-cache";
import type { ActionCandidate } from "../engine/action-types";

function freshMap(): Map<string, string> {
  const g = globalCache();
  if (!g.repairReservations || g.repairReservationTick !== Game.time) {
    g.repairReservations = new Map();
    g.repairReservationTick = Game.time;
  }
  return g.repairReservations;
}

/** 目标是否已被**别的** creep 在本 tick 占用。 */
export function repairTargetClaimedByOther(creepName: string, targetId: string): boolean {
  const map = freshMap();
  const holder = map.get(targetId);
  return holder !== undefined && holder !== creepName;
}

/** 占用目标（execute 阶段调用；同一 creep 重复调用幂等）。 */
export function claimRepairTarget(creepName: string, targetId: string): void {
  freshMap().set(targetId, creepName);
}

/**
 * 给维修类候选加「每目标每 tick 至多 1 人」语义：
 * resolve 跳过已被他人占用的目标，execute 先占用再执行。
 * 统一包在角色策略层，动作实现保持纯粹（可被 harvester 等其他角色复用）。
 */
export function claimedRepair<T extends { id: string }>(
  candidate: ActionCandidate<T>,
): ActionCandidate<T> {
  return {
    ...candidate,
    resolve: ac => {
      const target = candidate.resolve(ac);
      if (target && repairTargetClaimedByOther(ac.creep.name, target.id)) return undefined;
      return target;
    },
    execute: (ac, target) => {
      claimRepairTarget(ac.creep.name, target.id);
      candidate.execute(ac, target);
    },
  };
}
