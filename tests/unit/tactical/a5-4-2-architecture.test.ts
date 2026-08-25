/**
 * A5.4.2 Architecture Guard — Squad Formation Domain Purity & Boundary Tests.
 *
 * 规则：
 *   1. domain/tactical/squad-formation.ts 不得引用 Game / Memory / RawMemory / Kernel / Spawn / Transport / Recovery
 *   2. domain/tactical/squad-formation.ts 不得 import systems/ 或 creeps/
 *   3. domain/tactical/squad-formation.ts 不得调用 PathFinder / moveTo / registerMove
 *   4. domain/tactical/squad-formation.ts 不得使用 Math.random / Date.now
 *   5. systems/squad-movement-runtime.ts 不得引用 domain 层纯函数以外的决策函数
 *   6. squad-movement-runtime.ts 必须注册到 bootstrap
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

const SQUAD_FORMATION_FILE = ALL_FILES.find(f =>
  relative(SRC, f).endsWith("domain/tactical/squad-formation.ts"),
)!;

const SQUAD_MOVEMENT_RUNTIME_FILE = ALL_FILES.find(f =>
  relative(SRC, f).endsWith("systems/squad-movement-runtime.ts"),
)!;

// ─── 规则 1: Domain Purity — 不引用 Runtime ───

describe("A5.4.2: Squad Formation Domain Purity", () => {
  it("squad-formation.ts 不引用 Game / Memory / RawMemory / console", () => {
    const code = codeLines(readFileSync(SQUAD_FORMATION_FILE, "utf8"));
    const bad: string[] = [];
    if (/Game\./.test(code)) bad.push("Game");
    if (/Memory\./.test(code)) bad.push("Memory");
    if (/RawMemory\./.test(code)) bad.push("RawMemory");
    if (/console\./.test(code)) bad.push("console");
    expect(bad, `Runtime refs found: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("squad-formation.ts 不引用 PathFinder / moveTo / registerMove / creep.move", () => {
    const code = codeLines(readFileSync(SQUAD_FORMATION_FILE, "utf8"));
    const bad: string[] = [];
    if (/\bPathFinder\b/.test(code)) bad.push("PathFinder");
    if (/\.moveTo\b/.test(code)) bad.push("moveTo");
    if (/registerMove\b/.test(code)) bad.push("registerMove");
    if (/\.move\b\(/.test(code)) bad.push("move()");
    expect(bad, `Movement API refs found: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("squad-formation.ts 不使用 Math.random / Date.now", () => {
    const code = codeLines(readFileSync(SQUAD_FORMATION_FILE, "utf8"));
    const bad: string[] = [];
    if (/Math\.random/.test(code)) bad.push("Math.random");
    if (/Date\.now/.test(code)) bad.push("Date.now");
    expect(bad).toHaveLength(0);
  });

  it("squad-formation.ts 不 import systems/ 或 creeps/", () => {
    const src = readFileSync(SQUAD_FORMATION_FILE, "utf8");
    const imports: string[] = [];
    const re = /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      imports.push(m[1]!);
    }
    const bad = imports.filter(p =>
      p.includes("systems/") || p.includes("creeps/") || p.includes("kernel/"),
    );
    expect(bad, `Forbidden imports: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 2: System Layer Boundary ───

describe("A5.4.2: Squad Movement Runtime Boundary", () => {
  it("squad-movement-runtime.ts 不引用 evaluateTacticalAction / state-machine 决策函数", () => {
    const src = readFileSync(SQUAD_MOVEMENT_RUNTIME_FILE, "utf8");
    // 系统层薄壳不应直接调用 evaluateTacticalAction（那是 tactical-runtime 的职责）
    // squad-movement-runtime 只调用 squad-formation 的纯函数
    expect(src).not.toContain("evaluateTacticalAction");
    expect(src).not.toContain("assessObjectiveLifecycle");
  });

  it("squad-movement-runtime.ts 不直接调用 attack() / heal() / spawnCreep()", () => {
    const code = codeLines(readFileSync(SQUAD_MOVEMENT_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/\.attack\s*\(/);
    expect(code).not.toMatch(/\.heal\s*\(/);
    expect(code).not.toMatch(/\.rangedAttack\s*\(/);
    expect(code).not.toMatch(/spawnCreep\s*\(/);
  });
});

// ─── 规则 3: Bootstrap Registration ───

describe("A5.4.2: Bootstrap Registration", () => {
  it("squadMovementSystem 已注册到 bootstrap", () => {
    const bootstrapPath = join(SRC, "bootstrap.ts");
    const src = readFileSync(bootstrapPath, "utf8");
    expect(src).toContain("squadMovementSystem");
    expect(src).toContain("registerSystem(squadMovementSystem)");
  });
});

// ─── 规则 4: Barrel Export ───

describe("A5.4.2: Barrel Export", () => {
  it("squad-formation 已从 domain/tactical/index.ts 导出", () => {
    const indexPath = join(SRC, "domain/tactical/index.ts");
    const src = readFileSync(indexPath, "utf8");
    expect(src).toContain("squad-formation");
  });
});

// ─── 规则 5: 确定性验证 ───

describe("A5.4.2: Determinism — 纯函数确定性", () => {
  it("squad-formation.ts 中的导出函数都是纯函数（无副作用）", () => {
    const code = codeLines(readFileSync(SQUAD_FORMATION_FILE, "utf8"));
    // 不应包含副作用：写文件、网络请求、全局变量修改
    const bad: string[] = [];
    if (/require\s*\(/.test(code)) bad.push("require()");
    if (/process\./.test(code)) bad.push("process");
    if (/fs\./.test(code)) bad.push("fs");
    expect(bad).toHaveLength(0);
  });
});
