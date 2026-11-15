/** 静态守卫 — spawnQueue 直接 splice 仅允许在队列属主 spawn-manager。 */
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

 * - spawn-manager：队列属主，tick 内独占消费孵化，直接 splice 出队合法。
 * - domain/spawn/queue.ts：纯函数通道本体。房间级出口 submitRoomRequests 必须在
 *   本模块内接触 host.spawnQueue（否则出口无处落地），而它调用的 submitRequest
 *   是本模块自身的纯函数、不含 splice；该文件仍不读 Memory 全局、不读 Game。
 *   外模块绕过通道直操作队列仍被本守卫拦截 —— 白名单只登记通道本身。
 */
const ALLOWED_COMBINATION_FILES = new Set<string>([
  "systems/room/spawn-manager.ts",
  "domain/spawn/queue.ts",
]);

describe("静态守卫 — spawnQueue 直 splice 仅在 spawn-manager", () => {
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
        `队列属主是 spawn-manager，外模块应经 domain/spawn/queue 纯函数通道：\n${violations.join(
          "\n",
        )}`,
    ).toEqual([]);
  });

  it("白名单 spawn-manager 本身仍同时包含两者（守卫有效性自检）", () => {
    // 防止白名单条目被误删导致守卫恒真。
    const file = join(SRC_DIR, "systems", "room", "spawn-manager.ts");
    const code = stripComments(readFileSync(file, "utf-8"));
    expect(/\.spawnQueue\b/.test(code), "spawn-manager 应包含 .spawnQueue 引用").toBe(true);
    expect(/\.splice\s*\(/.test(code), "spawn-manager 应包含 .splice( 调用").toBe(true);
  });

  it("白名单 queue 模块不得读 Memory / Game（通道纯度自检）", () => {
    // queue 是纯函数通道：登记白名单的前提是它不触达运行时全局。一旦开始读
    // Memory 或 Game，它会变成第三个「复合判定」位点，白名单便失去合法性。
    const code = stripComments(readFileSync(join(SRC_DIR, "domain", "spawn", "queue.ts"), "utf-8"));
    expect(/\bMemory\b/.test(code), "queue 模块不得引用 Memory").toBe(false);
    expect(/\bGame\b/.test(code), "queue 模块不得引用 Game").toBe(false);
  });
});
