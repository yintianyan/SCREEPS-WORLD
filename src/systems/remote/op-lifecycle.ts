/** 远矿 op 生命周期 — 账本同步、实测经济止损、现役重估、运营维护与空转普查。 */
import { CONFIG } from "../../config";
import type { ColonyState, RoomSnapshot } from "../../kernel/contracts";
import { log } from "../../kernel/log";
import {
  peekRemoteOpLedger,
  setRemoteOpLedger,
  eachRemoteOpLedger,
  querySquad,
} from "../../kernel/global-cache";
import {
  fromOpLedgerSnapshot,
  summarizeOpLedger,
  opNetRate,
  type RemoteOpLedger,
  type RemoteOpLedgerSnapshot,
} from "../../domain/remote/op-ledger";
import {
  shouldPauseOperation,
  scoreRemoteCandidate,
  roomLinearDistance,
} from "../../domain/remote/targeting";
import { isHostilePlayerReservation } from "../../domain/intel";

/** 账本观测输出间隔（tick）——低频，避免刷屏与日志 CPU 开销。 */
const LEDGER_LOG_INTERVAL = 1000;

/**
 * Memory ↔ heap 账本同步，返回权威（heap）账本。
 *
 * 窗口起点不一致即判定 heap 是 global reset 后重建的空壳 → 用持久化数据恢复。
 * 这比「heap 缺失才恢复」可靠：reset 后首个 tick 若有交付先发生，heap 已被
 * bump 出一个新条目，只按缺失判定就永远不会恢复。恢复会丢弃该 tick 的零星几笔，
 * 远好于整窗观测被清零。
 *
 * @internal 导出仅供单元测试——业务代码唯一入口是 remoteMiningManagerSystem.run。
 */
export function syncOpLedger(
  home: string,
  target: string,
  persisted: RemoteOpLedgerSnapshot | undefined,
  tick: number,
): RemoteOpLedger {
  const heap = peekRemoteOpLedger(home, target);
  if (heap && (!persisted || heap.windowStart === persisted.w)) return heap;
  const restored = fromOpLedgerSnapshot(persisted, tick);
  setRemoteOpLedger(home, target, restored);
  return restored;
}

/**
 * 实测经济门：用账本的真实净营收收缩「运回来也不划算」的远矿线。
 *
 * 与静态重估（reevaluateActiveOps 的 netScore）的分工：静态分是开点前的摊销
 * 预测，永远看不到 container 溢出衰减、编队被反复击杀、道路迟迟不落地这些
 * 实测损失；账本是唯一能回答「这轮投资回本了吗」的口径。
 *
 * 四道防误杀：
 * 1. **承诺期**：投入在开点瞬间付出、交付要等通勤，窗口未满时净营收必为负，
 *    不设承诺期会把每个新点都误杀。
 * 2. **从未交付不判净营收**：那是「运不回来」而非「运回来不划算」——但零交付
 *    不等于免死：过承诺期仍零交付且孵化投入 ≥ zeroDeliverySpawnCost 时走
 *    零交付止损（2026-09 实证：W36S58 运力冻结在产出 12%，18k tick 零交付
 *    烧掉 15 万孵化，实测门/空转门/静态门三门全部漏接，见 CONFIG 注释）。
 *    零交付止损要求无救援任务（拆核/拆墙 — 救援期交付本就为 0）且无威胁/
 *    危险/压制冷却（威胁期交付同样为 0，归威胁链管）。
 * 3. **废弃后打候选冷却**：静态门否则会立刻把同一房重新选回来（开→废抖动，
 *    每来回白烧一整套编队 body）。
 * 4. **废弃只停投不杀现役**（不回收 creep）：编队余命内继续交付仍是净收益，
 *    提前回收反而浪费已付的 body 成本。与既有静态废弃路径同语义。
 *
 * @internal 导出仅供单元测试——业务代码唯一入口是 remoteMiningManagerSystem.run。
 */
