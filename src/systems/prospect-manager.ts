/** Prospect Manager */
import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import { selectProspectTarget, type ProspectCandidate } from "../domain/strategy/prospect";
import { roomLinearDistance } from "../domain/remote/targeting";
import { countPending, hasRequest, removeRequestsByRole, spawnKey, submitRequest } from "../domain/spawn/queue";
import { selectBody } from "../config/bodies";
import { querySquad } from "../kernel/global-cache";
import { getRoomIntel, queryRoomIntel } from "./intelligence";

/** ProspectOutcome 事件 outcome 编码（与 event-log 注释对齐）。 */
const OUTCOME_SUCCESS = 0;
const OUTCOME_TIMEOUT = 1;
const OUTCOME_DEATH = 2;
const OUTCOME_ABORTED = 3;

export const prospectManagerSystem: System = {
  name: "prospect-manager",
  priority: 3 as Priority,
  interval: CONFIG.prospect.interval,
  run(ctx: TickContext): void {
    pruneCooldown(ctx.tick);

    // 已知 hostile 房集合（供 scout 孵化请求写入 avoidRooms，导航绕行）。
    const hostileRooms = Array.from(collectHostileRooms(getMyUsername()));

    if (!Memory.kernel) Memory.kernel = {};
    const mission = Memory.kernel.prospect;

    if (!mission) {
      // 开新任务的门禁：姿态授权 + CPU/bucket 富余 + 无进行中的扩张行动。
      if (Memory.kernel.strategy?.expansionAllowed !== true) return;
      if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
      if ((Game.cpu.bucket ?? 0) < CONFIG.prospect.minBucket) return;
      if (Memory.kernel.expansion) return; // claimer/拓荒已在路上，侦察让位。

      const target = selectProspectTarget(
        buildCandidates(ctx.tick),
        ctx.tick,
        { intelFreshness: CONFIG.prospect.intelFreshness },
      );
      if (!target) return;

      Memory.kernel.prospect = {
        target: target.roomName,
        sponsor: target.sponsor,
        startedAt: ctx.tick,
        spawned: 0,
      };
      submitScoutRequest(ctx, Memory.kernel.prospect, hostileRooms);
      return;
    }

    // ── 任务存续期 ──
    // 瞬时 posture 翻转脱敏（Opt B）：pixel 放血会周期清空 bucket、令 posture 临时翻
    // develop（expansionAllowed=false），若在途任务立即撤会孤儿化 scout。对此类瞬时翻转
    // 脱敏——仅当 (a) 现场有活敌（hasLiveThreat，零滞回真相），或 (b) posture 持续非
    // expand 超过 grace 窗口，才中止任务。目标无过错、重新允许时自然再评；真实战略撤退
    // （war/持续 develop）由 grace 兜底收摊。
    const liveThreat = [...ctx.snapshots()].some((s) => (s.threatCreeps?.length ?? 0) > 0);
    if (liveThreat) {
      completeMission(ctx.tick, OUTCOME_ABORTED, false);
      return;
    }
    if (Memory.kernel.strategy?.expansionAllowed !== true) {
      // 瞬时翻转脱敏：累计非 expand 持续 tick，超过 grace 才中止。
      if (mission.postureExitSince === undefined) mission.postureExitSince = ctx.tick;
      if (ctx.tick - mission.postureExitSince >= CONFIG.prospect.postureGraceTicks) {
        completeMission(ctx.tick, OUTCOME_ABORTED, false);
        return;
      }
    } else {
      // 恢复 expand → 清零脱敏计时，任务存活。
      mission.postureExitSince = undefined;
    }

    // 成功判定：目标 intel 已新鲜且 sources 已知（决策就绪）。
    const intel = getRoomIntel(mission.target);
    if (
      intel &&
      intel.payload.sources !== undefined &&
      ctx.tick - intel.observedAt <= CONFIG.prospect.intelFreshness
    ) {
      completeMission(ctx.tick, OUTCOME_SUCCESS, false);
      return;
    }

    // 超时止损。
    if (ctx.tick - mission.startedAt > CONFIG.prospect.maxMissionTicks) {
      completeMission(ctx.tick, OUTCOME_TIMEOUT, true);
      return;
    }

    // 侦察兵全灭判定：live + pending 均为 0 且已孵化过 → 死光了。
    // P0-1：从全局编队索引取 scout 存活数，替代独立全量遍历 Game.creeps。
    let live = 0;
    const scouts = querySquad({ role: "scout", home: mission.sponsor, remoteTarget: mission.target });
    for (const e of scouts) {
      if (!e.spawning) live++;
    }
    const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
    const pending = queue ? countPending(queue, "scout", mission.sponsor) : 0;
    if (live + pending === 0) {
      if (mission.spawned >= CONFIG.prospect.maxSpawns) {
        completeMission(ctx.tick, OUTCOME_DEATH, true);
        return;
      }
      // 补派（侦察兵死在途中）：每轮至多补 1 只，spawned 累计封顶。
      submitScoutRequest(ctx, mission, hostileRooms);
    }
  },
};

