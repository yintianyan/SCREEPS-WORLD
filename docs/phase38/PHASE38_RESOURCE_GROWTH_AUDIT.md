# PHASE38 · 资源增长审计（Resource Growth Audit）

> 范围：任务书 §十 —— 1000t/10000t/50000t/100000t 四观察点的结构性论证 + 全结构增长表
> 方法：静态界证明（cap/GC 代码证据）为主；运行时采样为辅（E2E 11k tick 历史数据引用）

## 1. 四观察点外推（静态论证）

| 观察点 | 预期稳态 | 论证 |
|---|---|---|
| 1000t | 全部 ring 未满；heap 缓存建立中 | 各 cap 见 §3 |
| 10000t | experience ring 进入 age-GC 稳态（10kt）；decisionTrace ARCHIVED→purge 循环（2kt 周期 ×5） | 有界循环 |
| 50000t | evaluation(50kt)/recommendation(50kt) 整体过期首次触发；Memory 侧 blacklists 多轮 prune；hysteresisCache ≈ 扩张尝试数 | 除 GC-1 外有界 |
| 100000t | calibration(100kt) 首次整体过期；**hysteresisCache 持续单调**（每扩张尝试+1 条目，无删除）——唯一 O(total historical events) 结构 | GC-1 |

O(t) 类：无（所有时间索引皆 ring/窗口）。O(rooms)：快照、队列、segment——线性合法。
O(events)：decisionTrace/experience 等 ring 封顶。**越界者仅 hysteresisCache 一项。**

## 2. 运行时佐证

- E2E 11,000 tick 长稳场景（diag-death-spiral）：人口/经济曲线稳定，LAST_ERROR_STACK=undefined。
- Memory 体量看门狗已存在：stats.memorySize 每 100t 采样、1.5MB 告警阈值（telemetry-collector.ts:208-240）——
  上线后建议以该指标对 hysteresisCache 增速做实测校准。

## 3. 全结构 Owner/Writer/Reader/Cap/GC 表（26 项普查）

| 结构 | Writer | Reader | Cap | GC | Lifetime | Reset |
|---|---|---|---|---|---|---|
| transportPool (heap) | logistics.ts:71-205 | assignment-service:134 | tick-stamped rebuild | 每 tick | 1 tick | auto |
| fillReservations (heap) | targeting.ts:182-186 | hauler/fill actions | lazy tick reset | 每 tick | 1 tick | auto |
| spawnQueue/room (Mem) | spawn-mgr + 8 子系统 | trySpawn | distinct keys ≤~30/房 | TTL/retries 每 tick | ≤1000t | [] on abandon |
| buildQueue/room (Mem) | layout-planner/constr-mgr | constr-mgr | layout 派生 | cleanTasks 每 tick | done/purge | [] on anchor change |
| spawnBlacklist (Mem) | spawn-manager:80 | :165 | keys×roles | prune 每 tick | 500-1000t | 自过期 |
| __churnCounter (heap) | recordChurn:569 | breaker:596 | 200t 窗口 | compact :600 | ≤200t | reset |
| eventBuffer (heap) | event-log | telemetry drain | flush 排空 | per flush | <interval | drain |
| eventLog ring (seg) | telemetry:400-411 | analytics | 500 | ring overwrite | 500 events | seg rebuild |
| cpu/econ timeseries (seg) | telemetry :94,:135 | tuning/strategy | 300/200 | ring | samples | seg rebuild |
| empire-health histories (Mem) | empire-health:182-207 | dashboards | MAX_HISTORY=100 | shift | 100 样本 | — |
| decisionTrace ring (heap) | trace 采集器×8 | queries/exp-collector | 1000 | 分龄 gc | ≤2000t | reset |
| snapshotRegistry (heap) | buildSnapshot×8 | eviction/integrity | 引用集 | 500t evict | ring 引用期 | reset |
| processedDecisionIds (heap) | exp-collector:182 | dedup | 5000→trim 至 3000 | on add | soft | reset |
| processedExpansionPlanIds (heap) | trace:898 | dedup | 500→trim 200 | on add | soft | reset |
| **hysteresisCache (module Map)** | planner:155-164 | planner | **无** | **无** | 进程生命 | 仅 reset |
| corridorPathCache (heap) | corridor-roads:220 | road planning | 1 entry/房 | mismatch 时覆写 | per anchor/rcl | reset |
| __creepPathCache (heap) | pathfinding:419 | movement | ~creeps | 死 creep 清理 100t | creep 寿命 | reset |
| boostAssignments/labDemands | lab-system:440 | industry actions | tick-stamped | 每 tick | 1 tick | auto |
| procurementDemands | global-cache:433 | terminal:571 | deadline 过滤 | publish 时 | ≤deadline | tick-stamped |
| nukesInFlight (Mem) | war-planner:414 | :199 | landing 数 | prune 每 run | NUKE_LANDING | 空则删 |
| warBlacklist (Mem) | war-planner:398 | gates | targets | prune 每 run | cooldown | 空则删 |
| expansionBlacklist (Mem) | exp-mgr:800 | gates | targets | prune 每 run | cooldown | 空则删 |
| prospectCooldown (Mem) | prospect:167 | :249 | targets | prune 每 run | cooldownTicks | 空则删 |
| experience ring (A6 heap) | collector | attribution/calib | 500 | age 10kt | ≤10kt | reset |
| prediction ring (A6 heap) | prediction-system | resolution | 200 | rollover 弃 | ≤endTick+100 | reset |
| calibration ring (A6 heap) | resolution-sys | profile | 500+profiles10 | age 100kt | ≤100kt | reset |
| recommendation caches (A6 heap) | rec-engine | （无外部消费者） | 100+30 | age 50kt | ≤50kt | reset |

## 4. Spawn/Demand/Economy 长期行为要点（§八/§九 结论并入）

- **队列不可能无界**：key 族不含时间成分；transportPool/fillReservations 每 tick 重建（SPAWN 审计 F 系列）。
- **RCL8 能量终局**：upgrader 目标=0、link 停喂后，storageNearFull 只节流不加速消费 → 盈余以 container
  溢出 drop 衰减的形式永久流失。这是**结构性损耗设计缺口**（F6, P2），非泄漏；建议后续给 RCL8 增加
  sink 加速器（GCL farm/powerSpawn 满负荷/军事储备）。
- **Source 占用不会卡死**：occupancy 每 tick 从活体重建，敌离即恢复。
- **建造/维修缓存**：ERR_INVALID_TARGET 即清 + 快照下一 tick 自愈，无 stale target 积累。
- **claimer 幽灵请求**（F1, P2）：abort 后 home=sponsor 的 claimer 不在取消通道内，≤1000t 内可能孵向废目标。

## 5. 结论

资源安全性 GREEN except 两点：GC-1（hysteresisCache 无界，慢速）与 F6（RCL8 终局能量 bleed，
设计层）。二者均不阻断长期运行上线，分别列入 SHOULD_FIX 与技术债。
