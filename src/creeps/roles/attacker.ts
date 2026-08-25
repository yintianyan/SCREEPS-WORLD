/**
 * Attacker — P2 跨房远征攻击者（R3 战时闭环的进攻执行端，R4 波次集结）。
 * 职责：仅 war 姿态时由 war-planner 孵化；跨房行军至 war 目标房，先清敌方守军 creep，
 * 再拆高值建筑（spawn/tower > storage > extension）；低血标记回收撤出战区（recyclePass 归航）。
 * R4 波次集结（hold 钩子）：warPlan.phase==="build" 时不在目标房作战——在 home 停驻待命，
 * 在外归建（fleeToHome），advance 满编才整波推进；hold 在 ensureHome 之前接管本 tick，
 * 堵住「散兵逐个送」的添油路径。
 * 策略：combat:true 豁免 flee 检测；acquire/work 相同候选（无 CARRY，mode 振荡不影响行为）。
 * 约束：敌 creep/结构走 per-tick per-room 共享缓存（getHostilesCached 等），角色不做全房 find。
 */
import type { Priority, TickContext } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget, parkIdleCreep } from "../movement";
import { fleeToHome } from "../support";
import { getHostilesCached } from "../support/targeting";
import { globalCache } from "../../kernel/global-cache";
import { CONFIG } from "../../config";

/** A5.4.1 战术指令接口（与 domain/tactical/role-intent.ts RoleActionIntent 对齐）。 */
interface TacticalIntent {
  moveDirective: string;
  combatDirective: string;
  targetId?: string;
}

/** A5.4.3 AttackIntent 接口（与 domain/tactical/focus-fire.ts AttackIntent 对齐）。 */
interface FocusFireAttackIntent {
  squadId: string;
  creepId: string;
  targetId: string;
  targetPos: number;
  targetRoom: string;
  attackType: string;
  priority: string;
  expectedDamage: number;
  requiresMovement: boolean;
}

/**
 * A5.4.1 从 globalCache 读取当前 creep 的战术指令。
 *
 * 角色层不导入 systems 层（R3 架构守卫），直接从 globalCache 读取
 * tactical-runtime-system 写入的 RoleActionIntent。
 * 无指令时返回 null → 角色回退到 Legacy 行为。
 */
function readTacticalIntent(creepName: string): TacticalIntent | null {
  const g = globalCache() as Record<string, unknown> & {
    tacticalRoleIntents?: Map<string, TacticalIntent>;
  };
  return g.tacticalRoleIntents?.get(creepName) ?? null;
}

/**
 * A5.4.3 从 globalCache 读取当前 creep 的 FocusFire AttackIntent。
 *
 * 角色层不导入 systems 层（R3 架构守卫），直接从 globalCache 读取
 * tactical-engagement-runtime 写入的 AttackIntent。
 * 无指令时返回 null → 角色回退到 A5.4.1 TacticalIntent → Legacy 行为。
 */
function readAttackIntent(creepName: string): FocusFireAttackIntent | null {
  const g = globalCache() as Record<string, unknown> & {
    attackIntents?: Map<string, FocusFireAttackIntent>;
  };
  return g.attackIntents?.get(creepName) ?? null;
}

/** 低血撤退：标记回收 → role-runner 下 tick 短路 idle → spawn-manager recyclePass 归航。 */
export function markRetreat(creep: Creep): boolean {
  if (creep.hits < creep.hitsMax * CONFIG.war.retreatRatio) {
    creep.memory.recycle = true;
    return true;
  }
  return false;
}

/** 敌方结构价值分档 — 拆高值建筑优先（防守方先失 spawn/tower 即失去反制能力）。 */
function structureValueTier(t: StructureConstant): number {
  switch (t) {
    case STRUCTURE_SPAWN:
    case STRUCTURE_TOWER:
      return 4;
    case STRUCTURE_STORAGE:
      return 3;
    case STRUCTURE_EXTENSION:
      return 2;
    default:
      return 1;
  }
}

/** 目标房内敌结构列表（per-tick per-room 共享缓存，与 remote-hauler 同型模式）。 */
function getHostileStructuresCached(room: Room): AnyStructure[] {
  const g = globalCache() as { __warStructures?: Record<string, { tick: number; list: AnyStructure[] }> };
  if (!g.__warStructures) g.__warStructures = {};
  const cached = g.__warStructures[room.name];
  if (cached && cached.tick === Game.time) return cached.list;
  const list = room.find(FIND_HOSTILE_STRUCTURES);
  g.__warStructures[room.name] = { tick: Game.time, list };
  return list;
}

