#!/usr/bin/env node
/**
 * 注释文档引用门禁 — 代码必须自足，注释不得引用文档路径（docs/...）。
 * 扫描 src/ 与 tests/ 下的 .ts 文件，命中即失败并打印 file:line。
 * 用法：npm run check:docs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "tests"];
const FORBIDDEN_PATTERN = /docs\//;

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
      if (FORBIDDEN_PATTERN.test(line)) {
        violations.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`发现 ${violations.length} 处注释引用已删除的文档路径，请移除后重试：`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log("check:docs 通过 — 无注释引用文档路径。");