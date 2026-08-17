import type { RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { getObjectById } from "./obj-cache";

/**
 * 掉落堆选择的距离权重：每格距离折算的能量机会成本（往返运力代价）。
 * selectDroppedEnergy 用 score = amount − dist × 此值 在「堆大小 vs 取货距离」
 * 间权衡。20 ≈ 往返 2 格的运力损耗量级，使远处溢出大堆（损失更大）压过近处
 * 小堆，避免多 hauler 被身边小堆截胡而涌向同侧、冷落另一侧持续溢出的大堆。
 */
const DROP_DISTANCE_WEIGHT = 20;

/**
 * hauler 取能 container 选择的距离权重：每格距离折算的能量。
 * selectHaulSourceContainer 用 score = energy − dist × 此值 在「满溢程度 vs 距离」
 * 间权衡。10 使两侧同为满仓（2000）时按距离分流（近者优先），但满溢程度差距明显
 * 时（如 2000 vs 1000）仍优先疏解更满者（距离项 ≤200 不足以翻转千级能量差），
 * 兼顾防溢出与就近，配合名字哈希散布消除「全员涌向数组首个」的羊群偏置。
 */
const HAUL_CONTAINER_DISTANCE_WEIGHT = 10;

/**
 * 获取房间内所有敌对 creep（过滤联盟白名单）— per-tick per-room 共享缓存。
 *
 * 与 lifecycle.getRoomThreats 的区别：
 *   - getRoomThreats 返回 body-aware 过滤后的"有威胁"单位（ATTACK/RANGED/HEAL 等），
 *     供 flee 决策使用——无攻击能力的 reserver 不触发 flee。
 *   - 本函数返回所有非联盟的 hostile creep，供 remote-defender 使用——
 *     defender 需要击杀 NPC reserver（纯 CLAIM body）释放 source 占位，
 *     reserver 无威胁 body 但仍是 defender 的合法目标。
 *
 * 缓存生命周期：单 tick，globalCache 自动重置。
 * 同房多 defender 共享同一数组引用，避免每只 defender 每 tick 全房 find。
 *
 * 缓存数组在 tick 内不变——hostile 死亡当 tick 仍会被选中一次，
 * `creep.attack` 返回 ERR_INVALID_TARGET 由现有错误容忍处理。无行为回归。
 */
export function getHostilesCached(room: Room): Creep[] {
  const g = globalCache() as { __hostilesCache?: Record<string, { tick: number; creeps: Creep[] }> };
  if (!g.__hostilesCache) g.__hostilesCache = {};
  const cached = g.__hostilesCache[room.name];
  if (cached && cached.tick === Game.time) {
    return cached.creeps;
  }
  const allies = CONFIG.defense.allies;
  const hostiles = room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) => !allies.includes(c.owner.username),
  });
  g.__hostilesCache[room.name] = { tick: Game.time, creeps: hostiles };
  return hostiles;
}

