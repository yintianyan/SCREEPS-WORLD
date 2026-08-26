# A6.6 Recommendation Catalog — 建议类型目录

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **方法**: 逐项评估 Value × Evidence × Risk × Cost
> **约束**: 不假设全部实现，逐项评估后给出优先级

---

## 一、评估方法

每个 Recommendation 类型按以下 7 维评估：

| 维度 | 说明 | 评分 |
|------|------|------|
| Value | 对帝国自治的增益 | HIGH / MEDIUM / LOW |
| Evidence Availability | A6.1–A6.5 是否提供足够输入 | HIGH / MEDIUM / LOW |
| Risk | 冲突 Decision Authority 的风险 | LOW / MEDIUM / HIGH |
| CPU Cost | 生成此建议的 CPU 开销 | LOW / MEDIUM / HIGH |
| Implementation Cost | 实现复杂度 | LOW / MEDIUM / HIGH |
| Failure Cost | 建议错误时的代价 | LOW / MEDIUM / HIGH |
| Decision Authority Conflict | 是否侵入现有决策权 | NONE / LOW / MEDIUM |

---

## 二、8 类 Recommendation 评估

### 2.1 Economic Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | HIGH | 经济是帝国生存基础 |
| Evidence | HIGH | A6.2 economicGrowth/resourceEfficiency 维度 + A6.3 energy-shortage prediction |
| Risk | LOW | 只建议"考虑经济调整"，不修改 Economy |
| CPU Cost | LOW | 消费已有 Evaluation + Prediction |
| Implementation Cost | MEDIUM | 需要定义经济建议的触发规则 |
| Failure Cost | LOW | 建议被忽略不影响运行 |
| DA Conflict | NONE | Economy 由 room-state + empire-economy 管理 |

**建议示例**: "economicGrowth 维度连续 DEGRADING，考虑收紧 P3 开支"

**优先级**: P0（首批实现）

---

### 2.2 Expansion Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | HIGH | 扩张选址直接影响帝国规模 |
| Evidence | MEDIUM | A6.2 expansion 维度 + A6.3 expansion-readiness prediction（未实现） |
| Risk | LOW | 只建议"考虑扩张到 X"，不提交 AgendaItem |
| CPU Cost | LOW | 消费已有 Evaluation |
| Implementation Cost | MEDIUM | 需要整合 Intel + Readiness |
| Failure Cost | LOW | 建议被忽略 |
| DA Conflict | NONE | 扩张立项由 Empire + G1–G5 门控 |

**建议示例**: "Expansion readiness 高，但 energy-shortage 预测置信度高 → CONFLICT，暂缓扩张"

**优先级**: P0（首批实现，因为能展示 Conflict 处理）

---

### 2.3 Defense Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | HIGH | 防御不足导致团灭 |
| Evidence | MEDIUM | A6.2 riskLevel 维度 + A6.5 predictionConflicts（如有） |
| Risk | LOW | 只建议"考虑加强防御"，不创建 DefensePlan |
| CPU Cost | LOW | 消费已有数据 |
| Implementation Cost | MEDIUM | 需要定义防御建议规则 |
| Failure Cost | MEDIUM | 防御建议被忽略可能导致损失 |
| DA Conflict | NONE | 防御由 tower-defense + defense-planner 管理 |

**建议示例**: "riskLevel 维度 DEGRADING + 威胁预测活跃 → 考虑提前 fortify"

**优先级**: P1（第二批实现）

---

### 2.4 Military Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | MEDIUM | 军事建议价值高但证据链长 |
| Evidence | MEDIUM | A6.2 militaryOutcome 维度 + A6.1 war Experience |
| Risk | MEDIUM | 最容易越权 → 必须明确"不授权进攻" |
| CPU Cost | LOW | 消费已有数据 |
| Implementation Cost | HIGH | 需要处理 war posture 边界 |
| Failure Cost | HIGH | 错误的军事建议可能导致不必要的战争 |
| DA Conflict | NONE（如果设计正确） | war posture 唯一授权链 |

**建议示例**: "militaryOutcome 连续 FAILURE → 考虑退 fortify（但不授权退）"

**优先级**: P2（第三批实现，需要更严格的边界）

---

