import { builderRole } from "./creeps/roles/builder";
import { claimerRole } from "./creeps/roles/claimer";
import { defenderRole } from "./creeps/roles/defender";
import { distributorRole } from "./creeps/roles/distributor";
import { harvesterRole } from "./creeps/roles/harvester";
import { haulerRole } from "./creeps/roles/hauler";
import { mineralMinerRole } from "./creeps/roles/mineral-miner";
import { attackerRole } from "./creeps/roles/attacker";
import { healerRole } from "./creeps/roles/healer";
import { pbCollectorRole } from "./creeps/roles/pb-collector";
import { remoteHarvesterRole } from "./creeps/roles/remote-harvester";
import { remoteHaulerRole } from "./creeps/roles/remote-hauler";
import { remoteDefenderRole } from "./creeps/roles/remote-defender";
import { reserverRole } from "./creeps/roles/reserver";
import { scoutRole } from "./creeps/roles/scout";
import { upgraderRole } from "./creeps/roles/upgrader";
import { workerRole } from "./creeps/roles/worker";
import { Kernel } from "./kernel/kernel";
import { Registry } from "./kernel/registry";
import { assignmentServiceSystem } from "./systems/assignment-service";
import { constructionManagerSystem } from "./systems/construction-manager";
import { defensePlannerSystem } from "./systems/defense-planner";
import { empireStrategySystem } from "./systems/empire-strategy";
import { expansionManagerSystem } from "./systems/expansion-manager";
import { factoryManagerSystem } from "./systems/factory-manager";
import { powerCreepManagerSystem } from "./systems/power-creep-manager";
import { powerFarmManagerSystem } from "./systems/power-farm-manager";
import { layoutPlannerSystem } from "./systems/layout-planner";
import { labSystem } from "./systems/lab-system";
import { linkSystem } from "./systems/link-system";
import { pixelSystem } from "./systems/pixel-system";
import { prospectManagerSystem } from "./systems/prospect-manager";
import { remoteMiningManagerSystem } from "./systems/remote-mining-manager";
import { warPlannerSystem } from "./systems/war-planner";
import { roomObserverSystem } from "./systems/room-observer";
import { roomStateSystem } from "./systems/room-state";
import { spawnManagerSystem } from "./systems/spawn-manager";
import { telemetryCollectorSystem } from "./systems/telemetry-collector";
import { terminalManagerSystem } from "./systems/terminal-manager";
import { trafficManagerSystem } from "./systems/traffic-manager";
import { tuningEngineSystem } from "./systems/tuning-engine";
import { towerDefenseSystem } from "./systems/tower-defense";

/**
 * Bootstrap — 唯一组合根：新增系统/角色只改此文件并添加对应模块，不改 Kernel。
 * 硬约束：注册的每个角色名必须同时存在于 CONFIG.roles — roles 表兼任
 * recyclePass 的「在役角色」白名单，漏配则孵出即被回收（role-config-parity 强制）。
 * 注册顺序即同优先级执行顺序（P0→P3，见下方逐条注释）；room-state 必须最先运行
 * （每 tick 写 ColonyState 供后续消费）；assignment-service 故意设 P1 而非 P0：
 * 失败时角色回退无 assignment 行为，避免 P0 永不冷却刷屏。
 */
/** 组合根注册表 — 导出仅供一致性测试（role-config-parity）检视。 */
export const registry = new Registry()
  // P0：房间状态（ColonyState，必须先于其他系统）
  .registerSystem(roomStateSystem)
  // P0：孵化管理（紧急恢复）
  .registerSystem(spawnManagerSystem)
  // P0：塔防
  .registerSystem(towerDefenseSystem)
  // P1：帝国姿态（先于战术消费者裁决扩张/收缩/备战）
  .registerSystem(empireStrategySystem)
  // P1：任务分配（先于 P1 角色）
  .registerSystem(assignmentServiceSystem)
  // P1：link 能量传输（瞬移替代 hauler 往返）
  .registerSystem(linkSystem)
  // P1：lab 反应 + boost
  .registerSystem(labSystem)
  // P2：建造（消费 BuildQueue）
  .registerSystem(constructionManagerSystem)
  // P2：远矿管理（每 10 tick 评估目标）
  .registerSystem(remoteMiningManagerSystem)
  // P2：战争规划（war 姿态才选目标推 attacker；非 war 收摊）
  .registerSystem(warPlannerSystem)
  // P3：布局规划（低频）
  .registerSystem(layoutPlannerSystem)
  // P3：防御规划（独立于核心布局）
  .registerSystem(defensePlannerSystem)
  // P3：房间观察（低频）
  .registerSystem(roomObserverSystem)
  // P3：pixel 生成（bucket 满载时）
  .registerSystem(pixelSystem)
  // P3：terminal 帝国能量网络（跨房互济 + 市场交易）
  .registerSystem(terminalManagerSystem)
  // P3：factory/powerSpawn 最小运营（battery 压缩 + GPL 涓流）
  .registerSystem(factoryManagerSystem)
  // P3：Power Creeps GPL 消费闭环（create/upgrade/spawn/运营赋能）
  .registerSystem(powerCreepManagerSystem)
  // P3：扩张管理（GCL 有余量时 claim 新房）
  .registerSystem(expansionManagerSystem)
  // P3：PB 野采（power 自给供给源 — war 军事资源不双线）
  .registerSystem(powerFarmManagerSystem)
  // P3：主动情报（expansionAllowed 时派侦察兵取候选房视野；失败冷却止损）
  .registerSystem(prospectManagerSystem)
  // P3：遥测采集（低频采样）
  .registerSystem(telemetryCollectorSystem)
  // P3：参数自调优（每 500 tick 读遥测调角色边界覆盖值）
  .registerSystem(tuningEngineSystem)
  // P0（post 阶段）：交通解算 — 所有角色之后统一仲裁签发 move
  .registerSystem(trafficManagerSystem)
  // P0：恢复 worker（启动期/灾后）
  .registerRole(workerRole)
  // P1：defender（房内威胁时孵化，与塔协同）
  .registerRole(defenderRole)
  // P1：harvester/hauler（能量链）
  .registerRole(harvesterRole)
  .registerRole(haulerRole)
  // P1：distributor（storage→sink，RCL4+）
  .registerRole(distributorRole)
  // P1：远矿角色（采集 + 穿梭搬运）
  .registerRole(remoteHarvesterRole)
  .registerRole(remoteHaulerRole)
  // P2：upgrader/builder
  .registerRole(upgraderRole)
  .registerRole(builderRole)
  // P2：reserver（远矿 controller）
  .registerRole(reserverRole)
  // P2：claimer（占领新房）
  .registerRole(claimerRole)
  // P2：mineralMiner（RCL6+ 采矿→container→terminal）
  .registerRole(mineralMinerRole)
  // P2：attacker（仅 war-planner 孵化）
  .registerRole(attackerRole)
  // P2：healer（heal-tank 编队治疗端，仅 war-planner 孵化）
  .registerRole(healerRole)
  // P3：scout（一次性侦察兵，仅 prospect-manager 孵化）
  .registerRole(scoutRole)
  // P3：pbCollector（一次性 PB power 捡运，仅 power-farm-manager 孵化）
  .registerRole(pbCollectorRole)
  // P1：remoteDefender（杀 NPC reserver/Invader）
  .registerRole(remoteDefenderRole);

export const kernel = new Kernel(registry);
