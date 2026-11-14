/** Repair actions — 维修结构。优先级：repairCritical（关键结构 <50%）→ repairContainerDecay */
import { CONFIG, getWallTargetHits } from "../../../config";
import type { RoomSnapshot } from "../../../kernel/contracts";
import type { ActionCandidate } from "../action-types";
import { ACTION_RANGE_FAR, repairIntentAmount, runCountedAction } from "./helpers";
import { findCriticalRepair } from "../../support/targeting";
import { getObjectById } from "../../support/obj-cache";
import { claimRepairTarget, repairTargetClaimedByOther } from "../../support/repair-reservations";
import {
  buildFortificationContext,
  classifyFortification,
  isTowerCovered,
  resolveUnderSiege,
} from "../../../domain/defense/fortification";

/** 道路维修阈值 — 血量低于此比例才修（与 builder 维修需求信号共用 CONFIG 口径）。 */
const ROAD_REPAIR_THRESHOLD: number = CONFIG.construction.roadRepairThreshold;

/** 危路急救线 — 低于此比例的路提级到建造之前修（塌毁重建耗能 ≈ 维修 6 倍）。 */
const ROAD_EMERGENCY_THRESHOLD = 0.15;

/** 修复放手线 — 一旦开修就修到此比例才换目标（hysteresis）。
 * 原先修到 threshold(40%) 即弃：全路群永远贴线抖动、从不真正修满，demand 的修路信号随之抖动，
 * builder 编制孵了退退了孵。修满一条再换，路群从 90% 衰减回 40% 的窗口长达数万 tick。 */
const ROAD_REPAIR_CEILING = 0.9;

type Fortification = StructureWall | StructureRampart;

/** 修复 critical 结构（血量 < 50%）。findCriticalRepair 优先使用快照预计算值。 */
export function repairCritical(): ActionCandidate<AnyStructure> {
  return {
    name: "repair:critical",
    resolve: ac => findCriticalRepair(ac.snapshot),
    execute: (ac, t) => {
      runCountedAction(
        ac.creep,
        t,
        ACTION_RANGE_FAR,
        "repaired",
        () => ac.creep.repair(t),
        undefined,
        () => repairIntentAmount(ac.creep, t),
      );
    },
  };
}

/**
 * 修复衰减中的 container（血量 < 80%）。Container 每 tick 衰减 ~5000 hits，不修 ~50 tick 内
 * 从 80% 降到 0 被摧毁；失去 source container = 物流链断裂，故阈值比 repairCritical(50%) 更激进。
 * 目标持久化：优先复用 repairTargetId，仅在目标修好/消失时重选，消除多个衰减 container 间的摇摆。
 */
export function repairContainerDecay(): ActionCandidate<StructureContainer> {
  return {
    name: "repair:container-decay",
    resolve: ac => {
      // 优先复用持久化目标 — 验证类型 + 仍需修复。
      // P1 修复：原先不检查 structureType，repairTargetId 指向 road/wall 时比例检查仍可能命中
      // （道路 hitsMax 5000，80% = 4000），导致道路被当 container 修，真正衰减的 container 被饿死。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<StructureContainer>);
        if (
          cached &&
          cached.structureType === STRUCTURE_CONTAINER &&
          cached.hits < cached.hitsMax * 0.8 &&
          !repairTargetClaimedByOther(ac.creep.name, cached.id)
        ) {
          return cached;
        }
      }
      // 无有效缓存目标 — 修血量最低且未被他人占用的 container。
      let worst: StructureContainer | undefined;
      let worstRatio = 1;
      for (const c of ac.snapshot.containers) {
        const ratio = c.hits / c.hitsMax;
        if (ratio < 0.8 && ratio < worstRatio && !repairTargetClaimedByOther(ac.creep.name, c.id)) {
          worstRatio = ratio;
          worst = c;
        }
      }
      if (worst) {
        ac.creep.memory.repairTargetId = worst.id as Id<StructureContainer>;
      }
      return worst;
    },
    execute: (ac, worst) => {
      claimRepairTarget(ac.creep.name, worst.id);
      runCountedAction(
        ac.creep,
        worst,
        ACTION_RANGE_FAR,
        "repaired",
        () => ac.creep.repair(worst),
        {
          [ERR_INVALID_TARGET]: () => {
            ac.creep.memory.repairTargetId = undefined;
          },
        },
        () => repairIntentAmount(ac.creep, worst),
      );
    },
  };
}

