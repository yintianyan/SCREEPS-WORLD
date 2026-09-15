/** 远矿 creep 编制回收 — 超额回收、压制房撤离、回收标记管理。 */
import { CONFIG } from "../../config";
import { querySquad } from "../../kernel/global-cache";
import { remoteReplacementThreshold } from "../../domain/remote/staffing";
import type { RemoteCreepSummary } from "../../domain/remote/demand";

/**
 * 回收过量远矿 creep。
 *
 * 当某远矿目标的存活 creep 数超过配置上限时，标记多余的 creep 回收。
 * 回收标记由 spawn-manager 的 recyclePass 实际执行（spawn.recycleCreep）。

 * 交接豁免（关键）：demand 的 findReplacement 会在老 creep 进入替换窗口时
 * 提前孵化替补 — 交接重叠期同角色 2 只并存是**设计行为**，不是超额。

 * 无豁免的后果（线上实测的孵化→秒杀→再孵化循环）：
 *   1. 孵化中的替补 ticksToLive 为 undefined，按 ?? 0 排序被当成「最老」
 *      标记回收 — 替补出场即走向 spawn 消融；
 *   2. collectRemoteCreeps 排除 recycle 标记者 → demand 视角编制归零 →
 *      立即再孵 → 新替补再次与垂死者并存 → 再被标记，能量无限空烧
 *      （reserver 因 CLAIM 寿命仅 600 tick 替换最频繁，观感最明显）。
 * 因此：孵化中的不参与判定；替换窗口内的垂死者豁免（交接退场方，
 * 任其自然寿终 — 远矿角色被标记后跨房走回家的路程往往长于余命，
 * 回收残值拿不到还白丢交接期产出）；只有多只健康成员并存（双孵事故）
 * 才是真超额，保留最年轻、回收其余。

 * @internal 导出仅供单元测试（tests/unit/remote/recycle-excess.test.ts）—
 *           业务代码唯一入口是 remoteMiningManagerSystem.run。
 */
export function recycleExcessRemoteCreeps(
  homeRoom: string,
  remoteOps: Readonly<Record<string, RemoteOp>>,
  travelCosts?: Readonly<Record<string, { pathCost?: number }>>,
): void {
  // 收集每个 active 目标的远矿 creep，按角色分组。
  const byTarget = new Map<
    string,
    { harvester: Creep[]; hauler: Creep[]; reserver: Creep[]; defender: Creep[] }
  >();

  for (const entry of querySquad({ home: homeRoom })) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;
    if (creep.memory.recycle) continue; // 已标记回收的跳过。
    const target = creep.memory.remoteTarget;
    if (!target) continue;
    const op = remoteOps[target];
    if (!op || op.state !== "active") continue;

    let groupEntry = byTarget.get(target);
    if (!groupEntry) {
      groupEntry = { harvester: [], hauler: [], reserver: [], defender: [] };
      byTarget.set(target, groupEntry);
    }
    const role = creep.memory.role;
    if (creep.spawning) continue;
    if (role === "remoteHarvester") groupEntry.harvester.push(creep);
    else if (role === "remoteHauler") groupEntry.hauler.push(creep);
    else if (role === "reserver") groupEntry.reserver.push(creep);
    else if (role === "remoteDefender") groupEntry.defender.push(creep);
  }

  // 替换窗口判定 — 与 demand 的 findReplacement 完全同口径。
  const inReplacementWindow = (c: Creep): boolean => {
    const pathCost = travelCosts?.[c.memory.remoteTarget ?? ""]?.pathCost;
    return (
      c.ticksToLive !== undefined &&
      c.ticksToLive <= remoteReplacementThreshold(c.body.length, pathCost)
    );
  };

  // 组内标记：豁免垂死交接者后，健康成员超出配额的部分回收。
  // 保留序「载货优先，其次年轻」（2026-09 实测教训）：被回收的 creep 由
  // recyclePass 引导回 home 走 spawn.recycleCreep 消融，**随身货物一并销毁**
  // ——满载归途中的 hauler 被标记 = 800-1200e 交付报废 + 白走一趟归途。
  // 无货成员被回收只损失残值，载货成员被回收损失残值 + 整包 cargo，故
  // keepWorthiness 把载货排前：满载者留场完成交付，空载且更老者先退场。
  const markExcess = (creeps: Creep[], quota: number): void => {
    const healthy = creeps.filter(c => !inReplacementWindow(c));
    if (healthy.length <= quota) return;
    const keepWorthiness = (c: Creep): number =>
      ((c.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0) > 0 ? Number.MAX_SAFE_INTEGER / 2 : 0) +
      (c.ticksToLive ?? 0);
    healthy.sort((a, b) => keepWorthiness(b) - keepWorthiness(a));
    for (let i = quota; i < healthy.length; i++) {
      healthy[i]!.memory.recycle = true;
    }
  };

  for (const [target, entry] of byTarget) {
    // harvester 配额必须与 demand 侧同口径（B-1：按 op.sources 孵化，上限
    // harvestersMaxPerTarget）。若此处仍用固定 harvestersPerTarget=1，则
    // demand 孵 2（2-source）、回收判超额杀 1 — 与下方 hauler 曾经的口径分裂
    // 同源，形成孵化→回收→重孵死循环。
    markExcess(
      entry.harvester,
      Math.min(
        remoteOps[target]?.sources ?? CONFIG.remote.harvestersPerTarget,
        CONFIG.remote.harvestersMaxPerTarget,
      ),
    );
    // 爬坡期需求侧只少孵、不主动回收健康 hauler：远矿通勤存在长反馈延迟，
    // 已付出的运力在下一名 miner 到位后立即可用；低能量无 storage 时提前收缩
    // 会使 container 积压、home 断供并进入死亡螺旋。真正超额仅按满产额度回收。
    markExcess(entry.hauler, remoteOps[target]?.haulerNeed ?? CONFIG.remote.haulersPerTarget);
    markExcess(entry.reserver, 1);
    markExcess(entry.defender, 1);
  }
}