/** 获取或分配 creep 的 source。将 sourceId 存入 memory。 */
export function getSource(creep: Creep, snapshot: RoomSnapshot): Source | undefined {
  // 先尝试缓存的 source。
  if (creep.memory.sourceId) {
    const source = getObjectById(creep.memory.sourceId);
    if (source) {
      // 拥挤检测：如果当前 source 占用超过公平份额，且存在更空闲的 source，则重分配。
      // 公平份额 = ceil(总占用 / source 数量)。例如 2 harvester + 2 source → 每个最多 1。
      if (snapshot.sources.length > 1) {
        const myCount = snapshot.sourceOccupancy.get(source.id) ?? 0;
        let totalOccupancy = 0;
        let minCount = Infinity;
        for (const s of snapshot.sources) {
          const c = snapshot.sourceOccupancy.get(s.id) ?? 0;
          totalOccupancy += c;
          if (c < minCount) minCount = c;
        }
        const fairShare = Math.ceil(totalOccupancy / snapshot.sources.length);
        // 当前 source 超过公平份额 且 存在更空闲的 source → 迁移。
        if (myCount > fairShare && minCount < myCount) {
          creep.memory.sourceId = undefined;
          // 落入下方重分配逻辑。
        } else {
          return source;
        }
      } else {
        return source;
      }
    } else {
      // source 消失 — 清除并重新分配。
      creep.memory.sourceId = undefined;
    }
  }

  // 使用快照数据分配占用最少的 source（无需全局扫描）。
  // B-4 平局去偏置：sourceOccupancy 只统计采矿角色（harvester/worker），
  // builder/upgrader 直采互相不可见 — 占用计数恒平局时旧实现的严格小于
  // 比较永远选中 sources[0]，全员涌向同一 source 排队。
  // 以 creep 名哈希决定遍历起点：平局时各 creep 稳定散布到不同 source
  // （同一 creep 每 tick 起点一致，不抖动）；占用有差异时仍选最空者。
  // 刻意不把非采矿角色计入占用表 — room-state 的 harvesterCount 直接对
  // 占用表求和，扩表会虚增采集编制、掩盖真实 bootstrap 信号。
  let nameHash = 0;
  for (let i = 0; i < creep.name.length; i++) {
    nameHash = (nameHash * 31 + creep.name.charCodeAt(i)) | 0;
  }
  const sourceCount = snapshot.sources.length;
  const offset = sourceCount > 0 ? Math.abs(nameHash) % sourceCount : 0;
  let best: Source | undefined;
  let bestCount = Infinity;
  for (let i = 0; i < sourceCount; i++) {
    const source = snapshot.sources[(offset + i) % sourceCount]!;
    const count = snapshot.sourceOccupancy.get(source.id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = source;
    }
  }

  if (best) {
    creep.memory.sourceId = best.id;
  }
  return best;
}

/**
 * 查找最近的需能量结构（有空闲容量的 spawn 或 extension）。
 * 使用引擎原生 findClosestByRange 替代手动迭代。
 */
export function getFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;
  return creep.pos.findClosestByRange(snapshot.fillTargets as AnyOwnedStructure[]) ?? undefined;
}

/** 可被 hauler 填充的结构类型。 */
export type FillTarget = StructureSpawn | StructureExtension | StructureTower | StructureContainer;

/**
 * Hauler 填充目标的优先级层级（threat 感知）。
 *
 * 返回有序的类型桶 — 调用者按序遍历，第一个有匹配的桶中取最近目标。
 * threat 存在时 tower 提升到最高优先（防御弹药是生存关键）。
 * 末尾空桶匹配所有剩余类型（回退兜底）。
 *
 * 注意：controller container 的特殊优先级（< 半满时插队）
 * 由 getHaulFillTarget 在调用此函数之前自行处理，不包含在此通用层级中 —
 * flee 场景不需要补给 controller container（非生存关键）。
 */
export function haulerFillTiers(
  hasThreats: boolean,
): readonly (readonly string[])[] {
  return hasThreats
    ? [[STRUCTURE_TOWER], [STRUCTURE_SPAWN, STRUCTURE_EXTENSION], []]
    : [[STRUCTURE_SPAWN, STRUCTURE_EXTENSION], [STRUCTURE_TOWER], []];
}

/** 在 targets 中找最近的「未预约」目标；给定 types 时仅在这些结构类型中挑选。 */
function pickFillTarget(
  creep: Creep,
  targets: readonly FillTarget[],
  reserved: Set<string>,
  types?: readonly string[],
): FillTarget | undefined {
  const pool = targets.filter(
    s => !reserved.has(s.id) && (types === undefined || types.includes(s.structureType)),
  );
  if (pool.length === 0) return undefined;
  return creep.pos.findClosestByRange(pool) ?? undefined;
}

