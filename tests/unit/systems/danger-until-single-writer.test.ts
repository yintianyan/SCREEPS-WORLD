/**
 * P1-G 静态守卫 — dangerUntil 写入点仅存在于 remote-mining-manager。
 *
 * dangerUntil 从 intel[room] 迁移到 remoteOps[room] 后，remote-mining-manager
 * 是唯一写者。其他文件不应出现对 .dangerUntil 的赋值（写操作），
 * 防止新的双写者引入。
 *
 * 与 remote-site-guard 同款的源码扫描模式。
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

describe("P1-G 静态守卫 — dangerUntil 写入点仅存在于 remote-mining-manager", () => {
  it("src 全域非注释代码中 .dangerUntil = 赋值仅出现在 remote-mining-manager.ts", () => {
    const files = collectTsFiles(SRC_DIR);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_DIR, file);
      // 唯一允许的写者。
      if (rel === "systems/remote-mining-manager.ts") continue;
      // 迁移文件允许写（搬运逻辑）。
      if (rel === "kernel/memory.ts") continue;

      const code = stripComments(readFileSync(file, "utf-8"));
      // 匹配 .dangerUntil = 的赋值（排除 === 和 !== 比较）。
      const writePattern = /\.dangerUntil\s*=[^=]/;
      if (writePattern.test(code)) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `以下文件不应包含 .dangerUntil 写入（唯一写者是 remote-mining-manager.ts）：\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
