/** 远矿道路与工地 — container site 收编、路径修路规划、阻断墙检测、道路覆盖率。 */
import { CONFIG } from "../../config";
import type { TickContext } from "../../kernel/contracts";
import {
  querySquad,
  bumpRemoteOpLedger,
  roadBuildCounters,
  globalCache,
} from "../../kernel/global-cache";
import { getRemoteSiteTotal, getRemoteRoadSiteTotal, getTickSiteCounters } from "../site-quota";
import { recycleRemoteDismantlers } from "./creep-recycle";
import { structureCost } from "./op-lifecycle";

/**
 * 远矿 container site 收编 — 消费 remoteHarvester 的 needContainer 申请标记。

 * 职责（每 managerInterval tick 运行一次）：
 *   1. **siteCount 实测校正**：用 room.find 统计该房现存 container
 *      construction site 数，写回 op.siteCount — site 建成（变结构）/被移除/失效时
 *      递减，防只增不减永久占满 maxNormalLaneSites 饿死自有房重建。
 *   2. **消费申请**：收集 needContainer=true 的 remoteHarvester，按 source 分组处理。
 *   3. **配额仲裁**：远矿 site 永远让位自有房 emergency（emergency > 0 → 跳过）；
 *      normal 槽位与 construction-manager 公平竞争（normal > 0 → 跳过）；
 *      总量 ctx.globalSiteCount + remoteSiteTotal < maxNormalLaneSites。
 *   4. **创建 site**：在站桩位 creep 脚下创建 container site，成功后清标记 +
 *      递增 siteCount + 标记 normal 槽位已用；失败写 containerSiteCooldown 防重试。

 * 回收：远矿 site 的孤儿清扫复用 construction-manager 的 cleanOrphanConstructionSites
 * （abandoned 房不在 computeSiteKeepRooms 保留集，低频被 remove）— 不新增第二条删除路径。

 * @internal 导出仅供单元测试 — 业务代码唯一入口是 remoteMiningManagerSystem.run。
 */
