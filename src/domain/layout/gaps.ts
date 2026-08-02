/**
 * 结构缺口审计器 — 目标清单驱动的布局闭环核心（2026-08-01）。
 *
 * 期望 = expectedStructureCounts(rcl)（单一真相源 = CONTROLLER_STRUCTURES）；
 * 已有 = 已建结构 + 在建 site + 队列任务（queued/blocked，与
 * computeCommittedCounts 同口径）。缺口 > 0 即真实需求：
 *   - layout-planner 用它触发规划（不再只依赖 nextPlanTick 周期）
 *   - 缺口写入 Memory.kernel.layoutGaps（可观测，替代控制台告警）
 *   - placement 放不下时缺口持续存在 → 慢速重试 + 人工介入信号
 *
 * 纯函数 — 不访问 Game/Memory。
 */
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
 * MVC link 角色期望表（docs/layout-system-design-2026-08.md §3.5）。
 *
 * | RCL   | source | controller | storage | hub |
 * |-------|--------|------------|---------|-----|
 * | <5    | 0      | 0          | 0       | 0   |
 * | 5-7   | 1      | 1          | RCL≥6?1:0 | 0   |
 * | 8     | 2      | 1          | 1       | 2   |
 *
 * source 期望受房间真实 source 数量约束（min(MVC, sources.length)）：
 * 单 source 房（罕见）不会因 MVC 表硬要 2 个 source link 而虚报缺口。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param rcl          房间 RCL
 * @param sourceCount  房间 source 数量（通常为 1 或 2）
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
 * 按 link 角色审计缺口（2026-08-02，docs/layout-system-design-2026-08.md §3.5）。
 *
 * 病灶（W3N7 RCL5 实证）：2 个 source link 死资产（harvester 不灌），总数满足
 * CONTROLLER_STRUCTURES[link][5]=2 → `auditStructureGaps` 报 `link: 0` 缺口，
 * 但 controller link 缺失导致升级链断裂。角色感知让死资产骗不过检测：
 *   - 用 classifyLinkRole 对已建 link 和队列 link 任务的位置分类
 *   - 对照 MVC 角色期望表计算每角色缺口
 *   - 角色缺口 > 0 即真实需求（即使总数满足）
 *
 * 队列任务口径与 `auditStructureGaps` 一致：只计 queued/blocked（done/site
 * 已被实体覆盖）。link task 的角色由其 pos 几何判定（与放置侧
 * `linkRolePredicate` 同口径，闭合放置意图与运行时分类）。
 *
 * 纯函数 — 不访问 Game/Memory。
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
 * 将 link 角色缺口合并到 StructureGaps（就地修改，避免双重计数）。
 *
 * 合并规则：
 *   - 角色缺口存在（任一 > 0）时，删除 `STRUCTURE_LINK` 总缺口 key，
 *     加入 `linkSource`/`linkController`/`linkStorage`/`linkHub`（> 0 才收录）
 *   - 角色缺口全 0 时，保持 `STRUCTURE_LINK` 总缺口不变（总数够且角色分布对）
 *
 * 死资产场景（W3N7 RCL5：2 source link 死资产）：
 *   合并前 gaps = {}（link 总缺口 0）
 *   合并后 gaps = { linkController: 1 }（角色缺口暴露真实需求）
 *
 * Memory schema 兼容：v21 迁移只校验「值是 number」，`linkSource` 等 key
 * 不会被删除；`recordLayoutGaps` 无需改。
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
