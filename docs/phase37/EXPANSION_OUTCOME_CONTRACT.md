# Expansion Outcome Contract

## 设计原则

1. **Outcome 只能来自已经发生的 Runtime Fact**
2. 不从 Prediction / Evaluation 反推 Outcome
3. 复用现有 `collectExpansionOutcome()` 纯函数
4. 不创建第二套 Outcome 系统

## 数据流

```
Runtime Fact (event-log + rhythm ring + Memory.kernel.expansion)
    ↓
buildOutcomeCollectionInput case "expansion"
    ↓
collectExpansionOutcome(input) → OutcomeRecord
    ↓
attachOutcome(exp, outcome) → ExperienceRecord
``## 数据源映射

| OutcomeCollectionInput 字段 | 数据来源 | 转换逻辑 |
|---------------------------|----------|----------|
| expansionOutcome | Memory.kernel.expansionRhythm.ring[last] | phaseCode(1) * 10 + outcomeCode |
| expansionDuration | Memory.kernel.expansion.startedAt 或 decisionTick | tick - startedAt |
| hostilesInRoom | exp.context.metrics.hostilesInRoom | 直传 |

## rhythm ring 编码到 OutcomeClassification 映射

| ring code | ExpansionOutcomeKind | outcomeCode | Classification |
|-----------|---------------------|-------------|----------------|
| 0 | success | 0 | SUCCESS |
| 1 | stolen | 1 | FAILURE |
| 2 | timeout | 2 | EXPIRED |
| 3 | lost | 3 | UNKNOWN |
| 4 | aborted | 4 | UNKNOWN |

## 时间语义

| 字段 | 来源 | 约束 |
|------|------|------|
| startTick | expansion.startedAt | Memory 持久 |
| endTick | ctx.tick (Outcome 采集时刻) | 当前 tick |
| duration | endTick - startTick | 非负 |
| decisionTick | DecisionRecord.tick | 采集前的历史 tick |
| measurementTick | ctx.tick | 当前 tick |

### 不变量

- `decisionTick <= measurementTick` (不允许时间穿越)
- `duration >= 0` (不允许负持续时间)
- Outcome 不能使用 `Date.now()` 或 wall clock
- Outcome 不能读取未来数据（当前 tick 的 empire state 不能修改过去的 Outcome）

## Attribution 输入映射

| AttributionInput 字段 | 数据来源 |
|----------------------|----------|
| expansionDuration | exp.outcome.delay 或 context.metrics.expansionDuration |
| expansionTargetRoom | decisionRef.selectedAction.replace("EXPANSION_START_", "") |
| expansionFinalColonyState | 从 outcome.classification 推导 |
| expansionRclAchieved | context.metrics.expansionRclAchieved |
| threatLevelAfter | context.metrics.threatLevelAfter |
| posture | context.posture |

## 外部因素标记

- **EXTERNAL_THREAT**: outcome.classification = FAILURE + threatLevelAfter = HIGH/CRITICAL
- **TIMING**: outcome.classification = EXPIRED
- **UNKNOWN**: outcome.classification = UNKNOWN（证据不足时不猜测）

## Survivorship Bias 防护

- SUCCESS、FAILURE、EXPIRED、UNKNOWN 都被记录
- Operation recycle 不删除 Experience Ring Buffer 中的历史记录
- 失败的 Expansion 也能成为 Experience

## Self-Validation 防护

```
DecisionTrace → Experience → Outcome → Attribution → Evaluation
                                                        ↓
                   Prediction / Calibration / Reliability / Recommendation
```

**禁止反向**:
- Prediction → Outcome ❌
- Recommendation → Outcome ❌
- Evaluation → Outcome ❌