/**
 * Hauler 专用的填充目标选择 — 带优先级与每 tick 预约去重。
 *
 * 老玩家填充优先级：
 *   0. controller container 低于半满时优先补 1 个 hauler（站桩升级供能核心，远离核心区易饿死）。
 *   1. spawn / extension —— 孵化引擎，断能即停产，最高优先。
 *   2. tower —— 防御/维修，次之。
 *   3. 其余（如非紧急的 controller container）。
 * 同级取最近未预约者；预约集合按 tick 惰性重置，避免多 hauler 抢同一目标互相堵位。
 * 所有目标都被预约时回退到最近目标（允许共享），避免死锁。
 */
export function getHaulFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;

  const g = globalCache();
  if (!g.fillReservations || g.fillReservationTick !== Game.time) {
    g.fillReservations = new Set();
    g.fillReservationTick = Game.time;
  }
  const reserved = g.fillReservations;

  const hasThreats = snapshot.threatCreeps.length > 0;

  // P1-3: 威胁存在时 tower 提升到最高优先级 — 防御弹药是生存关键。
  // tower 每次攻击消耗 10 能量，hauler 必须在威胁期间优先补给 tower 保持防御火力。
  if (hasThreats) {
    const tower = pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_TOWER]);
    if (tower) {
      reserved.add(tower.id);
      return tower as unknown as AnyOwnedStructure;
    }
  }

  // 0. 站桩升级保障：controller container 低于半满时优先派一个 hauler 补给。
  const cc = snapshot.controllerContainer;
  if (
    cc &&
    cc.store.getFreeCapacity(RESOURCE_ENERGY) > cc.store.getUsedCapacity(RESOURCE_ENERGY) &&
    !reserved.has(cc.id)
  ) {
    reserved.add(cc.id);
    return cc as unknown as AnyOwnedStructure;
  }

  // 1→2→3 按 haulerFillTiers 优先级层级遍历（与 flee 逻辑共享同一层级定义）。
  // threat 时首个 [TOWER] 层级已在上方处理，此处为冗余遍历但无副作用 —
  // 已预留的 tower 会被 pickFillTarget 的 reserved 过滤排除。
  for (const types of haulerFillTiers(hasThreats)) {
    const target = pickFillTarget(
      creep,
      snapshot.fillTargets,
      reserved,
      types.length > 0 ? types : undefined,
    );
    if (target) {
      reserved.add(target.id);
      return target as unknown as AnyOwnedStructure;
    }
  }

  // 全部已预约 — 回退最近目标（允许共享）避免死锁。
  return (creep.pos.findClosestByRange(snapshot.fillTargets as FillTarget[]) ?? undefined) as
    | AnyOwnedStructure
    | undefined;
}

/**
 * Distributor 水位分级档位。
 *
 * 由 distributor gate 每 tick 根据 storage 水位计算并写入 creep.memory.distributorTier。
 * getDistributorFillTarget 读取该值过滤目标类型，withdrawStorageForDistribution 读取该值限制取能量。
 *
 * 档位定义（阈值见 CONFIG.economy.distributorTiers，绝对能量值）：
 *   0 — 库存 ≥ full(50k)：满载取能，所有 fillTarget 正常服务
 *   1 — 库存 ≥ sustained(10k)：满载取能，仅服务 spawn/extension（跳过 tower）
 *   2 — 库存 ≥ low(2k)：限取 400/tick，仅服务 spawn/extension
 *   3 — 库存 < low(2k)：限取 200/tick，仅服务 spawn/extension
 *
 * spawn 与 extension 在所有档位都同池服务：extension 里的能量只能被
 * spawnCreep 消费，与 spawn 本体同属孵化能量池 — 把能量从 storage 挪到
 * extension 不是消耗，只是换口袋。曾经 tier 3 排除 extension，导致
 * energyAvailable 被锁死在 spawn 容量上限 → 成本超限的 body 永不孵化 →
 * 采集编制萎缩 → storage 持续低水位 → tier 3 永续的自锁吸收态。
 * 低水位的真正节流手段是取能限额（200/tick），不是目标类型裁剪。
 */
