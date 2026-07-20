import { builderRole } from "./creeps/builder";
import { harvesterRole } from "./creeps/harvester";
import { haulerRole } from "./creeps/hauler";
import { upgraderRole } from "./creeps/upgrader";
import { workerRole } from "./creeps/worker";
import { Kernel } from "./kernel/kernel";
import { Registry } from "./kernel/registry";
import { assignmentServiceSystem } from "./systems/assignment-service";
import { constructionManagerSystem } from "./systems/construction-manager";
import { layoutPlannerSystem } from "./systems/layout-planner";
import { roomObserverSystem } from "./systems/room-observer";
import { spawnManagerSystem } from "./systems/spawn-manager";
import { towerDefenseSystem } from "./systems/tower-defense";

/**
 * Bootstrap — 唯一组合根。
 * 新增系统或角色只需修改此文件并添加对应模块，无需修改 Kernel。
 *
 * 系统注册顺序（同优先级内按注册顺序执行）：
 *   P0: spawn-manager → tower-defense
 *   P1: assignment-service（任务列表生成 + 紧急抢占）
 *   P2: construction-manager
 *   P3: layout-planner → room-observer
 *
 * 角色优先级：
 *   P0: worker（启动期/灾后恢复）
 *   P1: harvester, hauler（能量链）
 *   P2: upgrader, builder（发展）
 *
 * 注意：assignment-service 设为 P1 而非 P0 —
 *   失败时角色回退到无 assignment 行为，避免 P0 永不冷却刷屏。
 *   worker(P0) 可能在第一 tick 早于 assignment 运行，回退行为正确。
 */
const registry = new Registry()
  // P0：孵化管理（紧急恢复、队列处理）
  .registerSystem(spawnManagerSystem)
  // P0：塔防（攻击、维修、安全模式）
  .registerSystem(towerDefenseSystem)
  // P1：任务分配（生成任务列表 + 紧急抢占，在 P1 角色之前运行）
  .registerSystem(assignmentServiceSystem)
  // P2：建造（消费 BuildQueue，受 site 限流）
  .registerSystem(constructionManagerSystem)
  // P3：布局规划（低频生成 BuildTask 推入 BuildQueue）
  .registerSystem(layoutPlannerSystem)
  // P3：房间观察（低频策略）
  .registerSystem(roomObserverSystem)
  // P0：恢复 worker（启动期 / 灾后）
  .registerRole(workerRole)
  // P1：harvester 和 hauler（能量链）
  .registerRole(harvesterRole)
  .registerRole(haulerRole)
  // P2：upgrader 和 builder（发展）
  .registerRole(upgraderRole)
  .registerRole(builderRole);

export const kernel = new Kernel(registry);