export function fulfillContainerRequests(
  remoteOps: Record<string, RemoteOp>,
  ctx: TickContext,
  homeRoom: string,
): void {
  const counters = getTickSiteCounters();

  // 申请者收集提到 per-room 循环外，单遍按 remoteTarget 分桶。
  // R 个 active 远矿房原本需 R 次全量 Game.creeps 遍历（O(R×M)），
  // 提桶后降为 O(M) 一次。managerInterval 低频，但多远矿房时仍是可见节流。
  const requestingByRemote = new Map<string, Creep[]>();
  for (const entry of querySquad({ home: homeRoom })) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;
    if (!creep.memory.needContainer) continue;
    const target = creep.memory.remoteTarget;
    if (!target) continue;
    const sid = creep.memory.sourceId as string | undefined;
    if (!sid) continue;
    let arr = requestingByRemote.get(target);
    if (!arr) {
      arr = [];
      requestingByRemote.set(target, arr);
    }
    arr.push(creep);
  }

  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[roomName];
    if (!room) continue; // 无视野，无法校正也无法创建。

    // 1. siteCount 实测校正 — 同时收集每个 site 附近 source（R2）。
    //    旧实现"actualSites > 0 即清全部 source 组申请标记"，多源远矿房中
    //    A 源建成会一并清 B 源申请 → B 源 creep 等不到 site；A 源 site 成孤儿时
    //    B 被一并阻塞至 orphan sweep 清场。收窄到"已有 site 的 source 组"。
    const sites = room.find(FIND_CONSTRUCTION_SITES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER,
    });
    op.siteCount = sites.length;

    const sourcesWithSite = new Set<string>();
    if (sites.length > 0) {
      const sources = room.find(FIND_SOURCES);
      for (const site of sites) {
        for (const src of sources) {
          if (site.pos.getRangeTo(src) <= 1) {
            sourcesWithSite.add(src.id);
          }
        }
      }
    }

    // 2. 取本房申请者，按 sourceId 二次分组。
    const candidates = requestingByRemote.get(roomName) ?? [];
    const requestingBySource = new Map<string, Creep[]>();
    for (const creep of candidates) {
      const sid = creep.memory.sourceId as string | undefined;
      if (!sid) continue;
      let group = requestingBySource.get(sid);
      if (!group) {
        group = [];
        requestingBySource.set(sid, group);
      }
      group.push(creep);
    }

    // 3. 已有 site 的 source 组 → 清除该组申请标记（site 存在即申请已 fulfilled，
    //    build 路径接管）并从 pending Map 移除。无 site 的 source 组申请标记保留。
    for (const sid of sourcesWithSite) {
      const group = requestingBySource.get(sid);
      if (group) {
        for (const creep of group) creep.memory.needContainer = false;
        requestingBySource.delete(sid);
      }
    }

    // 4. 无 pending 申请 → 跳过（所有 source 都已有 site 或本就无申请）。
    if (requestingBySource.size === 0) continue;

    // 5. tick 配额仲裁：远矿让位 emergency（自有房紧急重建优先）；normal 槽位公平竞争。
    if (counters.emergency > 0) continue;
    if (!counters.canCreateNormal) continue;

    // 6. 总量判定：自有房 site + 远矿 site < maxNormalLaneSites。
    const remoteTotal = getRemoteSiteTotal();
    if (ctx.globalSiteCount + remoteTotal >= CONFIG.construction.maxNormalLaneSites) continue;

    // 7. 处理第一个有效申请（找到站桩位 creep 创建 site）。
    let fulfilled = false;
    for (const [sid, group] of requestingBySource) {
      // 防御性跳过：该 source 已有 site（step 3 应已 delete，但 Set 校验双保险）。
      if (sourcesWithSite.has(sid)) continue;
      const source = Game.getObjectById(sid as Id<Source>);
      if (!source) continue;
      // 找到在 source 旁 1 格内的 creep（站桩位 = container 位）。
      const positioned = group.find(c => c.pos.getRangeTo(source) <= 1);
      if (!positioned) continue;

      const result = room.createConstructionSite(positioned.pos, STRUCTURE_CONTAINER);
      if (result === OK) {
        // 成功：递增 siteCount（校正值已为 0，直接设 1）、标记 normal 槽位。
        op.siteCount = 1;
        counters.markNormal();
        fulfilled = true;
        // container 是这条远矿线的基建投入，记到 op 名下（净营收须扣除）。
        bumpRemoteOpLedger(homeRoom, roomName, "infraCost", structureCost(STRUCTURE_CONTAINER));
      } else {
        // 持久失败（ERR_FULL / ERR_INVALID_TARGET）：写冷却让 resolve 放行 dropEnergy。
        for (const c of group) c.memory.containerSiteCooldown = Game.time + 100;
      }
      // 无论成功失败，清除该 source 组的申请标记（防重复申请）。
      for (const c of group) c.memory.needContainer = false;
      break; // 每 tick 每房最多处理 1 个 source（tick 配额已由 counters 限制全局 1 个）。
    }

    // 如果本房成功创建，后续房让出 normal 槽位（counters.canCreateNormal 已变 false）。
    if (fulfilled) break;
  }
}

/** 通勤 hauler 的建路半径 — buildRoadSiteUnderfoot 只 build range<4 的最近 site。 */
const BUILD_EVIDENCE_RANGE = 3;

/** 格子的切比雪夫距离判据：与 evidence 集合中任一格 range≤BUILD_EVIDENCE_RANGE 即为 true。 */
function nearEvidence(keys: ReadonlySet<string>, a: { x: number; y: number }): boolean {
  for (const key of keys) {
    const comma = key.indexOf(",");
    const x = +key.slice(0, comma);
    const y = +key.slice(comma + 1);
    if (Math.abs(x - a.x) <= BUILD_EVIDENCE_RANGE && Math.abs(y - a.y) <= BUILD_EVIDENCE_RANGE) {
      return true;
    }
  }
  return false;
}