/**
 * 修复身边的 container（range<=2，血量<80%）— harvester 站桩自维护：正站在 container 旁、它快塌了，
 * 先修再倒。比 repairContainerDecay 更紧急——只修身边的，不需要跑远路。
 */
export function repairNearbyContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "repair:nearby-container",
    resolve: ac => {
      const candidates = ac.snapshot.containers.filter(
        c => ac.creep.pos.getRangeTo(c) <= 2 && c.hits < c.hitsMax * 0.8,
      );
      if (candidates.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(candidates as StructureContainer[]) ?? undefined;
    },
    execute: (ac, nearby) => {
      runCountedAction(
        ac.creep,
        nearby,
        ACTION_RANGE_FAR,
        "repaired",
        () => ac.creep.repair(nearby),
        undefined,
        () => repairIntentAmount(ac.creep, nearby),
      );
    },
  };
}

/**
 * 修复 wall/rampart 到分层目标血量（B3：维修权从塔移交给 creep）。
 * 塔修墙是能量黑洞（10 能量/次+距离衰减+与开火争弹药），creep 维修 1 energy/100 hits/WORK。
 * 分层目标（消除统一目标的维护经济黑洞）：perimeter → RCL 全额；core → 全额×coreRampartFactor；
 * utility → 仅新生急救地板。
 * 门禁（全部满足才启用）：tier 非 recovery/conserve；无威胁（入侵修墙是白送能量）；
 * 盈余按姿态分档：和平期 storage ≥ sprintStorage(50k)，受袭放宽到 sustainedStorage(10k)；
 * 无 storage（RCL3-4）放宽门禁，靠 work chain 优先级保证不抢生存行为。
 */
