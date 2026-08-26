# Phase 4-5: Single Room RCL1-RCL8 + Economy/Spawn/Creep Execution Audit

> **审计基准**: 2026-08-26
> **方法**: 逐级追踪能量流闭环 + Spawn 需求链 + Creep 执行路径 + 边界条件模拟

---

## 4.1 单房间生存闭环 — RCL1 → RCL8 逐级验证

### 4.1.1 RCL1 (300 能量容量) — Bootstrap 期

**起点**: Global Reset / 新 claim 后首 tick。

**闭环路径**:
```
1. room-state (P0): colonyState = bootstrap (harvesterCount=0 → understaffed)
2. spawn-manager (P0): livingHarvesters=0 → P0 worker 请求 [W,C,M] @200
3. trySpawn: energyAvailable ≥ 200 → spawnCreep 成功
4. worker.run: acquire → harvestSource (getSource 分配)
5. worker.run: work → fillTarget (spawn/extension) / upgradeController
6. economy (P1): 50 tick 后首窗 rollup → netFlowEma 播种
7. room-state: harvesterCount=1 → colonyState → growth (reserve 在涨)
```

**验证点**:
| 检查项 | 代码实现 | 裁决 |
|--------|---------|------|
| 首 tick 能量来源 | 初始 300 能量 (Game.rooms.room.energyAvailable) | ✅ |
| P0 worker body | `RECOVERY_BODY = [W,C,M]` @200 | ✅ |
| 降级守卫 | `degradeBody` 保证 MOVE ≥ ceil(nonMove/2) | ✅ |
| source 分配 | `getSource` 公平份额 (含拥挤迁移) | ✅ |
| 填充 spawn | `fillTarget` 在 worker work 链 | ✅ |
| 升级 controller | `upgradeController` 在 worker work 链尾 | ✅ |

**风险**:
- 🟡 如果 `Game.rooms[snapshot.roomName]?.energyAvailable` 在 spawn-manager 中读不到（snapshot 时序问题），会 fallback 到 `?? 200`。实际 Screeps 中 `Game.rooms[name].energyAvailable` 是同步可用的，但代码中 `roomCtx.energyAvailable` 从 `Game.rooms` 直接读取，**不使用 snapshot 中的值** — 这是有意为之（spawn-manager 需要实时值而非 tick 开始快照），但如果 `Game.rooms` 没有 room 对象（无视野），会 fallback 到 200。

**裁决**: ✅ RCL1 生存闭环完整。

### 4.1.2 RCL2-3 (550-800 能量容量) — 早期发展

**闭环路径**:
```
1. room-state: colonyState → growth (harvesterCount ≥ sourceCount)
2. spawn-manager: harvester (5W@600 或降级档), hauler (需 container), upgrader
3. construction-manager: source container site (layout-planner 规划)
4. harvester.run: stationaryMine (站桩采集 + 同 tick 倒能到 container)
5. hauler.run: withdrawRichestCapped → fillStorage / haulFillTarget
6. upgrader.run: withdrawControllerContainer → upgradeController
```

**关键验证**:
| 检查项 | 代码实现 | 裁决 |
|--------|---------|------|
| harvester body 递进 | 5W@600 → 4W@500 → 3W@400 → 2W@300 → 1W@200 | ✅ 平滑降级 |
| hauler 需求触发 | container fillRatio > 0.8 → +2, > 0.4 → +1 | ✅ 动态信号 |
| hauler 无 container 不孵 | `hasLogistics = containers.length > 0 || storage !== undefined` | ✅ |
| upgrader 门禁 | `energyAvailable < floor` 时 gate 拦截 acquire | ✅ 不与 spawn 竞争 |
| builder 需求 | site 数 > 0 → 动态目标 | ✅ |
| colonyState 振荡防护 | minBandTicks=100 + drainScore/liquidityScore 双迟滞 | ✅ |