export type DistributorTier = 0 | 1 | 2 | 3;

/**
 * 根据 storage 库存的**绝对能量值**计算 distributor 调度档位。
 *
 * 刻度口径（曾经的教训）：不能用 energy/capacity 比例 — storage 总容量
 * 1,000,000，比例 10% = 10 万能量，发展期房间（库存数百到数万）永久卡在
 * 最低档，extension 长期断供。绝对阈值来自
 * CONFIG.economy.distributorTiers，与 upgrade 调度（sprintStorage/
 * sustainedStorage）同一参照系。
 *
 * 边界不加迟滞：tier 只影响单车取量与目标类型，抖动代价小
 * （不像 colonyState 有全房爆炸半径），不值得引入驻留状态。
 * 无 storage 时返回 0（不限制）。
 */
export function computeDistributorTier(storage: StructureStorage | undefined): DistributorTier {
  if (!storage) return 0;
  const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);
  const tiers = CONFIG.economy.distributorTiers;
  if (energy >= tiers.full) return 0;
  if (energy >= tiers.sustained) return 1;
  if (energy >= tiers.low) return 2;
  return 3;
}

/**
 * controller 旁的 link 若存在且缺能（有空位）则返回它，否则 undefined。
 * 「缺能」= 需要 link 网络灌能供升级 —— 是 storage→storage-link→controller-link
 * 灌能链（②b）与 hauler 排空守卫的共同判据。
 */
