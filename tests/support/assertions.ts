/**
 * 跨层断言原语（FREEZE R20①）— 纯函数，吃 support/snapshot 的 TestSnapshot 形状。
 *
 * 语义等价断言的对（审计 R20）：integration Assertions.assertRoleExists ≡
 * e2e assertRoleCount；assertNoRuntimeError ≈ assertNoErrors —— 本文件是它们的
 * 公共底座；各层的富诊断（integration failureReport / e2e debugSnapshot）留在
 * 本层之上，不进内核。
 */
import { expect } from "vitest";
import type { TestSnapshot } from "./snapshot";
import { jsErrorLines } from "./errors";

/** 快照中指定角色 creep 数 ≥ min。 */
export function expectRoleCount(
  snap: TestSnapshot,
  role: string,
  min: number,
  message?: string,
): void {
  const actual = snap.creepCountByRole[role] ?? 0;
  expect(
    actual,
    message ?? `期望角色 ${role} 至少 ${min} 个，实际 ${actual} 个（tick ${snap.tick}）`,
  ).toBeGreaterThanOrEqual(min);
}

/** 快照中总 creep 数在 [min, max] 区间。 */
export function expectTotalCreepsInRange(
  snap: TestSnapshot,
  min: number,
  max: number,
  message?: string,
): void {
  expect(
    snap.totalCreeps,
    message ?? `期望总 creep 数在 [${min}, ${max}]，实际 ${snap.totalCreeps}（tick ${snap.tick}）`,
  ).toBeGreaterThanOrEqual(min);
  expect(snap.totalCreeps).toBeLessThanOrEqual(max);
}

/** RCL ≥ level（无 controller 视野时显式失败，不静默通过）。 */
export function expectRclAtLeast(
  snap: TestSnapshot,
  level: number,
  message?: string,
): void {
  const actual = snap.rcl;
  expect(
    actual,
    message ?? `期望 RCL ≥ ${level}，实际 ${actual ?? "无 controller 视野"}（tick ${snap.tick}）`,
  ).toBeDefined();
  expect(actual!, message).toBeGreaterThanOrEqual(level);
}

/** 快照日志中无 JS 致命错误（判定逻辑唯一来源 = support/errors）。 */
export function expectNoJsErrors(
  snap: TestSnapshot,
  message?: string,
): void {
  const errors = jsErrorLines(snap.consoleLogs);
  expect(
    errors,
    message ?? `快照中检测到 JS 错误日志（tick ${snap.tick}）: ${errors.join("; ")}`,
  ).toHaveLength(0);
}

/** 快照序列最后一个满足条件。 */
export function expectLastSnapshot<T>(
  snapshots: T[],
  predicate: (snap: T) => boolean,
  message = "最后一个快照不满足条件",
): void {
  const last = snapshots.at(-1);
  expect(last, "快照序列为空").toBeDefined();
  expect(predicate(last!), message).toBe(true);
}

/** 快照序列中某条件曾满足过。 */
export function expectAnySnapshot<T>(
  snapshots: T[],
  predicate: (snap: T) => boolean,
  message = "没有任何快照满足条件",
): void {
  expect(snapshots.some(predicate), message).toBe(true);
}
