/**
 * Power Creep Manager — P3 系统，GPL 消费闭环的执行层。
 * 决策纯函数见 domain/strategy/power-creeps（planGplSpending /
 * selectPowerAction）；本系统只做 Game 层采集 + 意图签发：
 *   ① GPL 消费：create（账号级创建）→ upgrade（build order 推进）；
 *   ② 驻留分配：PC → 有 powerSpawn 的房（Memory 粘性，PC 换房成本高）；
 *   ③ 孵化：未孵化 PC 在驻留房 powerSpawn.spawn（死亡冷却 ERR_TIRED 静默）；
 *   ④ 运营：已孵化 PC 按 selectPowerAction 裁决执行（renew/enableRoom/
 *      generateOps/三类 operate）。
 *
 * 行为约束（D1/D2 决策）：PC 不接 RolePolicy 管线（数量 ≤3、低频英雄单位，
 * 不配专属引擎）；移动用 moveTo 直连不接 traffic-manager（无产量仲裁需求）。
 * 幂等性：所有失败码静默等下轮（interval 10 tick 自然重试），成功才记
 * PowerCreepMilestone 事件；绝不调用 pc.delete（删 PC 会 -1 GPL）。
 */
import { CONFIG } from "../config";
import { recordEvent, EventKind } from "../kernel/event-log";
import type { Priority, System, TickContext, RoomSnapshot } from "../kernel/contracts";
import {
  PWR,
  planGplSpending,
  selectPowerAction,
  type PcSummary,
  type PowerCreepThresholds,
} from "../domain/strategy/power-creeps";

/** usePower 的统一施法距离（typings POWER_INFO.range）。 */
const USE_POWER_RANGE = 3;

export const powerCreepManagerSystem: System = {
  name: "power-creep-manager",
  priority: 3 as Priority,
  interval: CONFIG.powerCreeps.interval,
  run(ctx: TickContext): void {
    // 私服/测试环境无 PC API — 存在性检查照 pixel-system 先例。
    if (!Game.powerCreeps || typeof PowerCreep?.create !== "function") return;

    const pcs = Object.values(Game.powerCreeps);
    const names = Object.keys(Game.powerCreeps);

    // ── ① GPL 消费（create / upgrade）──
    const summaries: PcSummary[] = pcs.map((pc) => ({
      name: pc.name,
      level: pc.level,
      powers: collectPowerLevels(pc),
    }));
    const plan = planGplSpending(Game.gpl?.level ?? 0, summaries, names);
    if (plan.action === "create" && plan.pcName) {
      // POWER_CLASS.OPERATOR 的字面量（运行时常量在测试环境不可用）。
      const result = PowerCreep.create(plan.pcName, "operator");
      if (result === OK) {
        recordEvent(EventKind.PowerCreepMilestone, "", [0]);
      }
    } else if (plan.action === "upgrade" && plan.pcName && plan.power !== undefined) {
      const pc = Game.powerCreeps[plan.pcName];
      // upgrade 对未孵化 PC 同样有效（官方语义），失败静默等下轮。
      // PowerId 即引擎 PowerConstant 数值（domain 层锁定该映射）。
      if (pc && pc.upgrade(plan.power as PowerConstant) === OK) {
        recordEvent(EventKind.PowerCreepMilestone, "", [1, plan.power]);
      }
    }

    // ── ② 驻留分配（Memory 粘性）──
    const home = resolveHome(pcs, ctx);
    if (!home) return; // 帝国尚无 powerSpawn（RCL8 前）→ 全部运营无从谈起

    // ── ③④ 逐 PC 孵化 / 运营 ──
    for (const pc of pcs) {
      if (!pc.ticksToLive) {
        // 未孵化：在驻留房 powerSpawn 孵化（ERR_TIRED = 死亡冷却中）。
        if (home.powerSpawn && pc.spawn(home.powerSpawn) === OK) {
          recordEvent(EventKind.PowerCreepMilestone, home.roomName, [2]);
        }
        continue;
      }
      runSpawnedPc(pc, home, ctx);
    }
  },
};

/** 从 PC 的 powers 表采集 level 映射（cooldown 由运营路径单独采）。 */
function collectPowerLevels(pc: PowerCreep): Record<number, number> {
  const levels: Record<number, number> = {};
  for (const idStr in pc.powers) {
    levels[Number(idStr)] = pc.powers[idStr]!.level;
  }
  return levels;
}

/**
 * 解析 PC 驻留房：第一增量单 PC 单房 — 有 powerSpawn 的第一个 snapshot。
 * 粘性：Memory.kernel.powerCreeps.homeAssignments 已指向有效房则沿用
 * （PC 长途换房成本高）；失守/无 PC 的死条目顺带清理。
 */
function resolveHome(pcs: readonly PowerCreep[], ctx: TickContext): RoomSnapshot | undefined {
  const candidates = [...ctx.snapshots()].filter((s) => s.powerSpawn);
  if (candidates.length === 0) return undefined;

  // kernel 由 runMigrations/建档保证存在；防御性兜底（缺失视为无驻留）。
  Memory.kernel ??= {};
  Memory.kernel.powerCreeps ??= { homeAssignments: {} };
  const assignments = Memory.kernel.powerCreeps.homeAssignments;

  // 死条目清理：PC 已不存在 / 房已失守。
  for (const pcName in assignments) {
    if (!Game.powerCreeps[pcName] || !ctx.getSnapshot(assignments[pcName]!)) {
      delete assignments[pcName];
    }
  }

  const first = pcs[0];
  if (!first) return candidates[0];
  const assigned = assignments[first.name];
  if (assigned) {
    const sticky = candidates.find((s) => s.roomName === assigned);
    if (sticky) return sticky;
  }
  // 新分配 / 粘性失效 → 写入第一个候选并沿用。
  assignments[first.name] = candidates[0]!.roomName;
  return candidates[0];
}