export function enforceMeasuredEconomics(
  remoteOps: Record<string, RemoteOp>,
  homeRoom: string,
  tick: number,
): void {
  for (const [target, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    if (tick - op.createdAt < CONFIG.remote.minDuration) continue;

    const ledger = peekRemoteOpLedger(homeRoom, target);
    if (!ledger) continue;

    if (ledger.delivered <= 0) {
      // 零交付止损：承诺期已过、孵化投入烧穿门槛、且不在任何「交付本应为 0」
      // 的合法窗口（救援任务/威胁冷却）—— 物流断链或目标实质不可达，停投。
      const rescueActive = op.needCoreClear === true || op.needWallClear === true;
      const threatHold =
        (op.threatUntil !== undefined && tick < op.threatUntil) ||
        (op.dangerUntil !== undefined && tick < op.dangerUntil) ||
        (op.blockedUntil !== undefined && tick < op.blockedUntil);
      if (ledger.spawnCost >= CONFIG.remote.zeroDeliverySpawnCost && !rescueActive && !threatHold) {
        op.state = "abandoned";
        op.dangerUntil = tick + CONFIG.remote.econCooldown;
        log.info(
          "remote-mining-manager",
          `remote/${homeRoom}: 零交付止损 ${target}` +
            `（零交付 ${tick - op.createdAt} tick，spawn=${Math.round(ledger.spawnCost)} ` +
            `infra=${Math.round(ledger.infraCost)} ≥ ${CONFIG.remote.zeroDeliverySpawnCost}）`,
        );
      }
      continue;
    }

    const rate = opNetRate(ledger, tick);
    if (rate >= CONFIG.remote.closeNetRate) continue;

    op.state = "abandoned";
    op.dangerUntil = tick + CONFIG.remote.econCooldown;
    log.info(
      "remote-mining-manager",
      `remote/${homeRoom}: 实测亏损收缩 ${target}` +
        `（netRate=${rate.toFixed(2)} < ${CONFIG.remote.closeNetRate} e/t，` +
        `delivered=${Math.round(ledger.delivered)} spawn=${Math.round(ledger.spawnCost)} ` +
        `refund=${Math.round(ledger.refund)} infra=${Math.round(ledger.infraCost)}，` +
        `运行 ${tick - op.createdAt} tick）`,
    );
  }
}

/**
 * 结构建造成本（能量）。工地创建即视为承诺该笔投入——builder 后续只是兑现，
 * 不重复计。CONSTRUCTION_COST 是引擎全局，精简测试环境可能缺失，按 0 兜底。
 */
export function structureCost(type: BuildableStructureConstant): number {
  const table = (globalThis as { CONSTRUCTION_COST?: Record<string, number> }).CONSTRUCTION_COST;
  return table?.[type] ?? 0;
}

/** 低频输出各远矿 op 的净营收。观测期不参与任何决策：先用真实数据看清「哪条线在赚钱」。 */
export function logRemoteLedgers(tick: number): void {
  if (tick % LEDGER_LOG_INTERVAL !== 0) return;
  for (const { home, target, ledger } of eachRemoteOpLedger()) {
    log.info("remote-ledger", summarizeOpLedger(home, target, ledger, tick));
  }
}

/**
 * 现役 op 周期经济重估（A-3/B-6）。用当前 intel.pathCost + 当前 body 运力重算
 * netScore/haulerNeed：haulerNeed 写回（body 变大→缩编，防过配）；netScore 连续
 * 低于门槛超过宽限期 → 废弃（防边际 op 永续）。抗抖动：单次波动不撤，回升即清零。
 */
export function reevaluateActiveOps(
  remoteOps: Record<string, RemoteOp>,
  intel: Record<string, import("../../domain/intel").RoomIntel>,
  homeRoom: string,
  haulerCapacity: number,
  roadStatus: Readonly<Record<string, number>>,
  tick: number,
): void {
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const info = intel[roomName];
    const hasRoad = (roadStatus[roomName] ?? 0) >= 0.6;
    const { netScore, haulerNeed } = scoreRemoteCandidate({
      pathCost: info?.pathCost,
      linearDistance: roomLinearDistance(homeRoom, roomName),
      sources: op.sources ?? info?.sources,
      haulerCapacity,
      hasRoad,
    });
    // 唯一决策源（A4.4 决策权退休）：无条件写入重算结果。
    // 旧 planActive 门是 authority 死锁的根因 —— Plan 永不含 operation 请求，
    // 门却几乎恒真，haulerNeed 被冻结在开点值直至 op 死亡（W36S58 实证）。
    op.haulerNeed = haulerNeed;
    if (netScore < CONFIG.remote.minNetScore) {
      if (op.lowScoreSince === undefined) {
        op.lowScoreSince = tick; // 首次跌破 — 起算宽限期。
      } else if (tick - op.lowScoreSince > CONFIG.remote.lowScoreGrace) {
        op.state = "abandoned";
        log.info(
          "remote-mining-manager",
          `remote/${homeRoom}: 经济重估废弃 ${roomName}` +
            `（netScore=${netScore.toFixed(1)} < ${CONFIG.remote.minNetScore}，` +
            `持续 ${tick - op.lowScoreSince} tick）`,
        );
      }
    } else if (op.lowScoreSince !== undefined) {
      op.lowScoreSince = undefined; // 回升到门槛以上 — 清除低分计时。
    }
  }
}