/**
 * 远矿修路规划器 —— 每次运行对每个 active op：把**本次进程实测被踩过**的通勤格按热度降序
 * 限速下 road site；零进度又不在被走过的那条线上的残骸当场回收，把车道还出来。
 * 施工不归本函数：通勤 hauler 经 buildRoadSiteUnderfoot 边走边建（range≤3）。
 * 全部 site 写在远矿房（本系统是远矿房唯一 site 写者，架构合规）。
 *
 * 为什么不再用「home 锚 → container 的 PathFinder 预测线」下 site（2026-09-28 换掉）：
 * 预测线用纯地形代价，而 creep 真正出境用的是 moveTowardRoom 的 findClosestByRange(exitDir)
 * 加堆栈粘性出口缓存 —— 谁先把缓存打冷，全房对就用谁的落点；两条线在边界处能差十几格。
 * 而施工只能「脚下」发生，铺在无人走的线上的 site 永远不会建成，只会永久占着
 * roadSitesPerOpTotal 车道并触发 E7 siteStale。线上量到的正是这个形状：W36S58 挂 14 格 site、
 * 进度和 970、建成 0，而通勤腿到最近 site 的距离「6-10 格 / 11+ 格」占 18/22
 * （建路账本，见 domain/logistics/road-build）。
 *
 * 上一版为此加过「紧邻已有结构 / 已建 site 才算证据」的闸，但它**自证**：site 就下在
 * container 旁边 ⇒ 天然"有证据"，既建不成也扫不掉，14 格就这么挂着。所以现在的证据只有一个
 * 来源 —— 被踩过的格子本身。稳态是每轮 0 次 remove、0 次新建，直到通勤线再次推进。
 *
 * 冷启动（本次进程还没有热度）既不建也不扫：无从知道哪条线被走过时，"猜一条线"恰恰是上面
 * 那 14 格的成因；而通勤腿会在几小时内把热度重新铺出来，这不是永久停摆。
 */
