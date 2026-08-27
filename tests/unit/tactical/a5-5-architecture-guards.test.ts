/**  */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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

const COMBAT_MICRO_DOMAIN = readFileSync(
  join(SRC, "domain/tactical/combat-micro.ts"),
  "utf-8",
);
const COMBAT_MICRO_RUNTIME = readFileSync(
  join(SRC, "systems/combat-micro-runtime.ts"),
  "utf-8",
);
const DOMAIN_CODE = codeLines(COMBAT_MICRO_DOMAIN);
const RUNTIME_CODE = codeLines(COMBAT_MICRO_RUNTIME);

// ═══════════════════════════════════════════════════════════

describe("A5.5 Architecture Guards", () => {
  // ── 1. Domain 禁止 Game ──
  it("combat-micro.ts 禁止引用 Game", () => {
    expect(DOMAIN_CODE).not.toMatch(/\bGame\b/);
  });

  // ── 2. Domain 禁止 Memory / RawMemory ──
  it("combat-micro.ts 禁止引用 Memory / RawMemory", () => {
    expect(DOMAIN_CODE).not.toMatch(/\bMemory\b/);
    expect(DOMAIN_CODE).not.toMatch(/\bRawMemory\b/);
  });

  // ── 3. Domain 禁止 Creep / Room / PathFinder ──
  it("combat-micro.ts 禁止引用 Creep / Room / PathFinder", () => {
    expect(DOMAIN_CODE).not.toMatch(/\bCreep\b/);
    expect(DOMAIN_CODE).not.toMatch(/\bPathFinder\b/);
  });

  // ── 4. Domain 禁止 attack() / rangedAttack() / heal() ──
  it("combat-micro.ts 禁止调用 attack() / rangedAttack() / heal()", () => {
    expect(DOMAIN_CODE).not.toMatch(/\.attack\s*\(/);
    expect(DOMAIN_CODE).not.toMatch(/\.rangedAttack\s*\(/);
    expect(DOMAIN_CODE).not.toMatch(/\.heal\s*\(/);
    expect(DOMAIN_CODE).not.toMatch(/\.rangedHeal\s*\(/);
  });

  // ── 5. Domain 禁止 move() / registerMove / spawnCreep ──
  it("combat-micro.ts 禁止调用 move() / registerMove / spawnCreep", () => {
    expect(DOMAIN_CODE).not.toMatch(/\.move\s*\(/);
    expect(DOMAIN_CODE).not.toMatch(/registerMove/);
    expect(DOMAIN_CODE).not.toMatch(/spawnCreep/);
  });

  // ── 6. Micro Runtime 禁止 spawn ──
  it("combat-micro-runtime.ts 禁止调用 spawnCreep", () => {
    expect(RUNTIME_CODE).not.toMatch(/spawnCreep/);
  });

  // ── 7. Micro Runtime 禁止 logistics ──
  it("combat-micro-runtime.ts 禁止 import logistics", () => {
    expect(RUNTIME_CODE).not.toMatch(/from.*logistics/);
  });

  // ── 8. Micro Runtime 禁止 recovery ──
  it("combat-micro-runtime.ts 禁止 import recovery", () => {
    expect(RUNTIME_CODE).not.toMatch(/from.*recovery/);
  });

  // ── 9. Micro Runtime 禁止修改 WarPosture ──
  it("combat-micro-runtime.ts 禁止写入 WarPosture / strategy.posture", () => {
    // 禁止写入 posture（Memory.kernel.strategy.posture = ...）
    expect(RUNTIME_CODE).not.toMatch(/strategy\.posture\s*=/);
    expect(RUNTIME_CODE).not.toMatch(/\.warPosture\s*=\s*[^=]/);
  });

  // ── 10. Micro Runtime 禁止创建 Operation ──
  it("combat-micro-runtime.ts 禁止创建 Operation", () => {
    expect(RUNTIME_CODE).not.toMatch(/createOperation/);
    expect(RUNTIME_CODE).not.toMatch(/new\s+Operation/);
  });

  // ── 11. Micro Runtime 禁止创建 Strategic Target ──
  it("combat-micro-runtime.ts 禁止创建 Strategic Target", () => {
    expect(RUNTIME_CODE).not.toMatch(/createStrategicTarget/);
    expect(RUNTIME_CODE).not.toMatch(/addStrategicTarget/);
  });

  // ── 12. Micro 禁止第二套 Threat Assessment ──
  it("combat-micro.ts 禁止重新实现 Threat Assessment", () => {
    expect(DOMAIN_CODE).not.toMatch(/assessThreat/);
    expect(DOMAIN_CODE).not.toMatch(/ThreatAssessment/);
  });

  // ── 13. Micro 禁止第二套 CombatCapability ──
  it("combat-micro.ts 应消费 A5.1 CombatCapability（不重新解析 body）", () => {
    expect(DOMAIN_CODE).toMatch(/import.*CombatCapability.*from.*combat\/capability/);
    // 禁止重新解析 body
    expect(DOMAIN_CODE).not.toMatch(/\.body\b/);
  });

  // ── 14. Micro 禁止第二套 Formation ──
  it("combat-micro.ts 应消费 A5.4.2 Formation（不重新计算 slot）", () => {
    expect(DOMAIN_CODE).toMatch(/import.*FormationSlot.*from.*squad-formation/);
    expect(DOMAIN_CODE).toMatch(/import.*CohesionMetric.*from.*squad-formation/);
    // 禁止重新计算 formation slot
    expect(DOMAIN_CODE).not.toMatch(/computeFormationSlot/);
    expect(DOMAIN_CODE).not.toMatch(/calculateFormation/);
  });

  // ── 15. Micro 禁止第二套 FocusFire ──
  it("combat-micro.ts 应消费 A5.4.3 FocusFirePlan（不重新实现 target selection）", () => {
    expect(DOMAIN_CODE).toMatch(/import.*FocusFirePlan.*from.*focus-fire/);
    expect(DOMAIN_CODE).toMatch(/import.*AttackIntent.*from.*focus-fire/);
    // 禁止重新实现 planFocusFire
    expect(DOMAIN_CODE).not.toMatch(/export\s+function\s+planFocusFire/);
  });

  // ── 额外：Domain 不 import systems/ creeps/ kernel/ ──
  it("combat-micro.ts 禁止 import systems/ creeps/ kernel/", () => {
    expect(DOMAIN_CODE).not.toMatch(/from.*systems\//);
    expect(DOMAIN_CODE).not.toMatch(/from.*creeps\//);
    expect(DOMAIN_CODE).not.toMatch(/from.*kernel\//);
  });

  // ── 额外：Domain 不使用 Math.random / Date.now ──
  it("combat-micro.ts 禁止 Math.random / Date.now", () => {
    expect(DOMAIN_CODE).not.toMatch(/Math\.random/);
    expect(DOMAIN_CODE).not.toMatch(/Date\.now/);
  });

  // ── 额外：Runtime 不直接调用 Game action API ──
  it("combat-micro-runtime.ts 禁止直接调用 attack/rangedAttack/heal/move", () => {
    // Runtime 可以引用 Game.creeps / Game.rooms 来采集数据
    // 但不应对 creep 调用 attack/rangedAttack/heal/move
    expect(RUNTIME_CODE).not.toMatch(/\.attack\s*\(/);
    expect(RUNTIME_CODE).not.toMatch(/\.rangedAttack\s*\(/);
    expect(RUNTIME_CODE).not.toMatch(/\.heal\s*\(/);
    expect(RUNTIME_CODE).not.toMatch(/\.rangedHeal\s*\(/);
    // move 调用应该通过 traffic-manager，不直接调
    expect(RUNTIME_CODE).not.toMatch(/\.move\s*\(/);
  });

  // ── 额外：barrel export 完整 ──
  it("tactical/index.ts 应 export combat-micro", () => {
    const barrel = readFileSync(join(SRC, "domain/tactical/index.ts"), "utf-8");
    expect(barrel).toMatch(/export.*combat-micro/);
  });

  // ── 额外：bootstrap 注册 combatMicroSystem（通过 pipeline 合并）──
  it("bootstrap.ts 应通过 pipeline 注册 combatMicroSystem", () => {
    const bootstrap = readFileSync(join(SRC, "bootstrap.ts"), "utf-8");
    // R10 ADR 合并后：combatMicroSystem 通过 tacticalRuntimePipelineSystem 注册
    expect(bootstrap).toMatch(/tacticalRuntimePipelineSystem/);
    expect(bootstrap).toMatch(/tactical-runtime-pipeline/);
  });

  // ── 额外：Runtime 公共 API 存在 ──
  it("combat-micro-runtime.ts 应导出 getMicroDecision 和 getMicroPlan", () => {
    expect(COMBAT_MICRO_RUNTIME).toMatch(/export\s+function\s+getMicroDecision/);
    expect(COMBAT_MICRO_RUNTIME).toMatch(/export\s+function\s+getMicroPlan/);
  });

  // ── 额外：Domain 导出 planCombatMicro ──
  it("combat-micro.ts 应导出 planCombatMicro", () => {
    expect(COMBAT_MICRO_DOMAIN).toMatch(/export\s+function\s+planCombatMicro/);
  });

  // ── 额外：Domain 导出确定性 hash 函数 ──
  it("combat-micro.ts 应导出 microPlanHash 和 microDecisionHash", () => {
    expect(COMBAT_MICRO_DOMAIN).toMatch(/export\s+function\s+microPlanHash/);
    expect(COMBAT_MICRO_DOMAIN).toMatch(/export\s+function\s+microDecisionHash/);
  });
});