export function repairFortifications(): ActionCandidate<Fortification> {
  return {
    name: "repair:fortifications",
    resolve: ac => {
      if (ac.budget.tier === "recovery" || ac.budget.tier === "conserve") return undefined;
      if (ac.snapshot.threatCreeps.length > 0) return undefined;

      // 受袭姿态：近期有敌对活动 → 墙体目标升档 + 盈余门槛放宽。
      const roomMemory = Memory.rooms[ac.snapshot.roomName];
      const lastHostileAt = roomMemory?.lastHostileAt;
      // R3：帝国 war 姿态 → 全局备战 — 本房未受袭也按受袭目标维护墙体；
      // fortify 不全局升档（单房一次 invader 目击不烧全帝国墙血预算）。
      const underSiege = resolveUnderSiege(
        Memory.kernel?.strategy?.posture,
        lastHostileAt,
        Game.time,
        CONFIG.defense.siegeMemoryTicks,
      );

      const storage = ac.snapshot.storage;
      // Phase D 之后修：两级防护档。
      //
      // 死区问题：`repairFreshRampart` 只在 < 1,500 hits（bootstrap 的 15%）时急救，
      // 而本条要求 fortifyActive（300K）。两者之间 1,500–10,000 无人维护 ——
      // 线上实测 W8N3 最低 7,001、W7N4 2,201、W8N4 2,681、W6N1 1,101，
      // 一次普通 invader 攻击就能破盾。
      //
      // 成本核算：118 个 rampart 从 5K 补到 10K 共需约 5,900 能量（1 能量 = 100 hits），
      // 一次性；而修到 RCL8 的 10M 目标需 1.18B hits（约 11.8M 能量），永不可达。
      // 所以「基础防护」与「RCL 目标」必须分开：
      //   - 基础档：storage ≥ sustainedStorage(10K) 即开，目标 = min(10K, storage/10)。
      //     按水位缩放是关键 —— 固定 10K 目标在 storage 20K 时会把储备抽干
      //     （全房补一遍要 6,400–11,800 能量）；storage/10 让目标随血量同步收缩
      //     （storage 100K → 10K、50K → 5K、20K → 2K），既保墙又留出补员余量。
      //   - 全目标档：仅 fortifyActive（300K）开，修到 RCL 分层目标。
      let capHits = Infinity;
      if (storage) {
        // 和平期全额灌墙要求真盈余；受袭记忆窗口内目标血量升档（见下方 targetOf），
        // 但**开闸线不因受袭记忆放宽**。
        //
        // Phase C 修正：和平期改用回差闩锁，而不是裸 50K 判断。
        // 裸阈值有两个问题：① storage 刚过 50K 就开门、修到 49K 又关门，形成振荡；
        // ② RCL8 的 118 个 rampart 目标是 1,000 万 hits ⇒ 一旦开门就是无底洞
        // （W8N3 实测 16 e/t 长期失血，storage 从 67K 一路跌回 47K）。
        //
        // Phase D：改用修墙专用闸 fortifyActive（停 50K / 复 300K）。
        // 修墙是三类消费里唯一「没有资产收益」的纯消耗（升级给 GCL、lab 给化合物），
        // 与升级共用 60K 恢复线会让它抢走刚回血的那点盈余。
        //
        // ⚠️ 原实现在 `underSiege` 时把闸放宽到 sustainedStorage(10K) —— 这是个漏洞：
        // `underSiege` 只代表 `lastHostileAt` 记忆窗口（10,000 tick）或帝国战备姿态，
        // 不代表此刻有敌人。W8N3 实测：一次 invader 目击后的 10,000 拍里，塔与 builder
        // 持续以 13–40 e/t 灌 118 个 10M 目标的 rampart，而同期 combat 支出为 0。
        // 「记住挨过打」不等于「正在挨打」—— 正在被拆的应急维修由 `repairCritical`
        // 与塔的威胁路径承担（都不受本闸约束）。因此全目标档只看 fortifyActive。
        const storageEnergy = storage.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
        if (storageEnergy < CONFIG.economy.waterlines.sustainedStorage) return undefined;
        const roomMem = Memory.rooms[ac.snapshot.roomName];
        const richActive = roomMem?.fortifyActive ?? roomMem?.storageRichActive;
        const richGateOpen =
          richActive === undefined
            ? storageEnergy >= CONFIG.economy.waterlines.sprintStorage
            : richActive === true;
        capHits = richGateOpen
          ? Infinity
          : Math.min(CONFIG.defense.rampartBootstrapHits, Math.floor(storageEnergy / 10));
      }
      // 无 storage（RCL1-4）— 放宽门禁，靠 work chain 优先级保证不抢生存行为。

      // 分层分类上下文：min-cut 割集来自 Memory 持久化数据。
      const fortCtx = buildFortificationContext(ac.snapshot, roomMemory?.minCut?.positions);
      // R683：位置评估——塔火圈外的 perimeter rampart 只维持 bootstrap 线。
      // 原因不是“没塔保护”这么简单：rampart 会阻挡敌方步行，塔外的墙会把敌人
      // 挡在火力圈外（敌人打墙、塔打不到），且 RCL4 的 100K 目标维护成本巨大。
      // 核心/utility 档不受影响；塔覆盖到的 perimeter 仍按正常目标维护。
      const targetOf = (f: Fortification): number => {
        const role = classifyFortification(
          f.pos.x,
          f.pos.y,
          f.structureType === STRUCTURE_WALL,
          fortCtx,
        );
        const base = getWallTargetHits(ac.snapshot.rcl, underSiege, role);
        // 任何角色（perimeter/core/utility）只要在当前塔火圈外，都只维持 bootstrap 线：
        // 塔外的盾既不让塔打到敌人，又要按 RCL 目标吃维护工时。
        if (ac.snapshot.towers.length > 0 && !isTowerCovered(f.pos, ac.snapshot.towers)) {
          return Math.min(base, CONFIG.defense.rampartBootstrapHits);
        }
        // 基础防护档：闸未到 fortifyActive 时只允许补到 bootstrap 线（10K），
        // 填上 1,500–10,000 的死区。全目标档 capHits=Infinity 不生效。
        return Math.min(base, capHits);
      };

      // 优先复用持久化目标 — 验证它仍是墙/城防且仍低于自身档位目标。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<Fortification>);
        if (cached) {
          if (
            (cached.structureType === STRUCTURE_WALL ||
              cached.structureType === STRUCTURE_RAMPART) &&
            cached.hits < targetOf(cached)
          ) {
            return cached;
          }
        }
      }

      // 无有效缓存目标 — 重新扫描最低血量的墙/城防。
      const target = findFortificationTarget(ac.snapshot, targetOf);
      if (target) {
        ac.creep.memory.repairTargetId = target.id as Id<Fortification>;
      }
      return target;
    },
    execute: (ac, t) => {
      runCountedAction(
        ac.creep,
        t,
        ACTION_RANGE_FAR,
        "repaired",
        () => ac.creep.repair(t),
        {
          [ERR_INVALID_TARGET]: () => {
            ac.creep.memory.repairTargetId = undefined;
          },
        },
        () => repairIntentAmount(ac.creep, t),
      );
    },
  };
}

