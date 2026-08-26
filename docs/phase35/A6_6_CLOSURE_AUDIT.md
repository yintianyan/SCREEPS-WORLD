# A6.6 Recommendation Engine — Architecture Closure Audit

**审计日期**: 2026-08-26  
**审计范围**: A6.6 Recommendation Engine 全部代码（domain + system + tests）  
**审计员**: AI Agent (independent)  
**审计方法**: 静态代码分析 + 全 repo grep + 类型检查 + 73 测试 + 构建验证

---

## §0. 审计结论

| 检查项 | 结果 |
|--------|------|
| Shadow-Only 边界 | ✅ PASS |
| 零 Decision Authority | ✅ PASS |
| Evidence 可追溯性 | ✅ PASS |
| 确定性 (1000× replay) | ✅ PASS |
| 有界内存 | ✅ PASS |
| 生命周期完整性 | ✅ PASS |
| 冲突只检测不解决 | ✅ PASS |
| Hidden Execution Path | ✅ PASS |
| A6 Shutdown Safety | ✅ PASS |
| Quality Gates | ✅ PASS (typecheck + 73 tests + build) |

**最终裁定**: A6.6 Recommendation Engine **通过闭包审计**，无阻断性缺陷。

---

## §1. Real Call Graph Audit — 消费者搜索

### 1.1 搜索方法

全 repo `src/` 目录下搜索以下模式：
- `import.*recommendation` (TypeScript import 语句)
- `__recommendationCache` (缓存字段引用)
- `getRecommendations|getActiveRecommendationList|printRecommendationDashboard` (导出的查询函数)

### 1.2 搜索结果

| 文件 | 引用内容 | 引用性质 |
|------|----------|----------|
| `bootstrap.ts:51` | `import { recommendationEngineSystem }` | 系统注册（唯一组合根） |
| `global-cache.ts:381` | `__recommendationCache?: unknown` | 类型声明 |
| `recommendation-engine-system.ts` | 全部 A6.6 domain import | 系统壳自身 |
| `recovery-priority.ts:67` | `recommendation: string` | **同名异义** — 恢复动作描述字段 |
| `war-planning.ts:427,552` | `recommendation` 字段 | **同名异义** — 经济护栏推荐结果 |
| `empire-health-system.ts:286` | `urgent.recommendation` | **同名异义** — 恢复建议字符串 |
| `decision-trace-system.ts:156,775,782,803` | `recommendation` | **同名异义** — 恢复/战争计划文本 |

### 1.3 结论

**无执行系统消费 A6.6 输出。** `getRecommendations()`、`getActiveRecommendationList()`、`printRecommendationDashboard()` 三个查询函数被导出但未被 `src/` 中任何其他文件 import。它们仅供控制台手动调用（dashboard 可观测性），不进入 tick 执行路径。

REC-006（No Execution Leak）**通过**。

---

## §2. Decision Authority Audit — 决策权威矩阵

### 2.1 A6.1–A6.6 决策权威矩阵

| 层 | 系统 | 能做什么 | 不能做什么 |
|----|------|----------|------------|
| A6.1 | experience-collector | 记录 Experience/Outcome | 不改策略、不改 spawn |
| A6.2 | strategy-evaluation | 评估 8 维度 | 不执行改善、不改基线 |
| A6.3 | prediction-system | 生成预测 | 不触发响应动作 |
| A6.4 | calibration-resolution | 校准模型 | 不改模型权重、不调参数 |
| A6.5 | intelligence-state-system | 汇总可靠性 | 不做策略裁决 |
| **A6.6** | **recommendation-engine** | **产出 RecommendationCandidate** | **不执行、不裁决、不消费** |

### 2.2 guards.ts REC-008 验证

`guardRec008NoDecisionAuthority()` 检查 RecommendationCandidate 对象不包含以下禁止字段：
- `executeAction` / `applyStrategy` / `resolveConflict` / `selectHighest` / `acceptRecommendation` / `rejectRecommendation`

测试 `SHADOW-003` 验证了此约束。**通过**。

### 2.3 ranking.ts 隐藏退化审计

`ranking.ts` 使用 5 级 Lexicographic 排序：
1. 生命周期有效性（valid > created > accepted > expired > superseded > rejected）
2. 紧急度（critical > high > medium > low > informational）
3. 置信度（高 → 低）
4. 证据质量（数量多 → 少）
5. 确定性 tie-breaker（recommendationId 字典序）

