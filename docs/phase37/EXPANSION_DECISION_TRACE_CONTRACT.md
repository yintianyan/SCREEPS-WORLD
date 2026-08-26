# Expansion DecisionTrace Contract

## 设计原则

1. **一次 Expansion Decision = 一次 Decision Event**，不是每 tick 状态变化
2. 复用现有 `DecisionRecord` 类型，不创建第二套 Trace
3. `category: "EXPANSION"` 已在 `DecisionCategory` 联合类型中定义
4. `categoryToExperienceType("EXPANSION")` → `"expansion"` 已存在映射

## 采集时机

| 事件 | 触发条件 | 采集源 |
|------|----------|--------|
| Plan 启动 | Memory.kernel.expansion 新建 + planId 未处理 | Memory.kernel.expansion, executionDashboard |

## 防重机制

使用 `DecisionTraceCache.processedExpansionPlanIds: Set<string>` 跟踪已处理的 planId。
- planId 优先作为去重 key
- planId 为空时 fallback 到 `expansion:${target}:${startedAt}`
- Set 超过 500 条时清理最旧的 200 条

## DecisionRecord 字段映射

| DecisionRecord 字段 | 数据来源 | 示例值 |
|---------------------|----------|--------|
| decisionId | makeDecisionId(tick, seq) | `D-12345-7` |
| tick | ctx.tick | 12345 |
| category | 硬编码 | `"EXPANSION"` |
| actor | 硬编码 | `"expansion-manager"` |
| scope | expansion.target | `"W1N1"` |
| inputSnapshotHash | snapshotHash(buildSnapshot(...)) | `"a1b2c3d4"` |
| reasons | 从 expansion state + posture + dashboard 构建 | — |
| evidence | threat + health + population | — |
| selectedAction | `EXPANSION_START_${target}` | `"EXPANSION_START_W1N1"` |
| rejectedAlternatives | `[]` | — |
| expectedOutcome | 文本描述 | `"房间 W1N1 完成完整扩张链路..."` |
| correlationId | makeCorrelationId(decisionId, tick) | `"rcv-D-12345-7-12345"` |
| severity | `"IMPORTANT"` | — |
| decisionHash | decisionHash(...) | — |
| createdAt | tick | 12345 |
| lifecycle | `"ACTIVE"` | — |

## 不变量

- **不每 tick 重复产生**: processedExpansionPlanIds 保证同一 Plan 只产生一次
- **不修改 Execution**: collectExpansionDecisions 只读 Memory/kernel，不写
- **不修改 Strategy/Posture**: 只读取 posture 上下文
- **Shadow-Only**: DecisionTrace 是可观测设施，非执行通道