**流动性陷阱检测** (W37S58 实测根因):
```
spendableRatio < 0.15 (spawn 破产)
  AND frozenRatio > 0.8 (能量冻在 container)
  → liquidityScore 累积
  → crisis 通道 (绕过迟滞)
  → hauler 满量孵化 (liquidityDriven 分支)
```
✅ 已修复 — liquidityScore 与 drainScore 独立计算，任一爆表即 crisis。

**裁决**: ✅ RCL2-3 闭环完整，流动性陷阱有专门通道。

### 4.1.3 RCL4 (1300 能量容量) — Storage 转折点

**闭环路径变化**:
```
1. construction-manager: storage site 创建 (layout-planner 规划)
2. builder: buildNearestSite (storage 优先级)
3. storage 建成后:
   - hauler: acquire → fillStorage (work 链首位)
   - distributor: 新角色 (storage → spawn/extension/tower)
   - upgrader: withdrawStorageCapped (动态限量)
4. colonyState 评估: reserve 包含 storage 能量
```

**关键验证**:
| 检查项 | 代码实现 | 裁决 |
|--------|---------|------|
| storage 创建门禁 | `developmentGate`: economyPressure < 0.8 + energy 盈余 | ✅ |
| distributor 需求触发 | `hasStorage` → distTarget = fillCount / fillPerDistributor | ✅ |
| hauler/distributor 职责分离 | hauler: container→storage; distributor: storage→sink | ✅ |
| distributor 升编迟滞 | `distScaleUpSince` + `distributorScaleUpDelay` | ✅ 防尖峰扩编 |
| upgrader storage 取能限量 | `dynamicStorageLimit` 按水位 4 档 | ✅ |
| builder storage 取能限量 | `builderStorageLimit` 按水位 3 档 | ✅ |
| 道路优化 body | RCL4+ hauler/distributor 走 `ROAD_OPTIMIZED_BODIES` | ✅ |

**distributor 降级为 hauler 的安全性**:
```typescript
// distributor.ts gate:
if (!ac.snapshot.storage) {
  ac.creep.memory.role = "hauler";  // 降级
  return false;
}
```
✅ storage 被毁后 distributor 降级为 hauler 继续工作，不空转。

**裁决**: ✅ RCL4 storage 转折点闭环完整。

### 4.1.4 RCL5 (1800 能量容量) — Link 网络

**闭环路径变化**:
```
1. construction-manager: source link + controller link + storage link site
2. link-system: source link → storage link 瞬移
3. harvester: stationaryMine → dumpToNearbyLink (优先于 container)
4. hauler: withdrawStorageLink (排空 storage link) — acquire[0]
5. upgrader: withdrawControllerLink (0 通勤取能)
6. hauler 需求信号: storage link fillRatio > 0.8 → +2
```

**关键验证**:
| 检查项 | 代码实现 | 裁决 |
|--------|---------|------|
| link 角色分类 | `classifyLinkRole` (source/controller/storage) | ✅ |
| source link 背压检测 | hauler 需求中排除有 link 的 container | ✅ |
| storage link 排空信号 | `linkFillRatio > 0.8 → +2` | ✅ |
| controller link 供能检测 | `feedingController` 时跳过 storage link 信号 | ✅ 防过孵 |
| upgrader 站桩升级 | `stationaryUpgrade` (withdraw + upgrade 同 tick) | ✅ |

**裁决**: ✅ RCL5 link 网络闭环完整。

### 4.1.5 RCL6-7 (2300-5600 能量容量) — 工业链

**闭环路径变化**:
```
1. construction-manager: extractor + terminal + factory + lab site
2. mineral-miner: harvestMineral → dumpMineralsToNearbyContainer
3. hauler: haulMineralsToStorage / haulMineralTopUp (能量装完后顺路取矿)
4. distributor: stockFactoryEnergy / stockFactoryBattery / supplyLabs
5. terminal: 市场交易 (market-manager)
6. factory: 压缩/解压 (factory-manager)
```

