/**
 * A5.3.1 GAP-2 Architecture Test — 阻止新代码进入 Legacy Decision 路径。
 *
 * 规则：
 *   1. 只有 war-planner.ts 和 war-planning-system.ts 可以 import selectWarTarget / decideSquadSize
 *   2. 新增 system 文件禁止 import domain/war/planning.ts（Legacy 路径）
 *   3. 新增 system 文件必须通过 domain/military/war-planning.ts（Canonical 路径）
 *   4. domain/military/ 不得引用 Game / Memory / RawMemory
 *   5. recovery-execution-system.ts 是唯一消费 warAbortSignals 的系统
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const NL = String.fromCharCode(10);
const SRC = resolve(__dirname, "../../../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const ALL_FILES = walk(SRC);

function codeLines(src: string): string {
  return src.split(NL)
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join(NL);
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

// ─── 规则 1: selectWarTarget / decideSquadSize 只能在 war-planner.ts 中使用 ───

describe("A5.3.1 GAP-2: Legacy import 限制", () => {
  it("selectWarTarget 只能被 war-planner.ts import", () => {
    const allowed = ["systems/war-planner.ts"];
    const bad: string[] = [];
    for (const f of ALL_FILES) {
      const src = readFileSync(f, "utf8");
      // 精确检测 import 语句中包含 selectWarTarget 的行
      const lines = src.split(NL);
      let hasImport = false;
      for (const line of lines) {
        if (line.includes("selectWarTarget") && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          // 如果是 import 块的一部分（以 import 开头或以逗号结尾或包含 from）
          if (/^\s*(import|selectWarTarget|\})/.test(line) || line.includes("from")) {
            hasImport = true;
            break;
          }
          // 如果是实际调用也标记（需要检查是否是 import 语句的一部分）
          if (/selectWarTarget\s*\(/.test(line) && !line.trim().startsWith("//")) {
            // 这是调用，不是 import — 跳过
            continue;
          }
        }
      }
      // 更简单的方法：检测是否有 import 块包含 selectWarTarget
      const importBlockRe = /import\s*\{[^}]*selectWarTarget[^}]*\}/s;
      if (importBlockRe.test(src)) {
        const rel = relative(SRC, f);
        if (!allowed.some(a => rel.endsWith(a))) {
          if (!rel.endsWith("domain/war/planning.ts") && !rel.includes("tests/")) {
            bad.push(rel);
          }
        }
      }
    }
    expect(bad, `selectWarTarget imported by: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("decideSquadSize 只能被 war-planner.ts import", () => {
    const allowed = ["systems/war-planner.ts"];
    const bad: string[] = [];
    for (const f of ALL_FILES) {
      const src = readFileSync(f, "utf8");
      // 精确检测 import 语句中包含 decideSquadSize 的行
      const lines = src.split(NL);
      let hasImport = false;
      for (const line of lines) {
        // 只匹配实际 import 语句（以 import 开头或在 import 块中）
        if (/^\s*(decideSquadSize|\}|import)/.test(line) && line.includes("decideSquadSize")) {
          hasImport = true;
          break;
        }
        // 匹配多行 import 中的 decideSquadSize
        if (/^\s*decideSquadSize[\s,]/.test(line)) {
          hasImport = true;
          break;
        }
      }
      if (hasImport) {
        const rel = relative(SRC, f);
        if (!allowed.some(a => rel.endsWith(a))) {
          if (!rel.endsWith("domain/war/planning.ts") && !rel.includes("tests/")) {
            bad.push(rel);
          }
        }
      }
    }
    expect(bad, `decideSquadSize imported by: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 2: 新增 system 文件禁止 import domain/war/planning.ts ───

describe("A5.3.1 GAP-2: 新 system 禁止 Legacy 路径", () => {
  it("systems/ 下只有 war-planner.ts 可以 import domain/war/planning", () => {
    // power-farm-manager.ts import decideHealerCount from domain/war/planning —
    // 这是已有复用，标记为 LEGACY_COMPATIBILITY_ONLY 允许
    const allowed = ["systems/war-planner.ts", "systems/power-farm-manager.ts"];
    const bad: string[] = [];
    for (const f of ALL_FILES) {
      const rel = relative(SRC, f);
      if (!rel.startsWith("systems/")) continue;
      if (allowed.some(a => rel.endsWith(a))) continue;
      const src = readFileSync(f, "utf8");
      if (src.includes("domain/war/planning")) {
        bad.push(rel);
      }
    }
    expect(bad, `domain/war/planning imported by non-legacy: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 3: domain/military/ 纯度 ───

describe("A5.3.1 GAP-2: domain/military/ Domain Purity", () => {
  const militaryDomainFiles = ALL_FILES.filter(f =>
    relative(SRC, f).startsWith("domain/military/"),
  );

  it("不引用 Game / Memory / RawMemory / console", () => {
    const bad: string[] = [];
    for (const f of militaryDomainFiles) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Game\./.test(code) || /Memory\./.test(code) || /RawMemory\./.test(code) || /console\./.test(code)) {
        bad.push(relative(SRC, f));
      }
    }
    expect(bad, `Runtime refs found in: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("不 import systems/ 或 creeps/", () => {
    const bad: string[] = [];
    for (const f of militaryDomainFiles) {
      for (const imp of importsOf(f)) {
        if (imp.includes("systems/") || imp.includes("creeps/")) {
          bad.push(relative(SRC, f) + " -> " + imp);
        }
      }
    }
    expect(bad, `Cross-layer imports: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 4: recovery-execution-system 是唯一消费 warAbortSignals 的系统 ───

describe("A5.3.1 GAP-1: warAbortSignals 消费边界", () => {
  it("只有 recovery-execution-system.ts 在 systems/ 中读取 warAbortSignals", () => {
    const bad: string[] = [];
    for (const f of ALL_FILES) {
      const rel = relative(SRC, f);
      if (!rel.startsWith("systems/")) continue;
      if (rel.endsWith("recovery-execution-system.ts")) continue; // 唯一允许
      if (rel.endsWith("war-planner.ts")) continue; // 写入者允许
      const code = codeLines(readFileSync(f, "utf8"));
      if (code.includes("warAbortSignals")) {
        bad.push(rel);
      }
    }
    expect(bad, `warAbortSignals read by: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 5: spawnCreep 只在 spawn-manager 中 ───

describe("A5.3.1: spawnCreep 边界", () => {
  it("spawnCreep 只在 spawn-manager.ts 中", () => {
    const bad: string[] = [];
    for (const f of ALL_FILES) {
      const rel = relative(SRC, f);
      if (rel.endsWith("spawn-manager.ts")) continue;
      const code = codeLines(readFileSync(f, "utf8"));
      if (/spawnCreep\s*\(/.test(code)) {
        bad.push(rel);
      }
    }
    expect(bad, `spawnCreep found in: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 6: Legacy 标记验证 ───

describe("A5.3.1 GAP-2: LEGACY_COMPATIBILITY_ONLY 标记", () => {
  it("war-planner.ts 中 selectWarTarget 调用处有 LEGACY 标记", () => {
    const f = resolve(SRC, "systems/war-planner.ts");
    const src = readFileSync(f, "utf8");
    const lines = src.split(NL);
    let foundLegacyMark = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // 检测实际调用（非注释行，包含 selectWarTarget 和括号）
      if (line.includes("selectWarTarget") && line.includes("(") && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        // 查找前 15 行是否有 LEGACY 标记
        for (let j = Math.max(0, i - 15); j <= i; j++) {
          if (lines[j]!.includes("LEGACY")) {
            foundLegacyMark = true;
            break;
          }
        }
        if (!foundLegacyMark) break;
      }
    }
    expect(foundLegacyMark, "selectWarTarget call lacks LEGACY_COMPATIBILITY_ONLY marker").toBe(true);
  });

  it("war-planner.ts 中 decideSquadSize 调用处有 LEGACY 标记", () => {
    const f = resolve(SRC, "systems/war-planner.ts");
    const src = readFileSync(f, "utf8");
    const lines = src.split(NL);
    let foundLegacyMark = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // 检测实际调用（非注释行，包含 decideSquadSize 和括号）
      if (line.includes("decideSquadSize") && line.includes("(") && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        for (let j = Math.max(0, i - 15); j <= i; j++) {
          if (lines[j]!.includes("LEGACY")) {
            foundLegacyMark = true;
            break;
          }
        }
        if (!foundLegacyMark) break;
      }
    }
    expect(foundLegacyMark, "decideSquadSize call lacks LEGACY_COMPATIBILITY_ONLY marker").toBe(true);
  });

  it("domain/war/planning.ts 头部有 LEGACY 标记", () => {
    const f = resolve(SRC, "domain/war/planning.ts");
    const src = readFileSync(f, "utf8");
    // 检查前 30 行有 LEGACY_COMPATIBILITY_ONLY
    const header = src.split(NL).slice(0, 30).join(NL);
    expect(header).toContain("LEGACY_COMPATIBILITY_ONLY");
  });
});