export function planRemotePathRoads(
  homeRoom: string,
  remoteOps: Readonly<Record<string, RemoteOp>>,
  _ctx: TickContext,
): void {
  if (!Game.rooms[homeRoom]) return;
  // 独立预算车道：远矿路径 road 不占 maxNormalLaneSites（自有房常规工地帽会被
  // lab/rampart 长周期大活顶满，道路基建被无限饿死 —— 线上实证 maxNormalLaneSites=7
  // 全被占用）。上限 = 全帝国待建 road ≤ roadSitesPerOpTotal。求和口径必须跨主房：
  // 旧实现在这段 per-home 调用里用 room.find 自行累加本主房的 op，于是 20 的帽实际
  // 是 20×主房数 —— 名义全局、实为每房（详见 getRemoteRoadSiteTotal）。
  const roadBudget = getRemoteRoadSiteTotal();
  let created = 0;
  // 本轮清扫释放的车道额度 — roadBudget 是 tick 入口的快照（per-tick 缓存），不减掉
  // 刚 remove 的残骸会让「被自己的残骸锁死」这条路径多等一个 manager 间隔才解开。
  let released = 0;
  for (const [rn, op] of Object.entries(remoteOps)) {
    if (created >= CONFIG.remote.roadSitesPerRun) return;
    // 车道已满不是跳过本房的理由 —— 残骸正占着车道，越满越要先扫。预算判定挪到清扫之后。
    if (op.state === "abandoned") {
      // 废弃房的 site 由 construction-manager 孤儿清扫收走，计数立即归零释放车道。
      if (op.roadSiteCount !== 0) op.roadSiteCount = 0;
      continue;
    }
    const room = Game.rooms[rn];
    if (!room) continue; // 需视野建站（有 creep 即有视野）；失明维持上一轮计数。

    const allSites = room.find(FIND_MY_CONSTRUCTION_SITES);
    let roadSitesPending = allSites.filter(s => s.structureType === STRUCTURE_ROAD).length;
    if (op.state !== "active") {
      // 暂停/侦察房也要校正：不校正就再也无人写这个字段，残骸会永久占着跨主房车道。
      if (op.roadSiteCount !== roadSitesPending) op.roadSiteCount = roadSitesPending;
      continue;
    }

    // 阻挡集：已有 road / 任何工地 / 任何结构（container 等）。
    const blockedKeys = new Set<string>();
    // 实测账本（只读世界、写 heap，不参与任何决策）：判「这条通勤线上到底有没有施工」
    // 需要的是建成数与进度和，而不是再一次推理 —— 立案见 domain/logistics/road-build。
    let roadsBuilt = 0;
    let roadProgressSum = 0;
    for (const s of room.find(FIND_STRUCTURES)) {
      blockedKeys.add(`${s.pos.x},${s.pos.y}`);
      if (s.structureType === STRUCTURE_ROAD) roadsBuilt++;
    }
    for (const s of allSites) {
      blockedKeys.add(`${s.pos.x},${s.pos.y}`);
      if (s.structureType === STRUCTURE_ROAD) roadProgressSum += s.progress;
    }

    /**
     * 施工证据 = **本次进程实测被踩过的格子**（`globalCache().roomTraffic`）。
     *
     * 为什么不用「离已有结构 ≤3」当证据（旧口径）：那个集合永远满足得了它要防的东西 ——
     * site 就下在 container 旁边 ⇒ 它天然"紧邻证据"，于是既建不掉也没人回收。线上把这条
     * 账走了三次才量准（2026-09-28 建路账本）：W36S58 挂 14 格 site、970 点进度、建成 0，
     * 而通勤腿到最近 site 的距离落在「中 6-10 格 / 远 11+ 格」占 18/22 —— 规划线（home 锚
     * + 纯地形 PathFinder）与真实走的那条线压根不是一条，铺在无人走的线上的 site 永远建不成，
     * 还永久占着 roadSitesPerOpTotal 车道。
     *
     * 热度按 `x*50+y` 记账（与引擎 CostMatrix 同序），只在**有热度**时判决：本服每次
     * global reset 都会清空 heap，此刻无从知道哪条线被走过 —— 不设闸就退回到"猜一条线"，
     * 而猜错的代价正是上面那 14 格。所以热度为空的这一房本轮既不建也不扫（稳态是几小时内
     * 通勤腿把热度重新铺出来，不是永久停摆）。
     */
    const walked = walkedHeatKeys(globalCache().roomTraffic?.[rn], CONFIG.remote.roadMinTileWalks);
    if (walked.size === 0) {
      // 无实测证据：只校正计数与账本，不动 site、不铺新格。
      if (op.roadSiteCount !== roadSitesPending) op.roadSiteCount = roadSitesPending;
      const coldCounters = roadBuildCounters(rn);
      coldCounters.roadProgressSum = roadProgressSum;
      coldCounters.roadSitesPending = roadSitesPending;
      coldCounters.roadsBuilt = roadsBuilt;
      continue;
    }

    // 回收「零进度 + 不在被走过的线上」的 road site。progress=0 意味着一分能量都没投过，
    // remove 零损失，且当场把车道还回来。新铺的格子必然落在热度上，故本清扫的稳态是 0 次删除
    // —— 不是建/删循环（旧版正是"规划器每轮原地重建同一格"才不敢开这个闸）。
    for (const s of allSites) {
      if (s.structureType !== STRUCTURE_ROAD || s.progress > 0) continue;
      if (nearEvidence(walked, s.pos)) continue;
      s.remove();
      released++;
      roadSitesPending--;
    }
    // 实测校正（本字段唯一写者）：与 op.siteCount 同款「会递减」，防只增不减锁死车道。
    // 记清扫后的口径 —— 残骸当场释放，不必等下一轮再减。
    if (op.roadSiteCount !== roadSitesPending) op.roadSiteCount = roadSitesPending;
    // 建成侧账本（判据是 roadsBuilt 与 progress 和，不是 site 数）：见 domain/logistics/road-build。
    const counters = roadBuildCounters(rn);
    counters.roadProgressSum = roadProgressSum;
    counters.roadSitesPending = roadSitesPending;
    counters.roadsBuilt = roadsBuilt;
    // 清扫之后才判预算：本轮释放的额度当场可用（roadBudget 是 tick 入口快照）。
    if (roadBudget + created - released >= CONFIG.remote.roadSitesPerOpTotal) continue;
    // 单 op 挂起 road site 数（含在建）超上限则跳过 —— 铺完自然回落。
    if (roadSitesPending >= CONFIG.remote.maxRoadSitesPerOp) continue;
    const sources = room.find(FIND_SOURCES);

    // 铺路只沿着被走过的格子生长：热度高的格先铺（同分按坐标定序，保证同一输入同一结果）。
    const tiles = selectWalkedRoadTiles(
      globalCache().roomTraffic?.[rn],
      blockedKeys,
      sources.map(s => ({ x: s.pos.x, y: s.pos.y })),
      CONFIG.remote.roadMinTileWalks,
    );
    for (const tile of tiles) {
      if (created >= CONFIG.remote.roadSitesPerRun) break;
      if (roadSitesPending >= CONFIG.remote.maxRoadSitesPerOp) break;
      if (roadBudget + created - released >= CONFIG.remote.roadSitesPerOpTotal) return;
      const rc = room.createConstructionSite(tile.x, tile.y, STRUCTURE_ROAD);
      if (rc === OK) {
        created++;
        roadSitesPending++;
        blockedKeys.add(tile.key);
        // 道路是运力倍增器（有路 hauler 速度 ×2），但也是实打实的能量投入，
        // 记到 op 名下——否则「修路把远房变划算」的收益会被高估。
        bumpRemoteOpLedger(homeRoom, rn, "infraCost", structureCost(STRUCTURE_ROAD));
      } else {
        // ERR_FULL / ERR_INVALID_TARGET（地形冲突等）：跳过该格，下轮重评。
        blockedKeys.add(tile.key);
      }
    }
  }
}