/** 收集归属于本房的所有远矿 creep 摘要。 */
export function collectRemoteCreeps(homeRoom: string): RemoteCreepSummary[] {
  const result: RemoteCreepSummary[] = [];
  for (const entry of querySquad({ home: homeRoom })) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;
    // RD-1：回收中的 creep 不算编制 — 半血撤退的 defender / 被撤回的
    // 经济 creep 已退出战斗力序列，计入会挡住接替者的孵化。
    if (creep.memory.recycle === true) continue;
    const role = creep.memory.role ?? "unknown";
    // 只收集远矿角色（dismantler = 外国前置 spawn 拆除任务编制，需计入挡重复孵化）。
    if (
      role !== "remoteHarvester" &&
      role !== "remoteHauler" &&
      role !== "reserver" &&
      role !== "remoteDefender" &&
      role !== "coreClearer" &&
      role !== "dismantler"
    ) {
      continue;
    }
    result.push({
      name: creep.name,
      role,
      remoteTarget: creep.memory.remoteTarget,
      ticksToLive: creep.ticksToLive,
      bodyLength: creep.body.length,
      sourceSlot: creep.memory.sourceSlot as number | undefined,
    });
  }
  return result;
}

/**
 * 回收 InvaderCore 压制房的现役远矿 creep。

 * 核心压制期间该房是净亏损：source 被敌方预约压在 1500 容量、
 * reserver 打不动核心持续续期的预约。标记 recycle 后 role-runner 短路停工，
 * spawn-manager 的 recyclePass 引导回收；孵化冻结由 blockedRooms 负责，
 * 核心 decay 后运营自动恢复（remoteOps 状态与 intel 均保留）。
 */
export function recycleBlockedRoomCreeps(
  homeRoom: string,
  recycleRooms: ReadonlySet<string>,
  strongholdRooms: ReadonlySet<string> = new Set(),
): void {
  if (recycleRooms.size === 0) return;
  for (const entry of querySquad({ home: homeRoom })) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;
    if (creep.memory.recycle) continue;
    const target = creep.memory.remoteTarget;
    if (!target || !recycleRooms.has(target)) continue;
    // 次级核心房的 clearer 必须留场拆核；大要塞打不过，必须撤。
    if (creep.memory.role === "coreClearer" && !strongholdRooms.has(target)) continue;
    creep.memory.recycle = true;
  }
}

/** 回收指定远矿目标房的所有远矿 creep（RETREAT/ABORT 时调用）。 */
export function recycleRemoteCreepsForRoom(homeRoom: string, targetRoom: string): void {
  for (const entry of querySquad({ home: homeRoom, remoteTarget: targetRoom })) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;
    if (creep.memory.recycle) continue;
    // coreClearer 不回收（可能正在拆 InvaderCore，与威胁响应无关）。
    if (creep.memory.role === "coreClearer") continue;
    creep.memory.recycle = true;
  }
}

/** 拆除任务结束（spawn 拆完 / 对方 claim）→ 仅回收该房的 dismantler，经济 creep 不动。 */
export function recycleRemoteDismantlers(homeRoom: string, targetRoom: string): void {
  for (const entry of querySquad({
    home: homeRoom,
    remoteTarget: targetRoom,
    role: "dismantler",
  })) {
    const creep = Game.creeps[entry.name];
    if (!creep || creep.memory.recycle) continue;
    creep.memory.recycle = true;
  }
}