/**
 * 维护现有远矿运营：暂停过期运营、更新 lastSeen、清理废弃、检测敌占/敌方预定。
 * 返回需回收现役 creep 的房：selfClaimed（转本地）+ hostileReserved（敌方预定，需写冷却）。
 */
export function maintainExistingOps(
  remoteOps: Record<string, RemoteOp>,
  intel: Record<string, import("../../domain/intel").RoomIntel> | undefined,
  tick: number,
  myUsername?: string,
): { selfClaimed: string[]; hostileReserved: string[] } {
  // RM-3：被自己 claim 的远矿房（扩张升级为正式殖民地）— 返回给调用方回收现役 creep。
  const selfClaimed: string[] = [];
  // 敌方预定房 — 派 reserver 去只能打无谓拉锯，运行时退出（评选侧已挡新开点，
  // 此处处理"开点后目标房被敌方预定"的运行时发现，照 InvaderCore 止损链模板）。
  const hostileReserved: string[] = [];
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state === "abandoned") continue;

    // 归属校验（需视野）：目标房已有 owner → 废弃运营。
    // intel 对从未有视野的房间记录不到 owner（盲选是远矿自举的必经之路 —
    // 第一只远矿 creep 进房才产生视野），因此把校验放在获得视野之后。
    // RM-3 修复：原判定 `owner && !my` 漏掉「被自己 claim」— 该房已转入
    // 本地经济闭环，远矿角色继续运营会与本地 harvester 抢矿位、
    // reserver 对自有 controller 空耗 CLAIM 寿命 — 同样废弃并回收。
    const targetRoom = Game.rooms[roomName];
    if (targetRoom?.controller?.owner) {
      op.state = "abandoned";
      if (targetRoom.controller.my) selfClaimed.push(roomName);
      continue;
    }

    // 现场视野校正 op.sources — 开点时 sources 是 intel 一次性快照，可能低估
    // （线上实证：W37S57 开点记 1 源，实际 2 源，南源长期无采集者、满能量空转）。
    // 上限仍由 harvestersMaxPerTarget(2) 兜底，未知房异常虚增不会爆编制。
    if (targetRoom) {
      const liveSources = targetRoom.find(FIND_SOURCES).length;
      if (liveSources > 0 && liveSources !== op.sources) {
        op.sources = liveSources;
      }
    }

    // 敌对玩家预定检测（需视野）：controller 被他人预定 → 废弃 + 回收 + 打冷却。
    // 覆盖"开点后目标房被敌方 reserver 占据"。己方续期不触发。
    // Invader 预定不走这条：那是 Core 占坑，由 collectRemoteBlockers 按 lesser/
    // stronghold 分流。若此处把 Invader 当玩家争矿废弃，coreClearer 永远没有
    // active op 可派（线上 W37S57 实证）。
    const reservedBy = targetRoom?.controller?.reservation?.username;
    if (isHostilePlayerReservation(reservedBy, myUsername)) {
      op.state = "abandoned";
      hostileReserved.push(roomName);
      continue;
    }

    // 入口封死检测（需视野情报）：目标房全部出口都被人工墙封死 → 编队
    // 物理上无法进入，运营=无限白孵 → 废弃。部分封死（如 W36S58 仅西侧墙线）
    // 不废弃 — 编队从其余出口进入后由管线寻路绕行，正常作业。
    // 遗迹 spawn（enemySpawns>0 且 controller 无主）不在此列 — 前任玩家的
    // 房仍可运营远矿（威胁出现时 threatUntil/flee 链接管），占领才需先拆 spawn。
    const info = intel?.[roomName];
    const sealed = info?.sealedExits;
    if (sealed && sealed.length > 0) {
      const exits = Game.map.describeExits(roomName);
      if (exits) {
        const exitDirs = Object.keys(exits).map(Number);
        if (exitDirs.length > 0 && exitDirs.every(d => sealed.includes(d))) {
          op.state = "abandoned";
          log.info(
            "remote-mining-manager",
            `[${tick}] remote/${myUsername ?? "?"}: 入口封死废弃 ${
              roomName
            }（sealedExits=[${sealed.join(",")}]，编队无法进入）`,
          );
          continue;
        }
      }
    }

    // 检查是否有 creep 在该远矿房（有则更新 lastSeen）。
    const hasCreep = hasCreepInRoom(roomName);
    if (hasCreep) {
      op.lastSeen = tick;
    }

    // 过期暂停。
    if (shouldPauseOperation(op, tick, CONFIG.remote.staleThreshold)) {
      if (op.state === "active") {
        op.state = "paused";
      }
    } else if (op.state === "paused") {
      // 恢复：有新视野或 creep 到达时恢复 active。
      if (hasCreep) {
        op.state = "active";
        op.lastSeen = tick;
      }
    }
  }

  // 清理长期废弃的运营（超过 staleThreshold * 3 且无 creep）。
  const abandonThreshold = CONFIG.remote.staleThreshold * 3;
  for (const [_roomName, op] of Object.entries(remoteOps)) {
    if (op.state === "paused" && tick - op.lastSeen > abandonThreshold) {
      op.state = "abandoned";
    }
  }

  // 清理 abandoned 超过 10000 tick 的记录（防止 Memory 膨胀）。
  const cleanupThreshold = CONFIG.remote.staleThreshold * 6;
  for (const roomName of Object.keys(remoteOps)) {
    const op = remoteOps[roomName]!;
    if (op.state === "abandoned" && tick - op.lastSeen > cleanupThreshold) {
      delete remoteOps[roomName];
    }
  }
  return { selfClaimed, hostileReserved };
}

