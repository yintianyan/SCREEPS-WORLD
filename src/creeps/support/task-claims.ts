/** R678：任务目标级配额（每 tick 每个目标至多 1 名 creep）。
 *
 * 与 repair-reservations 同型，但键带任务类：lab 按 `labId:resource`、矿物按 containerId。
 * 评分阶段不做占用（避免落选候选偷目标）；execute 先占用，后来的 creep 在 resolve
 * 里看到占用就跳过该目标、改选其它候选。占用按 tick 自动失效，无跨 tick 租约。
 */
import { globalCache } from "../../kernel/global-cache";

function freshMap(): Map<string, string> {
  const g = globalCache();
  if (!g.taskClaims || g.taskClaimTick !== Game.time) {
    g.taskClaims = new Map();
    g.taskClaimTick = Game.time;
  }
  return g.taskClaims;
}

export function taskTargetClaimedByOther(
  kind: "lab" | "mineral",
  key: string,
  creepName: string,
): boolean {
  const holder = freshMap().get(`${kind}:${key}`);
  return holder !== undefined && holder !== creepName;
}

export function claimTaskTarget(kind: "lab" | "mineral", key: string, creepName: string): void {
  freshMap().set(`${kind}:${key}`, creepName);
}
