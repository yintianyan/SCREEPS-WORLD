/** 远矿道路与工地 — container site 收编、路径修路规划、阻断墙检测、道路覆盖率。 */
import { CONFIG } from "../../config";
import type { TickContext } from "../../kernel/contracts";
import { querySquad, bumpRemoteOpLedger } from "../../kernel/global-cache";
import { getRemoteSiteTotal, getRemoteRoadSiteTotal, getTickSiteCounters } from "../site-quota";
import { recycleRemoteDismantlers } from "./creep-recycle";
import { structureCost } from "./op-lifecycle";

/**
 * 远矿 container site 收编 — 消费 remoteHarvester 的 needContainer 申请标记。

 * 职责（每 managerInterval tick 运行一次）：
 *   1. **siteCount 实测校正**：用 room.find 统计该房现存 container
 *      construction site 数，写回 op.siteCount — site 建成（变结构）/被移除/失效时
 *      递减，防只增不减永久占满 maxGlobalSites 饿死自有房重建。
 *   2. **消费申请**：收集 needContainer=true 的 remoteHarvester，按 source 分组处理。
 *   3. **配额仲裁**：远矿 site 永远让位自有房 emergency（emergency > 0 → 跳过）；
 *      normal 槽位与 construction-manager 公平竞争（normal > 0 → 跳过）；
 *      总量 ctx.globalSiteCount + remoteSiteTotal < maxGlobalSites。
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

    // 6. 总量判定：自有房 site + 远矿 site < maxGlobalSites。
    const remoteTotal = getRemoteSiteTotal();
    if (ctx.globalSiteCount + remoteTotal >= CONFIG.construction.maxGlobalSites) continue;

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
 * 从跨房路径中筛选远矿房侧可铺路的格子（纯函数，供单测）。
 * 排除：已有 road / 任何工地 / container 等结构格 / source 近旁 1 格（采集位让给
 * container 与站桩 harvester）。sites/roads/structures 以 "x,y" key 集合传入。
 *
 * evidence 给出时，只保留「有施工证据」的格 —— 距已建成 road / progress>0 的 road site /
 * container ≤ 3。缺省（undefined）不加此约束（新开局：一条证据都还没有）。
 */