**关键验证**:
| 检查项 | 代码实现 | 裁决 |
|--------|---------|------|
| mineral-miner 需求 | RCL6+ extractor + mineralAmount > 0 | ✅ |
| mineral-miner body | 10W@1250 → 5W@650 → ... 降级 | ✅ |
| hauler 矿物搬运 | `haulMineralsToStorage` 在 work[0], `haulMineralTopUp` 在 acquire 尾 | ✅ |
| distributor 工业供料 | `stockFactoryEnergy/Battery/Components`, `supplyLabs` | ✅ |
| 矿物不占能量空间 | `dumpMineralsToNearbyContainer` 在 harvester work[1] | ✅ |
| recovery 豁免 | mineralMiner `recoveryEligible: true` | ✅ 矿物收入不耗能量 |

**裁决**: ✅ RCL6-7 工业链闭环完整。

### 4.1.6 RCL8 (12300 能量容量) — 满级稳态

**闭环路径变化**:
```
1. room-state: colonyState → steady (rcl≥8 && !understaffed)
2. upgrader: rcl8NoUpgrade → 停孵/停替换 (progress=0, 无降级风险)
3. harvester: 满配 5W 站桩 (source 再生 10/tick 恰好匹配)
4. hauler: 大运力档 [10C,10M]@1000 或道路优化 [32C,16M]@2400
5. builder: 大工地档 [16W,8C,12M]@2600
6. defender: 重防档 [8T,16A,16M]@2160 (TOUGH 前置吸塔伤)
7. upgrader: RCL8 限速 — 15W 恰好顶满官方 15 energy/tick 上限
```

**关键验证**:
| 检查项 | 代码实现 | 裁决 |
|--------|---------|------|
| RCL8 upgrader 停烧 | `rcl8NoUpgrade = rcl >= 8 && !hasDowngradeRisk` | ✅ |
| RCL8 upgrader 限速 | `maxCountByWork = floor(15 / workPerBody)` | ✅ |
| steady 相位 | `rcl >= 8 && !understaffed` → steady | ✅ |
| defender 满档 | `[8T,16A,16M]@2160` | ✅ |
| hauler 道路优化顶档 | `[32C,16M]@2400` | ✅ |

**裁决**: ✅ RCL8 稳态闭环完整。

---

## 5.1 能量流闭环 — Energy Accounting 深度审计

### 5.1.1 L1 计数器埋点完整性

**能量流闭环**:
```
Source(harvest) → Creep backpack → Container/Storage/Link → Sink(spawn/extension/tower/upgrade/build)
     ↓                    ↓                    ↓                    ↓
  harvested         carry delta          pool snapshot        upgraded/built/repaired/towerSpent
```

**埋点矩阵**:
| 能量动作 | 埋点字段 | 埋点位置 | 方法 | 裁决 |
|----------|---------|---------|------|------|
| harvest(source) | `harvested` | `helpers.ts:countedHarvest` | 背包差值 | ✅ |
| harvest(mineral) | `harvested` | `helpers.ts:countedHarvest` | 背包差值 | ✅ |
| pickup(dropped) | `pickedUp` | `actions/pickup.ts` | 背包差值 | ✅ |
| upgradeController | `upgraded` | `helpers.ts:countedUpgrade` | 背包差值 | ✅ |
| build(site) | `built` | `helpers.ts:runCountedAction` | 背包差值 | ✅ |
| repair(structure) | `repaired` | `helpers.ts:runCountedAction` | 背包差值 | ✅ |
| spawnCreep | `spawned` | `spawn-manager.ts:trySpawn` | `bodyCost(body)` 全额 | ✅ |
| recycle | `recycledRefund` | `recyclePass` | 按剩余寿命比例 | ✅ |
| tower attack/heal/repair | `towerSpent` | `tower-defense.ts` | 每次 10 | ✅ |

**埋点方法分析**:

动作层用**背包差值** (`accountFlow`)：
```typescript
const before = creep.store.getUsedCapacity(RESOURCE_ENERGY);
const result = action();
const delta = creep.store.getUsedCapacity(RESOURCE_ENERGY) - before;
bumpEnergyCounter(home, field, Math.abs(delta));
```