### 2.5 Logistics Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | MEDIUM | 物流瓶颈影响全局 |
| Evidence | MEDIUM | A6.2 resourceEfficiency 维度 + A6.3 logistics-bottleneck（未实现） |
| Risk | LOW | 只建议"考虑优化物流"，不提交 TransportRequest |
| CPU Cost | LOW | 消费已有数据 |
| Implementation Cost | MEDIUM | 需要定义物流建议规则 |
| Failure Cost | LOW | 建议被忽略 |
| DA Conflict | NONE | 物流由 logistics-planner + agenda-manager 管理 |

**建议示例**: "resourceEfficiency DEGRADING + hauler 饥饿预测 → 考虑增加 hauler 配额"

**优先级**: P2（第三批实现，依赖未实现的 prediction model）

---

### 2.6 Spawn Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | MEDIUM | Spawn 饥饿影响全局 |
| Evidence | HIGH | A6.3 spawn-starvation prediction（已实现） |
| Risk | LOW | 只建议"考虑调整 spawn 优先级"，不提交 SpawnRequest |
| CPU Cost | LOW | 消费已有 Prediction |
| Implementation Cost | LOW | 直接消费 spawn-starvation 预测 |
| Failure Cost | LOW | 建议被忽略 |
| DA Conflict | NONE | Spawn 由 SpawnManager 唯一管理 |

**建议示例**: "spawn-starvation 预测活跃（confidence=0.8）→ 考虑 P0 车道优先"

**优先级**: P1（第二批实现，证据链最完整）

---

### 2.7 Recovery Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | HIGH | 恢复延迟导致帝国崩溃 |
| Evidence | MEDIUM | A6.2 recoveryCost 维度 + A6.1 recovery Experience |
| Risk | LOW | 只建议"考虑启动恢复"，不提交 RecoveryAction |
| CPU Cost | LOW | 消费已有数据 |
| Implementation Cost | MEDIUM | 需要定义恢复建议规则 |
| Failure Cost | HIGH | 恢复建议被忽略可能导致崩溃 |
| DA Conflict | NONE | 恢复由 empire-health-system + recovery-execution-system 管理 |

**建议示例**: "recoveryCost DEGRADING + 多次恢复失败 → 考虑升级恢复策略"

**优先级**: P1（第二批实现）

---

### 2.8 Strategic Posture Recommendation

| 维度 | 评估 | 理由 |
|------|------|------|
| Value | HIGH | Posture 切换时机影响全局 |
| Evidence | HIGH | A6.2 全维度 + A6.5 IntelligenceState |
| Risk | HIGH | 最容易越权 → 必须明确"不修改 posture" |
| CPU Cost | LOW | 消费已有数据 |
| Implementation Cost | HIGH | 需要极严格的边界 |
| Failure Cost | HIGH | 错误的 posture 建议可能影响全局策略 |
| DA Conflict | NONE（如果设计正确） | posture 由 Policy 纯函数唯一裁决 |

**建议示例**: "全维度 DEGRADING + IntelligenceState 不确定性高 → 考虑收缩到 fortify（由 Policy 裁决）"

**优先级**: P2（最后实现，需要最严格的边界和最高置信度门槛）

---

## 三、优先级汇总

| 批次 | 类型 | 理由 |
|------|------|------|
| **P0 首批** | Economic + Expansion | 证据链完整，能展示 Conflict 处理 |
| **P1 第二批** | Defense + Spawn + Recovery | 证据可用，实现简单 |
| **P2 第三批** | Military + Logistics + Posture | 需要更严格的边界或依赖未实现模型 |

---

## 四、不实现的 Recommendation 类型

以下类型明确排除：

| 类型 | 排除理由 |
|------|---------|
| Tactical Recommendation | 战术层每 tick 决策，不适合低频建议 |
| Micro Recommendation | 微操由 RolePolicy 管理 |
| Market Recommendation | 市场由 MarketManager + 动态定价管理 |
| Layout Recommendation | 布局由 versioned template 管理 |
| Traffic Recommendation | 移动由 TrafficResolver 管理 |

---

## 五、结论

**A6.6 的 Recommendation Catalog 不需要全部一次性实现。**

建议分批实现：
- 首批实现 Economic + Expansion（证据链最完整）
- 逐步扩展到 Defense + Spawn + Recovery
- 最后实现 Military + Logistics + Posture（边界最严格）

**但架构设计必须覆盖全部 8 类，确保未来扩展不需要结构性变更。**
