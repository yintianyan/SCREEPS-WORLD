# A3.2 Architecture Review — Expansion Intelligence

> 日期：2026-08-24。阶段：A3.2 — Expansion Intelligence。
> 基线：A3.1 Empire Resource Network 已完成并提交。
> 方法：审查全部 Expansion / Intel / Scout / Empire Planner / Resource Network /
> Operation / Memory 相关代码 + 冻结蓝图文档，回答 11 个架构问题，
> 输出分类矩阵（Already Exists / Missing / Conflict / Technical Debt / Required Changes / Deferred To A3.3）。
> **禁止直接修改代码**——本文为设计审查阶段产出。

---

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| A3.1 证明了什么 | Empire 可以多房协调资源，Supply→Demand→Allocation→Operation→Logistics→Verification→Recovery 稳定工作 |
| A3.2 需要证明什么 | Empire 能自主判断「是否应该扩张、为什么扩张、扩张到哪里、当前是否承担得起、扩张需要什么」 |
| 当前 Expansion 能力 | **执行已有，决策不足**——`expansion-manager.ts` 有 claiming→pioneering 状态机，但缺少 Pressure / Readiness 分层、Candidate Ranking、Cost Model、Payback Model、Plan Lifecycle |
| 现有 Evaluator | `src/domain/expansion/evaluator.ts`：只做 source 数 × 新鲜度简单评分，无 7 因子蓝图评分 |
| 现有 Readiness | `src/domain/strategy/readiness.ts`：G0–G11 门控已有，但未与 Candidate / Cost / Budget 联动 |
| 现有 Budget | `src/domain/strategy/budget.ts`：五域预算已有 expansion 域，但无 Core Protection Constraint 和 Expansion Budget 递进计算 |
| 现有 Intel | `src/domain/intel.ts`：RoomIntel 完备（sources/mineral/owner/towers/walls/sealedExits/pathCost），但只覆盖直接邻居，无跨房候选管理 |
| 现有 Scout | `src/systems/prospect-manager.ts` + `src/domain/strategy/prospect.ts`：主动侦察闭环已有，支持 horizon 外扩 |
| 现有 Rhythm | `src/domain/expansion/rhythm.ts`：失败学习自适应已有，但不属于 A3.2 Intelligence 层 |
| 与冻结蓝图差距 | EXPANSION_ARCHITECTURE §1.2 七因子评分公式尚未实现；§2 G1–G5 门控部分实现（G2/G5 有，G1/G3/G4 缺）；§3 先 remote 尽调后 colonize 决策序未实现 |
| 进入 A3.2 | **GO**（前置项：A3.1 链路跑通、53 测试全通过、typecheck+test+build 全绿） |

---

## 1. 审查范围

