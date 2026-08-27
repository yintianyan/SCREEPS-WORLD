/** 结构缺口审计器 — 目标清单驱动的布局闭环核心。 */
import type { RoomSnapshot } from "../../kernel/contracts";
import { classifyLinkRole } from "../economy/links";
import { expectedStructureCounts } from "./constraint-placer";

/** 结构缺口：type → 还缺多少个（> 0 才收录）。 */
export type StructureGaps = Record<string, number>;

/** Link 角色缺口（MVC 角色期望 - 已有/队列计数，> 0 才有意义）。 */
export interface LinkRoleGaps {
  source: number;
  controller: number;
  storage: number;
  hub: number;
}

/**
 * MVC link 角色期望表。source 期望受真实 source 数约束
 * （min(MVC, sources.length)）：单 source 房不会因 MVC 表硬要
 * 2 个 source link 而虚报缺口。纯函数。
 */
export function expectedLinkRoleCounts(rcl: number, sourceCount: number): LinkRoleGaps {
  if (rcl < 5) return { source: 0, controller: 0, storage: 0, hub: 0 };
  const sourceExpected = rcl >= 8 ? Math.min(2, sourceCount) : Math.min(1, sourceCount);
  const controllerExpected = 1; // RCL5+ 恒为 1
  const storageExpected = rcl >= 6 ? 1 : 0;
  const hubExpected = rcl >= 8 ? 2 : 0;
  return {
    source: sourceExpected,
    controller: controllerExpected,
    storage: storageExpected,
    hub: hubExpected,
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
): LinkRoleGaps {
  const expected = expectedLinkRoleCounts(snapshot.rcl, snapshot.sources.length);

  // 锚点坐标视图（classifyLinkRole 接受纯坐标，不依赖 RoomPosition）。
  const sourcePoints = snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y }));
  const controllerPoint = snapshot.controller
    ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y }
    : undefined;
  const storagePoint = snapshot.storage
    ? { x: snapshot.storage.pos.x, y: snapshot.storage.pos.y }
    : undefined;

  const have: LinkRoleGaps = { source: 0, controller: 0, storage: 0, hub: 0 };
  const tally = (pos: { x: number; y: number }): void => {
    const role = classifyLinkRole(pos, sourcePoints, controllerPoint, storagePoint);
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
    hub: Math.max(0, expected.hub - have.hub),
  };
}

/**
 * 将 link 角色缺口合并进 StructureGaps（就地修改，避免双重计数）。
 * 角色缺口任一 > 0 时删除 STRUCTURE_LINK 总 key 并写入 linkSource/… 角色 key；
 * 全 0 时保持总缺口不变（总数够且角色分布对）。Memory schema 兼容：
 * v21 迁移只校验「值是 number」，linkSource 等 key 不会被删，recordLayoutGaps 无需改。
 */
export function mergeLinkRoleGaps(
  gaps: StructureGaps,
  linkRoleGaps: LinkRoleGaps,
): void {
  const hasRoleGap =
    linkRoleGaps.source > 0 ||
    linkRoleGaps.controller > 0 ||
    linkRoleGaps.storage > 0 ||
    linkRoleGaps.hub > 0;
  if (!hasRoleGap) return;

  // 角色缺口存在时替换总缺口（避免双重计数：总数 1 缺口 + 角色 1 缺口 = 虚报 2）。
  delete gaps[STRUCTURE_LINK];
  if (linkRoleGaps.source > 0) gaps.linkSource = linkRoleGaps.source;
  if (linkRoleGaps.controller > 0) gaps.linkController = linkRoleGaps.controller;
  if (linkRoleGaps.storage > 0) gaps.linkStorage = linkRoleGaps.storage;
  if (linkRoleGaps.hub > 0) gaps.linkHub = linkRoleGaps.hub;
}