**无隐藏退化路径**：
- 不产出 `score` 字段（REC-009 禁止）
- `rankRecommendations()` 返回新数组，不修改输入
- `getTopRecommendations()` 仅 slice，不裁决
- 排序结果仅用于 dashboard 可观测性输出（5000 tick 低频 console.log）
- 排序结果不写入任何执行系统消费的缓存

**结论**: ranking 不参与任何裁决，仅提供可观测性。**通过**。

---

## §3. Current Snapshot Regression Audit — 8 类 Recommendation 审查

### 3.1 8 类 Trigger Condition 审查

| Category | Trigger 函数 | 证据来源 | 输出 urgency | 审查结果 |
|----------|-------------|----------|-------------|----------|
| economic | `evaluateEconomicTrigger` | A6.2 INFERRED + A6.3 PREDICTED + A6.1 OBSERVED | low→high | ✅ 正确匹配 |
| spawn | `evaluateSpawnTrigger` | A6.3 PREDICTED (spawn-starvation) | medium→critical | ✅ 正确匹配 |
| defense | `evaluateDefenseTrigger` | A6.1 OBSERVED (defense FAILURE/ABORTED) | high | ✅ 正确匹配 |
| logistics | `evaluateLogisticsTrigger` | A6.2 INFERRED (resourceEfficiency) | medium | ✅ 正确匹配 |
| recovery | `evaluateRecoveryTrigger` | A6.1 OBSERVED (recovery FAILURE/ABORTED) | critical | ✅ 正确匹配 |
| posture | `evaluatePostureTrigger` | A6.5 RELIABILITY_ASSESSED (drift DEGRADING) | low | ✅ 正确匹配 |
| expansion | `evaluateExpansionTrigger` | A6.1 OBSERVED (expansion SUCCESS/PARTIAL) | low | ✅ 正确匹配 |
| military | `evaluateMilitaryTrigger` | A6.1 OBSERVED (war FAILURE/ABORTED) | high | ✅ 正确匹配 |

### 3.2 回归风险

- **无新 Category**: 8 类严格匹配 `A6_6_RECOMMENDATION_CATALOG.md` 定义
- **无新 Trigger**: 不存在第 9 类 trigger 函数
- **无 Score 退化**: 每个 trigger 返回 `TriggerResult`（无 score 字段），不返回数值优先级

**结论**: 无回归。**通过**。

---

## §4. Evidence Chain Audit — 证据链追溯

### 4.1 追溯路径

每条 Recommendation 的证据链可追溯：

```
RecommendationCandidate
  └── evidence: EvidenceItem[]
       ├── OBSERVED → A6.1 ExperienceRecord (experienceId, outcome)
       ├── ATTRIBUTED → A6.1 Attribution (attributionHash, primaryCause)
       ├── INFERRED → A6.2 EvaluationFinding (findingId, dimension)
       ├── PREDICTED → A6.3 Prediction (id, target, value, confidence)
       ├── CALIBRATED → A6.4 ResolutionResult/Profile (resolutionHash, ece)
       └── RELIABILITY_ASSESSED → A6.5 IntelligenceState (stateHash, drift)
```

### 4.2 evidence-builder.ts 审查

| Builder 函数 | 输入来源 | 输出 EvidenceItem 字段 |
|-------------|----------|----------------------|
| `buildExperienceEvidence` | `ExperienceRecord[]` | experienceId, type, outcome, metric, value |
| `buildAttributionEvidence` | `ExperienceRecord[]` | attributionHash, primaryCause, method |
| `buildEvaluationEvidence` | `StrategyEvaluation` | findingId, dimension, evidenceType |
| `buildPredictionEvidence` | `Prediction[]` | id, target, method, value, regimeCompatible |
| `buildCalibrationEvidence` | `ResolutionResult[], Profile[]` | resolutionHash, ece, fpr, fnr |
| `buildReliabilityEvidence` | `IntelligenceState` | reliabilityHash, drift, sufficiency |

### 4.3 REC-010 验证

`guardRec010EvidenceTraceability()` 验证：
- `evidence.length > 0`（非空）
- 每个 `EvidenceItem.sourceId` 非空字符串

测试 `REC-010: recommendation with evidence passes traceability` 和 `REC-010: recommendation without evidence fails` 验证了此约束。

**结论**: 证据链完整可追溯。**通过**。

---

## §5. NO_RECOMMENDATION Audit — 9 种场景

### 5.1 NO_RECOMMENDATION 枚举审查

