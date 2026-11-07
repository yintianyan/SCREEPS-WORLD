import type { RoomSnapshot } from "../../kernel/contracts";
import { packPos } from "./types";
import { classifyLinkRole, DEFAULT_LINK_ROLE_RANGES, type LinkRoleRanges } from "../economy/links";
import { auditLinkRoleGaps } from "./gaps";

/**
 * link 锚位预留（根因修复 B）。
 *
 * 病灶：引擎按 RCL 门控 link 槽位（`CONTROLLER_STRUCTURES.link` = 5:2／6:3／7:4／8:6），
 * 而道路从 RCL2 就开始按棋盘格占地。等 storage link 拿到槽位（RCL6+），storage 的
 * 角色半径内可能已被铺满 —— 线上 W8N3 即如此：`layoutGaps.linkStorage` 成了
 * 不可满足缺口，并把规划器钉在 gap-force 慢速重试上。
 *
 * 本模块的做法不是「按模板锁死一批格子」，而是**按放置侧当前的选择结果**预留：
 * 对每条未满足的 link 角色需求，用与 `createStorageLinkTask` / `createControllerLinkTask`
 * / `createSourceLinkTasks` 完全相同的几何口径（同一 `LinkRoleRanges`、同一角色分类函数）
 * 找出它今天会挑中的那一格，只把那一格从道路候选里摘掉。
 * 于是三条性质天然成立：
 * 1. **需求满足即释放** —— link 建好或已在队列里 ⇒ `auditLinkRoleGaps` 该项归零 ⇒ 预留集为空，
 *    不会长期饿死道路（这正是「按模板锁格」会犯的反面）。
 * 2. **恰好 demand 枚** —— 一枚需求只留一格，环内其余格照常铺路。
 * 3. **放不下就不留** —— 半径内无可放格 ⇒ 该角色不产出预留，道路与link 互锁不了。
 *
 * 作用域：只约束**道路**（核心棋盘路／流量路／走廊路／hub 路）。extension 与 container
 * 属必需结构，为它们让位会造成「凑不齐 RCL 配额」的真死锁；那条风险由半径放宽
 * （`resolveLinkRoleRanges`，见 domain/economy/links）承担，不在此处硬挡。
 */
export interface LinkReserveInput {
  snapshot: RoomSnapshot;
  /** 当前 buildQueue —— 队列里的 link 任务算「已满足」，避免重复预留。 */
  queue: readonly BuildTask[];
  terrain: RoomTerrain;
  occupiedSet: ReadonlySet<number>;
  ranges?: LinkRoleRanges;
}

interface Point {
  x: number;
  y: number;
}

const cheb = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * 返回被预留格的 packed 位置集合（x*50+y）。
 * 纯函数：不触 Game/Memory，地形与占用集合由调用方注入。
 */
export function computeLinkReserveCells(input: LinkReserveInput): Set<number> {
  const { snapshot, queue, terrain, occupiedSet } = input;
  const ranges = input.ranges ?? DEFAULT_LINK_ROLE_RANGES;
  const reserved = new Set<number>();

  const gaps = auditLinkRoleGaps(snapshot, queue, ranges);
  const sources = snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const controllerPoint = snapshot.controller
    ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y }
    : undefined;
  const storagePoint = snapshot.storage
    ? { x: snapshot.storage.pos.x, y: snapshot.storage.pos.y }
    : undefined;

  // 需求 → 锚点列表：storage/controller 各一枚单例；source 每个 source 一枚
  // （放置侧就是按 source 逐条生成的）。
  const demands: { role: "storage" | "controller" | "source"; anchors: Point[]; count: number }[] =
    [
      { role: "storage", anchors: storagePoint ? [storagePoint] : [], count: gaps.storage },
      {
        role: "controller",
        anchors: controllerPoint ? [controllerPoint] : [],
        count: gaps.controller,
      },
      { role: "source", anchors: sources, count: gaps.source },
    ];

  const roleAt = (p: Point) => classifyLinkRole(p, sources, controllerPoint, storagePoint, ranges);

  for (const demand of demands) {
    let remaining = demand.count;
    if (remaining <= 0) continue;
    for (const anchor of demand.anchors) {
      if (remaining <= 0) break;
      const limit = ranges[demand.role];
      const candidates: Point[] = [];
      for (let dx = -limit; dx <= limit; dx++) {
        for (let dy = -limit; dy <= limit; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = anchor.x + dx;
          const y = anchor.y + dy;
          if (x < 1 || x > 48 || y < 1 || y > 48) continue;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          const packed = packPos(x, y);
          if (occupiedSet.has(packed) || reserved.has(packed)) continue;
          // 必须是放置侧真的会认领的格：角色归属同口径，否则预留了一格
          // 建出来却是 hub（无消费者），道路还白让了一格。
          if (roleAt({ x, y }) !== demand.role) continue;
          candidates.push({ x, y });
        }
      }
      // 与放置侧一致：离锚点越近越优先。
      candidates.sort((a, b) => cheb(a, anchor) - cheb(b, anchor));
      if (candidates.length === 0) continue;
      reserved.add(packPos(candidates[0]!.x, candidates[0]!.y));
      remaining--;
    }
  }

  return reserved;
}
