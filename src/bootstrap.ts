import { builderRole } from "./creeps/builder";
import { harvesterRole } from "./creeps/harvester";
import { haulerRole } from "./creeps/hauler";
import { upgraderRole } from "./creeps/upgrader";
import { workerRole } from "./creeps/worker";
import { Kernel } from "./kernel/kernel";
import { Registry } from "./kernel/registry";
import { constructionManagerSystem } from "./systems/construction-manager";
import { roomObserverSystem } from "./systems/room-observer";
import { spawnManagerSystem } from "./systems/spawn-manager";
import { towerDefenseSystem } from "./systems/tower-defense";

/**
 * Bootstrap — 唯一组合根。
 * 新增系统或角色只需修改此文件并添加对应模块，无需修改 Kernel。
 */
const registry = new Registry()
  // P0：孵化管理（紧急恢复、队列处理）
  .registerSystem(spawnManagerSystem)
  // P0：塔防（攻击、维修、安全模式）
  .registerSystem(towerDefenseSystem)
  // P2：建造（发展性工作，受 site 限流）
  .registerSystem(constructionManagerSystem)
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