export function controllerLinkNeedingEnergy(snapshot: RoomSnapshot): StructureLink | undefined {
  const ctrl = snapshot.controller;
  if (!ctrl) return undefined;
  const ctrlLink = snapshot.links.find(l => l.pos.getRangeTo(ctrl) <= 2);
  if (ctrlLink && ctrlLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return ctrlLink;
  return undefined;
}

/**
 * storage 旁、有空位、且不是 controller-link 本身的 link（storage-link 中转）。
 * 作为 distributor 把 storage 能量灌入、经 link-system 规则3 送达 controller-link
 * 的中转点。`exclude` 排除 controller-link（防同一 link 既当源又当目标的退化）。
 */
export function storageLinkForControllerFeed(
  snapshot: RoomSnapshot,
  exclude: StructureLink,
): StructureLink | undefined {
  const st = snapshot.storage;
  if (!st) return undefined;
  return snapshot.links.find(
    l => l.id !== exclude.id &&
      l.pos.getRangeTo(st) <= 2 &&
      l.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  );
}

/**
 * Distributor 专用的填充目标选择 — 与 hauler 的 getHaulFillTarget 职责分离。
 *
 * 角色边界（修复角色错配）：
 *   distributor 的职责是 storage → 生产 sink。spawn/extension 是生产引擎，
 *   断能即停产 = 全盘崩溃，是绝对最高优先——即使敌袭期间也不让位 tower，
 *   因为 spawn 没能量就产不出防御 creep，等于釜底抽薪。
 *
 *   旧实现复用 hauler 专用的 getHaulFillTarget，其 #0 优先是 controller container
 *   （< 半满即派），导致 distributor 被持续 divert 去喂升级无底洞，spawn/extension
 *   长期排第二；且与 link 网络的 source/storage→controller 供能冗余，形成
 *   storage→distributor→controller container 的回流环路。本函数根治该错配。
 *
 * 优先级：
 *   1. spawn / extension —— 生产引擎，绝对最高（威胁下也不让位），所有档位服务。
 *   2. tower —— 防御/维修（tier >= 1 时跳过，保护低水位储备）。
 *   3. controller container —— 仅当房间无 controller link 时兜底（RCL4 有 storage 但
 *      link 未建成的窗口期）。有 controller link 时由 link 网络独占供能（零通勤），
 *      distributor 完全不碰，避免冗余回流。
 *
 * 同级取最近未预约者；预约集合与 hauler 共享（fillReservations，按 tick 惰性重置），
 * 避免 distributor 与 hauler 抢同一目标。所有目标都被预约时回退最近目标避免死锁。
 *
 * @param tier distributor 水位档位，控制允许填充的结构类型范围。
 */
export function getDistributorFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
  tier: DistributorTier = 0,
): AnyOwnedStructure | undefined {
  // 早退：无常规 fill 目标「且」无 storage-link→controller-link 灌能机会时才无事可做。
  // storage-link 灌能不在 fillTargets 池内（link 非 FillTarget），若只看 fillTargets，
  // spawn/ext/cc 全满时会误判无事可做而跳过升级链灌能（②b）。短路：fillTargets 非空
  // 时不额外计算 link 判据。
  if (snapshot.fillTargets.length === 0 && !controllerLinkNeedingEnergy(snapshot)) return undefined;

  const g = globalCache();
  if (!g.fillReservations || g.fillReservationTick !== Game.time) {
    g.fillReservations = new Set();
    g.fillReservationTick = Game.time;
  }
  const reserved = g.fillReservations;

  // spawn/extension 是同一孵化能量池，所有档位都完整服务 —
  // 低水位的节流由取能限额（withdrawStorageForDistribution）承担。
  const spawnTypes: string[] = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION];

  // 1. spawn / extension —— 生产引擎，最高优先。
  const primary = pickFillTarget(creep, snapshot.fillTargets, reserved, spawnTypes);
  if (primary) {
    reserved.add(primary.id);
    return primary as unknown as AnyOwnedStructure;
  }

  // 2. tower —— 威慑资产，平时必须有弹。
  //    tier 0：补满；tier 1-2：只补低于战备线（towerAmmoFloor）的塔 —
  //    战后弹药真空不能等 storage 攒到 full 才解除（发展期房间可能长期 < 50k，
  //    「只在威胁在场时反应式补弹」意味着下次袭击的前几十 tick 塔是哑的）；
  //    tier 3（< low）：生存优先，跳过。触发线语义保证低水位投入有上界。
  if (tier < 3) {
    const ammoFloor = CONFIG.economy.distributorTiers.towerAmmoFloor;
    const towerPool = tier < 1
      ? snapshot.fillTargets
      : (snapshot.fillTargets as FillTarget[]).filter(
          t => t.structureType !== STRUCTURE_TOWER ||
            t.store.getUsedCapacity(RESOURCE_ENERGY) < ammoFloor,
        );
    const tower = pickFillTarget(creep, towerPool, reserved, [STRUCTURE_TOWER]);
    if (tower) {
      reserved.add(tower.id);
      return tower as unknown as AnyOwnedStructure;
    }
  }

  // 3. storage link 灌能 → controller link（RCL6+ 0 通勤升级链的灌能侧）。
  //    controller link 缺能时，distributor 从 storage 把能量灌入紧邻 storage 的
  //    storage link（仅 1 格），link-system 规则3 免费瞬移到 controller link，
  //    upgrader 站桩取能。这取代 distributor 长途搬 cc（18 格），是 link 网络正道：
  //    1 格存能 vs 18 格往返，CPU/运力都远优。tier<2 与 cc 兜底同档。
  //    排在 cc 之前：有 storage link 时优先走 link 路，cc 仅在无 storage link
  //    （RCL5 仅 2 link）或 storage link 暂满时兜底。
  if (tier < 2) {
    const ctrlLink = controllerLinkNeedingEnergy(snapshot);
    if (ctrlLink) {
      const storageLink = storageLinkForControllerFeed(snapshot, ctrlLink);
      if (storageLink && !reserved.has(storageLink.id)) {
        reserved.add(storageLink.id);
        return storageLink as unknown as AnyOwnedStructure;
      }
    }
  }

  // 4. controller container 兜底 —— 仅当无「正在供能的」controller link 时。
  //    档位与 upgrader 调度对齐（tier < 2 ⇔ storage ≥ sustained）：
  //    upgrade.sustainedStorage 允许养 upgrader 的水位，就必须允许给它的
  //    供能站送能 — 否则两套水位裁决互相矛盾，cc 沦为死资产、
  //    upgrader 退化为往返 storage 限量取能（站桩 0 通勤设计失效）。
  //    判据用「link 在场且有能量」而非仅「在场」：link 网络未通（持续空、
  //    harvester 站位喂不进 / storage 未灌 link）时，distributor 必须接管 cc，
  //    否则「link 在场 → distributor 撒手 → link 又没通 → upgrader 半饿」。
  //    link 真在供能时它 tick 内多有能量，distributor 自然让位（cc 被 upgrader
  //    优先从 link 取而不降 → cc 满 → 本兜底无空位可填）。

  if (tier < 2) {
    const controllerLinkServing =
      snapshot.controller != null &&
      snapshot.links.some(l =>
        l.pos.getRangeTo(snapshot.controller!) <= 2 &&
        l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    if (!controllerLinkServing) {
      const cc = snapshot.controllerContainer;
      if (cc && !reserved.has(cc.id) && cc.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        reserved.add(cc.id);
        return cc as unknown as AnyOwnedStructure;
      }
    }
  }

  // 全部已预约 — 回退最近目标（允许共享）避免死锁，但须符合 tier 类型约束。
  const fallbackAmmoFloor = CONFIG.economy.distributorTiers.towerAmmoFloor;
  const fallbackPool = (snapshot.fillTargets as FillTarget[]).filter(t => {
    if (tier < 1) return true;
    if (t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION) return true;
    // tier 1-2 的 tower 战备线口径与主路径一致。
    return tier < 3 &&
      t.structureType === STRUCTURE_TOWER &&
      t.store.getUsedCapacity(RESOURCE_ENERGY) < fallbackAmmoFloor;
  });
  return (creep.pos.findClosestByRange(fallbackPool) ?? undefined) as
    | AnyOwnedStructure
    | undefined;
}

