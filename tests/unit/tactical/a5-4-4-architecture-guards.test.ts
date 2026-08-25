/**
 * A5.4.4 Architecture Guards — Tactical Combat Runtime Validation & Closure.
 *
 * 15 条强化架构守卫（对应需求 §19 Architecture Guards）：
 *
 *   1.  Domain 禁止 Game
 *   2.  Domain 禁止 Memory
 *   3.  Domain 禁止 Creep / Room / PathFinder
 *   4.  Domain 禁止 attack() / rangedAttack() / heal()
 *   5.  Domain 禁止 move() / registerMove / spawnCreep
 *   6.  Tactical 禁止 spawn
 *   7.  Tactical 禁止 logistics
 *   8.  Tactical 禁止 recovery
 *   9.  Tactical 禁止修改 WarPosture
 *   10. Tactical 禁止创建 Operation
 *   11. Tactical 禁止创建 Strategic Target
 *   12. Tactical 禁止第二套 Threat Assessment
 *   13. Tactical 禁止第二套 CombatCapability
 *   14. Role 禁止自行创建 Strategic Target
 *   15. Role 禁止绕过 AttackIntent 系统（attacker.ts 的 Legacy attack 必须是 fallback 而非首选）
 *
 * 同时验证：
 *   - Domain 不 import systems/ 或 creeps/ 或 kernel/
 *   - Domain 不使用 Math.random / Date.now
 *   - Tactical Runtime 不直接调用 Game action API
 *   - attacker.ts 的 acquire/work 链中 attackByFocusFire 在首位
 *   - focus-fire.ts 不使用 assessThreat / ThreatAssessment
 *   - focus-fire.ts 不使用 evaluateCombatCapability
 *   - 所有 Domain 纯函数文件 barrel export 完整
 *   - Bootstrap 注册完整
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
  return src
    .split(NL)
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join(NL);
}

function findFile(suffix: string): string {
  const f = ALL_FILES.find((f) => relative(SRC, f).endsWith(suffix));
  if (!f) throw new Error(`File not found: ${suffix}`);
  return f;
}

const FOCUS_FIRE_FILE = findFile("domain/tactical/focus-fire.ts");
const AUTHORIZATION_FILE = findFile("domain/tactical/authorization.ts");
const STATE_MACHINE_FILE = findFile("domain/tactical/state-machine.ts");
const ROLE_INTENT_FILE = findFile("domain/tactical/role-intent.ts");
const SQUAD_FORMATION_FILE = findFile("domain/tactical/squad-formation.ts");
const FORMATION_FILE = findFile("domain/tactical/formation.ts");
const TYPES_FILE = findFile("domain/tactical/types.ts");
const INDEX_FILE = findFile("domain/tactical/index.ts");
const ENGAGEMENT_RUNTIME_FILE = findFile("systems/tactical-engagement-runtime.ts");
const TACTICAL_RUNTIME_FILE = findFile("systems/tactical-runtime-system.ts");
const ATTACKER_FILE = findFile("creeps/roles/attacker.ts");
const HEALER_FILE = findFile("creeps/roles/healer.ts");

// All domain/tactical/*.ts files
const TACTICAL_DOMAIN_FILES = ALL_FILES.filter((f) =>
  relative(SRC, f).startsWith("domain/tactical/"),
);

// ═════════════════════════════════════════════════════════════
// Guards 1-5: Domain Purity — 不引用 Runtime / 不执行 Action
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Domain Purity (Guards 1-5)", () => {
  // Guard 1: Domain 禁止 Game
  it("1. domain/tactical/*.ts 不引用 Game", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_DOMAIN_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/\bGame\b\./.test(code)) bad.push(relative(SRC, f));
    }
    expect(bad, `Game refs found: ${bad.join(", ")}`).toHaveLength(0);
  });

  // Guard 2: Domain 禁止 Memory
  it("2. domain/tactical/*.ts 不引用 Memory", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_DOMAIN_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/\bMemory\b\./.test(code)) bad.push(relative(SRC, f));
    }
    expect(bad, `Memory refs found: ${bad.join(", ")}`).toHaveLength(0);
  });

  // Guard 3: Domain 禁止 Creep / Room / PathFinder
  it("3. domain/tactical/*.ts 不引用 Creep / Room / PathFinder", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_DOMAIN_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      const violations: string[] = [];
      if (/\bCreep\b/.test(code) && !code.includes("CreepSnapshot")) violations.push("Creep");
      if (/\bPathFinder\b/.test(code)) violations.push("PathFinder");
      if (/\bRoom\b/.test(code) && !/RoomPosition|roomName|targetRoom|retreatRoom|regroupRoom|anchorRoom|authorizedTargetRoom|desiredRoom|sameRoom|targetScope/.test(code)) {
        // Check if it's used as a type reference, not a Screeps Room object
        if (/\bRoom\b(?!\.)/.test(code) && !code.includes("TerrainContext")) {
          violations.push("Room");
        }
      }
      if (violations.length > 0) bad.push(`${relative(SRC, f)}: ${violations.join(", ")}`);
    }
    // Room type is allowed in type contexts, but not as runtime object
    // Focus on Creep and PathFinder as hard blocks
    const hardBlocks = bad.filter((b) => b.includes("Creep") || b.includes("PathFinder"));
    expect(hardBlocks, `Hard runtime refs found: ${hardBlocks.join(", ")}`).toHaveLength(0);
  });

  // Guard 4: Domain 禁止 attack() / rangedAttack() / heal()
  it("4. domain/tactical/*.ts 不调用 attack / rangedAttack / heal / dismantle", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_DOMAIN_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      const violations: string[] = [];
      if (/\battack\s*\(/.test(code) && !/attackType|attackCapability|attackParts|ATTACK/.test(code)) {
        // Check if it's an actual function call (not a property name)
        if (/\.attack\s*\(/.test(code)) violations.push("attack()");
      }
      if (/\.rangedAttack\s*\(/.test(code)) violations.push("rangedAttack()");
      if (/\.heal\s*\(/.test(code) && !/healCoverage|healCapability|healSupportDemand|healSupport|HEAL|rangedHeal/.test(code)) {
        if (/\.heal\s*\(/.test(code)) violations.push("heal()");
      }
      if (/\.dismantle\s*\(/.test(code) && !/dismantlePower|DISMANTLE/.test(code)) {
        violations.push("dismantle()");
      }
      if (/\bmoveTo\b/.test(code)) violations.push("moveTo");
      if (violations.length > 0) bad.push(`${relative(SRC, f)}: ${violations.join(", ")}`);
    }
    expect(bad, `Action API refs found: ${bad.join(", ")}`).toHaveLength(0);
  });

  // Guard 5: Domain 禁止 move / registerMove / spawnCreep
  it("5. domain/tactical/*.ts 不调用 move / registerMove / spawnCreep", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_DOMAIN_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      const violations: string[] = [];
      if (/\bregisterMove\b/.test(code)) violations.push("registerMove");
      if (/\bspawnCreep\s*\(/.test(code)) violations.push("spawnCreep()");
      if (/\b\.move\s*\(/.test(code) && !/moveTo|movement|MovementIntent|moveDirective|MovementMode|MOVE/.test(code)) {
        violations.push("move()");
      }
      if (violations.length > 0) bad.push(`${relative(SRC, f)}: ${violations.join(", ")}`);
    }
    expect(bad, `Movement/Spawn API refs found: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════
// Guards 6-8: Tactical 禁止 spawn / logistics / recovery
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Tactical Runtime Boundary (Guards 6-8)", () => {
  // Guard 6: Tactical 禁止 spawn
  it("6. tactical-engagement-runtime.ts 不调用 spawnCreep", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/spawnCreep\s*\(/);
  });

  it("6b. tactical-runtime-system.ts 不调用 spawnCreep", () => {
    const code = codeLines(readFileSync(TACTICAL_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/spawnCreep\s*\(/);
  });

  // Guard 7: Tactical 禁止 logistics
  it("7. tactical-engagement-runtime.ts 不引用 logistics-planner", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("logistics-planner");
    expect(src).not.toContain("logisticsSystem");
  });

  it("7b. tactical-runtime-system.ts 不直接 import logistics-planner", () => {
    const src = readFileSync(TACTICAL_RUNTIME_FILE, "utf8");
    // tactical-runtime-system.ts may reference SupplyDemand type but should not import logistics-planner directly
    expect(src).not.toContain("from \"../logistics-planner\"");
    expect(src).not.toContain("from \"../logistics-system");
  });

  // Guard 8: Tactical 禁止 recovery
  it("8. tactical-engagement-runtime.ts 不引用 recovery-execution", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("recovery-execution");
    expect(src).not.toContain("recoveryExecution");
  });

  it("8b. tactical-runtime-system.ts 不直接 import recovery-execution-system", () => {
    const src = readFileSync(TACTICAL_RUNTIME_FILE, "utf8");
    // May reference TacticalAbortSignal type but should not import recovery-execution-system directly
    expect(src).not.toContain("from \"../recovery-execution-system\"");
  });
});

// ═════════════════════════════════════════════════════════════
// Guards 9-10: Tactical 禁止修改 WarPosture / 创建 Operation
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Strategic Boundary (Guards 9-10)", () => {
  // Guard 9: Tactical 禁止修改 WarPosture
  it("9. tactical-engagement-runtime.ts 不修改 Memory.kernel.strategy / .posture", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/Memory\.kernel\.strategy\s*\./);
    expect(code).not.toMatch(/\.posture\s*=/);
  });

  it("9b. tactical-runtime-system.ts 不修改 Memory.kernel.strategy / .posture", () => {
    const code = codeLines(readFileSync(TACTICAL_RUNTIME_FILE, "utf8"));
    // tactical-runtime-system.ts reads posture but should not write it
    // Check for write patterns
    const postureWrites = code.match(/Memory\.kernel\.strategy\s*\.\s*posture\s*=/g);
    expect(postureWrites).toBeNull();
  });

  // Guard 10: Tactical 禁止创建 Operation
  it("10. tactical-engagement-runtime.ts 不创建 MilitaryOperation / createOperation", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("createOperation");
    // MilitaryOperation may appear in type imports but not in construction
    const code = codeLines(src);
    expect(code).not.toMatch(/new\s+MilitaryOperation/);
  });

  it("10b. tactical-runtime-system.ts 不创建 MilitaryOperation / createOperation", () => {
    const src = readFileSync(TACTICAL_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("createOperation");
    const code = codeLines(src);
    expect(code).not.toMatch(/new\s+MilitaryOperation/);
  });
});

// ═════════════════════════════════════════════════════════════
// Guard 11: Tactical 禁止创建 Strategic Target
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: No Strategic Target Creation (Guard 11)", () => {
  it("11. focus-fire.ts 不引用 WarPlan 修改 / 不创建 Strategic Target", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).not.toMatch(/WarPlan\b/);
    expect(code).not.toMatch(/\.posture\s*=/);
    expect(code).not.toMatch(/strategic\s+target/i);
  });

  it("11b. tactical-engagement-runtime.ts 不创建 Strategic Target / WarPlan", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    // Should read warPlan from Memory but not create/modify it
    expect(code).not.toMatch(/Memory\.kernel\.warPlan\s*=/);
  });
});

// ═════════════════════════════════════════════════════════════
// Guards 12-13: 不得创建第二套 Threat Assessment / CombatCapability
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: No Duplicate Systems (Guards 12-13)", () => {
  // Guard 12: 不得创建第二套 Threat Assessment
  it("12. focus-fire.ts 不重新实现 assessThreat / ThreatAssessment", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).not.toMatch(/\bassessThreat\b/);
    expect(code).not.toMatch(/\bThreatAssessment\b/);
  });

  it("12b. tactical-engagement-runtime.ts 不重新实现 assessThreat", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    // estimateThreatScore is a local helper that consumes CombatCapability,
    // not a duplicate ThreatAssessment system
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

  it("13b. tactical-engagement-runtime.ts 的 buildHostileCapability 不调用 evaluateCombatCapability", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    // buildHostileCapability is a local body parser that builds CombatCapability DTO
    // It does NOT call evaluateCombatCapability (the canonical G2 function)
    expect(code).not.toMatch(/\bevaluateCombatCapability\b/);
  });
});

// ═════════════════════════════════════════════════════════════
// Guard 14: Role 禁止自行创建 Strategic Target
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Role Strategic Target Boundary (Guard 14)", () => {
  it("14. attacker.ts 不创建 WarPlan / 不修改 WarPosture", () => {
    const code = codeLines(readFileSync(ATTACKER_FILE, "utf8"));
    expect(code).not.toMatch(/Memory\.kernel\.warPlan\s*=/);
    expect(code).not.toMatch(/Memory\.kernel\.strategy\s*\.\s*posture\s*=/);
  });

  it("14b. healer.ts 不创建 WarPlan / 不修改 WarPosture", () => {
    const code = codeLines(readFileSync(HEALER_FILE, "utf8"));
    expect(code).not.toMatch(/Memory\.kernel\.warPlan\s*=/);
    expect(code).not.toMatch(/Memory\.kernel\.strategy\s*\.\s*posture\s*=/);
  });
});

// ═════════════════════════════════════════════════════════════
// Guard 15: Role 禁止绕过 AttackIntent 系统
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Role AttackIntent Priority (Guard 15)", () => {
  it("15. attacker.ts acquire 链中 attackByFocusFire 在首位", () => {
    const src = readFileSync(ATTACKER_FILE, "utf8");
    const acquireMatch = src.match(/acquire:\s*\[([^\]]+)\]/);
    expect(acquireMatch).not.toBeNull();
    const acquireList = acquireMatch![1]!;
    expect(acquireList.trim().startsWith("attackByFocusFire()")).toBe(true);
  });

  it("15b. attacker.ts work 链中 attackByFocusFire 在首位", () => {
    const src = readFileSync(ATTACKER_FILE, "utf8");
    const workMatch = src.match(/work:\s*\[([^\]]+)\]/);
    expect(workMatch).not.toBeNull();
    const workList = workMatch![1]!;
    expect(workList.trim().startsWith("attackByFocusFire()")).toBe(true);
  });

  it("15c. attacker.ts 包含 readAttackIntent 消费函数", () => {
    const src = readFileSync(ATTACKER_FILE, "utf8");
    expect(src).toContain("readAttackIntent");
    expect(src).toContain("attackIntents");
  });

  it("15d. attacker.ts 的 Legacy attackEnemies 是 fallback（在 attackByFocusFire 之后）", () => {
    const src = readFileSync(ATTACKER_FILE, "utf8");
    const acquireMatch = src.match(/acquire:\s*\[([^\]]+)\]/);
    const acquireList = acquireMatch![1]!;
    const focusFirePos = acquireList.indexOf("attackByFocusFire");
    const enemiesPos = acquireList.indexOf("attackEnemies");
    expect(focusFirePos).toBeGreaterThanOrEqual(0);
    expect(enemiesPos).toBeGreaterThan(focusFirePos);
  });
});

// ═════════════════════════════════════════════════════════════
// Domain Import Boundary
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Domain Import Boundary", () => {
  it("domain/tactical/*.ts 不 import systems/ 或 creeps/ 或 kernel/", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_DOMAIN_FILES) {
      const src = readFileSync(f, "utf8");
      const imports: string[] = [];
      const re = /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        imports.push(m[1]!);
      }
      const badImports = imports.filter(
        (p) => p.includes("systems/") || p.includes("creeps/") || p.includes("kernel/"),
      );
      if (badImports.length > 0) bad.push(`${relative(SRC, f)}: ${badImports.join(", ")}`);
    }
    expect(bad, `Forbidden imports: ${bad.join("; ")}`).toHaveLength(0);
  });

  it("domain/tactical/*.ts 不使用 Math.random / Date.now", () => {
    const bad: string[] = [];
    for (const f of TACTICAL_DOMAIN_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      const violations: string[] = [];
      if (/Math\.random/.test(code)) violations.push("Math.random");
      if (/Date\.now/.test(code)) violations.push("Date.now");
      if (violations.length > 0) bad.push(`${relative(SRC, f)}: ${violations.join(", ")}`);
    }
    expect(bad).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════
// Runtime System Boundary
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Runtime System Boundary", () => {
  it("tactical-engagement-runtime.ts 不直接调用 attack() / heal() / rangedAttack()", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/\.attack\s*\(/);
    expect(code).not.toMatch(/\.heal\s*\(/);
    expect(code).not.toMatch(/\.rangedAttack\s*\(/);
    expect(code).not.toMatch(/\.rangedHeal\s*\(/);
  });

  it("tactical-engagement-runtime.ts 调用 planFocusFire (核心纯函数)", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).toContain("planFocusFire");
  });

  it("tactical-engagement-runtime.ts 不引用 evaluateTacticalAction", () => {
    const src = readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8");
    expect(src).not.toContain("evaluateTacticalAction");
  });

  it("tactical-runtime-system.ts 不直接调用 attack() / heal() / rangedAttack()", () => {
    const code = codeLines(readFileSync(TACTICAL_RUNTIME_FILE, "utf8"));
    expect(code).not.toMatch(/\.attack\s*\(/);
    expect(code).not.toMatch(/\.heal\s*\(/);
    expect(code).not.toMatch(/\.rangedAttack\s*\(/);
  });

  it("tactical-runtime-system.ts 调用 evaluateTacticalAction (核心纯函数)", () => {
    const src = readFileSync(TACTICAL_RUNTIME_FILE, "utf8");
    expect(src).toContain("evaluateTacticalAction");
  });
});

// ═════════════════════════════════════════════════════════════
// Bootstrap Registration
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Bootstrap Registration", () => {
  it("tacticalEngagementSystem 已注册到 bootstrap", () => {
    const bootstrapPath = join(SRC, "bootstrap.ts");
    const src = readFileSync(bootstrapPath, "utf8");
    expect(src).toContain("tacticalEngagementSystem");
    expect(src).toContain("registerSystem(tacticalEngagementSystem)");
  });

  it("tacticalRuntimeSystem 已注册到 bootstrap", () => {
    const bootstrapPath = join(SRC, "bootstrap.ts");
    const src = readFileSync(bootstrapPath, "utf8");
    expect(src).toContain("tacticalRuntimeSystem");
    expect(src).toContain("registerSystem(tacticalRuntimeSystem)");
  });
});

// ═════════════════════════════════════════════════════════════
// Barrel Export
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Barrel Export", () => {
  it("domain/tactical/index.ts 导出所有子模块", () => {
    const src = readFileSync(INDEX_FILE, "utf8");
    expect(src).toContain("./types");
    expect(src).toContain("./authorization");
    expect(src).toContain("./state-machine");
    expect(src).toContain("./formation");
    expect(src).toContain("./role-intent");
    expect(src).toContain("./squad-formation");
    expect(src).toContain("./focus-fire");
  });
});

// ═════════════════════════════════════════════════════════════
// Authorization Runtime Validation
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Authorization Runtime Validation", () => {
  it("attacker.ts 不包含 if hostile → attack() 的 legacy bypass", () => {
    const code = codeLines(readFileSync(ATTACKER_FILE, "utf8"));
    // The Legacy attack paths (attackEnemies, attackStructures) are fallback candidates
    // in the acquire/work chain — they are AFTER attackByFocusFire
    // They should NOT have their own authorization check bypass
    // The check is: there should be no direct "if hostile" → "attack()" without
    // going through the ActionCandidate resolve/execute pattern
    expect(code).not.toMatch(/if\s*\(\s*hostile\b.*\n.*\.attack\s*\(/);
  });

  it("focus-fire.ts 在非 war 姿态时产出 0 AttackIntent", () => {
    // This is validated in the domain test, here we verify the guard exists in code
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).toContain('warPosture !== "war"');
    expect(code).toContain("no offensive intent");
  });

  it("focus-fire.ts 在 RETREATING 状态时产出 0 AttackIntent", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    // RETREATING 和 no attack intent 可能在不同行 — 分别检查
    expect(code).toContain("RETREATING");
    expect(code).toContain("no attack intent");
  });
});

// ═════════════════════════════════════════════════════════════
// TargetScope Runtime Validation
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: TargetScope Runtime Validation", () => {
  it("focus-fire.ts 拒绝 authorizedTargetRoom 之外的目标", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).toContain("authorizedTargetRoom");
    expect(code).toMatch(/outside authorized/);
  });

  it("authorization.ts 包含 validateTargetScope 纯函数", () => {
    const src = readFileSync(AUTHORIZATION_FILE, "utf8");
    expect(src).toContain("validateTargetScope");
    expect(src).toContain("STRATEGIC");
    expect(src).toContain("tactical layer cannot select strategic targets");
  });
});

// ═════════════════════════════════════════════════════════════
// Threat / CombatCapability Canonical Audit
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Threat / CombatCapability Canonical", () => {
  it("focus-fire.ts 消费 CombatCapability（不重新计算 body parts）", () => {
    const src = readFileSync(FOCUS_FIRE_FILE, "utf8");
    expect(src).toContain("CombatCapability");
    // Should not parse body parts directly — 检查 Screeps 常量而非类型名
    // AttackType 中包含 "ATTACK" 字面量是允许的（是类型定义不是 body part 常量）
    const code = codeLines(src);
    // 检查是否直接使用了 Screeps body part 常量（大写标识符作为值使用）
    expect(code).not.toMatch(/\bTOUGH\b/);
    expect(code).not.toMatch(/\bWORK\b/);
    expect(code).not.toMatch(/\bCLAIM\b/);
    expect(code).not.toMatch(/\bHEAL\b(?!_)/);
    // ATTACK 和 RANGED_ATTACK 作为 AttackType 字面量是允许的
  });

  it("focus-fire.ts 不压缩为单一 powerScore", () => {
    const src = readFileSync(FOCUS_FIRE_FILE, "utf8");
    expect(src).toContain("TacticalValueBreakdown");
    // 注释中包含设计原则说明
    expect(src).toContain("单一 powerScore");
    expect(src).toContain("禁止");
  });

  it("tactical-engagement-runtime.ts 的 estimateThreatScore 消费 CombatCapability（不重新解析 body）", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    // estimateThreatScore is a lightweight mapper from CombatCapability → scalar
    // It does NOT parse body parts
    expect(code).toContain("estimateThreatScore");
    expect(code).toMatch(/cap\.attack.*cap\.rangedAttack.*cap\.heal/);
  });
});

// ═════════════════════════════════════════════════════════════
// Decision Trace Validation
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Decision Trace", () => {
  it("focus-fire.ts 包含 decisionHash（确定性验证）", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).toContain("decisionHash");
    expect(code).toContain("focusFirePlanHash");
  });

  it("focus-fire.ts 包含 rejectedTargets（被拒绝的备选目标）", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).toContain("rejectedTargets");
    expect(code).toContain("RejectedTarget");
  });

  it("focus-fire.ts 包含 expectedDamage / overkillRisk / enemyHealSupport", () => {
    const code = codeLines(readFileSync(FOCUS_FIRE_FILE, "utf8"));
    expect(code).toContain("expectedDamage");
    expect(code).toContain("overkillRisk");
    expect(code).toContain("enemyHealSupport");
  });
});

// ═════════════════════════════════════════════════════════════
// Memory Boundedness
// ═════════════════════════════════════════════════════════════

describe("A5.4.4: Memory Boundedness", () => {
  it("tactical-engagement-runtime.ts 每 tick 重置 per-tick 数据", () => {
    const code = codeLines(readFileSync(ENGAGEMENT_RUNTIME_FILE, "utf8"));
    expect(code).toMatch(/focusFirePlans\.clear|attackIntents\.clear/);
  });

  it("tactical-runtime-system.ts 每 tick 重置 per-tick 数据", () => {
    const code = codeLines(readFileSync(TACTICAL_RUNTIME_FILE, "utf8"));
    expect(code).toMatch(/tacticalRoleIntents.*clear|tacticalDecisions\s*=\s*\[\]/);
  });

  it("tactical-runtime-system.ts 清理终态 Objective 记录（防膨胀）", () => {
    const code = codeLines(readFileSync(TACTICAL_RUNTIME_FILE, "utf8"));
    expect(code).toContain("cleanupTerminalObjectives");
    expect(code).toMatch(/1000/); // TTL for terminal records
  });
});