这比引擎常量换算（如 `WORK = 2 energy/harvest`）更准确 — 它捕获实际流量，包括 boost 效果、fatigue 导致的部分采集等。

**spawn 计费**用全额 `bodyCost(body)` 而非差值 — 这是正确的，因为 spawnCreep 是一次性消费（背包差值为 0，能量从 room 池消失）。

**裁决**: ✅ L1 埋点完整且口径正确。

### 5.1.2 L2 核算窗口 — 三指标

**核算流程** (economy.ts):
```
每 tick: (tick + roomHash(roomName)) % 50 === 0 → 结算
  1. 读取 globalCache.energyLedger.rooms[roomName] (累计计数器)
  2. 采集 EnergyPools (spawnExt + containers + storage + terminal + links + carry + towers + loose)
  3. rollupWindow(lastLedger, cum, lastPools, pools) → AccountingWindow
  4. 三指标更新:
     - netFlowEma = EMA(income - consumption + refunds / ticks)
     - contractReserve = storage + terminal + link 水位
     - riskBuffer = reserve / max(p0p1PerTick, ε)
  5. drift 检测: Δtracked - flowBalance - Δloose - Δother
  6. 写入 Memory.rooms[r].economy 瘦快照
```

**drift 恒等式**:
```
Δtracked_pools = flowBalance + Δloose + Δother + drift
drift = (trackedEnd - trackedStart) - (income - consumption + refunds) - looseDelta - otherDelta
```

- `tracked` = spawnExt + containers + storage + terminal + links + carry + towers
- `loose` = dropped + tombstone + ruin (自然衰减排除)
- `other` = 非能量资源 + 未知结构

**连续超容差 2 窗 → AccountingDrift 事件**。✅ 有告警机制。

**裁决**: ✅ L2 核算窗口设计严谨，drift 恒等式正确。

### 5.1.3 效率系数校准

```typescript
// 初值 0.7 (社区数)
// 实测: measuredIncomePerTick / (sourceCount × 10)
// EMA 平滑: effFactor += alpha × (measured - prev)
// 估计收入: sourceCount × 10 × effFactor
```

**校准链路**:
```
实际采得 → L1 harvested → L2 incomePerTick → efficiency → estimatedIncome
                                                    ↓
                                               demand 配额
```

**风险**: 🟡 如果 harvester 长期不工作（被 kill / flee），effFactor 会持续下降 → estimatedIncome 偏低 → demand 可能误判为"不需要更多 harvester"。但 `understaffed` 判定（`harvesterCount < sourceCount`）独立于效率系数，会触发 bootstrap 相位强制孵化。✅ 有兜底。

**裁决**: ✅ 效率系数校准闭环正确，有独立兜底。

### 5.1.4 能量流 → 决策反馈

**反馈链路**:
```
Economy 三指标 → roomMem.economy (瘦快照)
  → room-state: economyPressure = f(drainScore, liquidityScore)
  → spawn-manager: roomCtx.economyPressure → hauler/builder/upgrader 梯度缩放
  → construction-manager: developmentGate(economyPressure) → 建造门禁
  → empire-strategy: posture 评估 (各房 economyPressure 汇总)
  → tuning-engine: 参数自调优 (economy 采样驱动)
```

**关键反馈路径验证**:
| 反馈路径 | 输入 | 输出 | 裁决 |
|---------|------|------|------|
| hauler 梯度缩放 | economyPressure > 0.6 | `dynamicHaulerTarget × (1 - (p-0.6)/0.4)` | ✅ |
| builder 迟滞带 | economyPressure > 0.35 进入 shrinking | `builderTarget 线性收缩到 minCount` | ✅ |
| upgrader 取能量门禁 | storage < floor | `dynamicStorageLimit → 0` 停止取能 | ✅ |
| 建造门禁 | economyPressure > 0.8 | `developmentGate → false` | ✅ |
| spawn 饥饿降级 | waitTicks > 2×spawnTime | `allowDegrade = true` | ✅ |

**裁决**: ✅ 能量流 → 决策反馈闭环完整，多维度梯度响应。

