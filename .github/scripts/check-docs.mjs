#!/usr/bin/env node
/**
 * 注释自足门禁 — 代码必须自足，注释不得含任何指向外部世界的死指针。
 * 扫描 src/ 与 tests/ 下的 .ts 文件（含注释与字符串字面量），命中即失败并打印 file:line。
 *
 * 禁令依据见 AGENT.md「注释规范」。pattern 全部取高置信形态，宁可漏判不误判；
 * G1–G15（扩张门）等系统内活概念不在禁令内。
 *
 * 用法：npm run check:docs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "tests"];

/** [名称, 正则] — 命中任一即违规。 */
const FORBIDDEN_PATTERNS = [
  ["文档路径", /docs\//],
  [".md 文件名", /\.md\b/i],
  ["章节条款号 §", /§/],
  ["巡检/事故 R 编号", /\bR\d{1,4}[a-z]?\b/],
  ["任务编号 MV-/SP-", /\b(?:MV|SP)-\d+\b/],
  ["任务/阶段 A 编号", /\bA\d{1,3}(?:\.\d+)*(?:-\d+)*\b/],
  ["任务/阶段 B 编号", /\bB\d{1,2}\b/],
  ["【编号】式标签", /【[A-Z0-9][A-Z0-9/·\-#]*】/],
];

/** 递归枚举目录下所有 .ts 文件。 */
function* walkTypeScriptFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) yield* walkTypeScriptFiles(fullPath);
    else if (fullPath.endsWith(".ts")) yield fullPath;
  }
}

const violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of walkTypeScriptFiles(join(ROOT, dir))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [name, pattern] of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${relative(ROOT, file)}:${index + 1} [${name}]: ${line.trim()}`);
          break; // 每行只报首个命中，避免刷屏
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    `发现 ${violations.length} 处注释死指针（文档路径/章节号/任务与巡检编号），` +
      "成因请内联进注释正文，指针一律移除（规矩见 AGENT.md 注释规范）：",
  );
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log("check:docs 通过 — 注释自足，无死指针。");