### 1.1 审查的代码文件

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/domain/expansion/evaluator.ts` | 106 | 候选评估：source 数 × 新鲜度简单评分 + 筛选 |
| `src/domain/expansion/bootstrap.ts` | 95 | 殖民自举决策：TTD/敌情/sponsor 容量 → dispatch/abandon |
| `src/domain/expansion/rhythm.ts` | 115 | 扩张节奏自适应：失败 ring → 暂停/收紧/黑名单缩放 |
| `src/systems/expansion-manager.ts` | 629 | 执行系统：claiming→pioneering 状态机 + bootstrap 车道 |
| `src/systems/prospect-manager.ts` | 330 | 侦察管理：scout 派遣 → intel 新鲜 → 成功收摊 |
| `src/domain/strategy/prospect.ts` | 100 | 侦察目标选择：距离 + hostile 邻接惩罚 |
| `src/systems/empire-strategy.ts` | ~185 | 帝国姿态/议程/容量/态势的唯一裁决者 |
| `src/systems/empire-economy.ts` | ~50+ | 帝国经济链组装 Planner Input |
| `src/domain/strategy/posture.ts` | 251 | 姿态评估纯函数（develop/expand/fortify/war + 滞回） |
| `src/domain/strategy/readiness.ts` | 262 | 扩张就绪度 G0–G11 门控 |
| `src/domain/strategy/budget.ts` | 160 | 五域预算分配（reserve/survival/production/infra/expansion/free） |
| `src/domain/strategy/capacity.ts` | 103 | 算力容量四档（abundant/comfortable/tight/constrained） |
| `src/domain/strategy/economic-health.ts` | 215 | 帝国经济健康五档（critical/deficit/stable/growing/healthy） |
| `src/domain/strategy/resource-view.ts` | 206 | 帝国资源聚合只读视图 |
| `src/domain/strategy/safety-margin.ts` | 161 | 经济安全边际五维加权 |
| `src/domain/strategy/planner-input.ts` | 160 | Empire Planner Input 汇总 |
| `src/domain/strategy/room-registry.ts` | 146 | 已知房间注册表 |
| `src/domain/economy/room-profile.ts` | 375 | Room Economic Profile + 门控函数 |
| `src/domain/economy/capacity-profile.ts` | 173 | Room 产能容量剖面五域 |
| `src/domain/economy/ownership.ts` | 91 | 可调拨量计算 |
| `src/domain/intel.ts` | ~200 | 邻居房情报（RoomIntel + scanNeighborIntel） |
| `src/systems/room-observer.ts` | ~302 | 房间观察器（intel 采集 + observer 调度） |
| `src/domain/operation/agenda-item.ts` | 156 | Operation 类型 + 状态枚举 |
| `src/domain/operation/supply-node.ts` | 139 | A3.1 供给节点 |
| `src/domain/operation/demand-node.ts` | ~180 | A3.1 需求节点 |
| `src/domain/operation/network-snapshot.ts` | 130 | A3.1 全局供需快照 |
| `src/kernel/global-cache.ts` | 370 | 全局缓存（networkSnapshot / networkHealth 等） |
| `src/types/global.d.ts` | ~750 | KernelMemory / RoomMemory 类型定义 |

### 1.2 审查的文档

- `docs/architecture/EXPANSION_ARCHITECTURE.md` — 扩张架构冻结蓝图
- `docs/architecture/GOAL_POLICY_PLAN_MODEL.md` — 目标-策略-计划模型
- `docs/architecture/PLANNING_ARCHITECTURE.md` — 规划架构
- `docs/architecture/INTELLIGENCE_ARCHITECTURE.md` — 情报架构
- `docs/architecture/ARCHITECTURE_FREEZE.md` — §15 修订记录（ADR R0-R9）
- `docs/phase5/A3_1_FINAL_REPORT.md` — A3.1 最终报告
- `docs/phase5/A3_1_ARCHITECTURE_REVIEW.md` — A3.1 架构审查

---

## 2. 11 个架构问题回答

### Q1: 当前是否已经存在 Expansion Candidate Model？

**部分存在，但严重不足。**

现有 `ExpansionCandidate`（`src/domain/expansion/evaluator.ts:11-18`）：

```typescript
export interface ExpansionCandidate {
  roomName: string;
  sponsorRoom: string;
  score: number;
  sources: number;
}
```

**仅有 4 个字段**。对照 A3.2 要求的 Candidate 模型：

| A3.2 要求字段 | 现有 | 缺失原因 |
| --- | --- | --- |
| roomName | ✅ | — |
| sponsorRoom | ✅ | — |
| score | ✅ | 但评分公式过于简单（source 数 × 1000 + 新鲜度） |
| sources | ✅ | — |
| lastSeen | ❌ | 在 ExpansionInput 中有 tick，但 Candidate 不携带 |
| terrainSummary | ❌ | Intel 有 wallCount/sealedExits，但 Candidate 不携带 |
| sourceCount | ✅ | = sources |
| controllerInfo | ❌ | Intel 有 owner/reservedBy，但 Candidate 不携带 |
| distance | ❌ | 无距离字段（evaluator 不算距离，只在筛选时用 pathCost 排序） |
| neighborRooms | ❌ | 无邻接信息 |
| risk | ❌ | 无风险评估 |
| estimatedBootstrapCost | ❌ | 无成本估算 |
| strategicValue | ❌ | 无战略价值评估 |
| status | ❌ | 无 Candidate 生命周期状态 |

**判定**：现有 `ExpansionCandidate` 只是一个**评选结果**，不是 A3.2 要求的**候选模型**。需要完全重建。

### Q2: 当前 Intel 能提供哪些 Room 信息？

**相当完备。** `RoomIntel` 接口（`src/domain/intel.ts:28-58`）：

| 字段 | 描述 | 来源 |
| --- | --- | --- |
| kind | normal / sk / center / highway | classifyRoomByName（无需视野） |
| status | normal / closed / novice / respawn | Game.map.getRoomStatus（无需视野） |
| sources | source 数 | 有视野时 room.find(FIND_SOURCES) |
| mineral | 矿物类型 | 有视野时 room.find(FIND_MINERALS) |
| owner | 房主名 | 有视野时 controller.owner |
| reservedBy | 预定者名 | 有视野时 controller.reservation |
| towers | 敌方塔数 | 有视野时 hostile structures |
| enemySpawns | 非我方 spawn 数 | 有视野时 hostile structures |
| wallCount | 人工墙数 | 有视野时 structures |
| sealedExits | 封死出口方向 | 有视野且 wallCount > 0 时计算 |
| powerBank | PB 存在 | 有视野时 structures |
| pathCost | 通勤成本 | PathFinder（room-observer 一次性计算） |
| lastSeen | 最后观测 tick | 每次 scan 更新 |

**判定**：Intel 信息**足以支撑 A3.2 的 Candidate Evaluation**。但 Intel 只覆盖直接邻居 + scout 主动侦察的目标。对于**多跳外的候选**，需要 prospect-manager 的 horizon 外扩机制逐步覆盖。A3.2 可直接消费已有 Intel 数据。

### Q3: 当前 Room Registry 能否管理 Candidate Room？

**不能。**

`RoomRegistry`（`src/domain/strategy/room-registry.ts`）是 `Map<string, RoomRegistryEntry>`，只管理**自有房间**的经济画像快照。`RoomRegistryEntry` 全部是 economy 字段（storageEnergy/netFlow/transferable 等）。

**不管理 Candidate Room**——候选房不是自有房，没有 economy 数据，不在 Registry 中。

**判定**：A3.2 需要新建独立的 **Candidate Registry**（或在 Memory 中建立 `expansionCandidates` 结构），不修改 RoomRegistry。

### Q4: 当前 Empire Planner 能否创建 Expansion Plan？

**不能。**

根据冻结蓝图 `PLANNING_ARCHITECTURE.md §1`：**「本系统不存在任何名为 Planner 的运行时组件」**。规划职责由三处吸收：
1. 战略方向 = Policy 纯函数（posture）
2. 中期承诺 = Agenda 管理器
3. 即时派工 = 各系统确定性推导

当前 `expansion-manager.ts` 的 `tryStartExpansion` 直接从 Intel → Evaluator → 启动 claiming，**跳过了 Plan 层**——没有 ExpansionPlan 对象，没有 lifecycle 管理，没有 reason/cost/benefit/risk 评估。

**判定**：A3.2 需要新建 **ExpansionPlan 模型**（纯函数 + Memory 持久化），但不违反蓝图——Plan 不是独立 Planner 组件，而是 Agenda 管理器的中期承诺数据。

### Q5: 当前 Resource Network 能否计算 Expansion Cost？

**不能直接计算。**

A3.1 的 Resource Network（Supply/Demand Node / NetworkSnapshot）是**运行时资源协调**层，回答「当前 surplus 在哪、deficit 在哪、怎么分配」。它不回答「扩张到新房需要多少资源」——这是 **Cost Model** 的职责。

现有 Budget 模块（`budget.ts`）有 `expansion` 预算域，但只分配**当前可用**的扩张预算量（`totalEnergy × 0.15`），不计算**扩张目标需要多少**。

现有 `ownership.ts` 的 `computeTransferable` 回答「现有可调拨量」，不回答「扩张需要调拨多少」。

**判定**：A3.2 需要新建 **Expansion Cost Model**——纯函数，从 Room Economy 真实模型估算 Bootstrap Cost / Travel Cost / Spawn Cost / Infrastructure Cost。

### Q6: 当前 Operation 能否表达 Expansion Operation？

**不能，但不应在 A3.2 实现。**

`OperationContext` 的 `OperationType = "supply"`，只有 supply 语义。Expansion 需要 `"claim"` 或 `"colonize"` 类型，但 A3.2 明确禁止执行 Claim/Reserve/Remote Mining。

**判定**：Expansion Operation 类型定义**延迟到 A3.3**（Execution）。A3.2 只产出 ExpansionPlan（WAITING_EXECUTION），不创建 Operation。

### Q7: 当前 Memory 是否能够区分 Owned / Candidate / Target Room？

**部分能。**

| 类型 | Memory 位置 | 现状 |
| --- | --- | --- |
| Owned Room | `Memory.rooms[roomName]`（含 `colonyState`、`layout`、`spawnQueue`） | ✅ 完备 |
| Candidate Room | `Memory.rooms[sponsor].intel[roomName]`（Intel 子表） | ⚠️ Intel 有 Room 信息但无 Candidate 生命周期管理 |
| Target Room | `Memory.kernel.expansion.target`（当前扩张目标） | ✅ 存在但无 Plan 生命周期 |
| ExpansionPlan | — | ❌ 不存在 |

`KernelMemory` 类型（`global.d.ts:323-331`）中 `expansion` 字段是执行状态机：
```typescript
expansion?: {
  state: "claiming" | "pioneering";
  target: string;
  sponsor: string;
  startedAt: number;
};
```

**判定**：需要新增 `Memory.kernel.expansionPlans`（候选 Plan 列表）和 `Memory.kernel.expansionCandidates`（候选 Registry）。不修改现有 `expansion` 字段（A3.3 执行层继续使用）。

### Q8: 当前 Scheduler 是否支持低频 Expansion Evaluation？

**是。**

- `expansion-manager.ts` 的 `interval = CONFIG.expansion.interval = 100`（每 100 tick）
- `empire-economy.ts` 的 `interval = 100`（Planner Input 每 100 tick 组装）
- `empire-strategy.ts` 的 `interval = 1`（姿态每 tick 评估，但只写 Memory 不做重活）

**判定**：Scheduler 已支持低频执行。A3.2 的 Expansion Evaluation 可挂在 `expansion-manager` 的低频相位中执行（或新建独立的 `expansion-planner` System，需遵守 R9 上限 15+3）。

### Q9: 哪些能力已有？

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 姿态授权扩张 | `posture.ts` → `expansionAllowed` | ✅ 完备（滞回 + liveThreat 门禁 + CPU ROI 门禁） |
| 扩张就绪度门控 | `readiness.ts` → G0–G11 | ✅ 完备（但需扩展 Candidate / Cost 维度） |
| 帝国经济健康度 | `economic-health.ts` | ✅ 完备（五档 + evidence） |
| 帝国预算分配 | `budget.ts` | ✅ 完备（六域含 expansion） |
| 安全边际 | `safety-margin.ts` | ✅ 完备（五维加权） |
| 算力容量 | `capacity.ts` | ✅ 完备（四档 + 滞回） |
| 帝国资源视图 | `resource-view.ts` | ✅ 完备（聚合 + surplus/deficit + threat） |
| 邻居房情报 | `intel.ts` → RoomIntel | ✅ 完备（13 字段） |
| 主动侦察 | `prospect-manager.ts` + `prospect.ts` | ✅ 完备（horizon 外扩 + 止损链） |
| 候选筛选 | `evaluator.ts` → `selectExpansionTarget` | ✅ 基本可用（但评分过于简单） |
| 失败学习 | `rhythm.ts` | ✅ 完备（ring + 自适应） |
| 殖民自举 | `bootstrap.ts` | ✅ 完备（dispatch/abandon/cooldown） |
| 执行状态机 | `expansion-manager.ts` → claiming/pioneering | ✅ 完备（A3.2 不修改） |
| Planner Input 汇总 | `planner-input.ts` | ✅ 完备（10 步链组装） |
| 帝国议程 | `agenda.ts` → initiative | ✅ 完备（recovery/defense/rcl-push/develop） |
| Room 产能剖面 | `capacity-profile.ts` | ✅ 完备（五域 + 瓶颈判定） |
| Resource Network | A3.1 全套模块 | ✅ 完备（Supply/Demand/Snapshot/Health/Rebalance） |

### Q10: 哪些能力缺失？

| 缺失能力 | 严重度 | A3.2 需求 | 说明 |
| --- | --- | --- | --- |
| **Expansion Pressure Model** | 🔴 关键 | 必须 | 帝国为什么想扩张——当前无 Production/Storage/Spawn 饱和度检测 |
| **Expansion Candidate Model (v2)** | 🔴 关键 | 必须 | 现有 Candidate 只有 4 字段，需 14+ 字段 + 生命周期 |
| **Candidate Discovery** | 🟡 重要 | 必须 | 从 Intel 提取候选 + 标记 UNKNOWN + 去重 |
| **Candidate Evaluation (7-Factor)** | 🔴 关键 | 必须 | 蓝图 §1.2 七因子评分未实现 |
| **Candidate Ranking** | 🟡 重要 | 必须 | 多候选排序 + 可解释 |
| **Expansion Cost Model** | 🔴 关键 | 必须 | Bootstrap/Travel/Spawn/Infrastructure 成本估算 |
| **Bootstrap Cost** | 🔴 关键 | 必须 | 0→Autonomous 需要什么 |
| **Expansion Payback Model** | 🟡 重要 | 必须 | Cost vs Benefit 比较 |
| **Expansion Risk Model** | 🟡 重要 | 必须 | Economic/Operational/Distance/Recovery/Defense 风险 |
| **Expansion Budget (Tiered)** | 🔴 关键 | 必须 | Total→Emergency→Core→Operational→Available 递进 |
| **Core Protection Constraint** | 🔴 关键 | 必须 | Expansion Budget 不侵入 Emergency Reserve |
| **Opportunity Cost** | 🟡 重要 | 必须 | 扩张 vs Upgrade/Infra/Spawn/Defense 权衡 |
| **Expansion Plan Model** | 🔴 关键 | 必须 | PlanId/Candidate/Reason/Priority/Cost/Benefit/Risk/Readiness/Dependencies/Status |
| **Plan Lifecycle** | 🔴 关键 | 必须 | DISCOVERED→EVALUATED→CANDIDATE→READY→APPROVED→WAITING_EXECUTION |
| **Plan Deduplication** | 🟡 重要 | 必须 | 同一 Candidate 最多一个 Active Plan |
| **Re-evaluation** | 🟡 重要 | 必须 | 经济/Intel/Cost/Core Health 变化时重评 |
| **Decision Hysteresis** | 🟡 重要 | 必须 | READY↔NOT_READY 防抖 |
| **Decision Explanation** | 🟡 重要 | 必须 | 人类可读的决策理由 |
| **Expansion Pressure ≠ Readiness 分层** | 🔴 关键 | 必须 | Pressure(HIGH) + Readiness(NOT_READY) → 不扩张 |
| **Multi-Candidate Management** | 🟡 重要 | 必须 | A/B/C/D 候选同时存在 + 排序选择 |
| **Expansion Observability** | 🟡 重要 | 必须 | Dashboard: Pressure/Readiness/Budget/Candidates/Plan |

### Q11: 哪些能力应该延迟到 A3.3？

| 延迟能力 | 原因 |
| --- | --- |
| Expansion Operation 创建 | A3.2 只到 WAITING_EXECUTION，不创建 Operation |
| Claim / Reserve 执行 | 明确禁止 |
| Spawn Construction | 明确禁止 |
| Bootstrap Execution | 明确禁止 |
| Military Escort | 明确禁止 |
| Pioneer 编队派遣 | 明确禁止 |
| Remote Mining | 明确禁止 |
| Terminal / Market | 明确禁止 |
| Expansion Creep 孵化 | 明确禁止 |
| Scout Execution | A3.2 可建 Scout Requirement，但执行由 prospect-manager 现有链路 |
| Defense Risk 评估 | 可先标 UNKNOWN / Deferred，不实现 Military |

---

## 3. 分类矩阵

### 3.1 Already Exists（可直接复用）

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 姿态授权 | `posture.ts` → `expansionAllowed` | 带滞回 + liveThreat 门禁 + CPU ROI 门禁 |
| 就绪度门控 G0–G11 | `readiness.ts` | 门控框架可直接扩展 |
| 帝国经济健康度 | `economic-health.ts` | 五档 + evidence，直接消费 |
| 帝国预算 | `budget.ts` | 六域含 expansion，可扩展 Tiered Budget |
| 安全边际 | `safety-margin.ts` | 五维加权，可作为 Readiness 输入 |
| 算力容量 | `capacity.ts` | 四档 + 滞回 |
| 帝国资源视图 | `resource-view.ts` | 聚合 + surplus/deficit + threat |
| Room 产能剖面 | `capacity-profile.ts` | 五域 + 瓶颈判定，Pressure 基础 |
| Intel 数据结构 | `intel.ts` → RoomIntel | 13 字段，足够 Candidate Evaluation |
| 主动侦察 | `prospect-manager.ts` | horizon 外扩 + 止损链 |
| 候选筛选（基础） | `evaluator.ts` | 筛选逻辑可用，评分需替换 |
| 失败学习 | `rhythm.ts` | 可复用但不属于 A3.2 Intelligence |
| Planner Input 汇总 | `planner-input.ts` | 可扩展加入 ExpansionPressure / ExpansionPlan |
| Empire Economy 链 | `empire-economy.ts` | 10 步链组装，可插入 Expansion 步骤 |
| safeRun 错误隔离 | `safe-run.ts` | 可包裹单 Candidate / 单 Plan 处理 |
| CPU 看门狗分频 | `scheduler.ts` | 低频执行机制 |
| Resource Network Snapshot | A3.1 | 供需快照可用于 Pressure 计算 |
| Network Health | A3.1 | 健康度可用于 Readiness 判定 |
| Room Registry | `room-registry.ts` | 自有房数据源 |
| Resource Ownership | `ownership.ts` | 可调拨量计算，Budget 基础 |

### 3.2 Missing（必须新建）

| 组件 | 落点 | 说明 |
| --- | --- | --- |
| Expansion Pressure Model | `src/domain/expansion/pressure.ts` | 7 维饱和度检测 → LOW/MEDIUM/HIGH |
| Expansion Candidate Model (v2) | `src/domain/expansion/candidate.ts` | 14+ 字段 + lifecycle status |
| Candidate Discovery | `src/domain/expansion/discovery.ts` | 从 Intel 提取候选 + UNKNOWN 标记 + 去重 |
| Candidate Evaluation (7-Factor) | `src/domain/expansion/scoring.ts` | 蓝图 §1.2 七因子评分 |
| Candidate Ranking | `src/domain/expansion/ranking.ts` | 多候选排序 + 可解释 |
| Expansion Cost Model | `src/domain/expansion/cost-model.ts` | Bootstrap/Travel/Spawn/Infra 成本 |
| Expansion Payback Model | `src/domain/expansion/payback.ts` | Cost vs Benefit 比较 |
| Expansion Risk Model | `src/domain/expansion/risk.ts` | 五维风险评估 |
| Expansion Budget (Tiered) | `src/domain/expansion/budget.ts` | Total→Emergency→Core→Operational→Available |
| Expansion Plan Model | `src/domain/expansion/plan.ts` | PlanId/Candidate/Reason/Cost/Benefit/Risk/Status |
| Plan Lifecycle | `src/domain/expansion/plan-lifecycle.ts` | DISCOVERED→...→WAITING_EXECUTION |
| Decision Explanation | `src/domain/expansion/explanation.ts` | 人类可读决策理由 |
| Expansion Observability | `src/domain/expansion/dashboard.ts` | Dashboard 数据组装 |
| Memory Schema 扩展 | `src/types/global.d.ts` | `expansionPlans` + `expansionCandidates` |

### 3.3 Conflict（与现有代码的冲突）

| 冲突 | 现有代码 | A3.2 需要 | 解决方向 |
| --- | --- | --- | --- |
| `ExpansionCandidate` 类型过窄 | `evaluator.ts:11-18`（4 字段） | 14+ 字段 + lifecycle | 新建 `candidate.ts`，evaluator 引用新类型 |
| `selectExpansionTarget` 评分简单 | `evaluator.ts:49-105`（source×1000+freshness） | 七因子评分 | 新建 `scoring.ts`，evaluator 调用新评分 |
| `expansion-manager` 直接执行 | `tryStartExpansion` 直接启动 claiming | 先 Plan → Approval → 执行 | A3.2 不改 expansion-manager 执行路径；新建 Intelligence 层 |
| `Memory.kernel.expansion` = 执行状态 | 只有 state/target/sponsor/startedAt | 需要 expansionPlans 列表 | 新增字段，不动现有字段 |
| `budget.ts` 无 Tiered Budget | 只分配当前可用量 | 需要 Total→Emergency→Core→Operational→Available 递进 | 新建 `expansion/budget.ts`，消费现有 `budget.ts` 结果 |
| `readiness.ts` 无 Candidate/Cost 维度 | 只看经济/CPU/威胁 | 需加 Candidate Score + Cost | 扩展 ReadinessOptions + 新增 Gate |

### 3.4 Technical Debt

| 技术债 | 位置 | 影响 | A3.2 处理 |
| --- | --- | --- | --- |
| Evaluator 评分不实现蓝图七因子 | `evaluator.ts` | 候选质量不可保证 | 替换为七因子评分 |
| 无 Candidate 持久化 | Intel 只在 sponsor 名下 | 候选无独立生命周期 | 新建 Candidate Registry |
| 无 Plan 持久化 | 只有 execution state | Plan 无法管理 | 新建 Plan Memory 字段 |
| `expansion-manager` 跳过 Plan 层 | 直接 Intel→Evaluator→Claim | 无法做 Readiness/Cost/Risk 评估 | Intelligence 层先行，执行层不改 |
| Budget 无 Core Protection | `budget.ts` 的 expansion 域可能侵入 Emergency | 核心房安全风险 | 新建 Tiered Budget |

### 3.5 Required Changes

```text
Phase 1: Model Layer (纯函数，不影响运行时)
  ├── 新建 expansion/pressure.ts — Expansion Pressure Model
  ├── 新建 expansion/candidate.ts — Expansion Candidate Model (v2)
  ├── 新建 expansion/discovery.ts — Candidate Discovery (从 Intel 提取)
  ├── 新建 expansion/scoring.ts — 7-Factor Candidate Evaluation
  ├── 新建 expansion/ranking.ts — Candidate Ranking
  ├── 新建 expansion/cost-model.ts — Expansion Cost + Bootstrap Cost
  ├── 新建 expansion/payback.ts — Payback Model
  ├── 新建 expansion/risk.ts — Expansion Risk Model
  ├── 新建 expansion/budget.ts — Tiered Expansion Budget
  ├── 新建 expansion/plan.ts — Expansion Plan Model
  ├── 新建 expansion/plan-lifecycle.ts — Plan Lifecycle + Dedup + Re-eval
  ├── 新建 expansion/explanation.ts — Decision Explanation
  └── 新建 expansion/dashboard.ts — Observability Data