---

## 5.2 Spawn 需求链 — 从评估到孵化

### 5.2.1 evaluateDemand 需求评估

**优先级序**:
```
P0: worker (livingHarvesters === 0) → 早期 return，阻塞后续
P1: defender (threatCreeps > 0) → squad 升级 P0
P1: harvester (按 source 占用分配，饱和封顶)
P1: hauler (container/link 积压信号驱动)
P1: distributor (fillTarget 需求 + cc 供能)
P2: mineralMiner (RCL6+ extractor + mineral)
P2: upgrader (storage 水位 + pressure 驱动)
P2: builder (site 数 + backlog + 道路维修)
替换: 将死 creep (4 重门禁)
```

**关键验证**:
| 检查项 | 代码实现 | 裁决 |
|--------|---------|------|
| P0 worker 阻塞路径 | `livingHarvesters === 0 → return` (不评估后续) | ✅ |
| harvester 饱和封顶 | `min(config.minCount, saturationTarget)` | ✅ |
| harvester 矿位分配 | `buildHarvesterOccupancy` + `pickLeastCrowdedSource` | ✅ |
| hauler 动态配额 | container/link fillRatio × 运力归一化 | ✅ |
| hauler 危机收缩 | `inCrisis && !liquidityDriven → minCount` | ✅ |
| distributor 升编迟滞 | `distScaleUpSince` + delay 窗口 | ✅ |
| upgrader 多档调度 | sprint/sustained/early/low 四档 | ✅ |
| builder 迟滞带 | `builderPressureState` full/shrinking | ✅ |
| 替换 4 重门禁 | 角色存在性 + maxCount + 盈余 + 稳定key | ✅ |
| churn 熔断 | `frozenRoles` 跳过评估 | ✅ |

**裁决**: ✅ 需求评估优先级正确，门禁完善。

### 5.2.2 trySpawn 孵化执行

**孵化流程**:
```
1. 预建 creepsByRoom 索引 (O(M) 一次遍历)
2. 每房:
   a. cleanQueue (TTL + 黑名单)
   b. checkChurnCircuitBreaker
   c. 请求撤销 (defender/upgrader)
   d. evaluateDemand → 新请求
   e. sortQueue (按优先级)
   f. trySpawn (多 spawn 并行)
   g. recyclePass
```

**六层降级策略验证**:
| 层 | 触发条件 | 效果 | 裁决 |
|----|---------|------|------|
| 1. P0 始终降级 | `priority === 0` | 按 energyAvailable 降级 | ✅ |
| 2. P1 bootstrap/recovery | `roomState === "bootstrap"/"recovery"` | 降级 | ✅ |
| 3. P1 饥饿超时 | `waitTicks >= spawnTime × 2` | 降级 | ✅ |
| 4. P2 饥饿+压力 | `waitTicks >= spawnTime × 10 && pressure > 0.5` | 降级 | ✅ |
| 5. 成本地板 | `bodyCost(degraded) < starvationDegradeFloor` | 继续排队 | ✅ |
| 6. 泵断供 | `distributor && distributorCount === 0` | 立即降级 | ✅ |

**SP-1 恢复预留验证**:
```typescript
const effectiveBudget = req.priority === 0 || isCollectorRole
  ? energyBudget                          // P0/采集者不预留
  : energyBudget - reserve;               // 非 P0 扣除预留
```
✅ 采集者豁免 — 避免"预留挡住 harvester → spawn 永久 idle"死锁。

**spawnCreep 唯一写者验证**:
```
grep "spawnCreep" src/ → 仅 spawn-manager.ts:448
```
✅ 唯一写者约束。

**裁决**: ✅ 孵化执行链完整，降级策略分层完善。

### 5.2.3 死锁分析

**场景 1: 所有 harvester 死亡**
```
livingHarvesters = 0
→ P0 worker 请求 [W,C,M]@200
→ trySpawn: priority=0, 不扣 reserve, energyAvailable ≥ 200 → 孵化
→ worker acquire: harvestSource → 采集恢复
→ colonyState: bootstrap → growth
```
✅ 自愈。

