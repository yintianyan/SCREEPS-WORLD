# A4.5 Autonomy Audit — Empire Autonomous Stability & Long-Run Validation

> 日期：2026-08-25。阶段：A4.5 — Empire Autonomous Stability & Long-Run Validation。
> 基线：A4.4 已完成 Logistics Decision Authority Convergence (8/10 Score)。
> 方法论：逐模块追踪完整自治闭环 SENSE→STATE→ECONOMY→PLANNING→LOGISTICS→EXECUTION→FEEDBACK→RECOVERY→REPLAN，标注每环的自治成熟度。

---

## 0. 审计范围

本审计覆盖以下系统与模块的自治能力：

### 0.1 经济闭环追踪

```
Economic Health (empire-economy.ts, economic-health.ts)
  ↓
Resource Imbalance (imbalance.ts)
  ↓
Demand (demand-node.ts)
  ↓
Supply Contract (specialization-planner.ts → supply-contract.ts)
  ↓
Logistics Plan (logistics-planner.ts → planner.ts)
  ↓
Transport (logistics.ts, agenda-manager.ts)
  ↓
Delivery (agenda-manager.ts Delivery Validation)
  ↓
Accounting (logistics-planner.ts collectAccountingWithTracking)
  ↓
Economic Health (反馈闭环)
```

### 0.2 扩张闭环追踪

```
Expansion Readiness (readiness.ts)
  ↓
Empire Planner (empire-economy.ts → planner-input.ts)
  ↓
Expansion Plan (expansion-planner.ts → plan-lifecycle.ts)
  ↓
Execution (expansion-manager.ts)
  ↓
Colony (colony-failure.ts, stability-score.ts, autonomy.ts)
  ↓
Economic Activation (phase.ts)
  ↓
Empire Resource Network (network-snapshot.ts)
```

---

## 1. Autonomous Loop Audit

### 1.1 SENSE → STATE

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Room Snapshot | `room-snapshot.ts` | ✅ 完整 — 每 tick 构建只读快照 | **Already Autonomous** |
| Room State | `room-state.ts` | ✅ 完整 — ColonyState 每 tick 更新 | **Already Autonomous** |
| Economy Query | `economy.ts` | ✅ 完整 — 三指标 50tick 错峰 | **Already Autonomous** |
| Intel | `intel.ts`, `room-observer.ts` | ✅ 完整 — 50t 采 intel | **Already Autonomous** |

**判定：SENSE → STATE 完全自治。**

### 1.2 STATE → ECONOMY

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Room Economic Profile | `room-profile.ts` | ✅ 完整 — netFlow/efficiency/riskBuffer | **Already Autonomous** |
| Empire Resource View | `resource-view.ts` | ✅ 完整 — surplus/deficit 聚合 | **Already Autonomous** |
| Economic Health | `economic-health.ts` | ✅ 完整 — 5 档 (critical/deficit/stable/growing/healthy) | **Already Autonomous** |
| Multi-Resource Health | `multi-resource-health.ts` | ✅ 完整 — A4.2 矿物维度 | **Already Autonomous** |
| Empire Budget | `budget.ts` | ✅ 完整 — 五域预算 | **Already Autonomous** |

**判定：STATE → ECONOMY 完全自治。**

### 1.3 ECONOMY → PLANNING

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Imbalance Detection | `imbalance.ts` | ✅ 完整 — surplus/deficit 对 | **Already Autonomous** |
| Supply Contract | `supply-contract.ts` + `specialization-planner.ts` | ✅ A4.4 修复 — 从 networkSnapshot 自动创建 | **Already Autonomous** |
| Logistics Plan | `planner.ts` + `logistics-planner.ts` | ✅ A4.4 修复 — Contract → Request 链路打通 | **Already Autonomous** |
| Expansion Readiness | `readiness.ts` | ✅ 完整 — G0-G15 门控 | **Already Autonomous** |
| Expansion Plan | `plan-lifecycle.ts` + `expansion-planner.ts` | ✅ 完整 — 去重 + 清理 + 防抖 + 重评 | **Already Autonomous** |

**判定：ECONOMY → PLANNING 完全自治。**

