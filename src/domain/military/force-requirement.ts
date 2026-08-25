/**
 * Force Requirement — A5.3 Capability 需求推导纯函数。
 *
 * 从 Operation 推导需要的能力，而不是直接推导 Creep 数量。
 *
 * 例如：
 * - SIEGE: 需要 dismantle, heal, tank, mobility
 * - ASSAULT: 需要 attack, ranged, heal, effectiveHP
 * - ESCORT: 需要 defense, mobility, responseTime
 *
 * 禁止自动决定 spawn 多少 Creep。这里只产生 Demand。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

import type { OperationType } from "./operation";
import type { CombatPower } from "../combat/capability";

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

export interface RequiredCapability {
  attack: number;
  rangedAttack: number;
  heal: number;
  effectiveHP: number;
  dismantle: number;
  mobility: number;
  claim: number;
  support: number;
}

export interface CapabilityGap {
  required: RequiredCapability;
  available: RequiredCapability;
  gaps: {
    attack: number;
    rangedAttack: number;
    heal: number;
    effectiveHP: number;
    dismantle: number;
    mobility: number;
    claim: number;
    support: number;
  };
  totalGapRatio: number;
  confidence: number;
  evidence: string[];
}

export interface ForceComposition {
  tank: number;
  attacker: number;
  ranged: number;
  healer: number;
  dismantler: number;
  support: number;
  total: number;
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════
// §2. 从 OperationType 推导 RequiredCapability
// ═══════════════════════════════════════════════════════════

export function deriveRequiredCapability(
  type: OperationType,
  enemyPower: CombatPower,
  _enemyTowers: number,
): RequiredCapability {
  const baseHP = Math.max(enemyPower.burstDamage * 3, 1000);
  const baseHeal = Math.max(enemyPower.burstDamage * 0.8, 100);

  switch (type) {
    case "DEFEND":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.5, 100),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.3, 50),
        heal: baseHeal,
        effectiveHP: baseHP,
        dismantle: 0,
        mobility: 0.5,
        claim: 0,
        support: 1,
      };

    case "ESCORT":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.3, 50),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.2, 30),
        heal: baseHeal * 0.5,
        effectiveHP: baseHP * 0.6,
        dismantle: 0,
        mobility: 1.0,
        claim: 0,
        support: 0,
      };

    case "HARASS":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.2, 30),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.15, 20),
        heal: baseHeal * 0.3,
        effectiveHP: baseHP * 0.4,
        dismantle: 50,
        mobility: 1.2,
        claim: 0,
        support: 0,
      };

    case "SIEGE":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.3, 50),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.2, 30),
        heal: baseHeal * 1.5,
        effectiveHP: baseHP * 1.5,
        dismantle: 200,
        mobility: 0.5,
        claim: 0,
        support: 1,
      };

    case "ASSAULT":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.8, 150),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.5, 80),
        heal: baseHeal * 1.2,
        effectiveHP: baseHP * 1.2,
        dismantle: 100,
        mobility: 0.8,
        claim: 0,
        support: 2,
      };

    case "RAID":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.4, 60),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.3, 40),
        heal: baseHeal * 0.4,
        effectiveHP: baseHP * 0.5,
        dismantle: 100,
        mobility: 1.0,
        claim: 0,
        support: 0,
      };

    case "CONTROLLER_ATTACK":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.5, 80),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.3, 50),
        heal: baseHeal * 0.8,
        effectiveHP: baseHP * 0.8,
        dismantle: 0,
        mobility: 0.8,
        claim: 1,
        support: 1,
      };

    case "REMOTE_DENIAL":
      return {
        attack: Math.max(enemyPower.burstDamage * 0.3, 40),
        rangedAttack: Math.max(enemyPower.burstDamage * 0.2, 30),
        heal: baseHeal * 0.4,
        effectiveHP: baseHP * 0.5,
        dismantle: 0,
        mobility: 1.2,
        claim: 0,
        support: 0,
      };

    case "CLAIM":
      return {
        attack: 0, rangedAttack: 0, heal: 0,
        effectiveHP: 300, dismantle: 0, mobility: 0.8, claim: 1, support: 0,
      };

    case "RESERVE":
      return {
        attack: 0, rangedAttack: 0, heal: 0,
        effectiveHP: 300, dismantle: 0, mobility: 0.8, claim: 1, support: 0,
      };

    case "RETREAT":
      return {
        attack: 0, rangedAttack: 0, heal: 0,
        effectiveHP: 200, dismantle: 0, mobility: 1.5, claim: 0, support: 0,
      };

    case "ABORT":
      return {
        attack: 0, rangedAttack: 0, heal: 0,
        effectiveHP: 0, dismantle: 0, mobility: 0, claim: 0, support: 0,
      };

    default:
      return {
        attack: 0, rangedAttack: 0, heal: 0,
        effectiveHP: 0, dismantle: 0, mobility: 0, claim: 0, support: 0,
      };
  }
}

// ═══════════════════════════════════════════════════════════
// §3. Capability Gap 计算
// ═══════════════════════════════════════════════════════════

export function computeCapabilityGap(
  required: RequiredCapability,
  available: RequiredCapability,
  intelConfidence: number,
): CapabilityGap {
  const gaps = {
    attack: Math.max(0, required.attack - available.attack),
    rangedAttack: Math.max(0, required.rangedAttack - available.rangedAttack),
    heal: Math.max(0, required.heal - available.heal),
    effectiveHP: Math.max(0, required.effectiveHP - available.effectiveHP),
    dismantle: Math.max(0, required.dismantle - available.dismantle),
    mobility: Math.max(0, required.mobility - available.mobility),
    claim: Math.max(0, required.claim - available.claim),
    support: Math.max(0, required.support - available.support),
  };

  const evidence: string[] = [];
  for (const [k, v] of Object.entries(gaps)) {
    if (v > 0) evidence.push(`${k}_gap=${v.toFixed(0)}`);
  }

  // 总缺口比例
  const reqSum = required.attack + required.rangedAttack + required.heal
    + required.effectiveHP * 0.01 + required.dismantle + required.mobility * 100
    + required.claim * 100 + required.support * 50;
  const gapSum = gaps.attack + gaps.rangedAttack + gaps.heal
    + gaps.effectiveHP * 0.01 + gaps.dismantle + gaps.mobility * 100
    + gaps.claim * 100 + gaps.support * 50;

  const totalGapRatio = reqSum > 0 ? Math.min(1, gapSum / reqSum) : 0;

  return {
    required,
    available,
    gaps,
    totalGapRatio: Math.round(totalGapRatio * 100) / 100,
    confidence: Math.round(intelConfidence * 100) / 100,
    evidence,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Force Composition 推导
// ═══════════════════════════════════════════════════════════

export function deriveForceComposition(
  type: OperationType,
  required: RequiredCapability,
): ForceComposition {
  const evidence: string[] = [];
  let tank = 0, attacker = 0, ranged = 0, healer = 0, dismantler = 0, support = 0;

  // 从能力需求推导编队（以能力为驱动，不是硬编码人数）
  if (required.effectiveHP > 0) {
    tank = Math.ceil(required.effectiveHP / 1000);
    evidence.push(`tank=${tank} (HP=${required.effectiveHP})`);
  }
  if (required.attack > 0) {
    attacker = Math.ceil(required.attack / 90); // ~3 ATTACK parts
    evidence.push(`attacker=${attacker} (atk=${required.attack})`);
  }
  if (required.rangedAttack > 0) {
    ranged = Math.ceil(required.rangedAttack / 30); // ~3 RANGED_ATTACK parts
    evidence.push(`ranged=${ranged} (ranged=${required.rangedAttack})`);
  }
  if (required.heal > 0) {
    healer = Math.ceil(required.heal / 36); // ~3 HEAL parts
    evidence.push(`healer=${healer} (heal=${required.heal})`);
  }
  if (required.dismantle > 0) {
    dismantler = Math.ceil(required.dismantle / 100); // ~2 WORK parts
    evidence.push(`dismantler=${dismantler} (dismantle=${required.dismantle})`);
  }
  if (required.support > 0) {
    support = Math.ceil(required.support);
    evidence.push(`support=${support}`);
  }

  // CLAIM 类操作需要至少 1 个 claimer
  if (required.claim > 0 && type === "CLAIM") {
    // claimer 不走标准编队，但需求标记
    evidence.push(`claimer=1 (claim required)`);
  }

  const total = tank + attacker + ranged + healer + dismantler + support;

  return { tank, attacker, ranged, healer, dismantler, support, total, evidence };
}
