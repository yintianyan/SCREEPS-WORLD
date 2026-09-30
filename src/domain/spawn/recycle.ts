import type { CreepSummary } from "./demand";
import { CONFIG } from "../../config";

/**
 * B1 回收通道的纯决策部分 — 选出应标记回收的 creep（保守白名单，不做全量配额对账）：
 * 1. 废弃角色（role 不在 knownRoles；"unknown" 跳过 — 数据畸形交迁移/人工处理）；
 * 2. 富余 worker：harvester 满编（≥ minCount）时保留 1 只作灾后保险，其余回收
 *    （与 demand 存在性门禁语义一致）；
 * 3. 富余 hauler（B3，2026-08-01）：link 化后编制收缩不能只靠死亡不补（1500 tick/代）—
 *    存活 > target+1 时回收富余者；替换窗口内（濒死）不回收，避免回收竞态。
 *    ⚠️**前提**：`sourceBacklog` 为假（源侧 container 没有积压）才允许执行 ——
 *    「编制目标塌了」不等于「没活可干」。线上实证（2026-09-30 巡检 #47，W38S56 RCL3 无 storage）：
 *    demand 的 `canDeliver` 闸门在「核心池刚好满 + 无 fillTargets」时关闭 ⇒ 目标回落 minCount ⇒
 *    keep 变小 ⇒ 这一条按 ttl 升序吃掉**最年轻**的 hauler；而当时 3 个 source container 各压 2000 能量。
 *    1225 拍内 25 次 `CreepDeath(hauler, natural=0)`、age 中位 202、死亡位置全贴在 spawn(26,12) 邻格，
 *    `EnemyCleared` 之后仍在继续 ⇒ 是自家人杀的。积压未清空时回收运力只会把积压拖得更久（恶性循环）。
 * 纯函数 — 不访问 Game/Memory。
 */
export function selectRecycleCandidates(
  summaries: readonly CreepSummary[],
  home: string,
  knownRoles: ReadonlySet<string>,
  harvesterMinCount: number,
  haulerTarget?: number,
  haulerPendingDownTarget?: number,
  sourceBacklog = false,
): string[] {
  const marked: string[] = [];

  // 规则 1：废弃角色（"unknown" 除外 — 数据畸形交迁移/人工处理）。
  for (const s of summaries) {
    if (s.home !== home) continue;
    if (!knownRoles.has(s.role) && s.role !== "unknown") marked.push(s.name);
  }

  // 规则 2：harvester 满编时，保留最先遇到的 1 只 worker 作保险，其余标记。
  const harvesterCount = summaries.filter(s => s.home === home && s.role === "harvester").length;
  if (harvesterCount >= harvesterMinCount) {
    const workers = summaries.filter(s => s.home === home && s.role === "worker");
    for (const w of workers.slice(1)) {
      marked.push(w.name);
    }
  }

  // 规则 3：富余 hauler（保留 1 只缓冲防抖动；濒死的不回收）。
  // P1-1：tuning 下调 minCount 时 keep 取下调目标 + 1 而非 haulerTarget + 1，
  // 让 recyclePass 主动收敛到新边界，避免 isContractMet 死锁。
  if (haulerTarget !== undefined && !sourceBacklog) {
    const haulers = summaries.filter(s => s.home === home && s.role === "hauler");
    const keep =
      haulerPendingDownTarget !== undefined ? haulerPendingDownTarget + 1 : haulerTarget + 1;
    if (haulers.length > keep) {
      const sorted = [...haulers].sort((a, b) => (a.ticksToLive ?? 0) - (b.ticksToLive ?? 0));
      const excess = sorted.slice(0, sorted.length - keep);
      for (const h of excess) {
        if (
          h.ticksToLive !== undefined &&
          h.ticksToLive <= (h.bodyLength ?? 3) * 3 + CONFIG.spawn.replaceBuffer
        ) {
          continue;
        }
        marked.push(h.name);
      }
    }
  }

  return marked;
}
