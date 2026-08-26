# A6.6 Decision Authority — 现有决策权审计

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **方法**: 代码级调用链追踪，逐项验证 Producer / Consumer / 唯一性
> **基线**: A6.0–A6.5 已冻结 + 真实代码审计

---

## 一、现有 Decision Authority 完整矩阵

### 1.1 帝国方向（Posture / Budget）

| 维度 | 内容 |
|------|------|
| **决策者** | Policy 纯函数 `evaluateEmpirePosture()` [domain/strategy/posture.ts] |
| **执行者** | empire-strategy.ts → `Memory.kernel.strategy.posture` |
| **频率** | 每 tick (interval=1), P1 |
| **唯一性** | ✅ 唯一 — 任何系统不得改 posture |
| **切换约束** | 滞回 + minDuration |
| **A6.6 关系** | A6.6 只读消费 posture 状态，不得修改 |

### 1.2 扩张 / 远矿立项

| 维度 | 内容 |
|------|------|
| **决策者** | Empire（AgendaItem + G1–G5 门控） |
| **执行者** | expansion-manager.ts [P2] / remote-mining-manager.ts [P2] |
| **规划者** | expansion-planner.ts → `Memory.kernel.expansionPlans[]` |
| **门控** | readiness.ts (G0–G11), budget.ts (expansion 域) |
| **唯一性** | ✅ 唯一 — 房间不得自行 claim/立项 |
| **A6.6 关系** | A6.6 可产出 Expansion Recommendation，但不执行立项 |

### 1.3 战争授权

| 维度 | 内容 |
|------|------|
| **决策者** | war posture 唯一授权链 |
| **执行者** | war-planner.ts [P2] — 唯一进攻执行决策者 |
| **规划者** | war-planning-system.ts → `planMilitaryOperation()` → WarPlan |
| **授权链** | PlayerIntel + 威胁记忆 + 战争经济学核算 → posture=war |
| **止损链** | casualtyMultiplier / warBlacklist / warStandDownUntil |
| **唯一性** | ✅ 唯一 — attacker 仅由 war-planner 经 SpawnManager 孵化 |
| **A6.6 关系** | A6.6 可产出 Military Recommendation，但不授权进攻 |

### 1.4 Spawn 排产

| 维度 | 内容 |
|------|------|
| **决策者** | SpawnManager（全局唯一 spawnCreep 调用者） |
| **执行者** | spawn-manager.ts [P0, interval=1] |
| **需求来源** | 房间 census / Empire Operation / replacement horizon / 防御应答 |
| **车道制** | P0(灾后/防御) > P1(生存) > P2(稳定) > P3(增长) |
| **唯一性** | ✅ 唯一 — 全项目仅 1 处 `spawnCreep` 调用 |
| **A6.6 关系** | A6.6 可产出 Spawn Recommendation，但不提交 SpawnRequest |

### 1.5 建造签发

| 维度 | 内容 |
|------|------|
| **决策者** | ConstructionManager（自有房）/ RemoteMiningManager（远矿） |
| **执行者** | construction-manager.ts [P2] / remote-mining-manager.ts [P2] |
| **全局约束** | maxGlobalSites, 每房 3 normal + 2 road + 1 critical |
| **布局** | layout-planner.ts + versioned template |
| **唯一性** | ✅ 唯一 — 角色层只写 `needContainer` 申请标记 |
| **A6.6 关系** | A6.6 不创建 ConstructionSite |

### 1.6 市场下单

| 维度 | 内容 |
|------|------|
| **决策者** | MarketManager（唯一写者） |
| **执行者** | terminal-manager.ts [P3, interval=200] |
| **定价** | 动态定价系统（行情快照 × 策略系数） |
| **唯一性** | ✅ 唯一 — 幂等键 |
| **A6.6 关系** | A6.6 不调用 terminal.send / market.deal |

### 1.7 跨房调拨

| 维度 | 内容 |
|------|------|
| **决策者** | Empire（terminal 网络 + 门控） |
| **执行者** | agenda-manager.ts [P1, interval=100] → networkSnapshot |
| **规划者** | logistics-planner.ts [P1, interval=100] → TransportPlan |
| **搬运** | logistics.ts [P0, interval=1] → transportPool → assignment-service |
| **唯一性** | ✅ 唯一 — 本土净流为正前置 |
| **A6.6 关系** | A6.6 不提交 TransportRequest |

### 1.8 恢复执行

| 维度 | 内容 |
|------|------|
| **决策者** | empire-health-system → `globalCache.recoveryActions` |
| **执行者** | recovery-execution-system.ts [P1, interval=10] |
| **链路** | RecoveryAction → translate → submit to spawn/agenda/terminal |
| **生命周期** | PROPOSED → SUBMITTED → VERIFYING → SUCCEEDED/FAILED |
| **唯一性** | ✅ 唯一 — 不重新实现执行逻辑 |
| **A6.6 关系** | A6.6 可产出 Recovery Recommendation，但不提交 RecoveryAction |

### 1.9 本地六闭环

| 维度 | 内容 |
|------|------|
| **决策者** | Room（phase 驱动） |
| **执行者** | RolePolicy + 本地系统 |
| **六闭环** | 能量 / 人口 / 物流 / 建造 / 升级 / 防御 |
| **唯一性** | ✅ 唯一 — 不得越过预算消耗共享资源 |
| **A6.6 关系** | A6.6 不干涉本地决策 |

