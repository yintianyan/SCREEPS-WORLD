# RESOURCE_OWNERSHIP_MODEL — 资源所有权模型

> 日期：2026-08-24。阶段：A2 后半·步 2。
> 合同锚点：ECONOMY_ARCHITECTURE §1.1 所有权与处分权表（冻结蓝图）、
> STATE_OWNERSHIP §3.1–§3.6（各状态 Owner）、DECISION_AUTHORITY §1（权力总表）、
> SYSTEM_BOUNDARIES §1.5/§1.6（Economy/Market 边界）。
> 本文档是冻结蓝图 §1.1 的代码层落地——不修订合同，只将合同映射到具体代码实现。

## 1. 冻结合同（ECONOMY §1.1 原文映射）

### 1.1 所有权与处分权总表

| 资源 | 所有者 | 帝国的权力 | 房间的权力 | 禁止 | 代码验证 |
| --- | --- | --- | --- | --- | --- |
| 能量（本地储备+预算） | **Room** | **调拨权**（terminal 网络+战时征调），受 §1.2 门控 | 本地六闭环内按预算自由支配 | 全房能量公共池；越过预算消耗共享资源 | ✅ Economy 只核算，不调拨；`economy.ts` 无 `send`/`deal` 调用 |
| 矿物 / commodity | Room（属地库存） | 互济调拨令+市场策略 | 本地 lab/factory 加工 | 房间直连市场下单（MarketManager 唯一写者） | ✅ `mineral-logistics.ts` 只加工；`terminal-manager.ts` 唯一 `deal` 调用者 |
| credits | **Empire** | 垄断 | 只读 | 房间级信用账户 | ✅ `Game.market.credits` 只在 `empire-strategy.ts`+`terminal-manager.ts` 读取 |
| CPU / 预算 | Empire（Policy 求值） | 五域预算下发 | 按预算行事 | 消耗决策只过能量账不过 CPU 账 | ✅ `capacity.ts` 纯函数评估，`empire-strategy.ts` 唯一写者 |

### 1.2 合同条款代码映射

| 条款 | 合同文本 | 代码实现 |
| --- | --- | --- |
| §1.1-1 能量属 Room | 本地储备与本地预算的处分权在房间六闭环内 | ✅ `economy.ts` 每 50t 写 `Memory.rooms[r].economy` 瘦快照（唯一写者），room-state 每 tick 写 `colonyState`/`economyPressure` |
| §1.1-2 Empire 持调拨权非所有权 | 跨房实物调拨只以调拨令形式下发，经 terminal 网络或战时征调 | ✅ `terminal-manager.ts` 是唯一 `deal` 调用者；`empire-strategy.ts` 只产出 posture 指令，不直接调拨 |
| §1.1-3 混态裁决 | 高频流动资源走请求牵引；低频战略资源走配额 | ✅ 能量走 `request-pool.ts` 请求池（Demand→Task）；矿物走 `terminal-policy.ts` 配额策略 |

## 2. 资源分层模型

### 2.1 能量分层

