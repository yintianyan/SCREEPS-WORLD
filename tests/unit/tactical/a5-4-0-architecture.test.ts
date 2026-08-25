/**
 * A5.4.0 Architecture Guard — Tactical Domain Purity & Boundary Tests.
 *
 * 规则：
 *   1. domain/tactical/ 不得引用 Game / Memory / RawMemory / Kernel / Spawn / Transport / Recovery
 *   2. domain/tactical/ 不得 import systems/ 或 creeps/
 *   3. domain/tactical/ 不得调用 spawnCreep / submitRequest / recycle / RecoveryExecution
 *   4. domain/tactical/ 不得使用 Math.random / Date.now
 *   5. Tactical Authorization 必须验证 warPosture
 *   6. Tactical 不得引用 Game.rooms / Memory
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

const TACTICAL_FILES = ALL_FILES.filter(f =>
  relative(SRC, f).startsWith("domain/tactical/"),
);

// ─── 规则 1: Domain Purity — 不引用 Runtime ───

describe("A5.4.0: Tactical Domain Purity", () => {
  it("不引用 Game / Memory / RawMemory / console", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Game\./.test(code) || /Memory\./.test(code) || /RawMemory\./.test(code) || /console\./.test(code)) {
        bad.push(relative(SRC, f));
      }
    }
    expect(bad, `Runtime refs found in: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("不引用 Creep / Room / Spawn / Structure 类型（runtime 引擎类型）", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      // 允许在 type-only import 中引用（type CreepSnapshot 等不持有 runtime）
      // 但禁止实际使用：new Creep() / creep.xxx 等
      if (/\bnew\s+(Creep|Room|Spawn|Structure)\b/.test(code)) {
        bad.push(relative(SRC, f));
      }
    }
    expect(bad).toHaveLength(0);
  });
});

// ─── 规则 2: 不 import systems/ 或 creeps/ ───

describe("A5.4.0: Tactical Domain 不 import 执行层", () => {
  it("不 import systems/ 或 creeps/", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_FILES) {
      for (const imp of importsOf(f)) {
        if (imp.includes("systems/") || imp.includes("creeps/")) {
          bad.push(relative(SRC, f) + " -> " + imp);
        }
      }
    }
    expect(bad, `Cross-layer imports: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("不 import kernel/ (除类型)", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_FILES) {
      for (const imp of importsOf(f)) {
        if (imp.includes("kernel/")) {
          // kernel 类型导入可以接受（contracts 等），但运行时导入不行
          // 暂时全部禁止以保持纯净
          bad.push(relative(SRC, f) + " -> " + imp);
        }
      }
    }
    expect(bad, `kernel imports: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 3: 不调用禁止的执行函数 ───

describe("A5.4.0: Tactical 禁止执行函数", () => {
  it("不调用 spawnCreep / submitRequest / recycle / activateSafeMode", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/spawnCreep\s*\(/.test(code)) bad.push(relative(SRC, f) + " (spawnCreep)");
      if (/submitRequest\s*\(/.test(code)) bad.push(relative(SRC, f) + " (submitRequest)");
      if (/\.recycle\s*\(/.test(code)) bad.push(relative(SRC, f) + " (recycle)");
      if (/activateSafeMode\s*\(/.test(code)) bad.push(relative(SRC, f) + " (activateSafeMode)");
    }
    expect(bad, `Forbidden functions: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 4: 确定性 — 不使用 Math.random / Date.now ───

describe("A5.4.0: Tactical Determinism", () => {
  it("不使用 Math.random / Date.now", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Math\.random/.test(code)) bad.push(relative(SRC, f) + " (Math.random)");
      if (/Date\.now/.test(code)) bad.push(relative(SRC, f) + " (Date.now)");
    }
    expect(bad, `Non-deterministic calls: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 5: Tactical Authorization 必须验证 warPosture ───

describe("A5.4.0: Authorization 验证 warPosture", () => {
  it("validateAuthorization 函数存在于 authorization.ts", () => {
    const f = resolve(SRC, "domain/tactical/authorization.ts");
    const code = readFileSync(f, "utf8");
    expect(code).toContain("validateAuthorization");
    expect(code).toContain("warPosture");
  });

  it("isOffensiveOperation 函数存在", () => {
    const f = resolve(SRC, "domain/tactical/authorization.ts");
    const code = readFileSync(f, "utf8");
    expect(code).toContain("isOffensiveOperation");
  });
});

// ─── 规则 6: 不引用 Game.rooms / Memory ───

describe("A5.4.0: Tactical 不引用 Game.rooms / Memory", () => {
  it("不引用 Game.rooms / Memory", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Game\.rooms/.test(code)) bad.push(relative(SRC, f) + " (Game.rooms)");
      if (/Memory\b/.test(code)) bad.push(relative(SRC, f) + " (Memory)");
    }
    expect(bad).toHaveLength(0);
  });
});

// ─── 规则 7: Tactical 必须有 index.ts barrel ───

describe("A5.4.0: Tactical Domain 结构", () => {
  it("index.ts 存在并导出所有模块", () => {
    const f = resolve(SRC, "domain/tactical/index.ts");
    const code = readFileSync(f, "utf8");
    expect(code).toContain("./types");
    expect(code).toContain("./authorization");
    expect(code).toContain("./state-machine");
    expect(code).toContain("./formation");
  });
});

// ─── 规则 8: Tactical 类型必须包含核心类型 ───

describe("A5.4.0: Tactical 类型完整性", () => {
  it("types.ts 包含 TacticalObjective", () => {
    const f = resolve(SRC, "domain/tactical/types.ts");
    const code = readFileSync(f, "utf8");
    expect(code).toContain("TacticalObjective");
    expect(code).toContain("SquadPlan");
    expect(code).toContain("TacticalState");
    expect(code).toContain("TacticalAuthorization");
    expect(code).toContain("TacticalDecision");
    expect(code).toContain("TacticalAbortSignal");
    expect(code).toContain("ForceShortage");
    expect(code).toContain("ReinforcementDemand");
    expect(code).toContain("SupplyDemand");
  });

  it("types.ts 包含 TargetScope", () => {
    const f = resolve(SRC, "domain/tactical/types.ts");
    const code = readFileSync(f, "utf8");
    expect(code).toContain("TargetScope");
    expect(code).toContain("LOCAL");
    expect(code).toContain("OPERATIONAL");
    expect(code).toContain("STRATEGIC");
  });

  it("types.ts 包含 MovementIntent", () => {
    const f = resolve(SRC, "domain/tactical/types.ts");
    const code = readFileSync(f, "utf8");
    expect(code).toContain("MovementIntent");
    expect(code).toContain("ADVANCE");
    expect(code).toContain("HOLD");
    expect(code).toContain("FLANK");
    expect(code).toContain("RETREAT");
    expect(code).toContain("REGROUP");
  });

  it("types.ts 包含 FormationType", () => {
    const f = resolve(SRC, "domain/tactical/types.ts");
    const code = readFileSync(f, "utf8");
    expect(code).toContain("FormationType");
    expect(code).toContain("LINE");
    expect(code).toContain("WEDGE");
    expect(code).toContain("COLUMN");
    expect(code).toContain("CLUSTER");
    expect(code).toContain("SCATTER");
  });
});