/**
 * 通勤热度 → 「被真正踩过的格子」集合（键 "x,y"，与 nearEvidence 同口径）。
 *
 * `roomTraffic` 的键是 `x*50+y` 的数字串（`creeps/movement/traffic.ts` 复用
 * `domain/layout/types.packPos`），所以这里必须换算 —— 两套键形直接混用会静默判不出命中。
 */
export function walkedHeatKeys(
  traffic: Readonly<Record<string, number>> | undefined,
  minWalks: number,
): Set<string> {
  const keys = new Set<string>();
  if (!traffic) return keys;
  for (const [packed, count] of Object.entries(traffic)) {
    if (!(count >= minWalks)) continue;
    const n = Number(packed);
    if (!Number.isFinite(n) || n < 0) continue;
    keys.add(`${Math.floor(n / 50)},${n % 50}`);
  }
  return keys;
}

/**
 * 从实测热度里挑可铺路的格子（纯函数，返回 "x,y" 键 + 坐标，按踩过的次数降序）。
 *
 * 排除项与旧口径一致：出口行（0/49 边）留给通行、source 旁 1 格让给 container 与站桩
 * harvester、已有结构与任何工地所在格不重复下站。
 */
export function selectWalkedRoadTiles(
  traffic: Readonly<Record<string, number>> | undefined,
  blockedKeys: ReadonlySet<string>,
  sources: readonly { x: number; y: number }[],
  minWalks: number,
): { x: number; y: number; key: string }[] {
  if (!traffic) return [];
  const picked: { x: number; y: number; key: string; walks: number }[] = [];
  for (const [packed, count] of Object.entries(traffic)) {
    if (!(count >= minWalks)) continue;
    const n = Number(packed);
    if (!Number.isFinite(n) || n < 0) continue;
    const x = Math.floor(n / 50);
    const y = n % 50;
    const key = `${x},${y}`;
    if (blockedKeys.has(key)) continue;
    if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
    let nearSource = false;
    for (const s of sources) {
      if (Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1) {
        nearSource = true;
        break;
      }
    }
    if (nearSource) continue;
    picked.push({ x, y, key, walks: count });
  }
  picked.sort((a, b) => b.walks - a.walks || a.key.localeCompare(b.key));
  return picked.map(({ x, y, key }) => ({ x, y, key }));
}

/**
 * 检测远矿通勤路径上的阻断 wall — 有视野时每轮运行。
 *
 * PathFinder 规划 home 锚→source 路径（与 planRemotePathRoads 同口径，不带结构
 * CostMatrix），路径会穿过 neutral wall 格子。但 creep 的 moveTo 带结构矩阵
 * （wall = 255 不可通行），导致 hauler 绕行或卡死。此函数检测路径上的 wall 结构，
 * 标记 needWallClear 驱动 demand 孵 dismantler 拆除。
 *
 * 失明时维持上一判定（不清除标记），防视野消失 → 清标 → 孵化恢复 → 路仍断 →
 * 新视野 → 重新标记的抖动循环。墙被拆除后（路径上无 wall）清除标记 + 回收 dismantler。
 */
