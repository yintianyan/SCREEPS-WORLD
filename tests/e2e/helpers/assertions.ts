/**
 * E2E 断言辅助 — 跨层断言原语已收敛至 tests/support/assertions（R20①/T3），
 * 本文件保留 e2e 专属调试输出并转断言原语（审计孤儿清理：assertRoleCount /
 * assertTotalCreeps / assertLastSnapshot / assertAnySnapshot 零引用、
 * assertNoErrors 死引用 —— 统一由 support 版本承接）。
 */
export {
  expectRoleCount,
  expectTotalCreepsInRange,
  expectRclAtLeast,
  expectNoJsErrors,
  expectLastSnapshot,
  expectAnySnapshot,
} from "../../support/assertions";
import type { BotSnapshot } from "../framework/SnapshotInspector";

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