Phase 2: Memory Schema (类型定义 + 迁移)
  ├── 扩展 KernelMemory: expansionPlans + expansionCandidates
  └── 扩展 planner-input.ts: 加入 ExpansionPressure + ExpansionPlan

Phase 3: System Integration (低频执行)
  ├── 扩展 readiness.ts: 新增 Candidate/Cost Gate
  ├── 新建 expansion-planner System (或挂在 expansion-manager)
  └── 扩展 global-cache.ts: expansionDashboard

Phase 4: Testing (20+ Contract Tests + Simulation)
  ├── A3.2-001..020 Contract Tests
  ├── 4-Candidate Simulation
  ├── 6 Economic Gate Scenarios
  └── 1k/5k/10k Tick Stability

Phase 5: Validation
  ├── Simulation Validation
  ├── Observability Dashboard
  └── Final Report
```

### 3.6 Deferred To A3.3

| 延迟项 | 原因 |
| --- | --- |
| Expansion Operation 类型 | A3.2 只到 WAITING_EXECUTION |
| Claim / Reserve 执行 | 明确禁止 |
| Pioneer 编队派遣 | 明确禁止 |
| Spawn Construction | 明确禁止 |
| Bootstrap Execution | 明确禁止 |
| Military Escort | 明确禁止 |
| Defense Risk 详细评估 | 先标 UNKNOWN |
| Terminal / Market 扩展 | 明确禁止 |

---

## 4. 关键设计决策建议

### 4.1 Expansion Plan vs Expansion Operation

**建议**：严格分离。

| 层 | 职责 | A3.2 交付 | A3.3 交付 |
| --- | --- | --- | --- |
| Expansion Plan | 「为什么要扩张」 | ✅ PlanId + Reason + Cost + Benefit + Risk + Status | 不修改 |
| Expansion Operation | 「怎么执行」 | ❌ 不创建 | claim/pioneer Operation |

Plan 的 Memory 落点：`Memory.kernel.expansionPlans`（有界列表，最多 N 个 Active Plan）。

### 4.2 Expansion Pressure 维度

**建议**：7 维可解释检测，不用复杂公式。

```
Pressure = {
  productionCapacity: number    // 0..1, from capacity-profile utilization
  storageSaturation: number     // 0..1, from resource-view storageRatio
  spawnCapacity: number         // 0..1, from capacity-profile spawnUtilization
  resourceDeficit: "none"|"low"|"medium"|"high"  // from imbalance
  growthOpportunity: number    // 0..1, from GCL headroom + candidate pool
  strategicPosition: number    // 0..1, from situation (adversary proximity)
  infrastructureSaturation: number // 0..1, from layout gaps
} → LOW / MEDIUM / HIGH
```

### 4.3 Expansion Readiness 分层

**建议**：复用现有 G0–G11 + 新增 Candidate/Cost Gate。

| 层 | 现有 | 新增 |
| --- | --- | --- |
| 经济层 | G0–G11 ✅ | — |
| 候选层 | — | G12: 有评分合格候选 |
| 成本层 | — | G13: Available Budget ≥ Estimated Cost |
| 风险层 | — | G14: Risk ≤ 可接受阈值 |
| 保护层 | — | G15: Core Reserve 未被侵入 |

### 4.4 Candidate 评分公式

**建议**：严格遵循蓝图 §1.2 七因子。

```
score = w1·sourceValue      // 2/3 source 价值
      + w2·mineralValue     // 矿物密度 × 帝国缺口权重
      + w3·distanceScore    // 距最近自有房跳数
      + w4·neighborSafety   // 周边归属分布
      − w5·rivalProximity   // 宿敌距离
      + w6·defensibility    // 出口数/地形/塔位
      + w7·layoutFitness     // 模板适配
