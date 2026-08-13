/**
 * War Planner — P2 系统，war 姿态的唯一进攻执行决策者（R3 战时闭环，R4 自治升级）。
 *
 * 架构定位（ES-1 预留插座的接线）：
 *   Strategy（empire-strategy 发布 posture）→ 本系统读姿态，姿态 = war 才激活。
 *   - 非 war：无需任何军事支出 — 收摊（核验战果 → 失败黑名单 → 回收 attacker →
 *     撤销寄宿孵化请求）。
 *   - war：从各房 intel 选目标（domain/war/planning 纯函数）→ 发布 Memory.kernel.warPlan
 *     → 按编队缺口向 sponsor 队列推 attacker 孵化请求（spawn-manager 是唯一 spawnCreep）。
 *
 * R4 自治升级（报复性战争深化）：
 *   1. 波次集结：warPlan.phase = build/advance 双阈值迟滞。build 阶段 attacker
 *      在 home 集结待命（role-runner hold 钩子），满编才整波 advance —
 *      用「整波推进」替代「散兵逐个送」（添油战术是消耗战失败的根源）。
 *   2. 战损止损：warPlan.spawned 累计提交孵化请求数，超过
 *      squadSize × CONFIG.war.casualtyMultiplier → 判消耗战失败收摊，
 *      并进入整军休战期（warStandDownUntil）— 黑名单挡单目标，休战期挡
 *      「A 止损 → 立刻打 B → 再止损 → 打 C」的跨目标添油循环。
 *   3. 战后核验：收摊时用目标房最新 intel 判定战果（evaluateWarOutcome 纯函数）—
 *      塔网清零/敌人弃房 = success；否则 failure/unknown 进 warBlacklist 冷却，
 *      冷却期内不被重选，防止「打不过 → 收摊 → 下一轮又选中 → 再送」。
 *   4. 可观测：收摊结论记录 WarOutcome 事件（战斗黑匣子）。
 *
 * 铁律：本系统不自行裁决「是否该开战」— 姿态是唯一授权来源。
 * 战争是否可持续由 Strategy 层裁决（posture 的 war 压力退出），
 * 本系统只执行「怎么打」与「何时止损」的作战层面决策。
 *
 * 运行成本：interval 10；非 war 时仅一次收摊（O(在役 attacker + 队列)），
 * 战争期间 O(全部 creep 一次 + 候选 intel 一次)，无全房 find / 无寻路。
 */
import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import {
  decideSquadSize,
  evaluateWarOutcome,
  isAttritionLost,
  nextWavePhase,
  selectWarTarget,
  type WarOutcome,
  type WarTargetCandidate,
  type WarTargetInput,
} from "../domain/war/planning";
import {
  countPending,
  hasRequest,
  removeRequestsByRole,
  spawnKey,
  submitRequest,
} from "../domain/spawn/queue";
import { selectBody } from "../config/bodies";

/** 收摊原因编码（WarOutcome 事件 d[2]）。 */
const REASON_POSTURE = 0;
const REASON_ATTRITION = 1;
const REASON_NO_TARGET = 2;
const REASON_PLAN_TIMEOUT = 3;

/** 核验结论编码（WarOutcome 事件 d[0]）。 */
const OUTCOME_CODES: Record<WarOutcome, number> = { success: 0, failure: 1, unknown: 2 };

