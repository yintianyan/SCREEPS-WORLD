/** E2E 断言辅助 — Screeps 专用语义化断言。 */
import { expect } from "vitest";
import type { BotSnapshot } from "../framework/SnapshotInspector";

/**
 * 断言快照中有至少指定数量的指定角色 creep。
 */
export function assertRoleCount(
  snapshot: BotSnapshot,
  role: string,
  minCount: number,
  message?: string,
): void {
  const actual = snapshot.creepCountByRole[role] ?? 0;
  expect(
    actual,
    message ?? `期望角色 ${role} 至少 ${minCount} 个，实际 ${actual} 个（tick ${snapshot.tick}）`,
  ).toBeGreaterThanOrEqual(minCount);
}

/**
 * 断言快照中总 creep 数量在指定范围内。
 */
export function assertTotalCreeps(
  snapshot: BotSnapshot,
  min: number,
  max: number,
  message?: string,
): void {
  const actual = snapshot.totalCreeps;
  expect(
    actual,
    message ?? `期望总 creep 数在 [${min}, ${max}]，实际 ${actual}（tick ${snapshot.tick}）`,
  ).toBeGreaterThanOrEqual(min);
  expect(actual).toBeLessThanOrEqual(max);
}

/**
 * 断言快照中没有错误日志。
 * 注意：console.log 的 "error" 字样也算错误。
 */
export function assertNoErrors(
  snapshot: BotSnapshot,
  message = `快照中检测到错误日志（tick ${snapshot.tick}）`,
): void {
  const errorLogs = snapshot.consoleLogs.filter(
    (line) =>
      line.includes("TypeError") ||
      line.includes("ReferenceError") ||
      line.includes("undefined is not") ||
      line.includes("Cannot read") ||
      line.includes("is not a function"),
  );
  expect(errorLogs, `${message}: ${errorLogs.join("; ")}`).toHaveLength(0);
}

/**
 * 断言快照序列的最后一个满足条件。
 */
export function assertLastSnapshot(
  snapshots: BotSnapshot[],
  predicate: (snap: BotSnapshot) => boolean,
  message = `最后一个快照不满足条件`,
): void {
  const last = snapshots.at(-1);
  expect(last, "快照序列为空").toBeDefined();
  expect(predicate(last!), message).toBe(true);
}

/**
 * 断言在快照序列中某条件曾经满足过。
 */
export function assertAnySnapshot(
  snapshots: BotSnapshot[],
  predicate: (snap: BotSnapshot) => boolean,
  message = `没有任何快照满足条件`,
): void {
  const satisfied = snapshots.some(predicate);
  expect(satisfied, message).toBe(true);
}

/**
 * 打印快照摘要（用于调试失败用例）。
 */
export function debugSnapshot(snapshot: BotSnapshot): string {
  const roles = Object.entries(snapshot.creepCountByRole)
    .map(([r, c]) => `${r}:${c}`)
    .join(", ");
  const logs = snapshot.consoleLogs.slice(-5).join("\n  ");
  return `[tick ${snapshot.tick}] creeps=${snapshot.totalCreeps} (${roles})\n  最近日志:\n  ${logs}`;
}