/**
 * 查找血量最低且低于自身档位目标血量的 wall/rampart。
 * P2 修复：rampart 优先于 wall — rampart 被摧毁会暴露同格所有结构（spawn/tower/extension），
 * wall 被摧毁只产生缺口。先扫 rampart，全部达标后才修 wall。
 */
function findFortificationTarget(
  snapshot: RoomSnapshot,
  targetOf: (f: Fortification) => number,
): Fortification | undefined {
  // 先扫 rampart — 被摧毁后果更严重（同格结构全裸）。
  let best: Fortification | undefined;
  let bestHits = Infinity;
  for (const rampart of snapshot.ramparts) {
    if (rampart.hits < targetOf(rampart) && rampart.hits < bestHits) {
      bestHits = rampart.hits;
      best = rampart;
    }
  }
  // 所有 rampart 都达标后才扫 wall。
  if (!best) {
    for (const wall of snapshot.walls) {
      if (wall.hits < targetOf(wall) && wall.hits < bestHits) {
        bestHits = wall.hits;
        best = wall;
      }
    }
  }
  return best;
}

/**
 * 新生 rampart 急救 — 血量低于 rampartBootstrapHits 的 rampart 无条件优先灌血。
 * rampart 建成仅 1 hit，每 100 tick 衰减 300 hits [事实：官方常量
 * RAMPART_DECAY_AMOUNT/RAMPART_DECAY_TIME]，不灌必死于首个衰减周期 → 规划器重建 →
 * builder 永久锁死在「建了就塌、塌了再建」循环，防线永远立不起来。
 * 与 repairFortifications 区别：无盈余/tier/威胁门禁（刚投入的资产属止损，威胁期间尤其要灌）；
 * 必须排在 build 动作之前（灌 10k 血十几 tick，建 site 上百 tick，顺序反了新 rampart 必死）；
 * 目标持久化独立于 repairTargetId（避免与 fortifications 缓存互踩），每 tick 直扫 snapshot.ramparts。
 */
export function repairFreshRampart(): ActionCandidate<StructureRampart> {
  return {
    name: "repair:fresh-rampart",
    resolve: ac => {
      // 进场线/放手线分离（hysteresis）：进场 = bootstrapHits 的 15%（1500 ≈ 500 tick 死亡余量，
      // 真濒死）；放手 = bootstrapHits（10k）。教训（线上实测两轮）：以 10k 为进场线时，22 个
      // 9.4k-9.9k 亚健康 rampart（3000+ tick 才塌）永久占据急救层，链后危路急救（2% 血量）反被饿死。
      // 急救层只救真濒死；亚健康群体由链尾 repairFortifications 按分层目标常规抬升。
      const ceiling = CONFIG.defense.rampartBootstrapHits;
      const entry = Math.floor(ceiling * 0.15);
      // 已锁定的灌血目标未到放手线则继续灌（一次灌满，防半途而废）。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<StructureRampart>);
        if (cached && cached.structureType === STRUCTURE_RAMPART && cached.hits < ceiling) {
          return cached;
        }
      }
      let worst: StructureRampart | undefined;
      let worstHits: number = entry;
      for (const rampart of ac.snapshot.ramparts) {
        if (rampart.hits < worstHits) {
          worstHits = rampart.hits;
          worst = rampart;
        }
      }
      if (worst) {
        ac.creep.memory.repairTargetId = worst.id as Id<StructureRampart>;
      }
      return worst;
    },
    execute: (ac, t) => {
      runCountedAction(
        ac.creep,
        t,
        ACTION_RANGE_FAR,
        "repaired",
        () => ac.creep.repair(t),
        undefined,
        () => repairIntentAmount(ac.creep, t),
      );
    },
  };
}

/**
 * 修复衰减中的道路（血量 < 40%）。
 * 衰减率（[Facts] docs.screeps.com/api/StructureRoad.html）：plain 100 hits/1000t（hitsMax 5,000）、
 * swamp 500/1000t（25,000）、wall 15,000/1000t（750,000）；每踩一步衰减计时器额外 -1 tick ×
 * body part 数量，高流量道路衰减远快于低流量。阈值 40% 在任何地形给 ~20,000 tick 修复窗口；
 * 道路塌毁不致命，但塌前需修复保持物流效率（swamp 无路 = 5x 移动成本）。
 * 门禁与 repairFortifications 一致：recovery/conserve tier + 威胁期间不修路。
 * 目标持久化：复用 creep.memory.repairTargetId（与 fortifications 共享）。
 */