### 1.4 PLANNING → LOGISTICS

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Transport Request V2 | `transport-request.ts` + `planner.ts` | ✅ A4.4 修复 — 从 Contract 派生 | **Already Autonomous** |
| V1/V2 去重 | `logistics.ts` | ✅ A4.4 修复 — Plan 覆盖的 source 跳过 V1 | **Already Autonomous** |
| Allocation Policy | `allocation-policy.ts` | ✅ 完整 — 7 因子可解释分配 | **Already Autonomous** |
| allocateNetwork 降级 | `agenda-manager.ts` | ✅ A4.4 修复 — Plan 存在时降级为 DEGRADED MODE | **Already Autonomous** |

**判定：PLANNING → LOGISTICS 完全自治。**

### 1.5 LOGISTICS → EXECUTION

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Operation 生命周期 | `agenda-item.ts` + `lifecycle.ts` | ✅ 完整 — 九态状态机 | **Already Autonomous** |
| Carrier Spawn | `agenda-manager.ts` → `spawn-queue.ts` | ✅ 完整 — 幂等 spawn 请求 | **Already Autonomous** |
| Hauler Assignment | `assignment-service.ts` | ✅ 完整 — TaskPool 分配 | **Already Autonomous** |
| Remote Mining Hauler | `remote-mining-manager.ts` | ✅ A4.4 修复 — Plan 拥有 Decision Authority | **Already Autonomous** |
| Terminal Send | `terminal-manager.ts` | ✅ A4.4 修复 — Plan 驱动 send | **Already Autonomous** |

**判定：LOGISTICS → EXECUTION 完全自治。**

### 1.6 EXECUTION → FEEDBACK

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Delivery Validation | `agenda-manager.ts` | ✅ A4.4 修复 — storage 增量验证 | **Already Autonomous** |
| Transport Accounting | `transport-accounting.ts` + `logistics-planner.ts` | ✅ A4.4 修复 — 跨 tick 追踪 | **Already Autonomous** |
| Logistics Health | `logistics-health.ts` | ✅ A4.4 修复 — 基于真实 Accounting | **Already Autonomous** |
| Network Health | `network-health.ts` | ✅ 完整 — 四档健康度 | **Already Autonomous** |
| Colony Failure Detection | `colony-failure.ts` | ✅ 完整 — 6 种失败类型 | **Already Autonomous** |
| Colony Stability Score | `stability-score.ts` | ✅ 完整 — 5 维度评分 | **Already Autonomous** |

**判定：EXECUTION → FEEDBACK 完全自治。**

### 1.7 FEEDBACK → RECOVERY

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Hauler Death Recovery | `agenda-manager.ts` Operation 重试 | ⚠️ **Partially Autonomous** — Operation 失败后重试，但无根因分析 | |
| Route Failure Recovery | `agenda-manager.ts` markBlocked | ⚠️ **Partially Autonomous** — 标记 blocked 但无替代路由寻找 | |
| Spawn Capacity Recovery | `spawn-manager.ts` 优先级排序 | ⚠️ **Partially Autonomous** — P0 优先但无 Bottleneck 检测 | |
| Colony Recovery | `colony-failure.ts` recommendedAction | ⚠️ **Partially Autonomous** — 检测失败并推荐动作，但动作执行靠各系统被动响应 | |
| Empire Health Recovery | ❌ **Missing** — 无综合 Empire Health 评估 | | |
| Recovery Priority | ❌ **Missing** — 多问题同时出现时无排序 | | |
| Recovery ROI | ❌ **Missing** — 恢复动作无成本/收益评估 | | |
| Root Cause Detection | ❌ **Missing** — 无法区分根因与症状 | | |
| Cascading Failure Detection | ❌ **Missing** — 无失败传播图 | | |

**判定：FEEDBACK → RECOVERY 部分自治。这是自治闭环的最大缺口。**

### 1.8 RECOVERY → REPLAN

| 环节 | 模块 | 状态 | 自治度 |
| --- | --- | --- | --- |
| Replan Event | `replan.ts` | ✅ 完整 — 事件驱动重规划 | **Already Autonomous** |
| Rebalance | `rebalance.ts` | ✅ 完整 — debounce + cooldown | **Already Autonomous** |
| Plan Stability | `stability.ts` | ✅ 完整 — 防抖四防线 | **Already Autonomous** |
| No-Progress Detection | ❌ **Missing** — 无法检测 Planner 空转 | | |
| Planner Thrashing | ❌ **Missing** — 无法检测 A↔B 振荡 | | |
| Action Cooldown | ⚠️ **Partially Autonomous** — Rebalance/Plan 有 cooldown，但 Hauler Scaling / Route Switch 无 | | |

