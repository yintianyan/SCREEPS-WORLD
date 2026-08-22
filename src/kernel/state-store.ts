/**
 * 【G-G/R2-3】StateStore — 状态族单调版本号（分层指纹的数据源）。
 *
 * 用途：Intent 的 domainFingerprint 校验（研究文档 07 号【RT-3】）——意图只绑定其依赖域，
 * 校验时比对版本号；域内任何差分写入由 owner 调 bumpStateFamily()。
 * 持久化：Memory.kernel.stateVersions —— **跨 global reset 存活**（reset 后若版本归零，
 * 陈旧 Intent 会重新通过校验——正是要防的事故）。planner 无感知、无法忘记 bump。
 */

import type { StateStore } from "./contracts";

/** 合法状态族（Intent 域）。新增族必须先在此登记。 */
export type StateFamily = "intel" | "war" | "economy" | "build" | "layout" | "expansion";

const ALL_FAMILIES: readonly StateFamily[] = ["intel", "war", "economy", "build", "layout", "expansion"];

interface VersionsShape {
  stateVersions?: Partial<Record<StateFamily, number>>;
}

function versions(): Partial<Record<StateFamily, number>> {
  const mem = Memory as unknown as { kernel?: VersionsShape };
  if (!mem.kernel) mem.kernel = {};
  if (!mem.kernel.stateVersions) mem.kernel.stateVersions = {};
  return mem.kernel.stateVersions;
}

/** 实现 contracts.StateStore —— 由 kernel 组装进 TickContext 的推荐方式。 */
class MemStateStore implements StateStore {
  version(family: string): number {
    return versions()[family as StateFamily] ?? 0;
  }

  bump(family: string): number {
    const v = versions();
    const key = family as StateFamily;
    const next = (v[key] ?? 0) + 1;
    v[key] = next;
    return next;
  }

  versionOfAll(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const f of ALL_FAMILIES) out[f] = this.version(f);
    return out;
  }
}

/** 进程级单例（无 per-tick 状态；Memory 即真相）。 */
export const stateStore: StateStore = new MemStateStore();

/** 便捷守卫：Intent 校验用（指纹一致才有效）。 */
export function fingerprintMatches(
  expected: { family: string; version: number }[],
  store: Pick<StateStore, "version">,
): boolean {
  for (const e of expected) {
    if (store.version(e.family as StateFamily) !== e.version) return false;
  }
  return true;
}