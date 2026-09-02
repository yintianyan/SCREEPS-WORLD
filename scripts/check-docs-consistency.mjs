#!/usr/bin/env node
/**
 * check:docs — 文档与源码一致性静态检查（docs 治理门禁）。
 *
 * 检查项（对应 docs 审查执行方案第五步）：
 *  1. docs + AGENT.md 内部 Markdown 链接全部可解析（相对路径目标文件存在）
 *  2. CpuTier 术语：文档不得出现「五档降级/CpuTier/看门狗」表述（源码只有四档）
 *  3. STATUS.md 的 schemaVersion 与 src/config/index.ts CONFIG.memory.schemaVersion 一致；
 *     文档中裸引用 sv=39 的行必须带 Historical / 旧部署 / Blocked 标注
 *  4. STATUS.md 的 registerSystem / registerRole 数量与 src/bootstrap.ts 一致
 *  5. Shadow-Only 与生产 import 图一致：src 内不得 import domain/intelligence 或
 *     strategy/decision-trace；已裁决删除的文件不得重新出现
 *  6. 发布/soak 文档不得保留未降级的「[Fact] soak」数据声明（旧 sv=39 数据集
 *     必须标 Historical Evidence）
 *  7. 文档禁止引用不存在的实现入口（MarketManager 禁名；文档中 src/*.ts 路径必须存在）
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const checks = [];

function fail(name, msg) {
  errors.push(`[${name}] ${msg}`);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── 收集文档集合 ────────────────────────────────────────────────
const docFiles = [
  ...walk(join(ROOT, "docs")).filter((p) => p.endsWith(".md")),
  join(ROOT, "AGENT.md"),
];
const docText = new Map(docFiles.map((p) => [p, readFileSync(p, "utf8")]));

// ── 1. Markdown 链接可解析 ──────────────────────────────────────
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
for (const [file, text] of docText) {
  for (const m of text.matchAll(LINK_RE)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const pathOnly = target.split("#")[0];
    if (!pathOnly) continue;
    const abs = resolve(dirname(file), pathOnly);
    if (!existsSync(abs)) {
      fail("links", `${relative(ROOT, file)} → ${target}（目标不存在）`);
    }
  }
}
checks.push(`1. 链接检查：${docFiles.length} 个文档`);

// ── 2. CpuTier 术语（源码四档） ─────────────────────────────────
const contracts = readFileSync(join(ROOT, "src/kernel/contracts.ts"), "utf8");
const tierMatch = contracts.match(/export type CpuTier = ([^;]+);/);
if (!tierMatch) fail("cputier", "src/kernel/contracts.ts 未找到 CpuTier 定义");
else {
  const tiers = tierMatch[1].match(/"([a-z]+)"/g) ?? [];
  if (tiers.length !== 4) {
    fail("cputier", `CpuTier 应为四档，实际 ${tiers.length} 档：${tierMatch[1]}`);
  }
}
for (const [file, text] of docText) {
  if (/五档(降级|CpuTier|看门狗)/.test(text)) {
    fail("cputier", `${relative(ROOT, file)} 出现「五档」降级表述（源码只有四档 CpuTier）`);
  }
}
checks.push("2. CpuTier 术语：contracts.ts 四档 + 文档禁「五档」");

// ── 3. schemaVersion 一致 ──────────────────────────────────────
const config = readFileSync(join(ROOT, "src/config/index.ts"), "utf8");
const svMatch = config.match(/schemaVersion:\s*(\d+)/);
if (!svMatch) fail("schema", "src/config/index.ts 未找到 schemaVersion");
const svCode = svMatch ? Number(svMatch[1]) : NaN;
const statusText = docText.get(join(ROOT, "docs/STATUS.md")) ?? "";
// 口径行正则说明：pipe 两侧用 [ \t]* 而非单空格 — markdown formatter 对
// 表格做列对齐时会给单元格填充空白（如「生产注册系统数     | **33**」），
// 单空格匹配会假阳性报「缺少口径行」（2026-09-02 审计事故实证）。仅容忍
// 水平空白（不含换行），保持「同一表格行」语义，防跨行误匹配。
const svDoc = statusText.match(/Memory schemaVersion[ \t]*\|[ \t]*\*\*(\d+)\*\*/);
if (!svDoc) fail("schema", "docs/STATUS.md 缺少「Memory schemaVersion」口径行");
else if (Number(svDoc[1]) !== svCode) {
  fail("schema", `STATUS.md schemaVersion=${svDoc[1]} ≠ CONFIG ${svCode}`);
}
for (const [file, text] of docText) {
  for (const line of text.split("\n")) {
    if (/sv=39/.test(line) && !/Historical|旧部署|Blocked|sv=39 vs/.test(line)) {
      fail("schema", `${relative(ROOT, file)} 裸引用 sv=39 未标 Historical/Blocked：${line.trim().slice(0, 80)}`);
    }
  }
}
checks.push(`3. schemaVersion：CONFIG=${svCode} ↔ STATUS.md + sv=39 标注`);