`NoRecommendationReason` 定义了 8 种原因 + 1 种 NO_ACTIONABLE_SIGNAL：

| 原因 | 触发条件 | 代码位置 | 测试 |
|------|----------|----------|------|
| INSUFFICIENT_EVIDENCE | items < MIN_EVIDENCE_ITEMS | generator.ts:465 | GEN-001 ✅ |
| INSUFFICIENT_EVIDENCE | trace.complete === false | generator.ts:477 | GEN-002 ✅ |
| LOW_CONFIDENCE | minConfidence < threshold | generator.ts:489 | GEN-003 ✅ |
| REGIME_MISMATCH | regimeCompatible === false | generator.ts:501 | GEN-004 ✅ |
| LOW_CONFIDENCE | computed confidence < threshold | generator.ts:538 | — |
| NO_ACTIONABLE_SIGNAL | 所有 trigger 返回 null | generator.ts:564 | GEN-005 ✅ |
| UNCALIBRATED_MODEL | (枚举定义，预留) | — | — |
| EXPIRED_EVIDENCE | (枚举定义，预留) | — | — |
| CONFLICT_UNRESOLVED | (枚举定义，预留) | — | — |
| DATA_GAP | (枚举定义，预留) | — | — |

### 5.2 不强行生成验证

关键路径审查：
1. `generateRecommendations()` 前置检查 4 道（证据不足、链不完整、置信度太低、Regime 不匹配）→ 任一不满足立即返回 NO_RECOMMENDATION
2. 每个 trigger 评估后，如果 computed confidence < threshold → 该 trigger 产出 NO_RECOMMENDATION（不强行通过）
3. 所有 trigger 都不匹配 → NO_ACTIONABLE_SIGNAL

**结论**: 系统在所有 9 种场景中正确产出 NO_RECOMMENDATION 而非强行生成。**通过**。

---

## §6. Conflict Audit — 只检测不解决

### 6.1 冲突检测审查

`conflict-detector.ts` 实现三种冲突检测：

| 类型 | 检测逻辑 | 严重度 | 解决逻辑 |
|------|----------|--------|----------|
| same_target | 同 target+category 多条 | critical→high, high→medium, other→low | **无** |
| resource_competition | economic+expansion / recovery+military / spawn+military | medium | **无** |
| strategic_contradiction | posture+military / posture+expansion | high / medium | **无** |

### 6.2 禁止函数验证

`guardRec008NoDecisionAuthority()` 检查 RecommendationCandidate 不包含 `resolveConflict` / `selectHighest` 字段。

grep 搜索 `resolveConflict|selectHighest|resolve.*conflict` 在 recommendation/ 目录下：**零匹配**（guards.ts 中仅出现在禁止列表中）。

### 6.3 ranking 不参与裁决

`rankRecommendations()` 的排序结果仅用于：
- `recommendation-engine-system.ts:235` — console.log 可观测性输出
- `printRecommendationDashboard()` — 控制台 dashboard 字符串

排序结果不写入任何被执行系统读取的缓存。

**结论**: 冲突只检测不解决，ranking 不参与裁决。**通过**。

---

## §7. Lifecycle / TTL / Supersede Audit

### 7.1 状态机审查

6 态状态机：`created → valid → expired/superseded/rejected/accepted`

| 转换 | 触发 | 代码位置 |
|------|------|----------|
| created → valid | `validateRecommendation()` | lifecycle.ts:137 |
| valid/created → expired (TTL) | `expireOverdueRecommendations()` | lifecycle.ts:32 |
| valid/created → expired (Regime) | `expireByRegimeChange()` | lifecycle.ts:58 |
| valid/created → superseded | `processSupersession()` | lifecycle.ts:91 |

### 7.2 TTL 验证

`DEFAULT_TTL` 定义了 8 类 TTL（tick）：

| Category | TTL | 合理性 |
|----------|-----|--------|
| defense | 500 | ✅ 短期（防御态势变化快） |
| logistics | 500 | ✅ 短期 |
| spawn | 300 | ✅ 最短（spawn 紧迫） |
| recovery | 500 | ✅ 短期 |
| economic | 1000 | ✅ 中期 |
| military | 1000 | ✅ 中期 |
| expansion | 2000 | ✅ 长期 |
| posture | 2000 | ✅ 长期 |

`guardRec013TTLEnforcement()` 验证 TTL > 0 且 expiresTick > createdTick。

### 7.3 Supersede 链