/**
 * 判断当前水位档位下 distributor 是否存在可服务的填充需求。
 *
 * 供取能门禁使用 — 取能与投放必须用同一套目标口径：
 * 若门禁只看未过滤的 fillTargets（如仅剩 tower 需求但档位跳过 tower），
 * distributor 会为它拒绝服务的目标取能，随后携能 idle，能量滞留在背包里。
 *
 * 判定与 getDistributorFillTarget 的过滤规则一一对应（不含预约状态 —
 * 门禁关心的是需求存在性，预约只是同 tick 内的分工去重）。
 */
export function hasDistributorFillDemand(snapshot: RoomSnapshot, tier: DistributorTier): boolean {
  // spawn/extension：所有档位都服务。
  if (
    snapshot.fillTargets.some(
      t => t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION,
    )
  ) {
    return true;
  }

  // tower：tier 0 补满口径，tier 1-2 战备线口径（低于 towerAmmoFloor 才算需求），
  // tier 3 不服务 — 与 getDistributorFillTarget 的过滤规则逐条对应。
  if (tier < 3) {
    const ammoFloor = CONFIG.economy.distributorTiers.towerAmmoFloor;
    const towerDemand = snapshot.fillTargets.some(
      t => t.structureType === STRUCTURE_TOWER &&
        (tier < 1 || t.store.getUsedCapacity(RESOURCE_ENERGY) < ammoFloor),
    );
    if (towerDemand) return true;
  }

  // storage link 灌能 → controller link 需求（RCL6+ link 升级链，与投放分支对应）。
  if (tier < 2) {
    const ctrlLink = controllerLinkNeedingEnergy(snapshot);
    if (ctrlLink && storageLinkForControllerFeed(snapshot, ctrlLink)) return true;
  }

  // controller container 兜底：tier < 2（与 upgrader 的 sustainedStorage 调度对齐）
  // 且无「正在供能的」controller link 时（link 网络未通则 distributor 接管，见上方注释）。
  if (tier < 2) {
    const controllerLinkServing =
      snapshot.controller != null &&
      snapshot.links.some(l =>
        l.pos.getRangeTo(snapshot.controller!) <= 2 &&
        l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    if (!controllerLinkServing) {
      const cc = snapshot.controllerContainer;
      if (cc && cc.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return true;
    }
  }
  return false;
}

/**
 * 在 spawn 安全区内、按 hauler 填充优先级选择最近的需能量结构。
 *
 * 供 flee 等特殊场景使用 — 与 getHaulFillTarget 共享优先级层级（haulerFillTiers），
 * 但不使用预约系统（flee 是临时行为，不应消耗正常 hauler 的预约配额），
 * 且增加空间约束（仅选择 spawnPos safeRange 范围内的结构）。
 *
 * 不包含 controller container 优先级 — flee 是生存行为，
 * controller container 供能是效率行为，不应在威胁期间占优先。
 */
export function pickHaulFillTargetInRange(
  creep: Creep,
  snapshot: RoomSnapshot,
  spawnPos: RoomPosition,
  safeRange: number,
): FillTarget | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;

  const hasThreats = snapshot.threatCreeps.length > 0;
  for (const types of haulerFillTiers(hasThreats)) {
    let best: FillTarget | undefined;
    let bestDist = Infinity;
    for (const t of snapshot.fillTargets) {
      if (types.length > 0 && !types.includes(t.structureType)) continue;
      if (t.pos.getRangeTo(spawnPos) > safeRange) continue;
      const d = creep.pos.getRangeTo(t.pos);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best) return best;
  }
  return undefined;
}

/**
 * hauler 取能 container 选择：在「满溢程度 vs 取货距离」间权衡，防止羊群偏置。
 *
 * 旧实现 findRichestContainer 纯选最满：两侧 source container 同为满仓（2000）时
 * 严格大于比较恒选数组首个 → 所有空载 hauler 每趟都涌向同一个 container，另一侧
 * 持续溢出无人疏解（线上实测：一侧 container 满溢地面堆积 5000+，hauler 全挤对侧）。
 *
 * score = energy − dist × HAUL_CONTAINER_DISTANCE_WEIGHT：
 *   - 越满的 container 越该优先疏解（防溢出，能量项主导）；
 *   - 越近成本越低（距离项微调，避免舍近求远空跑）；
 *   - 权重远小于满仓能量差，仅在满溢程度接近时由距离打破平局，实现两侧自然分流。
 * 平局（score 相同，如两侧同为满仓且等距）时用 creep 名哈希散布，避免全员选同一个
 * （参照 getSource 的 B-4 去偏置手法）。
 */
export function selectHaulSourceContainer(
  creep: Creep,
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestScore = -Infinity;
  // 名字哈希决定遍历起点：平局时各 creep 稳定散布到不同 container（同一 creep 每 tick 一致）。
  let nameHash = 0;
  for (let i = 0; i < creep.name.length; i++) {
    nameHash = (nameHash * 31 + creep.name.charCodeAt(i)) | 0;
  }
  const n = containers.length;
  if (n === 0) return undefined;
  const offset = Math.abs(nameHash) % n;
  for (let i = 0; i < n; i++) {
    const c = containers[(offset + i) % n]!;
    const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energy <= 0) continue;
    const score = energy - creep.pos.getRangeTo(c) * HAUL_CONTAINER_DISTANCE_WEIGHT;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** 找到能量最多的 container。 */
export function findRichestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestEnergy = 0;
  for (const c of containers) {
    const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = c;
    }
  }
  return best;
}

