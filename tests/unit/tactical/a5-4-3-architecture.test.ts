/**
 * A5.4.3 Architecture Guard — Focus Fire Domain Purity & Boundary Tests.
 *
 * 13 条边界检查（对应需求 §24 Architecture Guards）：
 *   1. Domain 禁止 Game
 *   2. Domain 禁止 Memory
 *   3. Domain 禁止 Creep
 *   4. Domain 禁止 attack
 *   5. Domain 禁止 move
 *   6. Tactical 禁止 spawn
 *   7. Tactical 禁止 logistics
 *   8. Tactical 禁止 recovery
 *   9. Tactical 禁止修改 WarPosture
 *   10. Tactical 禁止创建 Operation
 *   11. FocusFire 不得创建 Strategic Target
 *   12. 不得创建第二套 Threat Assessment
 *   13. 不得创建第二套 CombatCapability
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

const FOCUS_FIRE_FILE = ALL_FILES.find(f =>
  relative(SRC, f).endsWith("domain/tactical/focus-fire.ts"),
)!;

const ENGAGEMENT_RUNTIME_FILE = ALL_FILES.find(f =>
  relative(SRC, f).endsWith("systems/tactical-engagement-runtime.ts"),
)!;

// ─── 规则 1-5: Domain Purity — 不引用 Runtime / 不执行 Action ───

describe("A5.4.3: Focus Fire Domain Purity (Guards 1-5)", () => {
  // Guard 1: Domain 禁止 Game
  it("1. focus-fire.ts 不引用 Game", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).not.toMatch(/\bGame\b\./);
  });

  // Guard 2: Domain 禁止 Memory
  it("2. focus-fire.ts 不引用 Memory", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).not.toMatch(/\bMemory\b\./);
  });

  // Guard 3: Domain 禁止 Creep (类型引用)
  it("3. focus-fire.ts 不引用 Creep / Room / PathFinder", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    const bad: string[] = [];
    if (/\bCreep\b/.test(code)) bad.push("Creep");
    if (/\bPathFinder\b/.test(code)) bad.push("PathFinder");
    if (/\bRoom\b/.test(code) && !/RoomPosition/.test(code)) bad.push("Room");
    expect(bad, `Runtime refs found: ${bad.join(", ")}`).toHaveLength(0);
  });

  // Guard 4: Domain 禁止 attack()
  it("4. focus-fire.ts 不调用 attack / rangedAttack / heal", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    const bad: string[] = [];
    if (/\battack\s*\(/.test(code)) bad.push("attack()");
    if (/\brangedAttack\s*\(/.test(code)) bad.push("rangedAttack()");
    if (/\bheal\s*\(/.test(code)) bad.push("heal()");
    if (/\bmoveTo\b/.test(code)) bad.push("moveTo");
    expect(bad, `Action API refs found: ${bad.join(", ")}`).toHaveLength(0);
  });

  // Guard 5: Domain 禁止 move / registerMove
  it("5. focus-fire.ts 不调用 move / registerMove / spawnCreep", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    const bad: string[] = [];
    if (/\bregisterMove\b/.test(code)) bad.push("registerMove");
    if (/\bspawnCreep\s*\(/.test(code)) bad.push("spawnCreep()");
    if (/\b\.move\s*\(/.test(code)) bad.push("move()");
    expect(bad, `Movement/Spawn API refs found: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── 规则 6-8: Tactical 禁止 spawn / logistics / recovery ───

describe("A5.4.3: Tactical Engagement Runtime Boundary (Guards 6-8)", () => {
  // Guard 6: Tactical 禁止 spawn
  it("6. tactical-engagement-runtime.ts 不调用 spawnCreep", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/spawnCreep\s*\(/);
  });

  // Guard 7: Tactical 禁止 logistics
  it("7. tactical-engagement-runtime.ts 不引用 logistics-planner / logisticsSystem", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("logistics-planner");
    expect(src).not.toContain("logisticsSystem");
  });

  // Guard 8: Tactical 禁止 recovery
  it("8. tactical-engagement-runtime.ts 不引用 recovery-execution", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("recovery-execution");
    expect(src).not.toContain("recoveryExecution");
  });
});

// ─── 规则 9-10: Tactical 禁止修改 WarPosture / 创建 Operation ───

describe("A5.4.3: Strategic Boundary (Guards 9-10)", () => {
  // Guard 9: Tactical 禁止修改 WarPosture
  it("9. tactical-engagement-runtime.ts 不修改 WarPosture / Memory.kernel.strategy", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/Memory\.kernel\.strategy\s*\./);
    expect(code).not.toMatch(/\.posture\s*=/);
  });

  // Guard 10: Tactical 禁止创建 Operation
  it("10. tactical-engagement-runtime.ts 不创建 MilitaryOperation", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("createOperation");
    expect(src).not.toContain("MilitaryOperation");
  });
});

// ─── 规则 11: FocusFire 不得创建 Strategic Target ───

describe("A5.4.3: No Strategic Target Creation (Guard 11)", () => {
  it("11. focus-fire.ts 不引用 WarPlan / WarPosture 修改", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).not.toMatch(/WarPlan\b/);
    expect(code).not.toMatch(/\.posture\s*=/);
  });
});

// ─── 规则 12-13: 不得创建第二套 Threat Assessment / CombatCapability ───

describe("A5.4.3: No Duplicate Systems (Guards 12-13)", () => {
  // Guard 12: 不得创建第二套 Threat Assessment
  it("12. focus-fire.ts 不重新实现 assessThreat / ThreatAssessment", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).not.toMatch(/\bassessThreat\b/);
    expect(code).not.toMatch(/\bThreatAssessment\b/);
  });

  // Guard 13: 不得创建第二套 CombatCapability
  it("13. focus-fire.ts 不重新实现 evaluateCombatCapability", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).not.toMatch(/\bevaluateCombatCapability\b/);
    // Should import CombatCapability (consuming, not re-implementing)
    const src = readFileSync(FOCUS_FIRE_FILE, "utf8");
    expect(src).toContain("CombatCapability");
  });
});

// ─── 额外规则: Domain 不 import systems / creeps / kernel ───

describe("A5.4.3: Domain Import Boundary", () => {
  it("focus-fire.ts 不 import systems/ 或 creeps/ 或 kernel/", () => {
    const src = readFileSync(FOCUS_FIRE_FILE, "utf8");
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

  it("focus-fire.ts 不使用 Math.random / Date.now", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    const bad: string[] = [];
    if (/Math\.random/.test(code)) bad.push("Math.random");
    if (/Date\.now/.test(code)) bad.push("Date.now");
    expect(bad).toHaveLength(0);
  });
});

// ─── Bootstrap Registration ───

describe("A5.4.3: Bootstrap Registration", () => {
  it("tacticalEngagementSystem 已注册到 bootstrap", () => {
    const bootstrapPath = join(SRC, "bootstrap.ts");
    const src = readFileSync(bootstrapPath, "utf8");
    expect(src).toContain("tacticalEngagementSystem");
    expect(src).toContain("registerSystem(tacticalEngagementSystem)");
  });
});

// ─── Barrel Export ───

describe("A5.4.3: Barrel Export", () => {
  it("focus-fire 已从 domain/tactical/index.ts 导出", () => {
    const indexPath = join(SRC, "domain/tactical/index.ts");
    const src = readFileSync(indexPath, "utf8");
    expect(src).toContain("focus-fire");
  });
});

// ─── Runtime System Boundary ───

describe("A5.4.3: Runtime System Boundary", () => {
  it("tactical-engagement-runtime.ts 不直接调用 attack() / heal() / rangedAttack()", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/\.attack\s*\(/);
    expect(code).not.toMatch(/\.heal\s*\(/);
    expect(code).not.toMatch(/\.rangedAttack\s*\(/);
    expect(code).not.toMatch(/\.rangedHeal\s*\(/);
  });

  it("tactical-engagement-runtime.ts 不引用 evaluateTacticalAction (那是 tactical-runtime 的职责)", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("evaluateTacticalAction");
  });

  it("tactical-engagement-runtime.ts 调用 planFocusFire (核心纯函数)", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).toContain("planFocusFire");
  });
});

// ─── attacker.ts Integration ───

describe("A5.4.3: attacker.ts Focus Fire Integration", () => {
  it("attacker.ts 包含 attackByFocusFire 候选", () => {
    const attackerPath = join(SRC, "creeps/roles/attacker.ts");
    const src = readFileSync(attackerPath, "utf8");
    expect(src).toContain("attackByFocusFire");
    expect(src).toContain("readAttackIntent");
  });

  it("attacker.ts focus-fire 候选在 acquire/work 链的首位", () => {
    const attackerPath = join(SRC, "creeps/roles/attacker.ts");
    const src = readFileSync(attackerPath, "utf8");
    // acquire 数组中 attackByFocusFire 应该是第一个
    const acquireMatch = src.match(/acquire:\s*\[([^\]]+)\]/);
    expect(acquireMatch).not.toBeNull();
    const acquireList = acquireMatch![1]!;
    expect(acquireList.trim().startsWith("attackByFocusFire()")).toBe(true);
  });
});