**场景 2: 能量不足以孵化任何 body**
```
energyAvailable < 200 (连 RECOVERY_BODY 都不够)
→ degradeBody 返回 undefined
→ req.retries++ (不进黑名单 — P0 生存路径豁免 starvationDegradeFloor)
→ 下一 tick 重试
→ 等 hauler 从 container 搬能量回 spawn → energyAvailable 回升
→ 孵化成功
```
✅ 自愈（前提：container 有能量 + hauler 存活）。

**场景 3: 所有 spawn 被毁（Phase 3 已识别）**
```
snapshot.spawns.length === 0
→ trySpawn: `if (snapshot.spawns.length === 0) return`
→ 无法孵化
→ colonyState = bootstrap/recovery
→ 需要 builder 建造新 spawn
→ builder 需要 spawn 孵化
→ 死锁 ❌
```
⚠️ 已知死锁 — Phase 3 已记录，需要人工干预或 claimer 从外部 claim。

**场景 4: churn 熔断冻结所有角色**
```
churnFreezeUntil 覆盖所有角色
→ frozenRoles 包含所有角色
→ evaluateDemand 不生成请求 (P0 worker 早期 return 不受影响)
→ P0 worker 生命线豁免 churn 熔断
```
✅ P0 worker 豁免，不会全冻结。

**裁决**: ✅ 除"所有 spawn 被毁"已知死锁外，Spawn 需求链自愈能力完善。

---

## 5.3 Creep 真实执行路径 — RoleRunner 管线审计

### 5.3.1 RoleRunner 执行管线

```
getSnapshot → recycle check → 威胁检测(flee) → boost报到 → hold集结 →
ensureHome → updateMode → getAssignment → gate →
candidates(resolve → execute) → 无匹配则 idle(park)
```

**管线顺序验证**:
| 步骤 | 位置 | 职责 | 裁决 |
|------|------|------|------|
| recycle check | 最前 | 已标记回收的 creep 停止工作 | ✅ |
| 外房威胁检测 | ensureHome 前 | `shouldFleeForeignRoom` — 过境遇袭先逃 | ✅ |
| 小队威胁避险 | ensureHome 前 | `shelterAtCore` — 非战斗角色撤入核心 | ✅ |
| 本房威胁检测 | ensureHome 前 | `shouldFlee` — flee 释放 assignment | ✅ |
| flee 模式重置 | ensureHome 前 | 威胁消除后 `mode = undefined` | ✅ |
| boost 报到 | flee 后 | `interceptForBoost` — 新生 creep 去 lab | ✅ |
| hold 集结 | ensureHome 前 | `policy.hold` — attacker war build 阶段 | ✅ |
| ensureHome | hold 后 | 导航到 home/remoteTarget | ✅ |
| updateMode | ensureHome 后 | 背包满/空切 work/acquire | ✅ |
| getAssignment | updateMode 后 | TaskPool 分配 | ✅ |
| gate | candidates 前 | 角色级门禁 | ✅ |
| candidates | gate 后 | resolve → execute 有序评估 | ✅ |
| idle + park | 无匹配后 | 归位待命 | ✅ |

**关键安全性**:
- `finally { drawStatusLight(creep) }` — 所有 return 路径统一绘制状态灯 ✅
- `actionProfiling` 可选 — 关闭时零开销 ✅
- 每个候选 `resolve` 必填（EN-3）— 防静默死亡 ✅

**裁决**: ✅ RoleRunner 管线顺序正确，安全性完善。

### 5.3.2 各角色行为链审计

**Harvester (P1)**:
```
acquire: stationaryMine → harvestSource → harvestMineral
work: stationaryMine → dumpMinerals → dumpToNearbyLink → dumpToNearbyContainer →
      buildNearbyContainerSite → repairNearbyContainer → fillTarget → fillEmptiestContainer
```
- 站桩矿工被 `stationaryMine` 拦截，永不离岗 ✅
- 矿物优先卸载（不占能量空间）✅
- 不 fallback 到建造/升级（职责分离）✅

