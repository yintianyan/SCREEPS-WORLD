# TD-37-3 Root Cause Analysis

## 问题描述

Expansion Experience/Outcome 采集链路断裂，导致 A6 Intelligence 层无法消费 Expansion 类型的决策数据。

## 根因定位

### 断点 1: DecisionTrace 缺少 Expansion 采集

**文件**: `src/systems/decision-trace-system.ts`

**现象**: `run()` 函数调用了 6 个 `collect*Decisions()` 函数（empire-health, logistics, recovery, spawn, defense, war-plan），但缺少 `collectExpansionDecisions()`。

**影响**: Expansion Decision 从未进入 DecisionTrace Ring Buffer → Experience Collector 永远看不到 Expansion Decision → 0 条 expansion Experience 被创建。

**根因**: 原始设计只覆盖了已有系统的决策采集点，Expansion 系统的 Decision 产生时机（Plan consume → Memory.kernel.expansion 初始化）没有对应的采集函数。

### 断点 2: Outcome Collection 空壳

**文件**: `src/systems/intelligence/experience-collector-system.ts`

**现象**: `buildOutcomeCollectionInput()` 的 `case "expansion"` 只有注释 `// 从 expansionDashboard 获取扩张状态`，没有设置 `input.expansionOutcome`。

**影响**: `collectExpansionOutcome()` 检查 `input.expansionOutcome === undefined` → 永远返回 `undefined` → 0 条 expansion Outcome 被采集。

**根因**: 扩张结果（EventKind.ExpansionOutcome + rhythm ring + Memory.kernel.expansion 状态）的数据源已存在，但没有被注入到 OutcomeCollectionInput。

### 断点 3: Attribution 输入不完整

**文件**: `src/systems/intelligence/experience-collector-system.ts`

**现象**: `buildAttributionInput()` 的 `case "expansion"` 只设置了 `expansionDuration`，缺少 `expansionTargetRoom`、`expansionFinalColonyState`、`expansionRclAchieved`、`threatLevelAfter`、`posture` 等字段。

**影响**: Attribution 虽然能产出结果，但证据不足，归因置信度偏低。

### 断点 4: advanceEconomicStartup 缺少 recordExpansionOutcome

**文件**: `src/systems/expansion-manager.ts`

**现象**: `advanceEconomicStartup` 的 timeout 强推路径（CP3 通过但 timeout → 强制推进到 integrating）没有调用 `recordExpansionOutcome`，而 `advanceIntegrating` 的对应路径有。

**影响**: 某些扩张完成的 Outcome 事件未被记录到 event-log 和 rhythm ring。

## 修复方案

| 断点 | 修复 | 文件 |
|------|------|------|
| 1 | 新增 `collectExpansionDecisions()` 函数，从 Memory.kernel.expansion + executionDashboard 采集，使用 processedExpansionPlanIds 防重 | decision-trace-system.ts |
| 2 | 在 `buildOutcomeCollectionInput` case "expansion" 中从 rhythm ring 最后一条编码注入 expansionOutcome，从 expansion.startedAt 注入 expansionDuration | experience-collector-system.ts |
| 3 | 在 `buildAttributionInput` case "expansion" 中补充 expansionTargetRoom、expansionFinalColonyState、threatLevelAfter、posture | experience-collector-system.ts |
| 4 | 在 advanceEconomicStartup timeout 强推路径补充 `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_SUCCESS)` | expansion-manager.ts |

## 验证

- typecheck: PASS
- test: 4831/4831 PASS (含 38 条新增 TD-37-3 测试)
- build: PASS