export function repairRoads(): ActionCandidate<StructureRoad> {
  return roadRepairAction("repair:roads", ROAD_REPAIR_THRESHOLD, false);
}

/**
 * 危路急救 — 血量 < 15% 的道路提级维修（builder 链中排在建造之前）。

 * （主房 16 条路 8 条破 40%、最烂 4% 濒临塌毁）。塌毁代价不止重建耗能 6 倍：重建 site 还占用
 * 建造名额与 builder 工时，挤掉真正的新建任务。急救线兜住塌毁风险，常规维修仍礼让建造。
 * 门禁差异：conserve 不跳过（省小钱赔大钱），recovery/威胁仍跳过。
 */
export function repairUrgentRoads(): ActionCandidate<StructureRoad> {
  return roadRepairAction("repair:roads-urgent", ROAD_EMERGENCY_THRESHOLD, true);
}

/** 道路维修动作工厂 — threshold 为进场线；急救修到脱险线（threshold=40%）
 * 即放手回去建造，常规修到 ROAD_REPAIR_CEILING（90%）才换目标。 */
function roadRepairAction(
  name: string,
  threshold: number,
  urgent: boolean,
): ActionCandidate<StructureRoad> {
  const ceiling = urgent ? ROAD_REPAIR_THRESHOLD : ROAD_REPAIR_CEILING;
  return {
    name,
    resolve: ac => {
      // 门禁：recovery 恒跳过；conserve 仅常规跳过（急救不省这个钱）；威胁在场恒跳过。
      if (ac.budget.tier === "recovery") return undefined;
      if (!urgent && ac.budget.tier === "conserve") return undefined;
      if (ac.snapshot.threatCreeps.length > 0) return undefined;

      // Phase C：低储期收紧常规修路。storage < sprintStorage(50K) 时只接 hits < 30% 的道路，
      // 把满速维修（16W ≈ 16 e/t）让给 storage 回血；急救档不受限（塌路重建约 6 倍成本）。
      const lowStorage =
        ac.snapshot.storage !== undefined &&
        (ac.snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) <
          CONFIG.economy.waterlines.sprintStorage;
      const entryThreshold =
        !urgent && lowStorage ? CONFIG.construction.lowStorageRoadHits : threshold;

      // 目标缓存：急救用独立字段 urgentRoadId（共享 repairTargetId 会被常规修路/工事维修写入
      // 非危路目标，急救接手会越过链上更紧急的修复）；常规用共享 repairTargetId。
      // 两者都修到各自放手线才换（hysteresis）：急救到 40% 放手回去建造，常规到 90% 消除贴线抖动。
      const cacheKey = urgent ? "urgentRoadId" : "repairTargetId";
      const cachedId = ac.creep.memory[cacheKey];
      if (cachedId) {
        const cached = getObjectById(cachedId as Id<StructureRoad>);
        if (
          cached &&
          cached.structureType === STRUCTURE_ROAD &&
          cached.hits < cached.hitsMax * ceiling &&
          // 低储时缓存目标也必须满足更严格的进场线，否则清掉重选（防止旧目标继续吃 16 e/t）。
          (!lowStorage || urgent || cached.hits < cached.hitsMax * entryThreshold)
        ) {
          return cached;
        }
        ac.creep.memory[cacheKey] = undefined;
      }
      // 无有效缓存目标 — 修血量最低且低于进场线的道路。
      let worst: StructureRoad | undefined;
      let worstRatio = entryThreshold;
      for (const r of ac.snapshot.roads) {
        const ratio = r.hits / r.hitsMax;
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worst = r;
        }
      }
      if (worst) {
        ac.creep.memory[cacheKey] = worst.id as Id<StructureRoad>;
      }
      return worst;
    },
    execute: (ac, worst) => {
      runCountedAction(
        ac.creep,
        worst,
        ACTION_RANGE_FAR,
        "repaired",
        () => ac.creep.repair(worst),
        {
          [ERR_INVALID_TARGET]: () => {
            ac.creep.memory.repairTargetId = undefined;
          },
        },
        () => repairIntentAmount(ac.creep, worst),
      );
    },
  };
}
