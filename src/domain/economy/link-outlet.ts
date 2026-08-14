/**
 * Link 出口判定（纯函数，link 布局漏洞 #3）：source link 的 outlet = 存在可达的
 * controller/storage link；用于死资产检测（link-system）。与 harvest.ts 的
 * linkHasOutlet 语义不同（本函数是结构存在性拓扑判定；harvest 版检查 controller
 * link 的运行时能量需求，避免灌满 RCL8 停供的 link）— 不强行合并。
 */
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