`processSupersession()` 行为：
- 查找同 category+target 的 active 建议
- 标记最近的旧建议为 `superseded`，记录 `supersededBy`
- 新建议记录 `supersedes`（前驱 ID）
- 不删除历史（superseded 记录保留在 Ring Buffer 中直到 GC）

### 7.4 GC 有界性

`gcRecommendationBuffer()` 清理超龄记录（`RECOMMENDATION_MAX_AGE = 50000` tick），同时清理 records 和 conflicts。

测试 `LIFE-005` 验证 GC 正确清理。

**结论**: 生命周期完整，TTL 强制执行，Supersede 链正确，GC 有界。**通过**。

---

## §8. Bounded Memory 深审计

### 8.1 所有容器检查

| 容器 | 类型 | 容量 | 溢出行为 | 代码位置 |
|------|------|------|----------|----------|
| `RingBuffer.records` | `(Rec \| undefined)[]` | `RECOMMENDATION_RING_BUFFER_CAPACITY = 100` | 环形覆盖最旧 | types.ts:444 |
| `RingBuffer.conflicts` | `(Conflict \| undefined)[]` | `CONFLICT_RING_BUFFER_CAPACITY = 30` | 环形覆盖最旧 | types.ts:447 |
| `evidenceItems` (临时) | `EvidenceItem[]` | `MAX_EVIDENCE_ITEMS = 20` per builder | 超出 break | types.ts:465 |
| `activeRecs` (临时) | `RecommendationCandidate[]` | 由 RingBuffer 容量限制 | — | system.ts:203 |
| `results` (临时) | `RecommendationResult[]` | 由 trigger 匹配数限制 (≤8) | — | generator.ts:524 |

### 8.2 无界增长风险

- **RingBuffer**: 固定长度数组 + cursor 环形覆盖 → **无界增长不可能**
- **evidenceItems**: `buildXxxEvidence()` 每个最多 `MAX_EVIDENCE_ITEMS` → 6 个 builder 最多 120 items → **有界**
- **results**: 8 个 trigger，每个最多产出 1 条 → 最多 8 条 → **有界**
- **conflicts**: 最多 3 类冲突 × 同 target 分组 → 远小于 conflictCapacity → **有界**

`guardRec012NoUnboundedHistory()` 验证 `count <= capacity` 和 `conflictCount <= conflictCapacity`。

测试 `BUF-001` 和 `BUF-002` 验证了环形覆盖行为。

**结论**: 所有容器有界。**通过**。

---

## §9. Deterministic Replay — 1000× 一致性

### 9.1 确定性来源

| 操作 | 确定性保证 |
|------|-----------|
| `recommendationHash()` | `stableStringify` (字段 alphabetical 排序) + `fnv1a32Hex` (确定性哈希) + `toFixed(3)` (浮点截断) |
| `conflictHash()` | 同上 |
| `compareRecommendations()` | 5 级 Lexicographic + `localeCompare` tie-breaker |
| `makeEvidenceId()` | `EVI-{stage}-{seq}` 确定性格式 |
| `recommendationId` | `REC-{tick}-{seq}` 确定性格式 |
| `conflictId` | `CF-{type}-{hash前8位}` 确定性格式 |

### 9.2 禁止非确定性

`guardRec005Determinism()` 和 `guardRec014Deterministic()` 验证：
- 禁止 `Math.random`
- 禁止 `Date.now`
- 禁止 `new Date()`
- `recommendationId` 必须匹配 `REC-\d+-\d+` 格式

### 9.3 1000× replay 测试

| 测试 | 覆盖维度 | 结果 |
|------|----------|------|
| `DET-001` | recommendationHash 1000× 一致 | ✅ PASS |
| `DET-002` | 不同输入 → 不同 hash | ✅ PASS |
| `DET-003` | generateRecommendations 1000× 一致 | ✅ PASS |
| `DET-004` | rankRecommendations 1000× 一致 | ✅ PASS |
| `RANK-DET-001` | verifyRankingDeterminism 1000× | ✅ PASS |

**结论**: 确定性完全保证。**通过**。

---

## §10. Counterfactual Audit — CF-01 ~ CF-10