**判定：RECOVERY → REPLAN 部分自治。缺少振荡检测和空转检测。**

---

## 2. Autonomy Gap Analysis

### 2.1 Already Autonomous（已有自治能力）

| # | 能力 | 源码位置 | 验证 |
| --- | --- | --- | --- |
| 1 | Room Snapshot 构建 | `room-snapshot.ts` | ✅ 每 tick 自动 |
| 2 | ColonyState 更新 | `room-state.ts` | ✅ 每 tick 自动 |
| 3 | 经济指标采集 | `economy.ts` | ✅ 50t 错峰 |
| 4 | Empire Resource View | `resource-view.ts` | ✅ 100t 自动 |
| 5 | Economic Health | `economic-health.ts` | ✅ 100t 自动 |
| 6 | Multi-Resource Health | `multi-resource-health.ts` | ✅ 100t 自动 |
| 7 | Empire Budget | `budget.ts` | ✅ 100t 自动 |
| 8 | Supply/Demand Nodes | `supply-node.ts`, `demand-node.ts` | ✅ 100t 自动 |
| 9 | Supply Contract 创建 | `specialization-planner.ts` | ✅ 100t 自动 (A4.4) |
| 10 | Logistics Plan | `logistics-planner.ts` | ✅ 100t 自动 |
| 11 | V1/V2 去重 | `logistics.ts` | ✅ 每 tick 自动 (A4.4) |
| 12 | Operation 生命周期 | `agenda-item.ts`, `lifecycle.ts` | ✅ 100t 自动 |
| 13 | Delivery Validation | `agenda-manager.ts` | ✅ 100t 自动 (A4.4) |
| 14 | Transport Accounting | `logistics-planner.ts` | ✅ 100t 自动 (A4.4) |
| 15 | Logistics Health | `logistics-health.ts` | ✅ 100t 自动 (A4.4) |
| 16 | Network Health | `network-health.ts` | ✅ 100t 自动 |
| 17 | Replan Event | `replan.ts` | ✅ 事件驱动 |
| 18 | Rebalance | `rebalance.ts` | ✅ debounce + cooldown |
| 19 | Plan Stability | `stability.ts` | ✅ 防抖四防线 |
| 20 | Expansion Readiness | `readiness.ts` | ✅ G0-G15 |
| 21 | Expansion Plan | `plan-lifecycle.ts` | ✅ 去重 + 防抖 |
| 22 | Colony Failure Detection | `colony-failure.ts` | ✅ 6 种失败类型 |
| 23 | Colony Stability Score | `stability-score.ts` | ✅ 5 维度 |
| 24 | Autonomy Age | `autonomy.ts` | ✅ 里程碑追踪 |
| 25 | safeRun 错误隔离 | `safe-run.ts` | ✅ 单点错误不中断 |
| 26 | CPU 看门狗 | `scheduler.ts` | ✅ 四档 bucket |
| 27 | Posture/Agenda | `posture.ts`, `agenda.ts` | ✅ 滞回 + 驻留 |
| 28 | Remote Mining 止损 | `remote-mining-manager.ts` | ✅ 空转止损 + 威胁冷却 |
| 29 | Terminal 互济 | `terminal-manager.ts` | ✅ Plan 驱动 (A4.4) |
| 30 | Spawn Manager | `spawn-manager.ts` | ✅ 唯一 spawnCreep |

### 2.2 Partially Autonomous（部分自治）

| # | 能力 | 当前状态 | 缺失部分 |
| --- | --- | --- | --- |
| 1 | Hauler Death Recovery | Operation 失败后自动重试 | 无根因分析，不知道为什么死 |
| 2 | Route Failure Recovery | 标记 blocked + 重试 | 无替代路由寻找，无 DEGRADED 模式 |
| 3 | Spawn Capacity Recovery | P0 优先级排序 | 无 Bottleneck 检测，无 Scaling 限流 |
| 4 | Colony Recovery | 检测失败 + 推荐动作 | 动作执行靠各系统被动响应，无主动 Recovery |
| 5 | Action Cooldown | Rebalance/Plan 有 cooldown | Hauler Scaling / Route Switch 无 cooldown |
| 6 | Contract Lifecycle | ACTIVE 状态可创建 | DEGRADED/SUSPENDED/COMPLETED 状态转换未实现 |
| 7 | Spawn 决策统一 | 三源仍在 (DUPLICATE-006) | Plan 影响增大但未完全统一 |
| 8 | Decision Trace | 部分系统有 console.log | 无结构化 Decision Snapshot |