```

权重 w1–w7 从 CONFIG 读取（初值 SPECULATION），可由 tuning-engine 校准。

### 4.5 Core Protection Constraint

**建议**：Tiered Budget 递进计算。

```
Total Resources (= resourceView.totalEnergy)
  → Emergency Reserve (= budget.reserve × emergencyRatio)
    → Core Reserve (= budget.reserve, 不可侵入)
      → Operational Reserve (= budget.survival + budget.production)
        → Available Expansion Budget (= budget.expansion + budget.free)
```

只有 `Available Expansion Budget ≥ Plan.estimatedCost` 才能进入 READY。

### 4.6 Plan Deduplication & Hysteresis

**建议**：

- **Dedup**：Candidate Identity = roomName（稳定 key）。同一 roomName 最多 1 个 Active Plan。
- **Hysteresis**：READY → NOT_READY 需要 200 tick 持续不满足；NOT_READY → READY 需要 500 tick 持续满足 + 至少运输一次承诺。
- **Re-evaluation**：每 500 tick 或经济/Intel 变化时触发。

---

## 5. 与冻结蓝图的一致性

| 冻结条款 | A3.2 是否遵守 |
| --- | --- |
| EXPANSION §1: 立项权在 Empire | ✅ Intelligence 层只做评估与建议 |
| EXPANSION §1.1: 四类动机显式声明 | ✅ Plan.reason 必含动机类型 |
| EXPANSION §1.2: 七因子评分 | ✅ 新建 scoring.ts 实现七因子 |
| EXPANSION §2: G1–G5 门控 | ✅ 扩展 readiness.ts 加 G12–G15 |
| EXPANSION §3: 先 remote 尽调后 colonize | ⚠️ A3.2 只评估不执行，但 Plan 中可标注「需尽调」 |
| EXPANSION §4: 殖民自举五阶段 | ✅ A3.2 不执行，Cost Model 估算五阶段成本 |
| EXPANSION §5: 失败降级 | ✅ A3.2 不执行，但 Plan 标注 cancelConditions |
| EXPANSION §6: GCL 节奏 | ✅ A3.2 消费 GCL 余量门禁 |
| PLANNING §1: 无 Planner 组件 | ✅ 不新建 Planner，ExpansionPlan 是数据模型 |
| PLANNING §3: AgendaItem 数据契约 | ✅ Plan 可映射为 AgendaItem 的 expansion 类型 |
| PLANNING §4: 防振荡三防线 | ✅ Hysteresis + minDuration + 重建冷却 |
| GOAL_POLICY_PLAN §3: posture 四态 | ✅ 消费 posture.expansionAllowed |
| GOAL_POLICY_PLAN §4: 五域预算 | ✅ 消费 budget.expansion |
| R8: AgendaItem 类型集=冻结枚举 | ✅ expansion 类型已在冻结枚举中 |
| R9: System 注册表上限 15+3 | ⚠️ 新建 expansion-planner System 需检查上限 |
| INTELLIGENCE §1: 六概念 | ✅ 消费 Intel（fact/stale 区分） |

**无结构性冲突**。A3.2 在现有冻结蓝图框架内实施，不需要 ADR。

---

## 6. 依赖图

```text
                         ┌─────────────────────────────────────────┐
                         │              Empire State               │
                         │  (posture + budget + health + capacity) │
                         └────────────────┬────────────────────────┘
                                          │
                     ┌─────────────────────┼─────────────────────┐
                     ▼                     ▼                     ▼
            ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐
            │ Capacity Profile │  │ Resource Network  │  │  Empire Budget  │
            │ (5-domain util) │  │  (A3.1 snapshot)  │  │  (6-domain alloc)│
            └────────────────┘  └──────────────────┘  └────────────────┘
                     │                     │                     │
                     └─────────────────────┼─────────────────────┘
                                           │
                                           ▼
                              ┌────────────────────────┐
                              │  Expansion Pressure     │
                              │  (7-dimension saturation)│
                              └───────────┬────────────┘
                                          │
                         ┌────────────────┼────────────────┐
                         ▼                ▼                ▼
               ┌───────────────┐  ┌──────────────┐  ┌───────────────┐
               │  Intel (Room  │  │  Room Registry│  │  Empire Budget │
               │  Candidate)  │  │  (Owned Room) │  │  (Tiered)      │
               └───────┬───────┘  └───────┬──────┘  └───────┬───────┘
                       │                  │                  │
                       ▼                  ▼                  ▼
               ┌───────────────┐  ┌──────────────┐  ┌───────────────┐
               │  Candidate    │  │  Cost Model   │  │  Risk Model   │
               │  Discovery    │  │  (Bootstrap)   │  │  (5-dim)      │
               └───────┬───────┘  └───────┬──────┘  └───────┬───────┘
                       │                  │                  │
                       ▼                  ▼                  ▼
               ┌───────────────┐  ┌──────────────┐  ┌───────────────┐
               │  Candidate    │  │  Payback      │  │  Opportunity  │
               │  Evaluation   │  │  Model         │  │  Cost         │
               │  (7-Factor)   │  │                │  │                │
               └───────┬───────┘  └───────┬──────┘  └───────┬───────┘
                       │                  │                  │
                       └────────────────┼──────────────────┘
                                        │
                                        ▼
                          ┌─────────────────────────┐
                          │  Expansion Readiness     │
                          │  (G0–G15 + Pressure)     │
                          └───────────┬─────────────┘
                                      │
                                      ▼
                          ┌─────────────────────────┐
                          │  Candidate Ranking       │
                          │  (Multi-candidate sort)  │
                          └───────────┬─────────────┘
                                      │
                                      ▼
                          ┌─────────────────────────┐
                          │  Expansion Plan           │
                          │  (Lifecycle: DISCOVERED→  │
                          │   ...→WAITING_EXECUTION)  │
                          └───────────┬─────────────┘
                                      │
                                      ▼
                          ┌─────────────────────────┐
                          │  Decision Explanation    │
                          │  + Observability         │
                          └─────────────────────────┘
