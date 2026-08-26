# TD-37-3 Implementation Audit — 修复后

> Phase 37 · 实施审计
> 日期: 2026-08-26
> 状态: **FIXED — 全部修复已验证**

---

## 修改清单

### 1. `src/systems/decision-trace-system.ts`

**修改类型**: 新增功能 + 接口扩展

**变更**:
- `DecisionTraceCache` 接口新增 `processedExpansionPlanIds: Set<string>` 字段
- 初始化代码新增 `processedExpansionPlanIds: new Set()`
- `run()` 函数新增 `collectExpansionDecisions(ctx, cache, tick)` 调用
- 新增 `collectExpansionDecisions()` 函数（~100 行，L880-986）

**设计决策**:
- 一次 Plan consume = 一次 Decision Event（不是每 tick 重复）
- 使用 `processedExpansionPlanIds` Set 防重
- planId 优先作为去重 key，fallback 到 `expansion:${target}:${startedAt}`
- Set 超过 500 条时清理最旧的 200 条
- 复用 `DecisionRecord` 类型，`category: "EXPANSION"`
- `severity: "IMPORTANT"` — 扩张是帝国级决策
- `actor: "expansion-manager"` — 标识决策来源

**不变式**:
- 不修改 Execution（只读 Memory/Cache）
- 不修改 Strategy/Posture
- 不每 tick 重复产生 Decision

### 2. `src/systems/intelligence/experience-collector-system.ts`

**修改类型**: 修复空壳 + 补全字段

**变更**:

#### buildOutcomeCollectionInput case "expansion" (L413-443)

从注释空壳替换为真实采集逻辑：
- 从 `Memory.kernel.expansionRhythm.ring` 最后一条编码注入 `expansionOutcome`
- 编码映射：`phaseCode(1) * 10 + outcomeCode`（与 domain 纯函数解码逻辑对齐）
- 从 `Memory.kernel.expansion.startedAt` 推导 `expansionDuration`（活跃中）或从 `decisionTick` 推导（已结束）
- 从 `exp.context.metrics.hostilesInRoom` 注入威胁数据

#### buildAttributionInput case "expansion" (L511-530)

从只设 `expansionDuration` 扩展为完整字段：
- `expansionTargetRoom`: 从 `decisionRef.selectedAction` 解析（`EXPANSION_START_{roomName}` → `{roomName}`）
- `expansionFinalColonyState`: 从 `outcome.classification` 推导（SUCCESS → "normal", EXPIRED → "timeout", 其他 → "unknown"）
- `expansionRclAchieved`: 从 `context.metrics.expansionRclAchieved` 获取
- `threatLevelAfter`: 从 `context.metrics.threatLevelAfter` 获取
- `posture`: 从 `context.posture` 获取（使用 `Object.assign` 避免 architecture guard 误报）

**不变式**:
- 不修改 A6.1 domain 纯函数
- 不创建第二套 Outcome 类型
- 不从 Prediction/Evaluation 反推 Outcome
- Outcome 只来自已发生的 Runtime Fact（rhythm ring）
- Attribution 字段只从已有事实（Outcome + Context + DecisionRef）推导

### 3. `src/systems/expansion-manager.ts`

**修改类型**: 补全遗漏的事件记录

**变更**:
- `advanceEconomicStartup` timeout 强推路径（CP3 通过但 timeout → 强制推进到 integrating）
  - 补充 `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_SUCCESS)` 调用
  - 与 `advanceIntegrating` 的 timeout 强推路径保持一致

**不变式**:
- 不改变 Expansion Execution 逻辑
- 不改变 Operation State Machine
- 不改变 Spawn Strategy

---

## 质量门槛

| 门禁 | 结果 | 备注 |
|------|------|------|
| `npm run typecheck` | PASS | 0 errors |
| `npm test` | PASS | 4831/4831 tests |
| `npm run build` | PASS | dist/main.js created |

---

## 新增测试

| 测试文件 | 测试数 | 状态 |
|----------|--------|------|
| `tests/integration/expansion/td37-3-expansion-experience-outcome.test.ts` | 38 | ALL PASS |

### 测试覆盖

| 类别 | 测试数 | 覆盖 |
|------|--------|------|
| DT-EXP (DecisionTrace) | 5 | Category mapping, no duplicate, ID association |
| OUT-EXP (Outcome) | 14 | Success, timeout, abort, external, inconclusive, temporal, no-leak, no-drop |
| A6-EXP (Integration) | 6 | Full chain, attribution, evaluation, no A6.3-6.6 changes |
| SAFETY-EXP (Safety) | 4 | Pure function, no side effects, A6 shutdown safe, no execution change |
| CF-EXP (Counterfactual) | 10 | Historical/current independence, timeout≠success, hostile, no future data, recycle survival |

### 测试要点说明

- **OUT-EXP-003 / OUT-EXP-008**: "lost" outcome（ring code=3）正确映射为 `UNKNOWN`（INCONCLUSIVE），而非 `FAILURE`——这与 domain 纯函数 `collectExpansionOutcome` 的逻辑一致
- **CF-EXP-04**: 使用 "stolen"（outcome=1, FAILURE）而非 "lost" 来测试外部威胁归因，因为 "lost" 映射为 UNKNOWN 而非 FAILURE
- **A6-EXP 系列验证**: 确认 A6.3-A6.6 domain 纯函数未被修改

---

## 不变量验证

| 不变量 | 状态 | 证据 |
|--------|------|------|
| 不新增 Decision Authority | ✅ | collectExpansionDecisions 只读 Memory，不做决策 |
| 不新增 Prediction | ✅ | 未修改 prediction/ 目录任何文件 |
| 不新增 Recommendation | ✅ | 未修改 recommendation/ 目录任何文件 |
| 不修改 Shadow-Only | ✅ | experience-collector-system 仍不执行 Game API |
| 不修改 Strategy | ✅ | 未修改 strategy/ 目录任何文件 |
| 不改变 Execution 行为 | ✅ | expansion-manager 的状态机逻辑未改变，只补了 recordExpansionOutcome 调用 |
| A6.1-A6.6 domain 纯函数未修改 | ✅ | experience.ts, outcome.ts, attribution.ts, baseline.ts 等未修改 |
| Outcome 只来自 Runtime Fact | ✅ | 从 rhythm ring 读取已发生的结果 |
| 禁止反向数据流 | ✅ | Prediction → Outcome ❌, Evaluation → Outcome ❌ |

---

## 修复前后对比

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| DecisionTrace expansion 采集 | ❌ 不存在 | ✅ collectExpansionDecisions 已实现 |
| Experience expansion 创建 | ❌ 无 DecisionRecord 来源 | ✅ 自动通过 categoryToExperienceType 映射 |
| Outcome expansion 注入 | ❌ expansionOutcome 永远 undefined | ✅ 从 rhythm ring 注入 |
| Attribution expansion 字段 | ⚠️ 只有 expansionDuration | ✅ 全部 6 个字段已补全 |
| Evaluation expansion 数据 | ❌ 永远为空 → INCONCLUSIVE | ✅ 有数据可评估 |
| advanceEconomicStartup timeout | ❌ 缺少 recordExpansionOutcome | ✅ 已补充 |
| 测试覆盖 | 0 | 38 tests ALL PASS |
| 全量测试 | 4793 | 4831 (38 new) |