### 2.3 Manual Dependency（人工依赖）

| # | 能力 | 说明 |
| --- | --- | --- |
| 1 | Colony Abandonment | 不会自动放弃 Colony，只产生 recommendedAction |
| 2 | War Declaration | war 姿态由 posture 自动判定，但进攻执行需人工触发（A4.5 禁止 Military） |
| 3 | Manual Flag/Console | 系统不依赖手动 flag/console 运行（已满足自治要求） |

### 2.4 Hidden Coupling（隐藏耦合）

| # | 耦合 | 风险 |
| --- | --- | --- |
| 1 | logistics-planner `loadOperations` | 从 `global.__operations` 读取（heap），非从 Memory — global reset 后为空 |
| 2 | specialization-planner `getOpportunities` | 从 `global.__remoteOpportunities` 读取 — heap，global reset 丢失 |
| 3 | agenda-manager `routeCache` | heap Map，global reset 丢失 — 下次重算（可接受） |
| 4 | logistics-planner `accountingByRequestId` | heap Map，上限 200 条 — global reset 丢失（可接受） |

### 2.5 Missing Feedback（缺失反馈）

| # | 反馈 | 影响 |
| --- | --- | --- |
| 1 | Empire Health → Recovery | 无综合健康度驱动恢复动作 |
| 2 | Recovery Priority | 多问题同时出现时无排序 |
| 3 | Root Cause vs Symptom | 无法区分根因与症状 |
| 4 | Cascading Failure | 无失败传播图 |
| 5 | No-Progress Detection | Planner 空转不可检测 |
| 6 | Planner Thrashing | A↔B 振荡不可检测 |

### 2.6 Missing Recovery（缺失恢复）

| # | 恢复 | 影响 |
| --- | --- | --- |
| 1 | Empire Health Hysteresis | Health 在 HEALTHY/DEGRADED 之间每 tick 跳动 |
| 2 | Recovery ROI | 恢复动作无成本/收益评估 |
| 3 | Recovery Budget | 恢复无限消耗资源 |
| 4 | Colony Abandonment Candidate | 无法产生 ABANDONMENT_CANDIDATE |
| 5 | Autonomy Metrics | 无法统计自治表现 |
| 6 | Autonomy Score | 无法量化自治程度 |

---

## 3. Autonomous Loop 完整追踪

### 3.1 Economic Loop（经济闭环）

```
SENSE: room-snapshot → room-state → economy (50t)
  ↓
STATE: RoomEconomicProfile { netFlow, efficiency, riskBuffer }
  ↓
ECONOMY: EmpireResourceView → EconomicHealth → Imbalance
  ↓
PLANNING: Supply Contract (specialization-planner) → Logistics Plan (logistics-planner)
  ↓
LOGISTICS: TransportRequestV2 → V1/V2 去重 → Operation (agenda-manager)
  ↓
EXECUTION: Carrier spawn → 搬运 → Delivery Validation
  ↓
FEEDBACK: Transport Accounting → Logistics Health → Network Health
  ↓
RECOVERY: [GAP] — 无 Empire Health 驱动的主动恢复
  ↓
REPLAN: Replan Event → Rebalance → Plan Stability (防抖)
  ↓
SENSE: (循环)
```

**经济闭环自治度：85%** — SENSE→REPLAN 链路完整，RECOVERY 环节有缺口。

### 3.2 Logistics Loop（物流闭环）

```
SENSE: networkSnapshot (agenda-manager 100t)
  ↓
STATE: SupplyNodes + DemandNodes + gap
  ↓
PLANNING: Logistics Plan (logistics-planner 100t)
  ↓
LOGISTICS: TransportRequestV2 → Operation / Assignment
  ↓
EXECUTION: Carrier/Hauler 搬运
  ↓
FEEDBACK: Delivery Validation → Accounting → Logistics Health
  ↓
RECOVERY: [GAP] — Hauler 死亡靠 Operation 重试，无根因/替代路由
  ↓
REPLAN: Replan Event (carrier-death) → Rebalance → 新 Plan
  ↓
SENSE: (循环)
```

**物流闭环自治度：80%** — 反馈链完整，恢复链有缺口。

### 3.3 Colony Loop（殖民闭环）