```

---

## 7. 裁决

**GO**。

A3.1 已证明 Empire 可以多房协调资源。A3.2 的核心工作是将
**执行驱动型扩张**（Intel → Evaluator → 直接 Claiming）升级为
**智能驱动型扩张**（Pressure → Readiness → Discovery → Evaluation →
Cost → Risk → Budget → Plan → Approval → WAITING_EXECUTION），
同时严格不执行 Claim/Reserve/Bootstrap。

A3.2 的实施分为 5 个阶段：
1. **Model Layer** — 新建 Pressure / Candidate / Discovery / Scoring /
   Cost / Payback / Risk / Tiered Budget / Plan / Lifecycle / Explanation /
   Dashboard 等 12+ 纯函数模块
2. **Memory Schema** — 扩展 KernelMemory（expansionPlans +
   expansionCandidates）+ planner-input.ts
3. **System Integration** — 扩展 readiness.ts（G12–G15）+ 新建/
   扩展 expansion-planner System + global-cache.ts
4. **Testing** — 20 Contract Tests + 4-Candidate Simulation + 6 Economic
   Gate Scenarios + 1k/5k/10k Tick Stability
5. **Validation** — Simulation + Observability + Final Report

**严格禁止**：
- Claim / Reserve / Remote Mining / Expansion Creep / Bootstrap Execution
- Military Escort / Terminal / Market
- 自动创建新 Room
- 每 tick 全量 Expansion Planning
- 直接编码（必须先完成 Architecture Review）

**Architecture Review 完成。等待确认后进入实现阶段。**