/** 提交一个稳定 key 的 scout 孵化请求（幂等：同 key 合并），并计入 spawned。 */
function submitScoutRequest(ctx: TickContext, mission: NonNullable<KernelMemory["prospect"]>, avoidRooms: string[]): void {
  const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
  if (!queue) return;
  const key = spawnKey("scout", mission.sponsor, mission.spawned, mission.target);
  if (hasRequest(queue, key)) return;
  mission.spawned += 1;
  const cap = ctx.getSnapshot(mission.sponsor)?.energyCapacityAvailable ?? 800;
  submitRequest(queue, {
    key,
    role: "scout",
    home: mission.sponsor,
    priority: 3,
    body: selectBody("scout", cap),
    memory: {
      role: "scout",
      home: mission.sponsor,
      mode: "acquire",
      remoteTarget: mission.target,
      // 已知 hostile 房集合：moveTowardRoom 跨房路由绕行（避开 Aguia 的 W38S58 这类），
      // 无路可绕时由 scout 的 pushThrough 标志硬钻通过。仅导航安全网；源头优选由
      // frontier 评分惩罚（hostileAdjacent）完成。
      avoidRooms,
    },
    createdAt: ctx.tick,
    expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
}

/** 收摊（幂等）：记事件 → 失败则目标冷却 → 回收侦察兵 → 撤请求 → 清任务。 */
function completeMission(tick: number, outcome: number, cooldown: boolean): void {
  const mission = Memory.kernel?.prospect;
  if (!mission) return;

  recordEvent(EventKind.ProspectOutcome, mission.target, [outcome, mission.spawned]);
  if (cooldown) {
    Memory.kernel!.prospectCooldown ??= {};
    Memory.kernel!.prospectCooldown[mission.target] = tick + CONFIG.prospect.cooldownTicks;
  }

  // P0-1：从全局编队索引取 scout，按 name 精确定位 Creep 对象标记 recycle。
  const scouts = querySquad({ role: "scout", remoteTarget: mission.target });
  for (const e of scouts) {
    const creep = Game.creeps[e.name];
    if (creep) creep.memory.recycle = true;
  }
  const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
  if (queue) removeRequestsByRole(queue, "scout", mission.sponsor);
  delete Memory.kernel!.prospect;
}

/** 清理到期冷却条目（每次运行，防膨胀）。 */
function pruneCooldown(tick: number): void {
  const cooldown = Memory.kernel?.prospectCooldown;
  if (!cooldown) return;
  for (const roomName in cooldown) {
    if (cooldown[roomName]! <= tick) delete cooldown[roomName];
  }
  if (Object.keys(cooldown).length === 0) delete Memory.kernel!.prospectCooldown;
}

/**
 * 从各房 intel 采集侦察候选（世界可见态 → 纯函数输入）。
 * 除已知房外，主动纳入「已知房（含己方房）相邻、但 intel 未收录」的前沿发现候选
 * （known=false）— 视野只从己方房出口刷新（room-observer.ts:156），已知世界会被锁死在
 * 直接邻居；当直接邻居全不可殖民时扩张永久饿死。外扩让 scout 探明第 2 圈及以外的
 * 干净中立房，落库 intel 后 expansion 评估器即可见（CONFIG.prospect.horizon 限圈数）。
 */
/** 取己方用户名（排除假冒 owner），供 hostile 判定排除自身。 */
function getMyUsername(): string {
  for (const rn of Object.keys(Game.rooms)) {
    const room = Game.rooms[rn];
    if (room?.controller?.my && room.controller.owner) {
      return room.controller.owner.username;
    }
  }
  return "";
}

/**
 * 已知 hostile 房集合：intel 中「敌方所有（owner≠我）」或「带遗迹 spawn（enemySpawns>0）」的房。
 * 用于前沿候选评分惩罚 + scout 绕行，避免派 scout 去「需穿越敌方房才能 recon」的目标。
 */
function collectHostileRooms(myUsername: string): Set<string> {
  const hostile = new Set<string>();
  for (const entry of queryRoomIntel()) {
    const e = entry.payload;
    if ((e.owner && e.owner !== myUsername) || (e.enemySpawns ?? 0) > 0) {
      hostile.add(entry.subject);
    }
  }
  return hostile;
}

function buildCandidates(tick: number): ProspectCandidate[] {
  const candidates: ProspectCandidate[] = [];

  // 占用集合：己方殖民地 / 远矿运营目标 / 当前扩张目标。
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
  if (Memory.kernel?.expansion?.target) occupied.add(Memory.kernel.expansion.target);

  // 我方用户名（排除假冒 owner）。
  const myUsername = getMyUsername();

  const cooldown = Memory.kernel?.prospectCooldown;
  const horizon = CONFIG.prospect.horizon;

  // 已知 hostile 房集合（敌方所有 / 带遗迹 spawn）— 用于前沿候选评分惩罚 + scout 绕行。
  // 避免把 scout 派去「需穿越敌方房才能 recon」的目标（Aguia 的 W38S58 这类）。
  const hostileRooms = collectHostileRooms(myUsername);

  // ── 已知房候选（intel 已收录）──
  const knownRooms = new Set<string>();
  for (const entry of queryRoomIntel()) {
    const e = entry.payload;
    knownRooms.add(entry.subject);
    if (cooldown && (cooldown[entry.subject] ?? 0) > tick) continue;
    candidates.push({
      roomName: entry.subject,
      home: entry.observedBy,
      kind: e.kind,
      status: e.status,
      owner: e.owner,
      reservedBy: e.reservedBy,
      myUsername,
      sources: e.sources,
      lastSeen: entry.observedAt,
      pathCost: e.pathCost,
      occupied: occupied.has(entry.subject),
    });
  }

  // ── 前沿发现候选：已知房（含己方房）相邻、但 intel 尚未收录的房。
  // 以「最近己方房」为 sponsor（scout 从其 spawn 孵化、intel 落其名下），
  // 只探 horizon 圈数内、未被占用/冷却的未知房。
  const owned = Object.keys(Game.rooms).filter((r) => Game.rooms[r]?.controller?.my);
  if (owned.length > 0 && horizon > 0 && Game.map?.describeExits) {
    const baseRooms = new Set(knownRooms);
    for (const o of owned) baseRooms.add(o);
    const seen = new Set(knownRooms);
    const nearestOwned = (roomName: string): string => {
      let best = owned[0]!; // 外层已保证 owned.length > 0
      let bestD = Infinity;
      for (const o of owned) {
        const d = roomLinearDistance(o, roomName);
        if (d < bestD) { bestD = d; best = o; }
      }
      return best;
    };
    for (const base of baseRooms) {
      const exits = Game.map.describeExits(base);
      if (!exits) continue;
      for (const neighbor of Object.values(exits)) {
        if (!neighbor || seen.has(neighbor)) continue;
        seen.add(neighbor);
        if (occupied.has(neighbor)) continue;
        if (cooldown && (cooldown[neighbor] ?? 0) > tick) continue;
        const sponsor = nearestOwned(neighbor);
        if (roomLinearDistance(sponsor, neighbor) > horizon) continue;
        // hostile 相邻判定：候选房的正交邻居中存在已知 hostile 房 → 评分惩罚（scout 需穿越
        // 敌方房才能 recon，会被吓退/阵亡）。describeExits 按坐标计算，无需视野。
        const exits = Game.map?.describeExits(neighbor);
        const hostileAdj = !!(exits && Object.values(exits).some((ex) => ex && hostileRooms.has(ex)));
        candidates.push({
          roomName: neighbor,
          home: sponsor,
          kind: "unknown",
          status: "unknown",
          myUsername,
          sources: undefined,
          lastSeen: 0,
          occupied: false,
          known: false,
          hostileAdjacent: hostileAdj,
        });
      }
    }
  }

  return candidates;
}