**Hauler (P1)**:
```
gate: haulerGate (顺路卸能到 storage)
acquire: withdrawStorageLink → lootRemains → pickupDropped → withdrawTerminalEnergy →
         withdrawAssignmentContainer → withdrawRichestCapped → haulMineralTopUp →
         lootRemains(1) → pickupDropped
work: haulMineralsToStorage → fillStorage → haulFillTarget → haulMineralTopUp → supplyLabs
```
- 永不从 storage 取能（架构约束）✅
- storage link 排空优先（防 source link 背压）✅
- 矿物搬运双位保证（acquire 尾 + work 尾）✅

**Distributor (P1)**:
```
gate: distributorGate (无 storage 降级为 hauler)
acquire: salvageStorageToTerminal → withdrawStorageForDistribution → stockTerminalEnergy →
         reclaimFactoryOutput → stockFactoryBattery → stockFactoryEnergy → stockFactoryComponents →
         supplyLabs → stockPowerSpawn → stockNuker
work: distributorFillTarget → (满载后分发)
```
- 水位分级 tier 系统 ✅
- 无 storage 时安全降级 ✅

**Upgrader (P2)**:
```
gate: upgraderGate (能量地板门禁 + claim-secure + RCL8 停烧)
acquire: stationaryUpgrade → pickupNearbyDropped → withdrawControllerLink →
         withdrawControllerContainer → withdrawStorageCapped(dynamic) →
         withdrawRichestNonSourceContainer → harvestSource → moveToStation
work: stationaryUpgrade → upgradeAnchored
```
- 站桩同 tick 取+升（0 通勤损耗）✅
- storage 取能 4 档限量 + 流失率门禁 ✅
- 归站兜底（防石化在 spawn 出口）✅

**Builder (P2)**:
```
gate: builderGate (recovery 释放 assignment)
acquire: pickupDropped → withdrawStorageCapped → withdrawClosestNonSourceContainer → harvestSource
work: repairFreshRampart → repairUrgentRoads → buildAssignmentSite → buildNearestSite →
      repairContainerDecay → repairCritical → fillTarget → repairRoads → repairFortifications
```
- 新生 rampart 急救（建成仅 1 hit，100 tick 必死）✅
- 危路急救（40% 阈值）✅
- 不 fallback 到升级 ✅

**Worker (P0)**:
```
acquire: pickupDropped → harvestSource
work: fillAssignmentTarget → repairCritical → fillTarget → upgradeController
```
- P0 生命线，churn 熔断豁免 ✅
- repairCritical 确保"被计入 repairRooms 名副其实" ✅

**裁决**: ✅ 各角色行为链设计合理，职责分离明确。

### 5.3.3 FSM 状态切换防抖

**updateMode 逻辑**（`support/lifecycle.ts`）:
- 背包空 → acquire
- 背包满 → work
- 任务完成 → acquire
- 威胁解除 → undefined（role-runner 重置）

**防抖验证**:
| 场景 | 切换条件 | 防抖措施 | 裁决 |
|------|---------|---------|------|
| 采集→倒能 | 背包满 | stationaryMine 同 tick 采+倒（不切 mode）| ✅ |
| 倒能→采集 | 背包空 | 自然切换（无抖动）| ✅ |
| flee→正常 | 威胁消除 | `mode = undefined` → 下 tick 重新评估 | ✅ |
| idle→work | 有候选 | resolve 命中即执行 | ✅ |
| 通勤中 | 不在目标房 | remoteTarget 角色保持原 mode（防 idle→home 振荡）| ✅ |

**裁决**: ✅ FSM 防抖设计完善。

---

## 5.4 能量流闭环完整性 — 端到端追踪

### 5.4.1 完整能量流路径

