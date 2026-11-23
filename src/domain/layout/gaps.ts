/** 结构缺口审计器 — 目标清单驱动的布局闭环核心。 */
import type { RoomSnapshot } from "../../kernel/contracts";
import { classifyLinkRole, DEFAULT_LINK_ROLE_RANGES, type LinkRoleRanges } from "../economy/links";
import { expectedStructureCounts } from "./constraint-placer";

/** 结构缺口：type → 还缺多少个（> 0 才收录）。 */
export type StructureGaps = Record<string, number>;

/** Link 角色缺口（MVC 角色期望 - 已有/队列计数，> 0 才有意义）。 */
export interface LinkRoleGaps {
  source: number;
  controller: number;
  storage: number;
  spawn: number;
  hub: number;
}

/**
 * MVC link 角色期望表。source 期望受真实 source 数约束
 * （min(MVC, sources.length)）：单 source 房不会因 MVC 表硬要
 * 2 个 source link 而虚报缺口。纯函数。
 *
 * hub 期望恒为 0：hub 不是"应有而未建"的结构，而是「未被 source/controller/storage/spawn
 * 占用的剩余槽位」。放置侧只有这四个角色创建器，传输侧也只路由这些角色；role"hub" 既无
 * 创建器也无消费者。source link 由 planLinkTransfers 发出，controller link 由站桩 upgrader
 * 取能，storage/spawn link 由固定 keeper 排空。旧表在 RCL8 硬要 hub=2，会把 6/6 槽位建满的
 * 核心房永久钉在 gap-force 慢速重试上，并淹掉同通道的真实缺口。RCL8 现在只额外期望一个
 * spawn Link，第六个槽位保持未建。某角色建得比期望多（如 3 只 controller link）由超配审计
 * 与受限拆除通道处理，不伪装成缺口。
 */
export function expectedLinkRoleCounts(
  rcl: number,
  sourceCount: number,
  spawnCount = 0,
): LinkRoleGaps {
  if (rcl < 5) return { source: 0, controller: 0, storage: 0, spawn: 0, hub: 0 };
  const sourceExpected = rcl >= 8 ? Math.min(2, sourceCount) : Math.min(1, sourceCount);
  const controllerExpected = 1; // RCL5+ 恒为 1
  const storageExpected = rcl >= 6 ? 1 : 0;
  const spawnExpected = rcl >= 8 && spawnCount > 0 ? 1 : 0;
  return {
    source: sourceExpected,
    controller: controllerExpected,
    storage: storageExpected,
    spawn: spawnExpected,
    hub: 0,
  };
}

export function auditStructureGaps(
  snapshot: RoomSnapshot,
  queue: readonly BuildTask[],
): StructureGaps {
  const expected = expectedStructureCounts(snapshot.rcl);
  const have = new Map<string, number>();
  const add = (type: string): void => {
    have.set(type, (have.get(type) ?? 0) + 1);
  };
  for (const s of snapshot.spawns) add(s.structureType);
  for (const s of snapshot.extensions) add(s.structureType);
  for (const s of snapshot.towers) add(s.structureType);
  for (const s of snapshot.labs) add(s.structureType);
  if (snapshot.storage) add(snapshot.storage.structureType);
  if (snapshot.terminal) add(snapshot.terminal.structureType);
  if (snapshot.factory) add(snapshot.factory.structureType);
  if (snapshot.observer) add(snapshot.observer.structureType);
  if (snapshot.powerSpawn) add(snapshot.powerSpawn.structureType);
  if (snapshot.nuker) add(snapshot.nuker.structureType);
  for (const site of snapshot.myConstructionSites) add(site.structureType);
  for (const task of queue) {
    if (task.state === "queued" || task.state === "blocked") add(task.structureType);
  }

  const gaps: StructureGaps = {};
  for (const [type, target] of Object.entries(expected)) {
    const gap = target - (have.get(type) ?? 0);
    if (gap > 0) gaps[type] = gap;
  }
  return gaps;
}

/**
 * 按 link 角色审计缺口 — 角色感知防死资产（W3N7 RCL5 实证：2 个 source link
 * 死资产，总数满足 CONTROLLER_STRUCTURES 却缺 controller link，升级链断裂）。
 * 队列口径同 auditStructureGaps（只计 queued/blocked）；link task 角色由 pos
 * 几何判定，与放置侧 linkRolePredicate 同口径，闭合放置意图与运行时分类。
 * 纯函数。
 */
export function auditLinkRoleGaps(
  snapshot: RoomSnapshot,
  queue: readonly BuildTask[],
  linkRoleRanges?: LinkRoleRanges,
): LinkRoleGaps {
  const expected = expectedLinkRoleCounts(
    snapshot.rcl,
    snapshot.sources.length,
    snapshot.spawns.length,
  );
  const ranges = linkRoleRanges ?? DEFAULT_LINK_ROLE_RANGES;

  // 锚点坐标视图（classifyLinkRole 接受纯坐标，不依赖 RoomPosition）。
  const sourcePoints = snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const spawnPoints = snapshot.spawns.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const controllerPoint = snapshot.controller
    ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y }
    : undefined;
  const storagePoint = snapshot.storage
    ? { x: snapshot.storage.pos.x, y: snapshot.storage.pos.y }
    : undefined;

  const have: LinkRoleGaps = { source: 0, controller: 0, storage: 0, spawn: 0, hub: 0 };
  const tally = (pos: { x: number; y: number }): void => {
    const role = classifyLinkRole(
      pos,
      sourcePoints,
      controllerPoint,
      storagePoint,
      ranges,
      spawnPoints,
    );
    have[role]++;
  };

  for (const link of snapshot.links) tally({ x: link.pos.x, y: link.pos.y });
  for (const task of queue) {
    if (task.structureType !== STRUCTURE_LINK) continue;
    if (task.state !== "queued" && task.state !== "blocked") continue;
    tally({ x: task.pos.x, y: task.pos.y });
  }

  return {
    source: Math.max(0, expected.source - have.source),
    controller: Math.max(0, expected.controller - have.controller),
    storage: Math.max(0, expected.storage - have.storage),
    spawn: Math.max(0, expected.spawn - have.spawn),
    hub: Math.max(0, expected.hub - have.hub),
  };
}