/** 逐房「新开远矿」就绪门（纯函数便于单测）。
 *
 * 帝国姿态放行（newRemoteOpsAllowed）之外的**本房**门槛：本房经济须自身成熟，
 * 才允许再新开远矿点——RCL≥roomMinRcl 且 colonyState=normal 且 storage 盈余
 * ≥roomMinStorage。防止新占嫩房（RCL4、无 storage 缓冲）过早分兵远矿。
 * 只影响「是否新开」，不影响现役 op 的维护/重估/回收。 */
export function roomReadyForNewRemote(
  snapshot: RoomSnapshot,
  colonyState: ColonyState | undefined,
): boolean {
  if (snapshot.rcl < CONFIG.remote.roomMinRcl) return false;
  if (colonyState !== "normal") return false;
  const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  return storageEnergy >= CONFIG.remote.roomMinStorage;
}

/** 统计 active 状态的运营数。 */
export function countActiveOps(remoteOps: Readonly<Record<string, RemoteOp>>): number {
  let count = 0;
  for (const op of Object.values(remoteOps)) {
    if (op.state === "active") count++;
  }
  return count;
}

/**
 * 远矿空转普查 — 对每个 active op 统计编队健康度，全员空转超时 → 废弃。
 * 反馈闭环：manager 原本只看「账面」指标（sources/pathCost/netScore），看不到
 * 「编队实际在不在干活」— W36S58 线上实证：账面上 2 源近距高分房，实际编队
 * 被前任玩家墙线困住空转 44k tick、零产出、无限补员。本普查是吞吐反馈安全网。

 * 空转判定（单只）：mode 为 idle/flee，或 stuckTicks ≥ CONFIG.remote.stallStuckTicks。
 * 通勤中的 acquire/work、正常采集搬运均计为工作。全员空转计时进 op.stallSince；
 * 任一成员恢复工作（或编队归零 — 孵化替换窗口）立即清零（抗抖动）。
 * 成本：每 managerInterval 一次 Game.creeps 全遍历（O(creeps)，10 tick 分摊）。
 */