```
┌──────────────────────────────────────────────────────────┐
│ 能量（Room 所有）                                         │
│                                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Available   │  │ Reserved     │  │ Committed        │  │
│  │ (可支配)    │  │ (预留)       │  │ (已承诺)         │  │
│  │             │  │              │  │                  │  │
│  │ spawnExt +  │  │ spawn 排产   │  │  active lease   │  │
│  │ containers  │  │ 预留①       │  │  (hauler 租约)  │  │
│  │ + storage +  │  │ tower 围城   │  │                  │  │
│  │ terminal +  │  │ 储备②       │  │                  │  │
│  │ links       │  │ war 基金③    │  │                  │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                   │             │
│         └─────────────────┼───────────────────┘             │
│                           │                                 │
│  ┌────────────────────────▼──────────────────────────────┐  │
│  │ Transferable (可调拨)                                   │  │
│  │ = Available − Reserved − Committed                     │  │
│  │ 帝国调拨令可提取的余量（ECONOMY §1.2 门控前置）       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

| 层 | 定义 | 代码来源 |
| --- | --- | --- |
| Available | storage + terminal + link + spawnExt + containers + carry 能量合计 | `accounting.ts` `trackedPoolsOf()` |
| Reserved ① spawn 排产 | `spawning` + 已提交孵化请求的能量占用 | `spawn-manager.ts` 计入 `spawning` |
| Reserved ② tower 围城储备 | siege 态能量会计的库存项 | `tower-defense.ts`（siege 态配给序） |
| Reserved ③ war 基金 | war posture 划出的预算线 | `war-planner.ts` 止损上限 `casualtyMultiplier` |
| Committed | 活跃 haul 租约占用量 | `request-pool.ts` `supplyLedger()` `activeLeases` |
| Transferable | Available − Reserved − Committed | `canExportEnergy()` 门控前置（room-profile.ts） |

**不可转移**：riskBuffer < 400 时的全部 Available（ECONOMY §1.2 ①②③ 前置）。
此时即便 Available > 0 也不允许对外调拨——断供耐受不足。

### 2.2 矿物 / commodity 分层

| 层 | 定义 | 代码来源 |
| --- | --- | --- |
| 本地库存 | storage + terminal + factory + lab 内矿物合计 | `industry.ts` 各模块 `store.getUsedCapacity()` |
| 互济配额 | `mineralAidMinTransfer` 起送量，跨房 terminal send | `terminal-manager.ts` 矿物互济 |
| 市场策略 | 挂单/吃单，MarketManager 唯一写者 | `terminal-manager.ts` `deal`/`createOrder` |

### 2.3 credits 分层

| 层 | 定义 | 代码来源 |
| --- | --- | --- |
| Empire 垄断 | `Game.market.credits` 全局唯一 | `empire-strategy.ts` + `terminal-manager.ts` 只读 |
| 信用门禁 | `creditFloor` / `powerBuyCreditFloor` / `ghodiumBuyCreditFloor` | `CONFIG.market.*` |

### 2.4 CPU / 预算分层

| 层 | 定义 | 代码来源 |
| --- | --- | --- |
| Empire 预算 | `capacity.ts` 四档 tier（abundant→constrained） | `empire-strategy.ts` 唯一写者 `Memory.kernel.capacity` |
| 房间预算 | `cpuByHome` 归集各房 CPU 消耗 | `telemetry-collector.ts` 采样 `Memory.kernel.stats.cpuByHome` |
| 调拨门禁 | `expandMaxCpuRatio` — 总 creep CPU 占 limit 比例 | `posture.ts` 扩张 ROI 门禁 |

## 3. 调拨门控（ECONOMY §1.2 代码映射）

### 3.1 门控条件

| 条款 | 合同文本 | 代码实现 |
| --- | --- | --- |
| ① 支援方本土净流为正 | 平滑值（EMA） | `RoomEconomicProfile.netFlowPositive` ← `EconomyQuery.netFlow > 0` |
| ② 受援缺口经帝国复核 | 防报告腐化 | `needsEnergyAid(profile)` 纯函数判定（A2 后半新增） |
| ③ 援助预算上限 | f(支援方净流) | `canExportEnergy(profile)` 门控 + `aidMaxTransfer` 上限（`CONFIG.energy`） |

### 3.2 异常房例外策略

| 条款 | 合同文本 | 代码实现 |
| --- | --- | --- |
| alert/siege/evacuate 停止被抽离 | 优先注入 | `RoomEconomicProfile.isStruggling = true` → `canExportEnergy() = false` |
| 被援房独立降级 | 不拖垮支援房 | `economyPressure` 驱动各房本地收缩（room-state 本地决策） |

### 3.3 禁止项

| 禁止 | 代码验证 |
| --- | --- |
| 房间绕过帝国直连 terminal 跨房调拨 | ✅ `terminal.send()` 只在 `terminal-manager.ts`（唯一写者） |
| 任何模块绕过 MarketManager 市场下单 | ✅ `Game.market.deal()` 只在 `terminal-manager.ts` |
| Economy 系统执行调拨 | ✅ `economy.ts` 无 `send`/`deal`/`spawnCreep` 调用 |

## 4. 状态所有权一致性（STATE_OWNERSHIP 映射）

| 状态 | Owner（唯一写者） | Persistence | 代码验证 |
| --- | --- | --- | --- |
| EmpireState（posture/预算） | `empire-strategy.ts` | Memory 瘦字段 | ✅ 合规测试 R5 验证 |
| EconomyState（净流/储备） | `economy.ts` | heap 派生 + Memory 瘦快照 | ✅ 唯一写者 `Memory.rooms[r].economy` |
| RoomState（phase/colonyState） | `room-state.ts` | Memory 瘦字段 | ✅ P0 每 tick 更新 |
| SpawnState（队列/黑名单） | `spawn-manager.ts` | Memory 队列 | ✅ 唯一 `spawnCreep` 调用者 |
| RoomSnapshot | kernel `buildSnapshots` | 瞬时（heap） | ✅ 每 tick 重建 |
| RoomEconomicProfile | `room-profile.ts`（纯函数组装） | 瞬时（Read Model） | ✅ 不写任何状态 |

## 5. 代码边界验证

| 边界 | 验证方式 | 结果 |
| --- | --- | --- |
| Economy 不调拨 | `economy.ts` 无 `send`/`deal` 调用 | ✅ grep 验证 |
| Economy 不下单 | `economy.ts` 无 `Game.market` 引用 | ✅ 合规测试 R1 |
| MarketManager 唯一 deal | `deal(` 只在 `terminal-manager.ts` | ✅ grep 验证 |
| SpawnManager 唯一 spawnCreep | `spawnCreep(` 只在 `spawn-manager.ts` | ✅ 合规测试 R6 |
| domain 不引用 Game/Memory | 合规测试 R1 第三条 | ✅ 8/8 通过 |
| domain 不引用 systems | 合规测试 R1 第一条 | ✅ 8/8 通过 |

## 6. A2 后半新增件与所有权

| 新增件 | 类型 | Owner | 写入状态 |
| --- | --- | --- | --- |
| `room-profile.ts` | 纯函数 | — | 不写状态（Read Model） |
| `resource-view.ts`（步 4） | 纯函数 | — | 不写状态（Read Model） |
| `economic-health.ts`（步 5） | 纯函数 | — | 不写状态（Read Model） |
| `readiness.ts`（步 8） | 纯函数 | — | 不写状态（Read Model） |
| `empire-economy.ts`（步 12） | System | Empire Economy 系统 | `Memory.kernel.empireEconomy`（瘦快照，唯一写者） |

**关键不变量**：A2 后半新增的 domain 纯函数全部不写状态——只读组装。
唯一的写者是系统侧薄壳 `empire-economy.ts`，且只写 Empire 自己的状态
（`Memory.kernel.empireEconomy`），不写 Room 状态。

## 7. 质量门槛

| 门槛 | 结果 |
| --- | --- |
| 冻结蓝图一致性 | ✅ 无结构性冲突，无需 ADR |
| 代码验证 | ✅ grep + 合规测试通过 |
| typecheck | ✅ |
| test（2665 项） | ✅ 全绿 |
| build | ✅ |