export function selectRemoteRoadTiles(
  path: RoomPosition[],
  targetRoom: string,
  sources: readonly { x: number; y: number }[],
  blockedKeys: ReadonlySet<string>,
  evidence?: ReadonlySet<string>,
): RoomPosition[] {
  const out: RoomPosition[] = [];
  const seen = new Set<string>();
  for (const pos of path) {
    if (pos.roomName !== targetRoom) continue;
    const key = `${pos.x},${pos.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (blockedKeys.has(key)) continue;
    if (pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) continue; // 出口行留给通行
    let nearSource = false;
    for (const s of sources) {
      if (Math.abs(s.x - pos.x) <= 1 && Math.abs(s.y - pos.y) <= 1) {
        nearSource = true;
        break;
      }
    }
    if (nearSource) continue;
    if (evidence && !nearEvidence(evidence, pos)) continue;
    out.push(pos);
  }
  // 从目标端（container 侧）起铺：路径数组是「home 锚 → container」，正序即从边界往房内铺。
  // 通勤 hauler 的建路半径 3 格，链路必须从「确定被走的一端」生长 —— container 旁每一格
  // 都有 hauler 必经，边界那一端则取决于 creep 实际从哪个出口入境（见 planRemotePathRoads）。
  return out.reverse();
}

/**
 * 远矿路径修路规划器 —— 每次运行对每个 active op：home 锚（storage 优先，退 spawn）
 * → 各 source container 的跨房路径，筛出远矿房侧可铺格，限速下 road site。
 * 施工不归本函数：通勤 hauler（1W body）经 buildRoadSiteUnderfoot 边走边建（range≤3）。
 * 全部 site 写在远矿房（本系统是远矿房唯一 site 写者，架构合规）。
 *
 * 落点错配（线上实证 W37S57 tick 83188364）：本函数的锚是 home storage + 纯地形代价
 * （PathFinder 无 cost matrix），而 creep 穿越边界用的是 moveTowardRoom 的
 * findClosestByRange(exitDir) + 堆栈粘性出口缓存 —— 谁先把缓存打冷，全房对就用谁的落点。
 * 两条线在边界处可以差十几格：x=28 列上 28,44/45/46 有进度（被走过）而紧邻的 28,47/48
 * progress=0（hauler 从 x≈18 入境，从没踏上这两格）。因为施工只能「脚下」发生，
 * 落在无人行走的线上的 site 永远不会建成，只会永久占着 roadSitesPerOpTotal 车道并触发
 * E7 siteStale。对策分两步、顺序不能反：先用施工证据闸把「铺路」约束成只跟被走过的线
 * 生长（并改从 container 端起铺），再回收零进度且无证据的残骸 —— 只有前者到位，回收才
 * 收敛（否则规划器下一轮原地重建，变成建/删循环）。两者在同一函数体内，稳态是每轮 0 次
 * remove、0 次新建，直到通勤线再次推进。
 */
export function planRemotePathRoads(
  homeRoom: string,
  remoteOps: Readonly<Record<string, RemoteOp>>,
  _ctx: TickContext,
): void {
  const home = Game.rooms[homeRoom];
  if (!home) return;
  const anchor = home.storage ?? home.find(FIND_MY_SPAWNS)[0];
  if (!anchor) return;
  // 独立预算车道：远矿路径 road 不占 maxGlobalSites（自有房常规工地帽会被
  // lab/rampart 长周期大活顶满，道路基建被无限饿死 —— 线上实证 maxGlobalSites=7
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
    // 施工证据集（同两轮遍历顺带收集，不额外 find）：已建成 road / container /
    // progress>0 的 road site —— 通勤 hauler 确实踩过的位置。
    const blockedKeys = new Set<string>();
    const evidenceKeys = new Set<string>();
    for (const s of room.find(FIND_STRUCTURES)) {
      blockedKeys.add(`${s.pos.x},${s.pos.y}`);
      if (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) {
        evidenceKeys.add(`${s.pos.x},${s.pos.y}`);
      }
    }
    for (const s of allSites) {
      blockedKeys.add(`${s.pos.x},${s.pos.y}`);
      if (s.structureType === STRUCTURE_ROAD && s.progress > 0) {
        evidenceKeys.add(`${s.pos.x},${s.pos.y}`);
      }
    }
    // 回收「零进度 + 拿不到施工证据」的 road site —— 这类格落在"规划线有人画、通勤线
    // 没人走"的区段：出境点由 moveTowardRoom 的粘性出口缓存决定，与 home 锚的地形最短
    // 路可以差十几格（线上实证 W37S57 28,47/48、W37S54 边界端 9 格）。progress=0 意味
    // 一分能量都没投过，remove 零损失。加了施工证据闸之后新建 site 必然紧邻证据，故本
    // 清扫的稳态是 0 次删除 —— 不是建/删循环。evidenceKeys 为空（这房连 container 都
    // 没有）时跳过：此刻无从判断哪条线被走过，清扫会当场吃掉开局的第一段路。
    if (evidenceKeys.size > 0) {
      for (const s of allSites) {
        if (s.structureType !== STRUCTURE_ROAD || s.progress > 0) continue;
        if (nearEvidence(evidenceKeys, s.pos)) continue;
        s.remove();
        released++;
        roadSitesPending--;
      }
    }
    // 实测校正（本字段唯一写者）：与 op.siteCount 同款「会递减」，防只增不减锁死车道。
    // 记清扫后的口径 —— 残骸当场释放，不必等下一轮再减。
    if (op.roadSiteCount !== roadSitesPending) op.roadSiteCount = roadSitesPending;
    // 清扫之后才判预算：本轮释放的额度当场可用（roadBudget 是 tick 入口快照）。
    if (roadBudget + created - released >= CONFIG.remote.roadSitesPerOpTotal) continue;
    // 单 op 挂起 road site 数（含在建）超上限则跳过 —— 铺完自然回落。
    if (roadSitesPending >= CONFIG.remote.maxRoadSitesPerOp) continue;
    const sources = room.find(FIND_SOURCES);

    for (const source of sources) {
      if (created >= CONFIG.remote.roadSitesPerRun) break;
      if (roadSitesPending >= CONFIG.remote.maxRoadSitesPerOp) break;
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
      const tiles = selectRemoteRoadTiles(
        result.path,
        rn,
        sources.map(s => ({ x: s.pos.x, y: s.pos.y })),
        blockedKeys,
        // 开局（一条证据都没有）不设闸，否则永远铺不出第一段路。
        evidenceKeys.size > 0 ? evidenceKeys : undefined,
      );
      for (const pos of tiles) {
        if (created >= CONFIG.remote.roadSitesPerRun) break;
        if (roadSitesPending >= CONFIG.remote.maxRoadSitesPerOp) break;
        if (roadBudget + created - released >= CONFIG.remote.roadSitesPerOpTotal) return;
        const rc = room.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD);
        if (rc === OK) {
          created++;
          roadSitesPending++;
          blockedKeys.add(`${pos.x},${pos.y}`);
          // 道路是运力倍增器（有路 hauler 速度 ×2），但也是实打实的能量投入，
          // 记到 op 名下——否则「修路把远房变划算」的收益会被高估。
          bumpRemoteOpLedger(homeRoom, rn, "infraCost", structureCost(STRUCTURE_ROAD));
        } else {
          // ERR_FULL / ERR_INVALID_TARGET（地形冲突等）：跳过该格，下轮重评。
          blockedKeys.add(`${pos.x},${pos.y}`);
        }
      }
    }
  }
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
