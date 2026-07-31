/**
 * P1-H 静态守卫 — spawnQueue 直接 splice 仅允许在队列属主 spawn-manager。
 *
 * 队列属主是 spawn-manager（tick 内独占消费孵化，读取 spawnQueue 后 splice
 * 出队是合法行为）。其他模块（如 expansion-manager）必须经纯函数通道
 * （domain/spawn/queue 的 cancelRequestsByHome/removeRequest/...）
 * 操作队列，禁止「读取 spawnQueue 后直接 splice」——否则会绕过队列属主
 * 的 tick 内独占假设，引入隐式执行顺序耦合。
 *
 * 原始 bug：expansion-manager.reclaimExpeditionCreeps 取出 sponsor 的
 * spawnQueue 局部变量后用 for 循环 + queue.splice 清队列。链式调用守卫
 * （`.spawnQueue.splice(`）捕捉不到这种「先取局部变量再 splice」变体，
 * 故用复合判定：同一文件同时出现 .spawnQueue 引用与 .splice( 调用即违规
 * （白名单：spawn-manager 是属主，domain/spawn/queue 是纯函数层不读 Memory）。
 *
 * 与 danger-until-single-writer / remote-site-guard 同款源码扫描模式。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_DIR = join(process.cwd(), "src");

/** 递归收集 src 下所有 .ts 文件。 */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

/** 过滤掉注释行，只保留可执行代码。 */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter(l => {
      const trimmed = l.trim();
      return (
        trimmed !== "" &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

/**
 * 允许「同时出现 .spawnQueue 引用 + .splice( 调用」的文件白名单。
 *
 * - spawn-manager：队列属主，tick 内独占消费孵化，直接 splice 出队合法。
 *
 * domain/spawn/queue.ts 是纯函数层（不读 Memory，不会触发复合判定），
 * 故不在白名单内——若未来该文件开始读 Memory，则需在白名单补登记
 * 或重构为不读 Memory 的形态（设计上不应读）。
 */
const ALLOWED_COMBINATION_FILES = new Set<string>(["systems/spawn-manager.ts"]);

describe("P1-H 静态守卫 — spawnQueue 直 splice 仅在 spawn-manager", () => {
  it("src 全域无外模块同时引用 .spawnQueue 与调用 .splice(", () => {
    const files = collectTsFiles(SRC_DIR);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_DIR, file).split(join("/")).join("/");
      if (ALLOWED_COMBINATION_FILES.has(rel)) continue;

      const code = stripComments(readFileSync(file, "utf-8"));
      // 检测「读取 spawnQueue 字段」与「直接 splice 调用」共存。
      // 两者同时出现说明外模块绕过纯函数通道直接操作队列（原始 bug 模式）。
      const hasSpawnQueueRef = /\.spawnQueue\b/.test(code);
      const hasSpliceCall = /\.splice\s*\(/.test(code);
      if (hasSpawnQueueRef && hasSpliceCall) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `以下文件同时引用了 .spawnQueue 并调用 .splice( —— ` +
        `队列属主是 spawn-manager，外模块应经 domain/spawn/queue 纯函数通道：\n` +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("白名单 spawn-manager 本身仍同时包含两者（守卫有效性自检）", () => {
    // 防止白名单条目被误删导致守卫恒真。
    const file = join(SRC_DIR, "systems", "spawn-manager.ts");
    const code = stripComments(readFileSync(file, "utf-8"));
    expect(/\.spawnQueue\b/.test(code), "spawn-manager 应包含 .spawnQueue 引用").toBe(true);
    expect(/\.splice\s*\(/.test(code), "spawn-manager 应包含 .splice( 调用").toBe(true);
  });
});