### 1.10 移动签发

| 维度 | 内容 |
|------|------|
| **决策者** | TrafficResolver（tick 末按房仲裁） |
| **执行者** | traffic-manager.ts [P0 post, interval=1] |
| **唯一性** | ✅ 唯一 — 角色只登记意图 |
| **A6.6 关系** | A6.6 不签发 move |

---

## 二、A6.6 的权限矩阵

### 2.1 读取权限

| 来源 | A6.6 读取 | 理由 |
|------|:---------:|------|
| A6.1 `__experienceCache` | ✅ 只读 | 消费历史经验 |
| A6.2 `__evaluationCache` | ✅ 只读 | 消费策略评估 |
| A6.3 `__predictionCache` | ✅ 只读 | 消费预测 |
| A6.4 `__calibrationCache` | ✅ 只读 | 消费校准质量 |
| A6.5 IntelligenceState | ✅ 只读 | 消费可靠性评估 |
| EmpireHealth | ✅ 只读 | 消费健康状态 |
| globalCache（业务字段） | ✅ 只读 | 消费态势快照 |

### 2.2 写入权限

| 目标 | A6.6 写入 | 理由 |
|------|:---------:|------|
| A6.1–A6.5 任何 cache | ❌ | 不修改上游数据 |
| Memory.kernel.strategy | ❌ | 不修改策略 |
| Memory.kernel.warPlan | ❌ | 不修改战争计划 |
| Spawn 请求 | ❌ | 不提交孵化请求 |
| Construction site | ❌ | 不创建建造 |
| Terminal / Market | ❌ | 不下单 |
| TransportRequest | ❌ | 不提交搬运请求 |
| RecoveryAction | ❌ | 不提交恢复动作 |
| Posture | ❌ | 不修改姿态 |
| globalCache（业务字段） | ❌ | 不修改任何业务状态 |

### 2.3 A6.6 唯一允许的写入

| 目标 | 允许 | 条件 |
|------|:----:|------|
| `__recommendationCache` | ✅ | Bounded, TTL, GC, shadow-only |
| console.log | ✅ | 可观测性 |

---

## 三、Recommendation Consumption Boundary

### 3.1 当前状态

**当前无任何执行系统读取 A6.6 的输出。** 这是 by design。

### 3.2 未来接入路径

如果未来 A6.6 被接入执行系统，必须遵守以下边界：

```
A6.6 RecommendationCandidate[]
    ↓ (只读)
Future Decision Authority (独立模块)
    ↓ (裁决)
Existing Strategy / Planner / Spawn / Military / Logistics / Recovery
```

### 3.3 禁止的接入路径

| 路径 | 禁止 | 理由 |
|------|:----:|------|
| Recommendation → Strategy (直写 posture) | ❌ | posture 唯一写者是 Policy |
| Recommendation → Spawn (直提交请求) | ❌ | SpawnManager 唯一写者 |
| Recommendation → War (直授权进攻) | ❌ | war posture 唯一授权 |
| Recommendation → Construction (直建 site) | ❌ | ConstructionManager 唯一写者 |
| Recommendation → Recovery (直提交 action) | ❌ | recovery-execution-system 唯一执行 |
| Recommendation → Logistics (直提交 request) | ❌ | logistics 链路唯一 |

### 3.4 Recommendation 的正确消费方式

```
Recommendation → Decision Authority（人类或未来模块审查）
    ↓ 裁决
    ↓ 记录 Accepted/Rejected
    ↓ 转译为对应执行系统的合法输入
    ↓ 通过正式接口提交
```

**A6.6 本身不在这个链路中**。A6.6 只负责产出 Recommendation，不参与消费。

---

## 四、Decision Authority 冲突检测

### 4.1 检测方法

在 A6.6 实现前和实现后，必须验证：

1. **代码搜索**: 搜索 A6.6 domain 层是否出现任何 Game API 调用
2. **import 审计**: A6.6 domain 层是否 import 了任何 systems/ 模块
3. **写入审计**: A6.6 system 层是否写入了任何 globalCache 业务字段
4. **消费审计**: 是否有任何执行系统 import 了 A6.6 的输出
5. **autoApply 审计**: RecommendationCandidate.autoApply 是否始终为 `false`

### 4.2 守卫

| Guard ID | 检查内容 | 失败处理 |
|----------|---------|---------|
| REC-DA-001 | A6.6 不调用 Game API | safeRun 隔离 |
| REC-DA-002 | A6.6 不修改 Memory | safeRun 隔离 |
| REC-DA-003 | A6.6 不修改 globalCache 业务字段 | console.log 告警 |
| REC-DA-004 | A6.6 不提交 Spawn/Construction/Logistics 请求 | console.log 告警 |
| REC-DA-005 | A6.6 不修改 Posture/WarPlan/Agenda | safeRun 隔离 |
| REC-DA-006 | 无执行系统 import A6.6 输出 | 编译时检测 |

---

## 五、结论

**A6.6 不拥有任何 Decision Authority。**

A6.6 的角色是 **Evidence-backed Recommendation Producer**：

- 可以告诉上层"我建议考虑 X，因为证据 A/B/C 支持它"
- 绝不能说"我决定执行 X"
- 绝不能绕过任何现有 Decision Authority

**无 Decision Authority 冲突。A6.6 可安全进入架构设计。**