export function censusStalledOps(
  remoteOps: Record<string, RemoteOp>,
  homeRoom: string,
  tick: number,
): void {
  // 单次遍历全部 creep，按 remoteTarget 归组（远矿编队规模小，Map 摊还成本可忽略）。
  const byTarget = new Map<string, { total: number; stalled: number }>();
  for (const entry of querySquad({ home: homeRoom })) {
    const creep = Game.creeps[entry.name];
    if (!creep || creep.spawning || creep.memory.recycle) continue;
    const target = creep.memory.remoteTarget;
    if (!target) continue;
    const op = remoteOps[target];
    if (!op || op.state !== "active") continue;
    let stallEntry = byTarget.get(target);
    if (!stallEntry) {
      stallEntry = { total: 0, stalled: 0 };
      byTarget.set(target, stallEntry);
    }
    stallEntry.total++;
    const mode = creep.memory.mode;
    const stuck = creep.memory.stuckTicks ?? 0;
    if (mode === "idle" || mode === "flee" || stuck >= CONFIG.remote.stallStuckTicks) {
      stallEntry.stalled++;
    }
  }

  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const entry = byTarget.get(roomName);
    if (!entry || entry.total === 0) {
      // 编队归零（新开点孵化中 / 换代替换窗口）— 不计空转。
      if (op.stallSince !== undefined) op.stallSince = undefined;
      continue;
    }
    if (entry.stalled === entry.total) {
      if (op.stallSince === undefined) {
        op.stallSince = tick;
      } else if (tick - op.stallSince > CONFIG.remote.stallAbandonTicks) {
        op.state = "abandoned";
        log.info(
          "remote-mining-manager",
          `[${tick}] remote/${homeRoom}: 空转止损废弃 ${roomName}（编队 ${
            entry.total
          } 只全员空转持续 ${tick - op.stallSince} tick）`,
        );
      }
    } else if (op.stallSince !== undefined) {
      op.stallSince = undefined;
    }
  }
}

/** 检查是否有 creep 在指定房间（通过 Game.rooms 判断可见性 + creep 存在）。 */
function hasCreepInRoom(roomName: string): boolean {
  const room = Game.rooms[roomName];
  if (!room) return false;
  // 检查是否有自己的 creep 在该房间——用 room.find 代替全局扫描。
  return room.find(FIND_MY_CREEPS).length > 0;
}
