import type { CreepSummary } from "./demand";

/**
 * B1 回收通道的纯决策部分 — 选出应被标记回收的 creep 名。
 *
 * 标记规则（保守白名单，不做全量配额对账）：
 *   1. 废弃角色：role 不在 knownRoles 中（角色已下线，creep 永远闲置）；
 *      role 为 "unknown" 时跳过（数据畸形，交迁移/人工处理，不贸然回收）；
 *   2. 富余 worker：harvester 满编（≥ harvesterMinCount）时，
 *      worker 保留 1 只作灾后保险，其余回收（与 demand 存在性门禁语义一致）。
 *
 * 纯函数 — 接收预收集的摘要列表，不访问 Game/Memory。
 */
export function selectRecycleCandidates(
  summaries: readonly CreepSummary[],
  home: string,
  knownRoles: ReadonlySet<string>,
  harvesterMinCount: number,
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

  return marked;
}
