#!/usr/bin/env node
/**
 * docs:inventory — 从 src/bootstrap.ts 生成 STATUS.md §4 生产清单（合并式）。
 *
 * 设计：表格是文档与代码之间唯一允许的「生成物」。脚本以注册顺序解析
 * registerSystem 调用（绑定名→源文件、前置注释的 P 档），与 STATUS.md
 * inventory 标记区内的既有行按系统名（源文件 basename）合并：
 *   - 既有行整行保留（概念模块 / 状态所有者 / 证据为手工维护列）
 *   - bootstrap 中新出现而表中没有的系统 → 追加 ⚠️ 占位行（待归类）
 *   - 表中有而 bootstrap 中没有的非特殊行 → 状态列标 ⚠️ 未在 bootstrap 发现
 *   - 特殊行（世界模型构建器 / telemetry SDK 注册）原样保留
 * --check 模式：内容会变化时退出码 1（供 CI 使用），不写文件。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = resolve(ROOT, "src/bootstrap.ts");
const STATUS = resolve(ROOT, "docs/STATUS.md");
const CHECK_ONLY = process.argv.includes("--check");

const BEGIN = "<!-- inventory:begin";
const END = "<!-- inventory:end -->";

// ── 解析 bootstrap.ts ─────────────────────────────────────────
const boot = readFileSync(BOOTSTRAP, "utf8");
const lines = boot.split("\n");

// 绑定名 → 源文件相对路径（src/ 下）
const importFile = new Map();
for (const line of lines) {
  const m = line.match(/^import\s+\{\s*(\w+)\s*\}\s+from\s+"\.\/([\w/-]+)"\s*;?\s*$/);
  if (m) importFile.set(m[1], `src/${m[2]}.ts`);
}

function nearestPriority(idx) {
  for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
    const m = lines[i].match(/^\s*\/\/\s*P(\d)[：:]\s*(.*)$/);
    if (m) return { tier: `P${m[1]}`, hint: m[2].trim() };
  }
  return { tier: "?", hint: "（注释缺失）" };
}

const registered = []; // { name, file, tier, hint }
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/\.registerSystem\((\w+)\)/);
  if (!m) continue;
  const binding = m[1];
  const file = importFile.get(binding);
  const { tier, hint } = nearestPriority(i);
  registered.push({
    name: file ? basename(file, ".ts") : binding,
    file: file ?? `⚠️ 未找到 import：${binding}`,
    tier,
    hint,
  });
}
const nRoles = (boot.match(/\.registerRole\(/g) ?? []).length;

// ── 解析 STATUS.md inventory 区 ───────────────────────────────
const status = readFileSync(STATUS, "utf8");
const beginIdx = status.indexOf(BEGIN);
const endIdx = status.indexOf(END);
if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
  console.error(`✘ STATUS.md 缺少 ${BEGIN} … ${END} 标记区`);
  process.exit(1);
}
const section = status.slice(beginIdx, endIdx);
const secLines = section.split("\n");
const header = secLines.findIndex((l) => l.startsWith("| 概念模块"));
if (header === -1) {
  console.error("✘ inventory 区未找到表头行");
  process.exit(1);
}
const pre = secLines.slice(0, header + 2); // 标记行 + 表头 + 分隔行
const rows = secLines.slice(header + 2).filter((l) => l.startsWith("|"));
const SPECIAL = new Set(["（世界模型构建器）", "telemetry SDK 注册"]);

function cells(line) {
  return line.split("|").slice(1, -1).map((c) => c.trim());
}
function join(cellsArr) {
  return `| ${cellsArr.join(" | ")} |`;
}

const rowByKey = new Map();
const keptSpecial = [];
for (const line of rows) {
  const c = cells(line);
  if (SPECIAL.has(c[1]) || c[1].startsWith("（")) {
    keptSpecial.push(line);
    continue;
  }
  rowByKey.set(c[1], line);
}

const outRows = [];
const flagged = [];
const added = [];
for (const r of registered) {
  const existing = rowByKey.get(r.name);
  if (existing) {
    outRows.push(existing);
    rowByKey.delete(r.name);
  } else {
    const line = join([
      "⚠️ 待归类",
      r.name,
      `\`${r.file}\``,
      `${r.tier} / ${r.hint}`,
      "⚠️ 待填写",
      "⚠️ 新增",
      "—",
    ]);
    outRows.push(line);
    added.push(r.name);
  }
}
// 表中剩余 = bootstrap 已不存在的系统
for (const [key, line] of rowByKey) {
  const c = cells(line);
  if (!c[5].includes("未在 bootstrap")) {
    c[5] = `⚠️ 未在 bootstrap 发现（原：${c[5]}）`;
    outRows.push(join(c));
    flagged.push(key);
  } else {
    outRows.push(line);
  }
}

// 尾部保真：保留 inventory 区最后一行表格之后的原始尾行（formatter 会在表格后
// 插入空行；固定以单换行结尾的重建会丢掉它 → updated ≠ status → --check 假阳性，
// 2026-09-02 审计实证：清单内容一致仍报不一致，根因即此）。表格行之间的非管道
// 行仍被规范化丢弃——真实内容变化（行序/增删/状态改写）照常检出。
let lastPipeIdx = header + 1; // rows 区无表格行时，尾行从分隔行之后起算
for (let i = secLines.length - 1; i > header + 1; i--) {
  if (secLines[i].startsWith("|")) { lastPipeIdx = i; break; }
}
const trailingLines = secLines.slice(lastPipeIdx + 1);
const newSection = [...pre, ...outRows, ...keptSpecial, ...trailingLines].join("\n");
const updated = status.slice(0, beginIdx) + newSection + status.slice(endIdx);
const changed = updated !== status;

console.log(`bootstrap：${registered.length} 个 registerSystem / ${nRoles} 个 registerRole`);
if (added.length) console.log(`新增占位行：${added.join("、")}`);
if (flagged.length) console.log(`⚠️ 表中多余行（bootstrap 已无）：${flagged.join("、")}`);
if (!added.length && !flagged.length) console.log("清单与 bootstrap 一致。");

if (CHECK_ONLY) {
  if (changed) {
    console.error("\n✘ docs:inventory --check：STATUS.md §4 清单与 bootstrap.ts 不一致，请运行 npm run docs:inventory 后提交。");
    process.exit(1);
  }
  console.log("--check 通过，无需更新。");
} else if (changed) {
  writeFileSync(STATUS, updated);
  console.log("✔ STATUS.md §4 清单已更新。");
} else {
  console.log("STATUS.md §4 清单已是最新。");
}