/**
 * 找到距离 creep 最近且含有能量的 container。
 * 用于 builder 等需要在远处工地与能量源之间通勤的角色 — 选最近的能量源
 * 而非最满的，可显著缩短取能行走距离，提升建造 duty cycle。
 */
export function findClosestContainerWithEnergy(
  creep: Creep,
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestDist = Infinity;
  for (const c of containers) {
    if (c.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) continue;
    const d = creep.pos.getRangeTo(c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** 找到空闲容量最大的 container。 */
export function findEmptiestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestFree = 0;
  for (const c of containers) {
    const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
    if (free > bestFree) {
      bestFree = free;
      best = c;
    }
  }
  return best;
}

/**
 * 选择下一个要拾取的掉落能量堆（考虑拾取范围、衰减与堆大小）。
 *
 * 游戏机制：pickup 需相邻（range ≤ 1），每 tick 只能拾取一堆；掉落能量按
 * ceil(amount/1000)/tick 衰减，堆越大衰减越快（绝对损失越大）。因此：
 *   - 若身边（range ≤ 1）有可拾取的堆，优先拾取能量最多的一堆
 *     （先拿大堆，减少剩余堆的衰减损耗）。
 *   - 否则在「大小 vs 取货成本」间权衡：score = amount − dist × DROP_DISTANCE_WEIGHT。
 *     纯最近（旧实现）会让多个 hauler 被身边小堆反复截胡、涌向同一侧，冷落
 *     另一侧持续溢出的大堆（线上实测：一侧 container 满溢地面堆积 7000+ 无人问津，
 *     另一侧 3 hauler 抢几十能量的小堆）。按抢救价值加权后，远处大堆的吸引力
 *     压过近处小堆，hauler 自然被拉向溢出最严重处，两侧自平衡。
 * “未装满则继续拾取”的跨 tick 循环由 FSM（updateMode：free>0 时保持 acquire）保证。
 */
export function selectDroppedEnergy(
  creep: Creep,
  dropped: readonly Resource[],
): Resource | undefined {
  if (dropped.length === 0) return undefined;

  // 优先拾取身边（range ≤ 1）能量最多的一堆。
  let richestAdjacent: Resource | undefined;
  for (const r of dropped) {
    if (creep.pos.getRangeTo(r) > 1) continue;
    if (!richestAdjacent || r.amount > richestAdjacent.amount) {
      richestAdjacent = r;
    }
  }
  if (richestAdjacent) return richestAdjacent;

  // 身边无可拾取 — 在「堆大小 vs 取货距离」间权衡选最高抢救价值者。
  // DROP_DISTANCE_WEIGHT：每格距离折算的能量机会成本（往返运力代价）。
  // 大堆即使稍远也优先，避免多 hauler 被近处小堆截胡而冷落远处溢出大堆。
  let best: Resource | undefined;
  let bestScore = -Infinity;
  for (const r of dropped) {
    const score = r.amount - creep.pos.getRangeTo(r) * DROP_DISTANCE_WEIGHT;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/**
 * 查找紧急维修目标：血量低于 50% 的 spawn/extension/tower/container。
 * 优先使用快照预计算的 criticalRepairTarget（零重复迭代）；
 * 快照未提供时回退到实时遍历（向后兼容）。
 */
export function findCriticalRepair(
  snapshot: RoomSnapshot,
): AnyStructure | undefined {
  if (snapshot.criticalRepairTarget !== undefined) {
    return snapshot.criticalRepairTarget;
  }
  // 回退路径：快照未预计算时实时遍历。
  const groups: readonly (readonly AnyStructure[])[] = [
    snapshot.spawns,
    snapshot.extensions,
    snapshot.towers,
    snapshot.containers,
  ];
  for (const group of groups) {
    for (const s of group) {
      if (s.hits < s.hitsMax * 0.5) {
        return s;
      }
    }
  }
  return undefined;
}