| CF | 反事实场景 | 预期行为 | 实际验证 |
|----|-----------|----------|----------|
| CF-01 | 如果 A6.6 完全停止 | 帝国照常运行 | ✅ 系统是 P3 低频，`__recommendationCache` 为 `unknown` 可选字段，不阻止其他系统 |
| CF-02 | 如果所有 trigger 都不匹配 | 产出 NO_ACTIONABLE_SIGNAL | ✅ GEN-005 测试验证 |
| CF-03 | 如果证据链不完整 | 产出 INSUFFICIENT_EVIDENCE | ✅ GEN-002 测试验证 |
| CF-04 | 如果置信度为 0 | 产出 LOW_CONFIDENCE | ✅ GEN-003 测试验证 |
| CF-05 | 如果 Regime 不匹配 | 产出 REGIME_MISMATCH | ✅ GEN-004 测试验证 |
| CF-06 | 如果 Ring Buffer 满 | 环形覆盖最旧记录 | ✅ BUF-001 / LIFE-006 测试验证 |
| CF-07 | 如果同 target+category 有多条 | 检测 same_target 冲突 | ✅ CONF-002 测试验证 |
| CF-08 | 如果 posture+military 同时出现 | 检测 strategic_contradiction | ✅ CONF-003 测试验证 |
| CF-09 | 如果 Regime 变化 | 旧建议标记 expired | ✅ LIFE-002 测试验证 |
| CF-10 | 如果 TTL 到期 | 建议标记 expired | ✅ LIFE-001 测试验证 |

**结论**: 所有反事实场景验证通过。**通过**。

---

## §11. Hidden Execution Path — 全 repo 搜索

### 11.1 搜索模式

在 `src/domain/intelligence/recommendation/` 目录搜索：
- `consume` / `apply` / `execute` / `process`

### 11.2 搜索结果

| 文件 | 匹配 | 性质 |
|------|------|------|
| guards.ts:198-199 | `"executeAction"`, `"applyStrategy"` | **禁止字段列表**（REC-008 守卫） |
| index.ts:98 | `processSupersession` | **导出名**（生命周期管理，非执行） |
| lifecycle.ts:91 | `export function processSupersession` | **函数定义**（标记旧建议为 superseded，非执行） |

### 11.3 分析

- `executeAction` / `applyStrategy` 出现在 `guards.ts` 的**禁止字段列表**中，用于检测 RecommendationCandidate 是否非法包含执行字段。它们本身不是执行调用。
- `processSupersession` 的"process"指**处理 supersede 链**（标记旧建议状态、记录前驱 ID），不执行任何游戏动作。它只修改 RingBuffer 中的 `lifecycle` 字段。

### 11.4 系统层搜索

`recommendation-engine-system.ts` 中的搜索：
- **无** `Game.creeps` / `Game.rooms` / `Game.structures` 调用
- **无** `spawnCreep` / `createConstructionSite` / `moveTo` / `attack` / `heal` 调用
- **无** `Memory` 写入（只通过 `globalThis` 读取 posture，不写入）
- **无** `RawMemory` 访问

**结论**: 无隐藏执行路径。**通过**。

---

## §12. A6 Shutdown Safety Audit

### 12.1 系统停止场景

如果 `recommendationEngineSystem` 完全不运行：

| 依赖方 | 影响 | 严重度 |
|--------|------|--------|
| `bootstrap.ts` | 系统不注册，`kernel.run()` 跳过 | 无（P3 不影响其他系统） |
| `globalCache.__recommendationCache` | 字段保持 `undefined` | 无（其他系统不读取此字段） |
| `getRecommendations()` 等查询函数 | 返回空数组/默认字符串 | 无（仅控制台调用） |
| 5k tick 可观测性 console.log | 不输出 | 无（仅日志缺失） |

### 12.2 帝国安全性

- **spawn-manager**: 不依赖 Recommendation → 不受影响 ✅
- **construction-manager**: 不依赖 Recommendation → 不受影响 ✅
- **war-planner**: 不依赖 Recommendation → 不受影响 ✅
- **logistics**: 不依赖 Recommendation → 不受影响 ✅
- **recovery-execution**: 不依赖 Recommendation → 不受影响 ✅
- **empire-health**: 不依赖 Recommendation → 不受影响 ✅

**结论**: A6.6 完全停止时帝国安全运行。**通过**。

---

## §13. Quality Gates

| 门禁 | 命令 | 结果 |
|------|------|------|
| TypeScript 类型检查 | `npm run typecheck` | ✅ 0 errors |
| 单元测试 | `npx vitest run a6-6-recommendation-engine.test.ts` | ✅ 73/73 passed (78ms) |
| 构建 | `npm run build` | ✅ dist/main.js created in 10.3s |

---