export const warPlannerSystem: System = {
  name: "war-planner",
  priority: 2 as Priority,
  interval: CONFIG.war.interval,
  run(ctx: TickContext): void {
    pruneWarBlacklist(ctx.tick);

    const posture = Memory.kernel?.strategy?.posture;
    if (posture !== "war") {
      // 战争结束：清休战闸（plan 已在收摊时清除）。
      if (Memory.kernel) delete Memory.kernel.warStandDownUntil;
      demobilize(ctx.tick, REASON_POSTURE);
      return;
    }

    // R4 休战期：战损止损后整军休战 — 黑名单只挡单目标，
    // 休战闸挡「A 止损 → 立刻打 B → 再止损 → 打 C」的跨目标添油循环。
    if ((Memory.kernel?.warStandDownUntil ?? 0) > ctx.tick) return;

    // 1. 维护战争计划：无计划 / 计划超期 → 重新选目标。
    const existing = Memory.kernel?.warPlan;
    const needSelect = !existing || ctx.tick - existing.since > CONFIG.war.planTimeout;
    if (needSelect) {
      const next = selectWarTarget(buildTargetInput(ctx.tick));
      if (!next) {
        // 无合格目标（情报全过期 / 无玩家邻居 / 目标全在黑名单）：
        // 收摊并核验旧计划战果（无证据核验 → unknown → 黑名单）。
        demobilize(ctx.tick, REASON_NO_TARGET);
        return;
      }
      const keep = existing && existing.targetRoom === next.roomName;
      if (!keep) demobilize(ctx.tick, REASON_PLAN_TIMEOUT);
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.warPlan = {
        targetRoom: next.roomName,
        sponsor: next.sponsor,
        squadSize: decideSquadSize(next.towersSeen, CONFIG.war.squadBase, CONFIG.war.squadPerTower),
        since: ctx.tick,
        towersSeen: next.towersSeen,
        // 同目标续期：保留相位与止损账本（spawned 是消耗战判定的依据，不能重置）。
        phase: keep && existing!.phase ? existing!.phase : "build",
        spawned: keep ? (existing!.spawned ?? 0) : 0,
      };
    }

    const plan = Memory.kernel!.warPlan!;
    const sponsor = plan.sponsor;
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (!queue) return; // sponsor 失守/条目标丢 — 下轮 occupied 排除后会换目标

    // 计划存续期间目标进黑名单（他处止损）→ 立即收摊，防绕过滤选回。
    if (isBlacklisted(plan.targetRoom, ctx.tick)) {
      demobilize(ctx.tick, REASON_NO_TARGET);
      return;
    }

    // 2. 维持编队：统计在役 + pending，不足则补稳定 key 的孵化请求。
    let live = 0;
    for (const c of Object.values(Game.creeps)) {
      if (c.memory.role === "attacker" && c.memory.home === sponsor && c.memory.remoteTarget === plan.targetRoom) {
        live++;
      }
    }
    const pending = countPending(queue, "attacker", sponsor);
    // live+pending < squadSize 时每轮至多补 1 个新 key — 队列被能量门禁卡住时
    // pending 封顶 squadSize，spawned 不会因空转膨胀。
    if (live + pending < plan.squadSize) {
      const index = live + pending;
      const key = spawnKey("attacker", sponsor, index, plan.targetRoom);
      if (!hasRequest(queue, key)) {
        plan.spawned = (plan.spawned ?? 0) + 1;
        const cap = ctx.getSnapshot(sponsor)?.energyCapacityAvailable ?? CONFIG.war.fallbackCapacity;
        const body = selectBody("attacker", cap);
        submitRequest(queue, {
          key,
          role: "attacker",
          home: sponsor,
          priority: 2,
          body,
          memory: {
            role: "attacker",
            home: sponsor,
            mode: "acquire",
            spawnIndex: index,
            remoteTarget: plan.targetRoom,
          },
          createdAt: ctx.tick,
          expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
          retries: 0,
        });
      }
    }

    // 3. 波次相位（迟滞）：满编才 advance，被打残才回落 build 重组。
    plan.phase = nextWavePhase(
      plan.phase ?? "build",
      live,
      plan.squadSize,
      CONFIG.war.waveRegroupRatio,
    );

    // 4. 战损止损：投入超过编队规模 × 倍数仍未见效 → 判消耗战失败收摊。
    if (isAttritionLost(plan.spawned ?? 0, plan.squadSize, CONFIG.war.casualtyMultiplier)) {
      demobilize(ctx.tick, REASON_ATTRITION);
      // 收摊后整军休战 — 下一轮评估前先让经济喘息，防止换目标立即再送。
      Memory.kernel!.warStandDownUntil = ctx.tick + CONFIG.war.standDownTicks;
    }
  },
};

/**
 * 收摊（幂等）：核验战果 → 失败/unknown 进黑名单 → 记录 WarOutcome 事件 →
 * 回收在役 attacker（标记 recycle，spawn-manager 归航回收）→ 撤销寄宿请求 →
 * 清除计划。
 *
 * reason：收摊原因编码（WarOutcome 事件 d[2]，黑匣子复盘用）。
 */