// ── 4. registerSystem / registerRole 数量 ──────────────────────
const bootstrap = readFileSync(join(ROOT, "src/bootstrap.ts"), "utf8");
const nSystems = (bootstrap.match(/\.registerSystem\(/g) ?? []).length;
const nRoles = (bootstrap.match(/\.registerRole\(/g) ?? []).length;
const sysDoc = statusText.match(/生产注册系统数[ \t]*\|[ \t]*\*\*(\d+)\*\*/);
const roleDoc = statusText.match(/生产注册角色数[ \t]*\|[ \t]*\*\*(\d+)\*\*/);
if (!sysDoc) fail("registry", "STATUS.md 缺少「生产注册系统数」口径行");
else if (Number(sysDoc[1]) !== nSystems) {
  fail("registry", `STATUS.md 系统数 ${sysDoc[1]} ≠ bootstrap.ts ${nSystems}`);
}
if (!roleDoc) fail("registry", "STATUS.md 缺少「生产注册角色数」口径行");
else if (Number(roleDoc[1]) !== nRoles) {
  fail("registry", `STATUS.md 角色数 ${roleDoc[1]} ≠ bootstrap.ts ${nRoles}`);
}
checks.push(`4. 注册表：bootstrap ${nSystems} 系统 / ${nRoles} 角色 ↔ STATUS.md`);

// ── 5. Shadow-Only 与生产 import 图一致 ────────────────────────
const srcFiles = walk(join(ROOT, "src")).filter((p) => p.endsWith(".ts"));
for (const file of srcFiles) {
  if (file.includes(`${join(ROOT, "src")}/domain/intelligence`)) continue;
  const text = readFileSync(file, "utf8");
  if (/domain\/intelligence/.test(text)) {
    fail("shadow", `${relative(ROOT, file)} import 了 Shadow-Only 的 domain/intelligence（R11）`);
  }
  if (/strategy\/decision-trace/.test(text)) {
    fail("shadow", `${relative(ROOT, file)} import 了 Shadow-Only 的 strategy/decision-trace（R11）`);
  }
}
for (const gone of [
  "src/kernel/decision-trace.ts",
  "src/systems/evaluation-system.ts",
  "src/telemetry/EvaluationRegistry.ts",
]) {
  if (existsSync(join(ROOT, gone))) {
    fail("shadow", `R11 已删除文件重新出现：${gone}`);
  }
}
checks.push(`5. Shadow-Only：${srcFiles.length} 个 src 文件 import 图 + 已删文件不复活`);

// ── 6. 发布/soak 文档无未降级 [Fact] soak 声明 ──────────────────
for (const rel of [
  "docs/implementation/RELEASE_GATE_AND_ROLLBACK.md",
  "docs/implementation/CANARY_SOAK_PROCEDURE.md",
]) {
  const text = docText.get(join(ROOT, rel)) ?? "";
  if (/\[Fact\] soak/.test(text)) {
    fail("soak-fact", `${rel} 保留未降级的「[Fact] soak」声明（旧 sv=39 数据须标 Historical Evidence）`);
  }
}
checks.push("6. soak [Fact] 降级：RELEASE_GATE / CANARY 无裸 soak Fact");

// ── 7. 禁止不存在的实现入口 ────────────────────────────────────
// 豁免：否定式记述（「不存在 X」「已删除」「移除了」、删除线、概念性落点）是合法的历史/裁决记录。
const NEGATIVE_RE = /不存在|已删除|已移除|移除了|~~|概念性落点|概念性容器/;
for (const [file, text] of docText) {
  for (const line of text.split("\n")) {
    if (/MarketManager/.test(line) && !NEGATIVE_RE.test(line)) {
      fail("entry", `${relative(ROOT, file)} 引用不存在的 MarketManager（唯一写者是 TerminalManager）`);
    }
  }
}
const SRC_REF_RE = /src\/[A-Za-z0-9_][A-Za-z0-9_\/.-]*\.ts/g;
// research/ 是 Phase-0 调研存档，src 路径多为外部 bot 源码引用，不做本仓存在性检查。
for (const [file, text] of docText) {
  if (file.includes(`${join(ROOT, "docs")}/research/`)) continue;
  for (const line of text.split("\n")) {
    if (!SRC_REF_RE.test(line)) continue;
    SRC_REF_RE.lastIndex = 0;
    if (NEGATIVE_RE.test(line) || /概念性落点/.test(line)) continue;
    for (const m of line.matchAll(SRC_REF_RE)) {
      if (!existsSync(join(ROOT, m[0]))) {
        fail("entry", `${relative(ROOT, file)} 引用不存在的源码路径 ${m[0]}`);
      }
    }
  }
}
checks.push("7. 实现入口：MarketManager 禁名 + 文档 src 路径存在性");

// ── 汇总 ───────────────────────────────────────────────────────
for (const c of checks) console.log(`✔ ${c}`);
if (errors.length > 0) {
  console.error(`\n✘ ${errors.length} 个文档一致性问题：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\ncheck:docs 全部通过。");