/** 已孵化 PC 的运营执行：采集 → 纯函数裁决 → moveTo + 签发意图。 */
function runSpawnedPc(pc: PowerCreep, home: RoomSnapshot, ctx: TickContext): void {
  // PC 实际所在房（孵化后应在驻留房；防御性按实际位置找 snapshot）。
  const roomName = pc.room?.name ?? home.roomName;
  const snapshot = ctx.getSnapshot(roomName) ?? home;

  const cooldowns: Record<number, number | undefined> = {};
  for (const idStr in pc.powers) {
    cooldowns[Number(idStr)] = pc.powers[idStr]!.cooldown;
  }

  const spawn = snapshot.spawns[0];
  const firstTower = snapshot.towers[0];
  const thresholds: PowerCreepThresholds = {
    renewBelowTicks: CONFIG.powerCreeps.renewBelowTicks,
    opsBuffer: CONFIG.powerCreeps.opsBuffer,
    extensionFillGap: CONFIG.powerCreeps.extensionFillGap,
    effectRefreshMargin: CONFIG.powerCreeps.effectRefreshMargin,
  };

  // 姿态路由采集（审计缺口 7）：war/fortify 姿态或房内有威胁 = 战斗窗口；
  // rcl-push 议程 = 冲级窗口。
  const posture = Memory.kernel?.strategy?.posture;
  const agenda = Memory.kernel?.agenda?.initiative;
  const combatContext = posture === "war" || posture === "fortify"
    || snapshot.threatCreeps.length > 0;

  const factory = snapshot.factory;
  const factoryEffect = factory?.effects?.find(
    (e) => e.effect === PWR.OPERATE_FACTORY,
  );

  const action = selectPowerAction(
    {
      ticksToLive: pc.ticksToLive,
      opsCarried: pc.store?.[RESOURCE_OPS] ?? 0,
      powerLevels: collectPowerLevels(pc),
      cooldowns,
    },
    {
      powerEnabled: snapshot.controller?.isPowerEnabled ?? false,
      energyAvailable: snapshot.energyAvailable,
      energyCapacity: snapshot.energyCapacityAvailable,
      storageEnergy: snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY),
      storageNearFull: Memory.rooms[snapshot.roomName]?.storageNearFull === true,
      spawnIds: spawn ? [spawn.id] : [],
      storageId: snapshot.storage?.id,
      spawnEffectRemaining: findEffectRemaining(spawn, PWR.OPERATE_SPAWN),
      combatContext,
      towerIds: firstTower ? [firstTower.id] : [],
      towerEffectRemaining: findEffectRemaining(firstTower, PWR.OPERATE_TOWER),
      rclPush: agenda === "rcl-push",
      controllerId: snapshot.controller?.id,
      controllerEffectRemaining: snapshot.controller?.effects?.find(
        (e) => e.effect === PWR.OPERATE_CONTROLLER,
      )?.ticksRemaining,
      factoryId: factory?.id,
      factoryEffectRemaining: factoryEffect?.ticksRemaining,
      factoryLevel: factory?.level ?? 0,
    },
    thresholds,
  );

  switch (action.kind) {
    case "renew": {
      const ps = home.powerSpawn;
      if (!ps) return;
      if (pc.pos.getRangeTo(ps) <= 1) {
        pc.renew(ps);
      } else {
        pc.moveTo(ps, { range: 1 });
      }
      return;
    }
    case "enableRoom": {
      const controller = snapshot.controller;
      if (!controller) return;
      if (pc.pos.getRangeTo(controller) <= 1) {
        if (pc.enableRoom(controller) === OK) {
          recordEvent(EventKind.PowerCreepMilestone, snapshot.roomName, [3]);
        }
      } else {
        pc.moveTo(controller, { range: 1 });
      }
      return;
    }
    case "generateOps":
      pc.usePower(PWR.GENERATE_OPS);
      return;
    case "operateTower":
    case "operateController": {
      const target = Game.getObjectById(action.targetId as Id<Structure>);
      if (!target) return;
      if (pc.pos.getRangeTo(target) <= USE_POWER_RANGE) {
        pc.usePower(
          action.kind === "operateTower" ? PWR.OPERATE_TOWER : PWR.OPERATE_CONTROLLER,
          target,
        );
      } else {
        pc.moveTo(target, { range: USE_POWER_RANGE });
      }
      return;
    }
    case "operateSpawn":
    case "operateExtension":
    case "operateStorage":
    case "operateFactory": {
      const target = Game.getObjectById(action.targetId as Id<Structure>);
      if (!target) return;
      if (pc.pos.getRangeTo(target) <= USE_POWER_RANGE) {
        const power = action.kind === "operateSpawn"
          ? PWR.OPERATE_SPAWN
          : action.kind === "operateExtension"
            ? PWR.OPERATE_EXTENSION
            : action.kind === "operateStorage"
              ? PWR.OPERATE_STORAGE
              : PWR.OPERATE_FACTORY;
        pc.usePower(power, target);
      } else {
        pc.moveTo(target, { range: USE_POWER_RANGE });
      }
      return;
    }
    case "idle":
      return;
  }
}

/** 从结构 effects 找指定 power 的效果剩余 tick（无效果 undefined）。 */
function findEffectRemaining(
  structure: StructureSpawn | StructureTower | undefined,
  power: number,
): number | undefined {
  const effect = structure?.effects?.find((e) => e.effect === power);
  return effect?.ticksRemaining;
}