/** 目标房内 power bank（per-tick per-room 共享缓存 — PB 野采链，审计缺口 2）。 */
function getPowerBankCached(room: Room): StructurePowerBank | undefined {
  const g = globalCache() as { __powerBanks?: Record<string, { tick: number; pb: StructurePowerBank | undefined }> };
  if (!g.__powerBanks) g.__powerBanks = {};
  const cached = g.__powerBanks[room.name];
  if (cached && cached.tick === Game.time) return cached.pb;
  // FIND_STRUCTURES 全房 find 每 tick 一次/房（与 __warStructures 同预算口径）。
  const pb = room.find(FIND_STRUCTURES).find(
    s => s.structureType === STRUCTURE_POWER_BANK,
  ) as StructurePowerBank | undefined;
  g.__powerBanks[room.name] = { tick: Game.time, pb };
  return pb;
}

/**
 * A5.4.3 Focus Fire AttackIntent 消费 — 最高优先级的攻击候选。
 *
 * 当 tactical-engagement-runtime 产出 AttackIntent 时，attacker 按指令执行
 * 集火攻击：
 *   - ATTACK → 近身 attack
 *   - RANGED_ATTACK → rangedAttack
 *   - NO_ATTACK + requiresMovement → 不消费候选，让 Movement 系统处理
 *
 * 边界：无指令时返回 undefined → 回退到 A5.4.1 TacticalIntent → Legacy。
 *      targetId 可能无效（目标死亡）→ resolve 时检查并回退。
 *      requiresMovement=true → 不直接 resolve 目标，让 Movement 系统先移动到位。
 */
export function attackByFocusFire(): ActionCandidate<Creep | AnyStructure> {
  return {
    name: "attacker:focus-fire",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const intent = readAttackIntent(ac.creep.name);
      if (!intent) return undefined; // 无 FocusFire 指令 → 回退 A5.4.1
      // NO_ATTACK → 不消费候选（目标不在射程，Movement 系统处理接近）
      if (intent.attackType === "NO_ATTACK") return undefined;
      // 解析目标
      const target = Game.getObjectById(intent.targetId as Id<Creep | AnyStructure>);
      if (!target) return undefined; // 目标无效 → 回退
      // 攻击类型决定执行方式
      return target;
    },
    execute: (ac, target) => {
      const intent = readAttackIntent(ac.creep.name);
      if (!intent) {
        // 无 intent（不应到达此处，但防御性处理）→ Legacy attack
        const result = ac.creep.attack(target);
        if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
        return;
      }
      // 按攻击类型执行
      if (intent.attackType === "RANGED_ATTACK") {
        const dist = ac.creep.pos.getRangeTo(target.pos);
        if (dist <= 3) {
          // 在远程范围内 — 使用 rangedAttack
          ac.creep.rangedAttack(target as Creep | AnyStructure);
        } else {
          // 不在范围 — 移动接近（Movement 系统会处理，但这里作为 fallback）
          moveToTarget(ac.creep, target);
        }
      } else if (intent.attackType === "DISMANTLE") {
        // DISMANTLE 对建筑有效 — 使用 dismantle() 而非 attack()
        const result = ac.creep.dismantle(target as AnyStructure);
        if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
      } else if (intent.attackType === "ATTACK") {
        // 近身攻击 — 先校验范围
        const dist = ac.creep.pos.getRangeTo(target.pos);
        if (dist <= 1) {
          ac.creep.attack(target as Creep | AnyStructure);
        } else {
          // 不在近身范围 — 移动接近
          moveToTarget(ac.creep, target);
        }
      } else {
        // NO_ATTACK 或未知类型 — 不执行攻击动作，由 Movement 系统处理
        if (intent.requiresMovement) moveToTarget(ac.creep, target);
      }
    },
  };
}

/**
 * PB 野采打击（审计缺口 2）：mission="powerBank" 编队的专用候选 — PB 是
 * FIND_STRUCTURES 中立结构（非 hostile），attackEnemies/attackStructures
 * 的 hostile 链打不到。编队 healer 经 buddy 机制自动跟随贴身覆盖 PB 反击。
 */
/**
 * A5.4.1 战术指令消费 — 优先消费 Tactical Runtime 产出的 RoleActionIntent。
 *
 * 当 tactical-runtime-system 产出指令时，attacker 按指令执行移动/攻击/撤退，
 * 而非走 Legacy 的 findClosestByRange 逻辑。指令不覆盖 hold 钩子（波次集结
 * 仍在 attackerHold 中裁决）。
 *
 * 边界：无指令时返回 undefined → 回退到 Legacy 候选（向后兼容）。
 *      指令的 targetId 可能在视野外 → resolve 时检查可见性。
 */
