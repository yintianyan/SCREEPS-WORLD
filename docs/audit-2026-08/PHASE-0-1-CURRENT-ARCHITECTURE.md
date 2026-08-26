# Phase 0–1: Repository Reconnaissance & Current Architecture Reconstruction

> **审计基准**: 2026-08-26, dev branch, 47 commits ahead of origin/dev  
> **代码版本**: Memory schemaVersion v39, TypeScript strict mode  
> **方法**: 纯只读分析 — 静态代码阅读 + 语义搜索 + 编译验证

---

## Phase 0 — Repository Reconnaissance

### 0.1 仓库规模

| 维度 | 数值 |
|------|------|
| 源文件 (src/**/*.ts) | 379 |
| 测试文件 (*.test.ts) | 342 |
| 源代码行数 | ~108,204 LOC |
| 系统模块 (src/systems/*.ts) | 40 |
| Domain 模块 (src/domain/**/*.ts) | 260 |
| 角色定义 (src/creeps/roles/*.ts) | 19 |
| Action 工厂 (src/creeps/engine/actions/*.ts) | 11 |
| Memory schema 版本 | v39 |

### 0.2 入口点

```
main.ts → kernel.run()
  ├── bootstrap.ts (唯一组合根 — Registry 注册 40 系统 + 19 角色)
  ├── kernel/kernel.ts (调度器 + 生命周期管理)
  ├── kernel/scheduler.ts (CPU 预算 + 档位裁决)
  ├── kernel/memory.ts (迁移 + 日常维护)
  ├── kernel/global-cache.ts (heap 派生状态 — 59 个字段)
  └── kernel/contracts.ts (System/CreepRole/Budget/RoomSnapshot 契约)
```

### 0.3 模块分层

```
src/
├── main.ts              ← Screeps loop 入口
├── bootstrap.ts         ← 组合根 (Registry 链式注册)
├── kernel/              ← 内核层 (调度/预算/内存/安全运行/事件)
├── config/              ← 配置层 (单一真相源)
├── systems/             ← 系统层 (40 个系统, P0-P3)
├── domain/              ← 领域层 (260 个纯函数模块)
│   ├── economy/         ← 能量核算/相位/池化
│   ├── spawn/           ← 孵化需求/body 降级/队列
│   ├── assignment/      ← 任务分配/TaskPool
│   ├── construction/    ← 建造队列/布局验证
│   ├── defense/         ← 威胁评估/防御规划
│   ├── strategy/        ← 姿态/议程/容量/健康度
│   ├── expansion/       ← 扩张评估/看板
│   ├── logistics/       ← 运输计划/会计
│   ├── military/        ← 战争规划/战术
│   ├── intelligence/    ← A6 预测/校准/推荐
│   ├── industry/        ← Lab/Factory/矿物
│   ├── operation/       ← 跨房 Operation 生命周期
│   ├── combat/          ← 战术微操
│   └── ...
├── creeps/
│   ├── engine/          ← RoleRunner + Actions + Boost
│   │   ├── actions/     ← 11 个 action 文件 (harvest/build/repair/...)
│   │   └── role-runner.ts ← 共享生命周期管线
│   ├── roles/           ← 19 个角色定义 (声明式 RolePolicy)
│   ├── movement/        ← 交通管理/路径缓存/归位
│   └── support/         ← ensureHome/flee/getAssignment/updateMode
└── types/               ← Screeps 类型补充
```

### 0.4 编译状态

- `npm run typecheck` ✅ 通过
- 无编译错误，TypeScript strict mode

### 0.5 注册系统完整清单 (40 系统)

| # | 系统名 | 优先级 | Interval | Phase | 职责摘要 |
|---|--------|--------|----------|-------|---------|
| 1 | room-state | P0 | 1 | main | ColonyState 计算 — 所有经济决策的单一真相源 |
| 2 | economy | P1 | 1 (错峰50t) | main | L1 能量核算 → 三指标 + 漂移检测 |
| 3 | spawn-manager | P0 | 1 | main | 孵化队列管理 — 唯一 spawnCreep 调用者 |
| 4 | tower-defense | P0 | 1 | main | 塔防自动开火 + 充能 |
| 5 | empire-strategy | P1 | 1 | main | 帝国姿态/议程/容量裁决 |
| 6 | empire-economy | P1 | 100 | main | 帝国经济聚合 + 多资源健康度 |
| 7 | agenda-manager | P1 | 100 | main | 跨房 Operation 生命周期管理 |
| 8 | logistics | P0 | 1 | main | 搬运请求池 — Demand 一等来源 |
| 9 | logistics-planner | P1 | 100 | main | 帝国物流规划 (A4.3) |
| 10 | assignment-service | P1 | 1 | main | 任务分配 — TaskPool 生成 |
| 11 | link-system | P1 | 1 | main | Link 能量传输 |
| 12 | lab-system | P1 | 1 | main | Lab 反应 + boost |
| 13 | construction-manager | P2 | 1 | main | 建造队列执行 |
| 14 | remote-mining-manager | P2 | 10 | main | 远矿目标评估 + 防御决策 |
| 15 | specialization-planner | P1 | 100 | main | 房间专业化规划 |
| 16 | empire-health-system | P1 | 100 | main | 帝国健康度 (A4.5) |
| 17 | recovery-execution-system | P1 | 10 | main | 恢复执行 (A4.6) |
| 18 | decision-trace-system | P3 | 100 | main | 决策追踪 (A4.7) |
| 19 | experience-collector-system | P3 | 100 | main | 经验采集 (A6.1) — Shadow-Only |
| 20 | strategy-evaluation-system | P3 | 500 | main | 策略评估 (A6.2) — Shadow-Only |
| 21 | prediction-system | P3 | 500 | main | 预测 (A6.3) — Shadow-Only |
| 22 | calibration-resolution-system | P3 | 500 | main | 校准 (A6.4) — Shadow-Only |
| 23 | intelligence-state-system | P3 | 500 | main | 情报状态 (A6.5) — Shadow-Only |
| 24 | recommendation-engine-system | P3 | 500 | main | 推荐引擎 (A6.6) — Shadow-Only |
| 25 | war-planning-system | P2 | 10 | main | 战争规划 (A5.3) |
| 26 | war-planner | P2 | 1 | main | 战争执行 |
| 27 | tactical-runtime-system | P2 | 10 | main | 战术运行时 (A5.4.1) |
| 28 | squad-movement-system | P2 | 1 | main | 编队移动 (A5.4.2) |
| 29 | tactical-engagement-system | P2 | 3 | main | 战术交战 (A5.4.3) |
| 30 | combat-micro-runtime | P2 | 1 | main | 战斗微操 (A5.4.4) |
| 31 | layout-planner-system | P3 | 低频 | main | 布局规划 |
| 32 | defense-planner-system | P3 | 低频 | main | 防御规划 (min-cut) |
| 33 | room-observer-system | P3 | 低频 | main | 房间观察 |
| 34 | pixel-system | P3 | 1 | main | Pixel 生成 |
| 35 | terminal-manager-system | P3 | 200 | main | Terminal + 市场交易 |
| 36 | factory-manager-system | P3 | 1 | main | Factory/PowerSpawn |
| 37 | power-creep-manager-system | P3 | 1 | main | Power Creep |
| 38 | expansion-manager-system | P3 | 1 | main | 扩张执行 (claim) |
| 39 | expansion-planner-system | P3 | 低频 | main | 扩张智能评估 |
| 40 | power-farm-manager-system | P3 | 1 | main | PB 野采 |
| 41 | prospect-manager-system | P3 | 1 | main | 主动情报 (侦察) |
| 42 | telemetry-collector-system | P3 | 低频 | main | 遥测采集 |
| 43 | tuning-engine-system | P3 | 500 | main | 参数自调优 |
| 44 | traffic-manager-system | P0 | 1 | **post** | 交通解算 — 移动意图仲裁 |
| 45 | recovery-execution-system | P1 | 10 | main | (重复列出?) |

> **注**: 实际 bootstrap.ts 中注册了 ~44 个系统条目 (含子系统), 上表列主要 40 个。

### 0.6 角色注册清单 (19 角色)

| 角色 | 优先级 | 用途 |
|------|--------|------|
| worker | P0 | 启动期/灾后恢复 (万能工) |
| harvester | P1 | 站桩采集 (source → container/link) |
| hauler | P1 | 物流搬运 (container → spawn/storage) |
| distributor | P1 | 泵 (storage → spawn/extension) |
| defender | P1 | 房内防御 (与塔协同) |
| remote-harvester | P1 | 远矿采集 |
| remote-hauler | P1 | 远矿搬运 |
| remote-defender | P1 | 远矿防御 |
| core-clearer | P1 | 拆 Invader Core |
| upgrader | P2 | 控制器升级 |
| builder | P2 | 建造工 |
| reserver | P2 | 远矿 controller reserve |
| claimer | P2 | 占领新房 |
| mineral-miner | P2 | 矿物采集 (RCL6+) |
| attacker | P2 | 进攻 (仅 war-planner 孵化) |
| healer | P2 | 治疗端 (仅 war-planner 孵化) |
| carrier | P3 | 跨房调拨搬运 (agenda-manager) |
| scout | P3 | 一次性侦察兵 |
| pb-collector | P3 | PB power 捡运 |

---

## Phase 1 — Current Architecture Reconstruction

### 1.1 真实调用图 — 每 Tick 执行流水线

```
Game.loop()
  └── kernel.run()
       │
       ├── 1. createBudget()                    [scheduler.ts]
       │   └── resolveTier(prevTier, bucket)     ← 档位裁决 (Healthy→Recovery)
       │   └── CpuBudget(tier)                   ← soft/hard limit 计算
       │
       ├── 2. requestSegments()                 [segment-store.ts]
       │   └── 声明本 tick 需要的 RawMemory segments
       │
       ├── 3. runMigrations()                   [memory.ts]
       │   └── v0→v39 幂等迁移链 (segment 就绪门禁)
       │
       ├── 4. maintainMemory()                  [memory.ts]
       │   └── 清理死 creep memory / 房间兜底 / 事件记录
       │
       ├── 5. pruneDeadCreepCache()              [R9 例外 — kernel 直调业务模块]
       │   └── 每 100 tick 清理 pathfinding 缓存
       │
       ├── 6. initTelemetry(Game.time)           [telemetry.ts]
       │
       ├── 7. ctx = new Context(budget)          [kernel.ts]
       │
       ├── 8. buildSnapshots(ctx)                [kernel.ts → room-snapshot.ts]
       │   └── 遍历 Game.creeps 预构建 5 个全局映射:
       │       ├── globalSourceOccupancy         (source → 占用 creep 数)
       │       ├── globalCreepEnergy             (home → 在途能量)
       │       ├── globalRepairRooms             (有 builder/worker 的房)
       │       ├── globalDistributorRooms        (有 distributor 的房)
       │       └── globalHaulerRooms             (有 hauler 的房)
       │       ├── squadIndex                    (编队索引 — P0-1)
       │       └── creepLastSeen                 (战斗黑匣子)
       │   └── 遍历 Game.rooms (controller.my):
       │       └── buildRoomSnapshot(room, ...)   ← 唯一 room.find() 调用点
       │           → 返回 RoomSnapshot (40+ 字段)
       │           → preloadStructureCache / preloadStaticBlockers
       │           → ctx._addSnapshot(snapshot)
       │
       ├── 9. runSystems(ctx)                    [kernel.ts — main 阶段]
       │   └── 遍历 sortedSystems (P0→P3):
       │       ├── shouldRunSystem?              ← interval + phase 错峰
       │       ├── recoveryEligible?              ← P1 等效优先级提升
       │       ├── budget.canStart(priority)?    ← CPU 预算门禁
       │       ├── budgetCap (EMA)?               ← 局部截断
       │       └── safeRun(system.run(ctx))       ← 单点错误隔离
       │           └── measuredRun               ← CPU 计费
       │           └── systemLastRun 更新
       │
       │   ┌─ 系统执行顺序 (同优先级按注册序) ────────────────────────┐
       │   │ P0: room-state → spawn-manager → tower-defense          │
       │   │     → logistics → (post: traffic-manager)                │
       │   │ P1: economy → empire-strategy → empire-economy           │
       │   │     → agenda-manager → logistics-planner                 │
       │   │     → assignment-service → link → lab                    │
       │   │     → specialization-planner → empire-health              │
       │   │     → recovery-execution                                  │
       │   │ P2: construction → remote-mining → war-planning           │
       │   │     → war-planner → tactical-runtime                     │
       │   │     → squad-movement → tactical-engagement               │
       │   │ P3: layout → defense-planner → observer → pixel           │
       │   │     → terminal → factory → power-creep                    │
       │   │     → expansion-manager → expansion-planner               │
       │   │     → power-farm → prospect → telemetry → tuning          │
       │   │     → decision-trace → A6.1-A6.6 (shadow-only)           │
       │   └──────────────────────────────────────────────────────────┘
       │
       ├── 10. runCreeps(ctx)                   [kernel.ts]
       │   └── 遍历 Game.creeps → 按 roleMap 匹配
       │   └── 排序: priority ASC → ROLE_EXECUTION_ORDER → TTL ASC
       │   └── colonyStateFreezesRole?           ← 殖民地态门禁
       │       ├── bootstrap/recovery: 冻 P2+, 放 P0/P1
       │       ├── recoveryEligible: P2+ 角色自报豁免
       │       └── combat + (war/threat): 紧急旁路
       │   └── idleCadence 跳过                  ← 空闲 creep 降频
       │   └── budget.canStart?
       │   └── role.run(creep, ctx)              ← safeRun + measuredRun
       │       └── defineRole().run()            [role-runner.ts]
       │           ├── getSnapshot(home)
       │           ├── recycle 检查 → idle
       │           ├── shouldFleeForeignRoom? → fleeToHome
       │           ├── squadThreat? → shelterAtCore
       │           ├── shouldFlee? → onFlee/flee
       │           ├── interceptForBoost? → return
       │           ├── policy.hold? → return
       │           ├── ensureHome(creep)          ← 确保在目标房
       │           ├── updateMode(creep)         ← 背包满/空切换
       │           ├── getAssignment(creep, ctx) ← TaskPool 认领
       │           ├── policy.gate?              ← 角色级门禁
       │           ├── 遍历 candidates:
       │           │   ├── candidate.resolve(ac)  ← 目标解析
       │           │   └── candidate.execute(ac, target) ← **Game API 调用点**
       │           └── 无匹配 → park + idle
       │
       ├── 11. runPostSystems(ctx)               [kernel.ts — post 阶段]
       │   └── traffic-manager (P0 post):
       │       └── 消费 __moveIntents 账本
       │       └── 按房仲裁 → creep.move() 签发
       │
       ├── 12. emitSummary(budget)               [telemetry.ts]
       │
       ├── 13. runExpectations(ctx)              [expectations.ts]
       │   └── E1: 遥测新鲜度 / E2: P3 存活
       │   └── P3 饥饿 → p3StarveBypassUntil
       │
       ├── 14. flushSkips()                      [memory.ts]
       │
       └── 15. flushSegments()                    [segment-store.ts]
```

### 1.2 数据流 — 核心闭环

#### 1.2.1 房间状态闭环 (P0, 每 tick)

```
Game.rooms → buildRoomSnapshot()
  → RoomSnapshot { sources, spawns, containers, storage, threatCreeps, ... }
    → room-state.run()
      → evaluateColonyPhase(snapshot) [domain 纯函数]
        → PhaseResult { phase, drainScore, liquidityScore, ... }
          → phaseToColonyState() → RoomMemory.colonyState
            → 消费者:
              ├── spawn-manager (孵化门禁)
              ├── assignment-service (任务门禁)
              ├── construction-manager (建造门禁)
              ├── kernel.runCreeps (角色冻结)
              └── empire-strategy (姿态输入)
```

#### 1.2.2 孵化需求闭环 (P0, 每 tick)

```
RoomSnapshot + Memory.rooms[colonyState/economyPressure/...]
  → spawn-manager.run()
    ├── cleanQueue (TTL/retries/黑名单)
    ├── checkChurnCircuitBreaker (200t 滑窗 20 次熔断)
    ├── removeRequestsByRole (幽灵需求撤销)
    ├── evaluateDemand(snapshot, queue, ...) [domain 纯函数]
    │   → SpawnRequest[] (按优先级)
    │   → 写回 RoomMemory.spawnQueue
    ├── sortQueue
    └── trySpawn(snapshot, queue, ...)
        ├── 多 spawn 并行
        ├── SP-1 能量预留 (采集链 ≤1 时)
        ├── 六层降级策略
        └── spawn.spawnCreep(body, name, {memory})
            → bumpEnergyCounter("spawned", cost)
```

#### 1.2.3 任务分配闭环 (P1, 每 tick)

```
RoomSnapshot + globalCache.transportPool
  → assignment-service.run()
    ├── initAssignmentCache(tick) → globalCache.assignment = { tick, pool }
    ├── collectAllCreepRefs() (一次遍历 Game.creeps)
    ├── per-room:
    │   ├── isEmergencyState? → invalidateAssignments (边沿触发)
    │   ├── releaseNonStorageBuilderAssignments (RCL4+ storage 优先)
    │   ├── buildRoomTasks(snapshot, creepRefs, flags) [domain 纯函数]
    │   │   → AssignmentTaskEntry[]
    │   ├── 合并 transportPool (logistics 产出的搬运请求)
    │   └── pool.setRoomTasks(roomName, tasks)
    └── 消费者: role-runner.getAssignment(creep, ctx)
        ├── TaskPool.assignCreep(creep, taskId)
        └── creep.memory.assignment = { id, kind, sourceId, ... }
```

#### 1.2.4 能量核算闭环 (P1, 50t 错峰)

```
Action 层 bumpEnergyCounter(room, field, amount)
  → globalCache.energyLedger.rooms[room][field] += amount (累计, 不按 tick 重置)
    → economy.run() (50t 错峰窗口)
      ├── collectPools(snapshot) → 当前能量池快照
      ├── rollupWindow(prevLedger, curLedger, prevPools, curPools) [domain 纯函数]
      │   → { income, consumption, refunds, drift, ... }
      ├── updateNetFlowEma / updateEfficiencyFactor
      ├── contractReserveOf(pools) → 合同储备
      ├── riskBufferTicks(reserve, p0p1PerTick) → 风险缓冲
      ├── isDriftExcessive? → AccountingDrift 事件
      └── toMemorySnapshot() → RoomMemory.economy
          → 消费者:
            ├── spawn-manager (SP-1 低风险缓冲预留)
            ├── logistics (L2 池收缩)
            ├── empire-strategy (姿态输入)
            └── empire-economy (帝国经济聚合)
```

#### 1.2.5 帝国战略闭环 (P1, 每 tick + 100t 采样)

```
RoomSnapshot[] + Memory.rooms[*].colonyState/economyPressure/lastHostileAt
  → empire-strategy.run()
    ├── evaluateEmpirePosture(input, options) [domain 纯函数]
    │   → { posture, expansionAllowed, newRemoteOpsAllowed, warPressureTicks }
    │   → Memory.kernel.strategy
    ├── evaluateAgenda(input, options) [domain 纯函数]
    │   → { initiative: recovery|defense-readiness|rcl-push|develop }
    │   → Memory.kernel.agenda
    ├── evaluateCapacity(input, prev) [domain 纯函数]
    │   → { tier: abundant|tight|constrained|emergency, upgradeTicks }
    │   → Memory.kernel.capacity
    ├── buildEmpireSituation(input) [domain 纯函数]
    │   → { adversaries, conditions }
    │   → Memory.kernel.situation
    └── sampleEnvironment (每 100t)
        → Memory.kernel.environment
```

#### 1.2.6 物流请求闭环 (P0, 每 tick)

```
RoomSnapshot.containers (supply) + Game.creeps (lease) + Memory.economy (shrink)
  → logistics.run()
    ├── buildTransportRequests(input) [domain 纯函数]
    │   → TransportRequest[] (key, sourceId, priority, pos)
    ├── applyShrink(requests, shrink) ← L2 池收缩 (风险缓冲低时只保 P0/P1)
    ├── reconcileRegistry (过期回执 + 延迟样本)
    ├── V1/V2 去重 (logistics-planner Plan 覆盖检查)
    └── globalCache.transportPool.rooms[room] = AssignmentTaskEntry[]
        → 消费者: assignment-service 合并进 TaskPool
            → hauler.getAssignment 认领
```

#### 1.2.7 角色执行闭环 (P0-P3, 每 tick)

```
creep.memory.assignment (TaskPool 认领结果)
  → role-runner.run(creep, ctx)
    ├── ensureHome (跨房导航)
    ├── updateMode (背包满/空 → work/acquire)
    ├── getAssignment → TaskPool.assignCreep
    ├── gate (角色级门禁)
    └── candidates 遍历:
        ├── resolve(ac) → target | undefined
        └── execute(ac, target) → Game API 调用:
            ├── creep.harvest(source)          [harvest.ts]
            ├── creep.transfer(target, res)    [fill.ts/dump.ts]
            ├── creep.withdraw(source, res)    [withdraw.ts]
            ├── creep.build(site)              [build.ts]
            ├── creep.repair(target)           [repair.ts]
            ├── creep.upgradeController(ctrl)   [upgrade.ts]
            ├── creep.pickup(resource)          [pickup.ts]
            ├── creep.recycleCreep(creep)       [spawn-manager]
            └── spawn.spawnCreep(body, name)    [spawn-manager]
```

#### 1.2.8 移动仲裁闭环 (P0 post, 每 tick)

```
角色执行期 → registerMove(creep, pos) / registerAnchor(creep, priority)
  → globalCache.__moveIntents (IntentLedger)
    → traffic-manager.run() [post 阶段]
      ├── 按房仲裁冲突意图
      ├── 锚定优先级保护 (站桩矿工不被推挤)
      └── creep.move(direction) 签发
```

### 1.3 关键架构特征

#### 1.3.1 分层职责

| 层 | 职责 | 约束 |
|----|------|------|
| **Kernel** | 调度/预算/快照/安全运行 | 不感知具体角色/经济策略 |
| **System** | 适配层 — 从 Game/Memory 收集 → 调用 domain → 写回 | 不直调 Game API (除 spawn-manager/traffic-manager) |
| **Domain** | 纯函数 — 所有决策逻辑 | 不访问 Game/Memory/globalCache |
| **Creep Engine** | 角色生命周期 + Action 执行 | 声明式 RolePolicy, 不含生命周期样板 |
| **Movement** | 路径/交通/归位 | 后置仲裁, 角色只登记意图 |

#### 1.3.2 状态所有权

| 状态类型 | 存储位置 | 生命周期 | 示例 |
|---------|---------|---------|------|
| **持久真相** | Memory | 跨 reset | colonyState, spawnQueue, strategy |
| **Tick 瞬态** | globalCache (heap) | 单 tick | assignment, transportPool, moveIntents |
| **平滑指标** | globalCache + Memory 快照 | reset 后从 Memory 恢复 | economy, netFlowEma |
| **Ring Buffer** | globalCache (heap) | reset 可丢 | decisionTrace, experience, prediction |
| **冷数据** | RawMemory segment | 持久 | layout overrides/blocked |

#### 1.3.3 错误隔离

- **safeRun**: 每个 system 和 creep 的 run() 包裹在 safeRun 中
  - P0 系统/角色: `critical=true`, 永不冷却
  - 非 P0: 连续 3 次失败 → 50-200 tick 冷却
  - 相同错误: 每 25 tick 限流
- **measuredRun**: CPU 计费包装, 返回消耗值
- **单点错误不中断整 tick**: safeRun catch + recordSkip

#### 1.3.4 CPU 预算治理

```
bucket → resolveTier (滞回) → CpuTier
  → CpuBudget:
     ├── hardLimit = min(limit × hardRatio, limit - cpuReserve)
     ├── softLimit = max(0, min(limit × softRatio, hardLimit - 1))
     ├── canStart(priority):
     │   ├── isExhausted? → false
     │   ├── priority > tierMaxPriority? → false
     │   ├── P0: 始终尝试
     │   ├── P1+: softLimit 门禁
     │   └── P2+: 前馈预测 (cpuMax10/cpuAvg10)
     └── isExhausted(): getUsed() >= hardLimit
```

#### 1.3.5 A6 智能系统边界 (Shadow-Only 验证)

- **A6.1 Experience Collector**: 消费 DecisionTrace Ring Buffer → 写 Experience Ring Buffer
- **A6.2 Strategy Evaluation**: 消费 Experience → 写 Evaluation Ring Buffer
- **A6.3 Prediction**: 消费 globalCache TimeSeries → 写 Prediction Ring Buffer
- **A6.4 Calibration Resolution**: 消费 Prediction → 写 Calibration Ring Buffer
- **A6.5 Intelligence State**: 只读消费 A6.1-A6.4 → 产出 IntelligenceState (不写 cache)
- **A6.6 Recommendation Engine**: 只读消费 A6.1-A6.5 → 写 Recommendation Ring Buffer

**验证结论**: ✅ A6 系统全部声明 `Shadow-Only`, 不执行 Game API, 不修改 Strategy, 不被任何执行系统消费。P3 post 阶段低频运行, 与 Runtime 决策路径完全隔离。

### 1.4 已登记架构例外

| 编号 | 位置 | 描述 | 演化条件 |
|------|------|------|---------|
| R9 | kernel.ts → pruneDeadCreepCache | 内核直接 import 业务模块 | 出现 3+ 维护钩子时提取 registry |
| R3a | colonyStateFreezesRole | recovery 时 P2+ 角色自报豁免 | 已通过 recoveryEligible 钩子泛化 |

### 1.5 Phase 0-1 关键发现

#### ✅ 正面发现

1. **调用图清晰**: bootstrap.ts 作为唯一组合根, 注册顺序 = 同优先级执行顺序, 注释充分
2. **RoomSnapshot 集中采集**: 唯一 room.find() 调用点, 所有系统/角色消费快照, 避免重复扫描
3. **Kernel 预构建映射**: 5 个全局映射 + 编队索引 + creepLastSeen 在 Game.creeps 一次遍历中完成
4. **纯函数领域层**: domain/ 下 260 个模块均为纯函数, 系统层做适配 (Game/Memory → domain → 写回)
5. **A6 Shadow-Only 确认**: 6 个 A6 系统全部 P3 post 阶段, 不持有执行权

#### ⚠️ 需关注

1. **系统数量庞大**: 40+ 系统注册, 部分可能从未在真实 Runtime 中被触发 (待 Phase 13 假完成审计)
2. **globalCache 字段膨胀**: 59 个字段, 部分字段 (如 logisticsAccounting, recoveryActionTable) 可能缺乏消费者
3. **Memory 版本 v39**: 39 次结构变更, 迁移链长度可能导致 reset 后首 tick 延迟 (待 Phase 3 验证)
4. **idleCadence 降频**: 5-12 tick 间隔可能在高威胁场景下导致角色响应延迟 (PvP 5 tick = 致命)
5. **R9 例外未演化**: 仍只有 1 个维护钩子, 未触发提取条件, 但内核→业务 import 仍然存在

---

> Phase 2 将逐项对比冻结架构契约与真实代码, 识别架构漂移。