```
SENSE: expansion-planner → discovery → scoring
  ↓
STATE: ExpansionCandidate → Plan lifecycle (EVALUATED→READY→APPROVED)
  ↓
ECONOMY: Expansion Readiness (G0-G15) → Budget
  ↓
PLANNING: Expansion Plan → WAITING_EXECUTION
  ↓
EXECUTION: expansion-manager → claim → colonize
  ↓
FEEDBACK: Colony Failure Detection → Stability Score → Autonomy Age
  ↓
RECOVERY: [GAP] — 检测失败但无主动恢复执行
  ↓
REPLAN: Plan lifecycle 重评 → 防抖
  ↓
SENSE: (循环)
```

**殖民闭环自治度：75%** — 检测完整，恢复执行缺失。

---

## 4. Failure Propagation Graph（失败传播图）

### 4.1 当前已知传播路径

```
Harvester Death
  → Production ↓
    → Energy Income ↓
      → netFlow ↓ (可能转负)
        → riskBuffer ↓
          → ColonyState → recovery/bootstrap
            → Spawn Priority 重定向
              → Hauler 可能不足
                → Logistics ↓
                  → Colony Health ↓

Hauler Death
  → Container 积压
    → Harvester 空转 (source 满)
      → Production ↓
        → (同上传播)

Route Blocked
  → Operation → blocked
    → retryFromBlocked (max retries)
      → markFailed
        → Reservation released
          → Demand 重新出现
            → 下个 Plan 周期新 Operation

Spawn 饥饿
  → 新 Creep 不出
    → 人口下降
      → 各角色不足
        → 多链路同时退化
```

### 4.2 缺失的传播检测

- **无法识别 Cascade**：Harvester 死 → Energy ↓ → Spawn ↓ → Hauler ↓ → Logistics ↓ 这条链路当前无系统追踪
- **无法区分 Root Cause vs Symptom**：Spawn 缺 Energy 可能是 Spawn 问题，也可能是 Harvester/Hauler 问题
- **无法量化传播深度**：不知道一个失败影响了几层

---

## 5. Recovery Gap Summary

### 5.1 需要新增的模块

| # | 模块 | 位置 | 职责 |
| --- | --- | --- | --- |
| 1 | `empire-health.ts` | `src/domain/strategy/` | 综合帝国健康评估 + Hysteresis |
| 2 | `failure-propagation.ts` | `src/domain/strategy/` | 失败传播图 + 根因检测 + Cascade 检测 |
| 3 | `recovery-priority.ts` | `src/domain/strategy/` | 恢复优先级 + ROI + Action Cooldown |
| 4 | `autonomy-metrics.ts` | `src/domain/strategy/` | 自治指标 + Autonomy Score + No-Progress/Thrashing 检测 |
| 5 | `empire-health-system.ts` | `src/systems/` | 系统薄壳 + 注册到 bootstrap |

### 5.2 需要修改的模块

| # | 模块 | 修改 |
| --- | --- | --- |
| 1 | `bootstrap.ts` | 注册 empire-health-system |
| 2 | `global-cache.ts` | 增加 empireHealth / autonomyMetrics / recoveryState 字段 |
| 3 | `global.d.ts` | 增加 Memory.kernel.empireHealth 字段 |

---

## 6. 审计结论

| 维度 | 自治度 | 判定 |
| --- | --- | --- |
| SENSE → STATE | 100% | ✅ Already Autonomous |
| STATE → ECONOMY | 100% | ✅ Already Autonomous |
| ECONOMY → PLANNING | 100% | ✅ Already Autonomous |
| PLANNING → LOGISTICS | 100% | ✅ Already Autonomous |
| LOGISTICS → EXECUTION | 100% | ✅ Already Autonomous |
| EXECUTION → FEEDBACK | 100% | ✅ Already Autonomous |
| FEEDBACK → RECOVERY | 40% | ⚠️ Partially Autonomous — 最大缺口 |
| RECOVERY → REPLAN | 60% | ⚠️ Partially Autonomous — 缺少振荡/空转检测 |
| **整体自治度** | **~85%** | **需补齐 Recovery 环节** |

**A4.5 核心任务：补齐 FEEDBACK → RECOVERY → REPLAN 环节的缺失能力，使 Empire 具备「失败→发现→定位→恢复→继续运行」的完整自治闭环。**

---

**Audit 完成。** 下一步：按优先级实施 A4.5 核心模块。