export function attackByTacticalIntent(): ActionCandidate<Creep | AnyStructure> {
  return {
    name: "attacker:tactical-intent",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const intent = readTacticalIntent(ac.creep.name);
      if (!intent) return undefined; // 无战术指令 → 回退 Legacy
      // HOLD_POSITION / NO_MOVE → 不消费攻击候选（移动由 traffic-manager 处理）
      if (intent.moveDirective === "HOLD_POSITION" || intent.moveDirective === "NO_MOVE") {
        // 但如果有战斗指令，仍然攻击
      }
      // RETREAT → 标记回收让 spawn-manager 处理撤退
      if (intent.moveDirective === "RETREAT_TO_SAFE" || intent.moveDirective === "BREAK_CONTACT") {
        ac.creep.memory.recycle = true;
        return undefined;
      }
      // 有战斗指令 + targetId → 查找目标
      if (intent.combatDirective !== "NO_COMBAT" && intent.targetId) {
        const target = Game.getObjectById(intent.targetId as Id<Creep | AnyStructure>);
        if (target) return target;
        // targetId 无效 → 回退 Legacy
      }
      // 有移动指令但无战斗 → 不消费候选，让移动由 traffic-manager 处理
      if (intent.combatDirective === "NO_COMBAT") return undefined;
      // 回退 Legacy
      return undefined;
    },
    execute: (ac, target) => {
      const result = ac.creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

export function attackPowerBank(): ActionCandidate<StructurePowerBank> {
  return {
    name: "attacker:attack-power-bank",
    resolve: (ac) => {
      if (ac.creep.memory.mission !== "powerBank") return undefined;
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      return getPowerBankCached(ac.creep.room);
    },
    execute: (ac, target) => {
      const result = ac.creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

export function attackEnemies(): ActionCandidate<Creep> {
  return {
    name: "attacker:attack-creeps",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const hostiles = getHostilesCached(ac.creep.room);
      if (hostiles.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(hostiles) ?? hostiles[0];
    },
    execute: (ac, target) => {
      const result = ac.creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

export function attackStructures(): ActionCandidate<AnyStructure> {
  return {
    name: "attacker:attack-structures",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const structs = getHostileStructuresCached(ac.creep.room);
      if (structs.length === 0) return undefined;
      let best: AnyStructure | undefined;
      let bestScore = -Infinity;
      for (const s of structs) {
        // 同价值档内优先拆受伤者（集火残血加速摧毁），距离只在同档内决胜。
        const score = structureValueTier(s.structureType) * 1000
          + s.hitsMax - s.hits
          - ac.creep.pos.getRangeTo(s);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      return best;
    },
    execute: (ac, target) => {
      const result = ac.creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

/**
 * 战备集结（R4 hold 钩子，导出供单测直接调用）。决策矩阵：
 * PB 野采编队（mission="powerBank"）→ 不集结直接推进（无波次语义 —
 *   PB 房无守军，添油无害且更快开打；healer 同用本钩子自动放行）；
 * 无 warPlan / 已 advance / 计划目标与己不一致 → 不接管（false，正常管线）；
 * build + 低血 → 标记回收接管（归航由 spawn-manager 处理）；
 * build + 在 home → 停驻待命（parkIdleCreep）；build + 在外 → 归建（fleeToHome）。
 * 返回 true 表示本 tick 已处理（role-runner 跳过导航与攻击候选）。
 */
export function attackerHold(creep: Creep, ctx: TickContext): boolean {
  if (creep.memory.mission === "powerBank") return false;
  const plan = Memory.kernel?.warPlan;
  if (!plan || plan.phase === "advance") return false;
  if (plan.targetRoom !== creep.memory.remoteTarget) return false;

  if (markRetreat(creep)) return true;
  if (creep.room.name !== creep.memory.home) {
    fleeToHome(creep);
    return true;
  }
  const snapshot = creep.memory.home ? ctx.getSnapshot(creep.memory.home) : undefined;
  if (snapshot) parkIdleCreep(creep, snapshot);
  return true;
}

const policy: RolePolicy = {
  combat: true,
  hold: attackerHold,
  // A5.4.3：focus-fire 最高优先 → A5.4.1 tactical-intent → Legacy 候选
  // 无 FocusFire 指令时回退到 A5.4.1 TacticalIntent → PB → enemies → structures
  acquire: [attackByFocusFire(), attackByTacticalIntent(), attackPowerBank(), attackEnemies(), attackStructures()],
  work: [attackByFocusFire(), attackByTacticalIntent(), attackPowerBank(), attackEnemies(), attackStructures()],
};

export const attackerRole = defineRole("attacker", 2 as Priority, policy);