export function demobilize(tick: number, reason: number): void {
  const plan = Memory.kernel?.warPlan;
  if (!plan) return;

  // 战后核验：以 sponsor 记录的最新目标房 intel 判定战果。
  const intel = Memory.rooms[plan.sponsor]?.intel?.[plan.targetRoom];
  const outcome = evaluateWarOutcome(
    plan.towersSeen,
    intel?.towers,
    intel?.owner,
    intel?.lastSeen,
    tick,
    CONFIG.war.targetFreshness,
  );
  if (outcome !== "success") {
    blacklistWarTarget(plan.targetRoom, tick + CONFIG.war.warBlacklistTicks);
  }
  recordEvent(EventKind.WarOutcome, plan.targetRoom, [
    OUTCOME_CODES[outcome],
    plan.spawned ?? 0,
    reason,
  ]);

  for (const c of Object.values(Game.creeps)) {
    if (c.memory.role === "attacker") c.memory.recycle = true;
  }
  const queue = Memory.rooms[plan.sponsor]?.spawnQueue;
  if (queue) removeRequestsByRole(queue, "attacker", plan.sponsor);
  delete Memory.kernel!.warPlan;
}

/** 目标是否处于战争黑名单冷却期内。 */
function isBlacklisted(roomName: string, tick: number): boolean {
  const bl = Memory.kernel?.warBlacklist;
  if (!bl) return false;
  return (bl[roomName] ?? 0) > tick;
}

/** 战争失败目标黑名单：房名 → 冷却到期 tick。唯一写者：本系统。 */
function blacklistWarTarget(roomName: string, until: number): void {
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.warBlacklist ??= {};
  Memory.kernel.warBlacklist[roomName] = until;
}

/** 清理到期黑名单条目（每次运行调用，O(条目数)，防膨胀）。 */
function pruneWarBlacklist(tick: number): void {
  const bl = Memory.kernel?.warBlacklist;
  if (!bl) return;
  for (const roomName in bl) {
    if (bl[roomName]! <= tick) delete bl[roomName];
  }
  if (Object.keys(bl).length === 0) delete Memory.kernel!.warBlacklist;
}

/** 从内存采集战争目标候选（世界可见态 → 纯函数输入）。 */
function buildTargetInput(tick: number): WarTargetInput {
  // 占用集合：我方殖民地 / 远矿运营目标 / 当前扩张目标 — 不打自己正在用的房。
  const occupied = new Set<string>();
  for (const rn of Object.keys(Game.rooms)) {
    if (Game.rooms[rn]?.controller?.my) occupied.add(rn);
  }
  for (const rn of Object.keys(Memory.rooms)) {
    const ops = Memory.rooms[rn]?.remoteOps;
    if (ops) {
      for (const target of Object.keys(ops)) {
        if (ops[target] && ops[target]!.state !== "abandoned") occupied.add(target);
      }
    }
  }
  const expansionTarget = Memory.kernel?.expansion?.target;
  if (expansionTarget) occupied.add(expansionTarget);

  // 我方用户名（首个自有房 controller owner）— 用于排除假冒目标。
  let myUsername = "";
  for (const rn of Object.keys(Game.rooms)) {
    const room = Game.rooms[rn];
    if (room?.controller?.my && room.controller.owner) {
      myUsername = room.controller.owner.username;
      break;
    }
  }

  const candidates: WarTargetCandidate[] = [];
  for (const home of Object.keys(Memory.rooms)) {
    const intel = Memory.rooms[home]?.intel;
    if (!intel) continue;
    for (const roomName of Object.keys(intel)) {
      const e = intel[roomName];
      if (!e) continue;
      candidates.push({
        roomName,
        home,
        kind: e.kind,
        owner: e.owner,
        lastSeen: e.lastSeen,
        towers: e.towers,
        pathCost: e.pathCost,
        occupied: occupied.has(roomName),
      });
    }
  }

  return {
    tick,
    myUsername,
    candidates,
    freshness: CONFIG.war.targetFreshness,
    maxTowers: CONFIG.war.maxTowers,
    blacklist: Memory.kernel?.warBlacklist,
  };
}
