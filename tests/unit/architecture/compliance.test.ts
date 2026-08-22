/**
 * 【G-J】Architecture Compliance Tests —— FREEZE 红线的自动化守卫。
 * 规则来源：DEPENDENCY_GRAPH.md + STATE_OWNERSHIP_MODEL。
 * 已登记例外内建于 allowlist；新增例外必须在此登记并注明 ADR。
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

function importsOf(file: string): { resolved: string; isType: boolean }[] {
  const src = readFileSync(file, "utf8");
  const out: { resolved: string; isType: boolean }[] = [];
  const re = /import\s+(type\s+)?[\s\S]*?from\s+["'][^"']+["']/g;
  const specRe = /["']([^"']+)["']/;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const stmt = m[0];
    const specMatch = stmt.match(specRe);
    if (!specMatch) continue;
    const spec = specMatch[1]!;
    if (!spec.startsWith(".")) continue;
    const base = resolve(file, "..", spec);
    const candidates = [base, base + ".ts", join(base, "index.ts")];
    const resolved = candidates.find((c) => { try { return statSync(c).isFile(); } catch { return false; } }) ?? base;
    out.push({ resolved, isType: Boolean(m[1]) });
  }
  return out;
}

function layerOf(file: string): string {
  const rel = relative(SRC, file);
  if (rel.startsWith("domain")) return "domain";
  if (rel.startsWith("systems")) return "systems";
  if (rel.startsWith("creeps")) return "creeps";
  if (rel.startsWith("kernel")) return "kernel";
  if (rel.startsWith("config")) return "config";
  return "root";
}

function codeLines(src: string): string {
  return src.split(NL)
    .filter((l) => { const t = l.trim(); return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*"); })
    .join(NL);
}

describe("R1 domain 纯度", () => {
  const domainFiles = ALL_FILES.filter((f) => layerOf(f) === "domain");

  it("不 import systems/* 或 creeps/*", () => {
    const bad: string[] = [];
    for (const f of domainFiles) {
      for (const imp of importsOf(f)) {
        const l = layerOf(imp.resolved);
        if (l === "systems" || l === "creeps") bad.push(relative(SRC, f) + " -> " + relative(SRC, imp.resolved));
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });

  it("kernel 导入仅允许 global-cache（值）或任意 kernel 模块的 type-only", () => {
    const bad: string[] = [];
    for (const f of domainFiles) {
      for (const imp of importsOf(f)) {
        if (layerOf(imp.resolved) !== "kernel") continue;
        if (imp.isType) continue;
        if (imp.resolved.includes("global-cache")) continue;
        bad.push(relative(SRC, f) + " -> " + relative(SRC, imp.resolved));
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });

  it("代码行不得引用 Game./Memory./console.", () => {
    const bad: string[] = [];
    for (const f of domainFiles) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Game\./.test(code) || /Memory\./.test(code) || /console\./.test(code)) bad.push(relative(SRC, f));
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R3 creeps 不 import systems", () => {
  const creepFiles = ALL_FILES.filter((f) => layerOf(f) === "creeps");
  it("零命中", () => {
    const bad: string[] = [];
    for (const f of creepFiles) {
      for (const imp of importsOf(f)) {
        if (layerOf(imp.resolved) === "systems") bad.push(relative(SRC, f));
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R4 systems→creeps 仅限 movement/support", () => {
  const systemFiles = ALL_FILES.filter((f) => layerOf(f) === "systems");
  it("禁 roles/engine", () => {
    const bad: string[] = [];
    for (const f of systemFiles) {
      for (const imp of importsOf(f)) {
        if (layerOf(imp.resolved) !== "creeps") continue;
        const rel = relative(SRC, imp.resolved);
        if (!rel.includes("creeps/movement/") && !rel.includes("creeps/support")) bad.push(relative(SRC, f) + " -> " + rel);
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R5 strategy 状态唯一写者", () => {
  it("赋值写只在 empire-strategy.ts", () => {
    const bad: string[] = [];
    for (const f of ALL_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Memory\.kernel\.strategy\s*(?:\.[a-zA-Z_$][\w$]*)?\s*=[^=]/.test(code)) {
        const rel = relative(SRC, f);
        if (!rel.endsWith("empire-strategy.ts")) bad.push(rel);
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R6 roles 动作红线", () => {
  const roleFiles = ALL_FILES.filter((f) => relative(SRC, f).startsWith("creeps/roles"));
  it("禁 spawnCreep/createConstructionSite/PathFinder.search/Game.market", () => {
    const bad: string[] = [];
    for (const f of roleFiles) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/spawnCreep\s*\(/.test(code)) bad.push(relative(SRC, f) + ": spawnCreep");
      if (/createConstructionSite\s*\(/.test(code)) bad.push(relative(SRC, f) + ": createConstructionSite");
      if (/PathFinder\.search\s*\(/.test(code)) bad.push(relative(SRC, f) + ": PathFinder.search");
      if (/Game\.market/.test(code)) bad.push(relative(SRC, f) + ": Game.market");
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R7 无循环依赖", () => {
  it("src 相对导入图无环（忽略 type-only）", () => {
    const graph = new Map<string, Set<string>>();
    for (const f of ALL_FILES) {
      graph.set(f, new Set());
      for (const imp of importsOf(f)) {
        if (imp.isType) continue;
        if (imp.resolved.startsWith(SRC)) graph.get(f)!.add(imp.resolved);
      }
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    let cyclic: string | undefined;
    const visit = (n: string): void => {
      color.set(n, GRAY);
      for (const next of graph.get(n) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) { cyclic = n + " -> " + next; return; }
        if (c === WHITE) visit(next);
        if (cyclic) return;
      }
      color.set(n, BLACK);
    };
    for (const n of graph.keys()) {
      if ((color.get(n) ?? WHITE) === WHITE) { visit(n); if (cyclic) break; }
    }
    expect(cyclic, "circular dependency at " + cyclic).toBeUndefined();
  });
});
