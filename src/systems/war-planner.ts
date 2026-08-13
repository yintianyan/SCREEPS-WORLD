/**
 * War Planner — P2 系统，war 姿态的唯一进攻执行决策者（R3 战时闭环）。
 *
 * 架构定位（ES-1 预留插座的接线）：
 *   Strategy（empire-strategy 发布 posture）→ 本系统读姿态，姿态 = war 才激活。
 *   - 非 war：无需任何军事支出 — 清除战争计划、撤销寄宿的 attacker 请求、
 *     标记在役 attacker 回收（代码/任务存在不等于战争开始）。
 *   - war：从各房 intel 选目标（domain/war/planning 纯函数）→ 发布 Memory.kernel.warPlan
 *     → 按编队缺口向 sponsor 队列推 attacker 孵化请求（spawn-manager 是唯一 spawnCreep）。
 *
 * 铁律：本系统不自行裁决「是否该开战」— 姿态是唯一授权来源。
 *
 * 运行成本：interval 10；非 war 时仅一次 plan 清理（O(在役 attacker)），不孵任何军事单位。
 */
import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  decideSquadSize,
  selectWarTarget,
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

export const warPlannerSystem: System = {
  name: "war-planner",
  priority: 2 as Priority,
  interval: CONFIG.war.interval,
  run(ctx: TickContext): void {
    const posture = Memory.kernel?.strategy?.posture;
    if (posture !== "war") {
      demobilize();
      return;
    }

    // 1. 维护战争计划：无计划 / 计划超期 → 重新选目标。
    const existing = Memory.kernel?.warPlan;
    const needSelect = !existing || ctx.tick - existing.since > CONFIG.war.planTimeout;
    if (needSelect) {
      const next = selectWarTarget(buildTargetInput(ctx.tick));
      if (!next) {
        // 无合格目标（情报全过期 / 无玩家邻居）：收摊，等待下次评估。
        clearPlanAndRecall();
        return;
      }
      // 目标变更 → 先回收旧编队（下轮为新目标重新孵化）。
      if (existing && existing.targetRoom !== next.roomName) {
        clearPlanAndRecall();
      }
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.warPlan = {
        targetRoom: next.roomName,
        sponsor: next.sponsor,
        squadSize: decideSquadSize(next.towersSeen, CONFIG.war.squadBase, CONFIG.war.squadPerTower),
        since: ctx.tick,
        towersSeen: next.towersSeen,
      };
    }

    const plan = Memory.kernel!.warPlan!;
    const sponsor = plan.sponsor;
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (!queue) return; // sponsor 失守/条目标丢 — 下轮 occupied 排除后会换目标

    // 2. 维持编队：统计在役 + pending，不足则补稳定 key 的孵化请求。
    let live = 0;
    for (const c of Object.values(Game.creeps)) {
      if (c.memory.role === "attacker" && c.memory.home === sponsor && c.memory.remoteTarget === plan.targetRoom) {
        live++;
      }
    }
    const pending = countPending(queue, "attacker", sponsor);
    if (live + pending < plan.squadSize) {
      const index = live + pending;
      const key = spawnKey("attacker", sponsor, index, plan.targetRoom);
      if (!hasRequest(queue, key)) {
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
  },
};

/** 非 war 姿态：一次性收摊（计划存在才动作，幂等）。 */
export function demobilize(): void {
  const plan = Memory.kernel?.warPlan;
  if (!plan) return;
  for (const c of Object.values(Game.creeps)) {
    if (c.memory.role === "attacker") c.memory.recycle = true;
  }
  const queue = Memory.rooms[plan.sponsor]?.spawnQueue;
  if (queue) removeRequestsByRole(queue, "attacker", plan.sponsor);
  delete Memory.kernel!.warPlan;
}

/** 计划消失（无合格目标 / 目标变更）：与 demobilize 同语义（幂等）。 */
function clearPlanAndRecall(): void {
  demobilize();
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
  };
}