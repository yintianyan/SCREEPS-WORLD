/** Link 出口判定（纯函数，link 布局漏洞 #3）：source link 的 outlet = 存在可达的 */
import type { LinkInfo, LinkRole } from "./links";

/**
 * 判定 source link 是否有可用的下游出口；非 source link 永远返回 true
 * （不需要 outlet）。otherLinks 不含待判定 link 自身。
 */
export function linkHasOutlet(
  linkRole: LinkRole,
  otherLinks: readonly LinkInfo[],
): boolean {
  if (linkRole !== "source") return true;
  return otherLinks.some(l => l.role === "controller" || l.role === "storage");
}
