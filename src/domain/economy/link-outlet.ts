/**
 * Link 出口判定（纯函数，2026-08-02，link 布局漏洞 #3）。
 *
 * source link 的 outlet = 存在可达的 controller link 或 storage link。
 * 死资产判定用此函数：source link 无 outlet → 能量无处可去 → 死资产。
 *
 * 与 harvest.ts 的 `linkHasOutlet` 区分：
 *   - 本函数（结构存在性）：拓扑判定，用于死资产检测（link-system）
 *   - harvest.ts 版本（运行时需求）：检查 controller link 是否需要能量，
 *     避免 harvester 灌满 RCL8 停供的 controller link。两者语义不同，
 *     不强行合并 — harvest.ts 的精细判定保留原样。
 *
 * 纯函数 — 不访问 Game/Memory。
 */
import type { LinkInfo, LinkRole } from "./links";

/**
 * 判定 source link 是否有可用的下游出口。
 *
 * @param linkRole     待判定的 link 角色
 * @param otherLinks   同房其他 link 列表（不含待判定 link 自身）
 * @returns source link 有 controller/storage link 可达 → true；否则 false。
 *          非 source link 永远返回 true（不需要 outlet）。
 */
export function linkHasOutlet(
  linkRole: LinkRole,
  otherLinks: readonly LinkInfo[],
): boolean {
  if (linkRole !== "source") return true;
  return otherLinks.some(l => l.role === "controller" || l.role === "storage");
}
