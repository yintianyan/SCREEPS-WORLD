/**
 * A5.4.1 Architecture Guards — Tactical Runtime 架构守卫。
 *
 * 守卫规则：
 *   AG-1: tactical-runtime-system 是系统层（不导入 creeps/roles/）
 *   AG-2: tactical-runtime-system 不直接写 warAbortSignals
 *   AG-3: tactical-runtime-system 不调用 spawnCreep / submitRequest（由 war-planner 执行孵化）
 *   AG-4: creeps 层不导入 tactical-runtime-system（通过 globalCache 通信）
 *   AG-5: tactical-runtime-system 不调用 PathFinder.search
 *   AG-6: tactical-runtime-system 不调用 creep.move / attack / heal / rangedAttack
 *   AG-7: recovery-execution-system 消费 tacticalAbortSignals
 *   AG-8: logistics-planner 消费 tacticalSupplyDemands
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

// ─── AG-1: tactical-runtime-system 不导入 creeps/roles/ ───

describe("A5.4.1 AG-1: tactical-runtime-system 不导入 creeps 层", () => {
  it("不导入 creeps/roles/ 或 creeps/engine/", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const imports = importsOf(f);
    const bad = imports.filter(p =>
      p.includes("creeps/roles/") || p.includes("creeps/engine/"),
    );
    expect(bad, `导入了 creeps 层: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── AG-2: tactical-runtime-system 不直接写 warAbortSignals ───

describe("A5.4.1 AG-2: 不直接写 warAbortSignals", () => {
  it("tactical-runtime-system.ts 不写 g.warAbortSignals =", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const code = codeLines(readFileSync(f, "utf8"));
    expect(code).not.toMatch(/g\.warAbortSignals\s*=/);
  });
});

// ─── AG-3: tactical-runtime-system 不调用 spawnCreep / submitRequest ───

describe("A5.4.1 AG-3: 不调用 spawnCreep / submitRequest", () => {
  it("tactical-runtime-system.ts 不直接调用孵化 API", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const code = codeLines(readFileSync(f, "utf8"));
    expect(code).not.toMatch(/spawnCreep\s*\(/);
    expect(code).not.toMatch(/submitRequest\s*\(/);
  });
});

// ─── AG-4: creeps 层不导入 tactical-runtime-system ───

describe("A5.4.1 AG-4: creeps 层不导入 tactical-runtime-system", () => {
  it("零命中", () => {
    const creepFiles = ALL_FILES.filter(f =>
      relative(SRC, f).startsWith("creeps/"),
    );
    const bad: string[] = [];
    for (const f of creepFiles) {
      const imports = importsOf(f);
      for (const imp of imports) {
        if (imp.includes("tactical-runtime-system")) {
          bad.push(relative(SRC, f));
        }
      }
    }
    expect(bad, `导入了 tactical-runtime-system: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── AG-5: tactical-runtime-system 不调用 PathFinder.search ───

describe("A5.4.1 AG-5: 不调用 PathFinder.search", () => {
  it("tactical-runtime-system.ts 不直接寻路", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const code = codeLines(readFileSync(f, "utf8"));
    expect(code).not.toMatch(/PathFinder\.search\s*\(/);
  });
});

// ─── AG-6: tactical-runtime-system 不调用 creep 动作 API ───

describe("A5.4.1 AG-6: 不调用 creep 动作 API", () => {
  it("不调用 .move() / .attack() / .heal() / .rangedAttack() / .rangedHeal()", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const code = codeLines(readFileSync(f, "utf8"));
    expect(code).not.toMatch(/\.move\s*\(/);
    expect(code).not.toMatch(/\.attack\s*\(/);
    expect(code).not.toMatch(/\.heal\s*\(/);
    expect(code).not.toMatch(/\.rangedAttack\s*\(/);
    expect(code).not.toMatch(/\.rangedHeal\s*\(/);
  });
});

// ─── AG-7: recovery-execution-system 消费 tacticalAbortSignals ───

describe("A5.4.1 AG-7: recovery-execution-system 消费 tacticalAbortSignals", () => {
  it("recovery-execution-system.ts 包含 consumeTacticalAbortSignals", () => {
    const f = resolve(SRC, "systems/recovery-execution-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("consumeTacticalAbortSignals");
    expect(src).toContain("tacticalAbortSignals");
  });
});

// ─── AG-8: logistics-planner 消费 tacticalSupplyDemands ───

describe("A5.4.1 AG-8: logistics-planner 消费 tacticalSupplyDemands", () => {
  it("logistics-planner.ts 包含 tacticalSupplyDemands 消费", () => {
    const f = resolve(SRC, "systems/logistics-planner.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("tacticalSupplyDemands");
  });
});