export function detectPathWallBlockers(
  homeRoom: string,
  remoteOps: Record<string, RemoteOp>,
): void {
  const home = Game.rooms[homeRoom];
  if (!home) return;
  const anchor = home.storage ?? home.find(FIND_MY_SPAWNS)[0];
  if (!anchor) return;

  for (const [rn, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[rn];
    if (!room) continue; // 失明：维持上一判定，不清标。

    // 收集路径上（远矿房内）的 neutral wall。
    const sources = room.find(FIND_SOURCES);
    const walls = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_WALL,
    }) as StructureWall[];
    if (walls.length === 0) {
      if (op.needWallClear) {
        op.needWallClear = undefined;
        recycleRemoteDismantlers(homeRoom, rn);
      }
      continue;
    }

    const wallKeys = new Set(walls.map(w => `${w.pos.x},${w.pos.y}`));
    let foundWallOnPath = false;
    for (const source of sources) {
      if (foundWallOnPath) break;
      const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: st => st.structureType === STRUCTURE_CONTAINER,
      })[0] as StructureContainer | undefined;
      const goal = container ? container.pos : source.pos;
      const result = PathFinder.search(
        anchor.pos,
        { pos: goal, range: 1 },
        {
          maxRooms: 2,
          plainCost: 2,
          swampCost: 10,
        },
      );
      for (const pos of result.path) {
        if (pos.roomName !== rn) continue;
        if (wallKeys.has(`${pos.x},${pos.y}`)) {
          foundWallOnPath = true;
          break;
        }
      }
    }

    if (foundWallOnPath) {
      if (!op.needWallClear) op.needWallClear = true;
    } else {
      if (op.needWallClear) {
        op.needWallClear = undefined;
        recycleRemoteDismantlers(homeRoom, rn);
      }
    }
  }
}

/**
 * 检测远矿通勤路径的道路覆盖率。有视野时对每个 active op 做 PathFinder.search
 * 获取 home 锚→source container 路径，统计路径上已建成 road 的格子占比。
 * 返回 0-1 的连续覆盖率值（0=无道路，1=全程有路），供 selectBody 和
 * computePerHaulerThroughput 使用。覆盖率 ≥ 0.6 时 selectBody 切换到 2:1
 * 道路配比档（更多 CARRY → 更大运力）。
 * 失明（无视野）时保守返回 0（无路），与旧硬编码行为一致。
 */
export function detectRoadCoverage(
  homeRoom: string,
  remoteOps: Readonly<Record<string, RemoteOp>>,
): Record<string, number> {
  const result: Record<string, number> = {};
  const home = Game.rooms[homeRoom];
  const anchor = home?.storage ?? home?.find(FIND_MY_SPAWNS)?.[0];
  if (!anchor) {
    for (const rn of Object.keys(remoteOps)) result[rn] = 0;
    return result;
  }
  const homeRoadKeys = new Set<string>();
  // hoist home!.find outside the loop — home room doesn't change per iteration.
  for (const s of home!.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) homeRoadKeys.add(`${s.pos.x},${s.pos.y}`);
  }
  for (const [rn, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") {
      result[rn] = 0;
      continue;
    }
    const room = Game.rooms[rn];
    if (!room) {
      result[rn] = 0;
      continue;
    }
    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0) {
      result[rn] = 0;
      continue;
    }
    const roadKeys = new Set<string>();
    for (const s of room.find(FIND_STRUCTURES)) {
      if (s.structureType === STRUCTURE_ROAD) roadKeys.add(`${s.pos.x},${s.pos.y}`);
    }
    let totalPathTiles = 0;
    let roadTiles = 0;
    for (const source of sources) {
      const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: st => st.structureType === STRUCTURE_CONTAINER,
      })[0] as StructureContainer | undefined;
      const goal = container ? container.pos : source.pos;
      const searchResult = PathFinder.search(
        anchor.pos,
        { pos: goal, range: 1 },
        {
          maxRooms: 2,
          plainCost: 2,
          swampCost: 10,
        },
      );
      for (const pos of searchResult.path) {
        if (pos.roomName !== rn && pos.roomName !== homeRoom) continue;
        const key = `${pos.x},${pos.y}`;
        totalPathTiles++;
        if (pos.roomName === rn && roadKeys.has(key)) roadTiles++;
        else if (pos.roomName === homeRoom && homeRoadKeys.has(key)) roadTiles++;
      }
    }
    result[rn] = totalPathTiles > 0 ? roadTiles / totalPathTiles : 0;
  }
  return result;
}