/**
 * 将 link 角色缺口合并进 StructureGaps（就地修改，避免双重计数）。
 * 角色缺口任一 > 0 时删除 STRUCTURE_LINK 总 key 并写入 linkSource/… 角色 key；
 * 全 0 时保持总缺口不变（总数够且角色分布对）。Memory schema 兼容：
 * v21 迁移只校验「值是 number」，linkSource 等 key 不会被删，recordLayoutGaps 无需改。
 */
export function mergeLinkRoleGaps(gaps: StructureGaps, linkRoleGaps: LinkRoleGaps): void {
  const hasRoleGap =
    linkRoleGaps.source > 0 ||
    linkRoleGaps.controller > 0 ||
    linkRoleGaps.storage > 0 ||
    linkRoleGaps.spawn > 0 ||
    linkRoleGaps.hub > 0;
  if (!hasRoleGap) return;

  // 角色缺口存在时替换总缺口（避免双重计数：总数 1 缺口 + 角色 1 缺口 = 虚报 2）。
  delete gaps[STRUCTURE_LINK];
  if (linkRoleGaps.source > 0) gaps.linkSource = linkRoleGaps.source;
  if (linkRoleGaps.controller > 0) gaps.linkController = linkRoleGaps.controller;
  if (linkRoleGaps.storage > 0) gaps.linkStorage = linkRoleGaps.storage;
  if (linkRoleGaps.spawn > 0) gaps.linkSpawn = linkRoleGaps.spawn;
  if (linkRoleGaps.hub > 0) gaps.linkHub = linkRoleGaps.hub;
}

/**
 * link **角色超配**审计（纯函数）：某角色建得比期望多时的那部分数量之和。
 *
 * 为什么需要它：`auditLinkRoleGaps` 只报缺口（`Math.max(0, expected - have)`），
 * 超配被截成 0 ⇒ "6 个名额建满、其中 3 只挤在 controller range≤2 内"这种现场形状
 * 在缺口账上完全隐形；摘掉虚期望之前，它还被误报成 `linkHub:2`。
 * 只统计**有创建器的角色**（source/controller/storage/spawn）——hub 不是需求（无常驻消费者）。
 *
 * ⚠️输出只供仪表（layoutMetrics.linkRoleSurplus）：**不得**并进 shouldPlan 消费的缺口字典，
 * 否则等于把刚拆掉的 gap-force 钉重新钉回去。
 */
export function auditLinkRoleSurplus(
  snapshot: RoomSnapshot,
  queue: readonly BuildTask[],
  linkRoleRanges?: LinkRoleRanges,
): number {
  const expected = expectedLinkRoleCounts(
    snapshot.rcl,
    snapshot.sources.length,
    snapshot.spawns.length,
  );
  const ranges = linkRoleRanges ?? DEFAULT_LINK_ROLE_RANGES;
  const sourcePoints = snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const spawnPoints = snapshot.spawns.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const controllerPoint = snapshot.controller
    ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y }
    : undefined;
  const storagePoint = snapshot.storage
    ? { x: snapshot.storage.pos.x, y: snapshot.storage.pos.y }
    : undefined;
  const have = { source: 0, controller: 0, storage: 0, spawn: 0 };
  const tally = (pos: { x: number; y: number }): void => {
    const role = classifyLinkRole(
      pos,
      sourcePoints,
      controllerPoint,
      storagePoint,
      ranges,
      spawnPoints,
    );
    if (role in have) have[role as keyof typeof have]++;
  };
  for (const link of snapshot.links) tally({ x: link.pos.x, y: link.pos.y });
  for (const task of queue) {
    if (task.structureType !== STRUCTURE_LINK) continue;
    if (task.state !== "queued" && task.state !== "blocked") continue;
    tally({ x: task.pos.x, y: task.pos.y });
  }
  return (
    Math.max(0, have.source - expected.source) +
    Math.max(0, have.controller - expected.controller) +
    Math.max(0, have.storage - expected.storage) +
    Math.max(0, have.spawn - expected.spawn)
  );
}

/** 返回可拆的 controller Link 超配 id；保留距 controller 最近的一条。 */
export function findSurplusControllerLinks(
  snapshot: RoomSnapshot,
  linkRoleRanges?: LinkRoleRanges,
): string[] {
  const controller = snapshot.controller;
  if (!controller) return [];
  const ranges = linkRoleRanges ?? DEFAULT_LINK_ROLE_RANGES;
  const sourcePoints = snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const spawnPoints = snapshot.spawns.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const controllers = snapshot.links
    .filter(
      l =>
        classifyLinkRole(
          l.pos,
          sourcePoints,
          controller.pos,
          snapshot.storage?.pos,
          ranges,
          spawnPoints,
        ) === "controller",
    )
    .sort(
      (a, b) =>
        a.pos.getRangeTo(controller.pos) - b.pos.getRangeTo(controller.pos) ||
        a.id.localeCompare(b.id),
    );
  return controllers.slice(1).map(l => l.id);
}