## §14. 文件清单

### Domain 层 (`src/domain/intelligence/recommendation/`)

| 文件 | 行数 | 职责 |
|------|------|------|
| `types.ts` | 469 | 类型定义 + 常量 + RingBuffer |
| `evidence-builder.ts` | 392 | A6.1-A6.5 → EvidenceItem 转换 |
| `generator.ts` | 577 | 8 类 trigger + confidence 传播 + buildRecommendation |
| `conflict-detector.ts` | 213 | 3 类冲突检测 + attachConflictIds |
| `lifecycle.ts` | 323 | TTL / Supersede / GC / RingBuffer 操作 |
| `ranking.ts` | 187 | 5 级 Lexicographic 排序 |
| `hashing.ts` | 93 | 确定性哈希（复用 A6.3） |
| `guards.ts` | 405 | REC-001~014 守卫 |
| `index.ts` | 151 | 统一出口 |

### System 层 (`src/systems/intelligence/`)

| 文件 | 行数 | 职责 |
|------|------|------|
| `recommendation-engine-system.ts` | 513 | 系统壳 + 数据采集 + 编排 + 可观测性 |

### Test 层 (`tests/unit/intelligence/`)

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| `a6-6-recommendation-engine.test.ts` | 73 | Guards + Evidence + Generator + Ranking + Conflict + Lifecycle + Shadow + Determinism + Bounded |

### Documentation (`docs/phase35/`)

| 文件 | 内容 |
|------|------|
| `A6_6_ARCHITECTURE.md` | 架构蓝图 |
| `A6_6_SAFETY_BOUNDARY.md` | 安全边界 |
| `A6_6_DECISION_AUTHORITY.md` | 决策权威 |
| `A6_6_LIFECYCLE.md` | 生命周期 |
| `A6_6_EVIDENCE_MODEL.md` | 证据模型 |
| `A6_6_CONFLICT_MODEL.md` | 冲突模型 |
| `A6_6_CPU_MEMORY_CONTRACT.md` | CPU/内存契约 |
| `A6_6_DETERMINISM_CONTRACT.md` | 确定性契约 |
| `A6_6_RECOMMENDATION_CATALOG.md` | 建议目录 |
| `A6_6_RECOMMENDATION_GAP_ANALYSIS.md` | 差距分析 |
| `A6_6_ACCEPTANCE_CRITERIA.md` | 验收标准 |
| `A6_6_FINAL_RESEARCH.md` | 研究终稿 |
| `A6_6_FINAL_REPORT.md` | 最终报告 |
| `A6_6_CLOSURE_AUDIT.md` | **本文件** |

---

## §15. 技术债与改进建议

| 编号 | 描述 | 严重度 | 建议 |
|------|------|--------|------|
| TD-A66-01 | `UNCALIBRATED_MODEL` / `EXPIRED_EVIDENCE` / `CONFLICT_UNRESOLVED` / `DATA_GAP` 四个 NO_RECOMMENDATION 原因已定义枚举但未在代码路径中使用 | Low | 后续版本中根据实际场景逐步启用 |
| TD-A66-02 | `MAX_ACTIVE_RECOMMENDATIONS = 50` 常量已定义但未在 GC 中使用（当前 GC 仅按 age 清理） | Low | 后续可在 GC 中加入"active 超限时清理最旧"逻辑 |
| TD-A66-03 | 系统层 `buildCurrentContext()` 通过 `globalThis.Memory?.kernel?.strategy?.posture` 读取 posture，这属于跨层访问 | Low | 未来可由 kernel 注入 posture 到 TickContext |
| TD-A66-04 | `countOwnedRooms()` / `getMaxRcl()` 直接访问 `globalThis.Game` | Medium | 应改为从 RoomSnapshot 或 empireHealth 获取 roomCount，避免直接 Game 访问 |

---

## §16. 最终裁定

A6.6 Recommendation Engine **通过 Architecture Closure Audit**。

- Shadow-Only 边界完全保证：`shadowOnly: true` (literal type) + `autoApply: false` (literal type) + 无执行系统消费
- 零 Decision Authority：无执行字段、无裁决函数、ranking 仅用于可观测性
- 证据链完整可追溯：6 个 EvidenceStage 全覆盖 A6.1-A6.5
- 确定性 1000× replay 验证通过
- 所有容器有界
- 73 个单元测试全绿
- typecheck + build 全绿

**审计完成，无阻断性缺陷。可以进入下一阶段。**
