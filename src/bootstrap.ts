import { builderRole } from "./creeps/roles/builder";
import { defenderRole } from "./creeps/roles/defender";
import { distributorRole } from "./creeps/roles/distributor";
import { harvesterRole } from "./creeps/roles/harvester";
import { haulerRole } from "./creeps/roles/hauler";
import { remoteHarvesterRole } from "./creeps/roles/remote-harvester";
import { remoteHaulerRole } from "./creeps/roles/remote-hauler";
import { remoteDefenderRole } from "./creeps/roles/remote-defender";
import { reserverRole } from "./creeps/roles/reserver";
import { upgraderRole } from "./creeps/roles/upgrader";
import { workerRole } from "./creeps/roles/worker";
import { Kernel } from "./kernel/kernel";
import { Registry } from "./kernel/registry";
import { assignmentServiceSystem } from "./systems/assignment-service";
import { constructionManagerSystem } from "./systems/construction-manager";
import { defensePlannerSystem } from "./systems/defense-planner";
import { layoutPlannerSystem } from "./systems/layout-planner";
import { labSystem } from "./systems/lab-system";
import { linkSystem } from "./systems/link-system";
import { pixelSystem } from "./systems/pixel-system";
import { remoteMiningManagerSystem } from "./systems/remote-mining-manager";
import { roomObserverSystem } from "./systems/room-observer";
import { roomStateSystem } from "./systems/room-state";
import { spawnManagerSystem } from "./systems/spawn-manager";
import { telemetryCollectorSystem } from "./systems/telemetry-collector";
import { terminalManagerSystem } from "./systems/terminal-manager";
import { tuningEngineSystem } from "./systems/tuning-engine";
import { towerDefenseSystem } from "./systems/tower-defense";

/**
 * Bootstrap — 唯一组合根。
 * 新增系统或角色只需修改此文件并添加对应模块，无需修改 Kernel。
 *
 * 系统注册顺序（同优先级内按注册顺序执行）：
 *   P0: room-state → spawn-manager → tower-defense
 *   P1: assignment-service（任务列表生成 + 紧急抢占）→ link-system（link 能量瞬移）→ lab-system（lab 反应 + boost）
 *   P2: construction-manager → remote-mining-manager（远矿目标评估 + spawn 请求）
 *   P3: layout-planner → defense-planner → room-observer → pixel-generator → telemetry-collector → tuning-engine
 *
 * 角色优先级：
 *   P0: worker（启动期/灾后恢复）
 *   P1: harvester, hauler, distributor, remoteHarvester, remoteHauler（能量链）
 *   P2: upgrader, builder, reserver（发展 + 远矿占领）
 *
 * 注意：room-state 必须在 spawn-manager 之前运行 —
 *   它每 tick 计算每房 ColonyState 并写入 RoomMemory，供所有后续系统消费。
 *   assignment-service 设为 P1 而非 P0 —
 *   失败时角色回退到无 assignment 行为，避免 P0 永不冷却刷屏。
 *   worker(P0) 可能在第一 tick 早于 assignment 运行，回退行为正确。
 */
const registry = new Registry()
  // P0：房间状态（每房 ColonyState + downgradeRisk，必须在所有其他系统之前运行）
  .registerSystem(roomStateSystem)
  // P0：孵化管理（紧急恢复、队列处理）
  .registerSystem(spawnManagerSystem)
  // P0：塔防（攻击、维修、安全模式）
  .registerSystem(towerDefenseSystem)
  // P1：任务分配（生成任务列表 + 紧急抢占，在 P1 角色之前运行）
  .registerSystem(assignmentServiceSystem)
  // P1：link 能量传输（source→controller/storage 瞬移，替代 hauler 往返）
  .registerSystem(linkSystem)
  // P1：lab 反应 + boost（化合物生产、creep 强化）
  .registerSystem(labSystem)
  // P2：建造（消费 BuildQueue，受 site 限流）
  .registerSystem(constructionManagerSystem)
  // P2：远矿管理（每 10 tick 评估目标 + 生成远矿 spawn 请求）
  .registerSystem(remoteMiningManagerSystem)
  // P3：布局规划（低频生成 BuildTask 推入 BuildQueue）
  .registerSystem(layoutPlannerSystem)
  // P3：防御规划（rampart/wall 生成，独立于核心布局）
  .registerSystem(defensePlannerSystem)
  // P3：房间观察（低频策略）
  .registerSystem(roomObserverSystem)
  // P3：pixel 生成（bucket 满载时生成 pixel）
  .registerSystem(pixelSystem)
  // P3：terminal 市场贸易（卖盈余矿物换 credits → 买缺口原料喂反应链）
  .registerSystem(terminalManagerSystem)
  // P3：遥测采集（时序数据 + 事件日志 + 运行时摘要，低频采样）
  .registerSystem(telemetryCollectorSystem)
  // P3：参数自调优（每 500 tick 读取遥测 → 调整角色边界覆盖值）
  .registerSystem(tuningEngineSystem)
  // P0：恢复 worker（启动期 / 灾后）
  .registerRole(workerRole)
  // P1：defender（本房防御响应 — 房内出现威胁时孵化，与塔协同）
  .registerRole(defenderRole)
  // P1：harvester 和 hauler（能量链）
  .registerRole(harvesterRole)
  .registerRole(haulerRole)
  // P1：distributor（storage → sink 分发，RCL4+）
  .registerRole(distributorRole)
  // P1：远矿角色（远矿采集 + 穿梭搬运）
  .registerRole(remoteHarvesterRole)
  .registerRole(remoteHaulerRole)
  // P2：upgrader 和 builder（发展）
  .registerRole(upgraderRole)
  .registerRole(builderRole)
  // P2：reserver（远矿 controller 占领）
  .registerRole(reserverRole)
  // P1：remoteDefender（远矿防御者，杀 NPC reserver/Invader）
  .registerRole(remoteDefenderRole);

export const kernel = new Kernel(registry);