```
Source (3000/300tick = 10/tick)
  ↓ harvest (L1: harvested)
Harvester backpack (CARRY)
  ↓ transfer/drop (无记账 — 池内移动非消费)
Container/Link/Storage (pool: containers/links/storage)
  ↓ withdraw (无记账 — 池内移动)
Hauler/Distributor backpack (CARRY)
  ↓ transfer (无记账 — 池内移动)
Sink:
  ├→ Spawn/Extension (pool: spawnExt)
  │    ↓ spawnCreep (L1: spawned)
  │    └→ Creep body (转化为采集/建造/升级能力)
  │
  ├→ Controller (L1: upgraded)
  │    └→ RCL 进度 (复利投资)
  │
  ├→ Construction site (L1: built)
  │    └→ 基础设施 (产能放大器)
  │
  ├→ Tower (pool: towers)
  │    ↓ attack/heal/repair (L1: towerSpent)
  │    └→ 防御/维修输出
  │
  └→ Creep 死亡 (L1: lost — 背包能量消失)
       └→ Recycle (L1: recycledRefund — 按剩余寿命比例返还)
```

**恒等式验证**:
```
Δtracked = (income - consumption + refunds) + Δloose + Δother + drift

income = harvested + pickedUp
consumption = spawned + upgraded + built + repaired + towerSpent
refunds = recycledRefund
tracked = spawnExt + containers + storage + terminal + links + carry + towers
loose = dropped + tombstone + ruin
```

**关键验证**: transfer/withdraw 不入账 — ✅ 池内移动不是消费，恒等式中 Transfers 自相抵消。

### 5.4.2 能量流断点分析

**潜在断点 1: Creep 死亡时背包能量丢失**
- L1 无 `lost` 字段 — 背包能量消失不计入 consumption
- **影响**: drift 会捕获到（Δcarry 包含死亡丢失）→ drift 偏正
- **裁决**: 🟡 设计选择 — drift 是核算缺陷信号，creep 死亡不是"消费"而是"损失"，drift 偏正会触发 drift 告警（连续 2 窗超容差）。但单次死亡不会触发（容差 = max(floor, throughput × ratio)）。可接受。

**潜在断点 2: boost 消耗化合物不记账**
- boost 消耗的 mineral/energy 不在 EnergyLedger 中
- **影响**: 不影响能量恒等式（boost 消耗的是 mineral 而非 energy）
- **裁决**: ✅ 设计正确 — ResourceLedger (A4.2) 追踪矿物，EnergyLedger 只追踪能量。

**潜在断点 3: market.deal 能量交易**
- 买入 energy: 应入账 `bought`（ResourceLedger 有此字段）
- 卖出 energy: 应入账 `sold`
- **EnergyLedger 无 bought/sold 字段** — market 交易不在能量账本中
- **影响**: 🟡 market 买入的 energy 进入 terminal/storage（pool 变化被 tracked），但不计入 income → drift 偏负。需要 market-manager 侧手动 bump `bought`/`sold` counter？检查代码...
- **实际**: EnergyLedger 是纯能量账本，没有市场交易字段。market 交易导致的 pool 变化会被 drift 捕获。**这是一个已知的设计缺口** — 但 drift 容差机制会容忍小量交易 drift。
- **裁决**: 🟡 轻微 — market 交易能量不入 L1 账本，drift 容差兜底但不精确。建议后续在 market-manager 中添加 `bumpEnergyCounter(room, "bought"/"sold", amount)`。

### 5.4.3 能量流闭环成熟度

| 维度 | 评级 | 说明 |
|------|------|------|
| L1 埋点覆盖 | M4 | 所有能量动作都有埋点，背包差值法准确 |
| L2 核算窗口 | M4 | 50 tick 滚动窗 + drift 恒等式 + 连续超容差告警 |
| 三指标 | M4 | 净流 EMA / 合同储备 / 风险缓冲，跨 reset 可恢复 |
| 效率系数 | M3 | 0.7 初值 + EMA 校准，但 harvester 不工作时可能偏低 |
| 市场交易入账 | M2 | market.deal 的能量买卖未入 L1 账本，drift 容差兜底但不精确 |
| **综合** | **M3.5** | 能量流闭环完整，drift 恒等式正确，但市场交易缺 L1 入账 |