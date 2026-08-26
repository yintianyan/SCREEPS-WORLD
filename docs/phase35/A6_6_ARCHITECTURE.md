# A6.6 Architecture — 架构设计

> **阶段**: A6.6 Research / Architecture
> **日期**: 2026-08-26
> **禁止实现**: 本文档仅做架构设计，不修改任何代码
> **基线**: A6.1-A6.5 已冻结契约 + A6.6 Gap Analysis + Decision Authority Audit + Recommendation Catalog + Evidence Model + Conflict Model + Lifecycle + Safety Boundary + CPU/Memory Contract + Determinism Contract + Acceptance Criteria

---

## 一、架构概览

### 1.1 A6.6 在 Intelligence 链条中的位置

```
A6.1 Experience      "发生了什么？为什么？"
A6.2 Evaluation       "做得怎么样？比基线如何？"
A6.3 Prediction       "按照当前趋势，未来可能发生什么？"
A6.4 Calibration      "过去的 Prediction 到底准不准？"
A6.5 Reliability      "系统知道自己的预测能力后，如何形成可靠的 Intelligence？"
A6.6 Recommendation   "基于可靠 Intelligence，哪些行动值得被考虑？"
                         ↓
                     Future Decision Authority (不属于 A6.6)
                         ↓
                     Existing Strategy / Planner / Spawn / Military / Logistics / Recovery
```

### 1.2 A6.6 的角色

**A6.6 = Evidence-backed Recommendation Producer**

不是 Decision Authority。不是 Executor。不是 Strategy。

A6.6 是在 A6.1-A6.5 之上的**只读聚合 + 建议生成层**：

```
┌──────────────────────────────────────────────────────┐
│               A6.6 Recommendation Engine              │
│  (只读消费 — 产出 RecommendationCandidate[] — bounded) │
├──────────┬──────────┬──────────┬────────────────────┤
│ Evidence │ Conflict │ Lifecycle│  Recommendation     │
│ Builder  │ Detector  │ Manager  │  Generator          │
│          │          │          │                     │
│ 从 A6.1- │ 从 A6.5  │ TTL/GC/  │  规则匹配 +         │
│ A6.5 构建 │ Conflict │ Supersede│  Evidence 组装 +   │
│ Evidence │ 检测冲突 │ 生命周期 │  NO_RECOMMENDATION  │
└──────────┴──────────┴──────────┴────────────────────┘
         ↑ 只读            ↑ 只读        ↑ 只读
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ A6.5           │ │ A6.4           │ │ A6.1-A6.3      │
│ IntelligenceState│ │ Calibration   │ │ Experience/Eval│
│ + Reliability  │ │ + Profiles     │ │ /Prediction    │
└────────────────┘ └────────────────┘ └────────────────┘
```

---

## 二、分层结构

### 2.1 Domain 层（纯函数）

```
src/domain/intelligence/recommendation/
├── types.ts           — RecommendationCandidate, EvidenceItem, NoRecommendation 等
├── evidence-builder.ts — 从 A6.1-A6.5 数据构建 EvidenceItem[]
├── conflict-detector.ts — Recommendation 间冲突检测
├── lifecycle.ts       — TTL / Supersede / GC 生命周期管理
├── generator.ts       — 规则匹配 + Recommendation 生成
├── ranking.ts         — Lexicographic ranking（确定性排序）
├── hashing.ts         — 确定性 hash（复用 A6.3 stableStringify + FNV-1a）
├── guards.ts          — REC-001~014 守卫验证函数
└── index.ts           — 统一出口
```

### 2.2 System 层（薄壳）

```
src/systems/intelligence/
└── recommendation-engine-system.ts — 系统层薄壳（采集 + 编排 + 暴露）
```

### 2.3 与 A6.1-A6.5 的依赖方向

```
A6.6 Recommendation Domain
  ↓ imports (只读)
A6.5 Reliability Domain (types, compute-state — 只读调用)
  ↓ imports (只读)
A6.4 Calibration Domain (types, ring-buffer — 只读)
A6.3 Prediction Domain (types, ring-buffer — 只读)
A6.1 Experience Domain (types only)
A6.2 Strategy Evaluation Domain (types, RecommendationCandidate — 只读)
```

**关键约束**: A6.6 不修改 A6.1-A6.5 的任何文件。只读 import。

---

## 三、Domain 类型定义（拟）

### 3.1 RecommendationCandidate（A6.6 扩展版）

```typescript
/**
 * A6.6 RecommendationCandidate — 完整的建议候选。
 *
 * Shadow-Only:
 *   - shadowOnly: true (literal type)
 *   - autoApply: false (literal type)
 *   - 不被任何执行系统读取
 *
 * REC-009: 禁止 recommendationScore 字段。
 * REC-010: 每条必须有可追溯 evidence。
 * REC-011: autoApply 必须 false。
 * REC-013: 必须有 validityWindow (TTL)。
 */
interface RecommendationCandidate {
  readonly recommendationId: string;
  readonly category: RecommendationCategory;
  readonly target: string;
  readonly description: string;
  readonly rationale: string;
  readonly evidence: readonly EvidenceItem[];
  readonly expectedBenefit: number | null;
  readonly expectedCost: number | null;
  readonly confidence: number;  // <= min(evidence confidence)
  readonly urgency: RecommendationUrgency;
  readonly validityWindow: RecommendationValidity;
  readonly contextSignature: string;
  readonly conflicts: readonly string[];  // RecommendationConflict IDs
  readonly alternatives: readonly string[];  // RecommendationAlternative IDs
  readonly shadowOnly: true;
  readonly autoApply: false;
  readonly recommendationHash: string;
  status: RecommendationStatus;
  readonly createdAt: number;
  supersededBy?: string;
  supersedes?: string;
}

type RecommendationCategory =
  | "ECONOMIC"
  | "EXPANSION"
  | "DEFENSE"
  | "MILITARY"
  | "LOGISTICS"
  | "SPAWN"
  | "RECOVERY"
  | "POSTURE";

type RecommendationUrgency = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type RecommendationStatus =
  | "created" | "valid" | "expired"
  | "superseded" | "rejected" | "accepted";

interface RecommendationValidity {
  readonly createdTick: number;
  readonly expiresTick: number;
  readonly ttl: number;
}
```

### 3.2 EvidenceItem

```typescript
interface EvidenceItem {
  readonly evidenceId: string;
  readonly source: EvidenceSource;
  readonly sourceId: string;
  readonly type: EvidenceType;
  readonly value: string;
  readonly confidence: number;
  readonly collectedAt: number;
  readonly trace: EvidenceTrace;
  readonly evidenceHash: string;
}
```

### 3.3 NoRecommendation

```typescript
interface NoRecommendation {
  readonly category: RecommendationCategory;
  readonly reason: NoRecommendationReason;
  readonly evidence: readonly EvidenceItem[];
  readonly confidence: number;
  readonly assessedAt: number;
  readonly hash: string;
}

type NoRecommendationReason =
  | "INSUFFICIENT_EVIDENCE" | "LOW_CONFIDENCE"
  | "REGIME_MISMATCH" | "CONFLICTING_EVIDENCE"
  | "EXTERNAL_INTERFERENCE" | "NO_MATERIAL_BENEFIT"
  | "HIGH_RISK" | "NOT_ACTIONABLE";
```

### 3.4 RecommendationConflict

```typescript
interface RecommendationConflict {
  readonly conflictId: string;
  readonly type: "mutual_exclusion" | "resource_competition" | "temporal_clash";
  readonly recommendationIds: readonly string[];
  readonly description: string;
  readonly severity: number;
  readonly detectedAt: number;
  readonly conflictHash: string;
}
```

---

## 四、核心函数签名（拟）

### 4.1 主入口

```typescript
interface RecommendationEngineInput {
  readonly experiences: readonly ExperienceRecord[];
  readonly evaluations: readonly StrategyEvaluation[];
  readonly predictions: readonly Prediction[];
  readonly resolutions: readonly ResolutionResult[];
  readonly profiles: readonly ModelCalibrationProfile[];
  readonly intelligenceState: IntelligenceState | null;
  readonly currentContext: PredictionContext;
  readonly currentTick: number;
}

interface RecommendationEngineOutput {
  readonly recommendations: readonly RecommendationCandidate[];
  readonly noRecommendations: readonly NoRecommendation[];
  readonly conflicts: readonly RecommendationConflict[];
  readonly stats: RecommendationStats;
}

function runRecommendationEngine(
  input: RecommendationEngineInput
): RecommendationEngineOutput;
```

### 4.2 Evidence Builder

```typescript
function buildEvidence(
  category: RecommendationCategory,
  input: RecommendationEngineInput,
): EvidenceItem[];
```

### 4.3 Generator

```typescript
function generateRecommendations(
  input: RecommendationEngineInput,
): (RecommendationCandidate | NoRecommendation)[];
```

### 4.4 Conflict Detector

```typescript
function detectRecommendationConflicts(
  recommendations: readonly RecommendationCandidate[],
  predictionConflicts: readonly PredictionConflict[],
  currentTick: number,
): RecommendationConflict[];
```

### 4.5 Lifecycle Manager

```typescript
function manageLifecycle(
  cache: RecommendationCache,
  newRecommendations: readonly RecommendationCandidate[],
  currentTick: number,
): RecommendationCache;
```

### 4.6 Ranking

```typescript
function rankRecommendations(
  recommendations: readonly RecommendationCandidate[],
): readonly RecommendationCandidate[];
```

---

## 五、System 层（拟）

### 5.1 System 定义

```typescript
// 概念设计（非实现）
export const recommendationEngineSystem: System = {
  name: "recommendation-engine",
  priority: 3 as Priority,
  interval: 500,
  run(ctx: TickContext): void {
    // 1. 从 Ring Buffer / globalCache 读取 A6.1-A6.5 数据
    // 2. 构建 RecommendationEngineInput
    // 3. 调用 Domain 纯函数 runRecommendationEngine()
    // 4. 写入 __recommendationCache (bounded)
    // 5. 运行 REC-XXX 守卫
    // 6. GC 过期 Recommendation
  },
};
```

### 5.2 Cache 定义

```typescript
interface RecommendationCache {
  records: RecommendationCandidate[];
  capacity: number;  // 50
  count: number;
  totalGenerated: number;
  totalNoRecommendation: number;
  totalConflicts: number;
}
```

### 5.3 bootstrap.ts 注册（拟）

```typescript
// 概念设计（非实现）
// bootstrap.ts
import { recommendationEngineSystem } from "./systems/intelligence/recommendation-engine-system";
systems.push(recommendationEngineSystem);
// P3 post phase, interval=500t
```

---

## 六、Counterfactual — 10 个反事实场景

### R1: Evidence strong → Recommendation valid

**场景**: A6.3 energy-shortage prediction confidence=0.8 + A6.2 economicGrowth DEGRADING + A6.5 reliability SUFFICIENT

**预期**: 产出 ECONOMIC Recommendation, confidence ≥ 0.7, status=valid

---

### R2: Evidence weak → NO_RECOMMENDATION

**场景**: A6.3 无 active prediction + A6.2 样本不足 + A6.5 COLD_START

**预期**: 产出 NO_RECOMMENDATION (reason=INSUFFICIENT_EVIDENCE)

---

### R3: Prediction high confidence 但 Calibration poor → Recommendation confidence reduced

**场景**: A6.3 prediction confidence=0.8 + A6.4 OVERCONFIDENT (ece=0.3)

**预期**: Recommendation confidence ≤ 0.8 × calibrationMultiplier (< 0.8)

---

### R4: Reliability low → Recommendation downgraded/suppressed

**场景**: A6.5 driftDetected=true + sampleSufficiency=INSUFFICIENT + regimeFit=false

**预期**: Recommendation confidence × reliabilityFactor → 如果 < 0.3 → NO_RECOMMENDATION

---

### R5: Two strong conflicting evidence → CONFLICT

**场景**: energy-shortage prediction (conf=0.8) + expansion-readiness prediction (conf=0.7) → A6.5 检测 logical conflict

**预期**: 产出两个 Recommendation + 冲突标记, 双方 confidence 降级, 不选择

---

### R6: Regime changed → Recommendation invalid

**场景**: Recommendation contextSignature="peace-healthy-2-3-low" → 当前 posture=war

**预期**: Recommendation status → expired (reason: regime_changed)

---

### R7: External interference → 不错误归因

**场景**: A6.1 Attribution 标注 hasExternalFactor=true

**预期**: Recommendation evidence 中标注 externalFactor, confidence 不归因于策略

---

### R8: Recommendation expired → 不得被消费

**场景**: Recommendation TTL=500t, currentTick > expiresTick

**预期**: status=expired, 查询 API 不返回, 等待 GC

---

### R9: Same input → Same recommendation hash

**场景**: 同一 RecommendationEngineInput 1000 次调用

**预期**: 1000 次产出相同 recommendationHash

---

### R10: A6.6 completely stopped → A6.1-A6.5 completely unaffected

**场景**: 关闭 recommendation-engine-system 运行 5000t

**预期**: A6.1-A6.5 全部正常, 帝国安全运行, 无任何系统读取 Recommendation

---

## 七、Cache 方案分析

### 7.1 三方案对比

| 维度 | A: 完全 transient | B: Bounded cache | C: Persistent history |
|------|:---:|:---:|:---:|
| CPU | 最低（每次重建） | 低（复用 cache） | 中（读写 Memory） |
| Memory | 0（不存储） | ~55KB（bounded） | 高（无界增长） |
| Replay | ✅（同输入同输出） | ✅ | ✅ |
| Debugging | 差（无历史） | 好（有近 5000t 历史） | 最好（全历史） |
| Auditability | 差 | 好 | 最好 |
| Safety | 最好（不存储） | 好（bounded） | 差（可能影响运行） |

### 7.2 推荐方案: B — Bounded Recommendation Cache

**理由**:
1. CPU 开销低（~0.25ms/run）
2. Memory 有界（~55KB, 50 条）
3. 可调试（有近 5000t 历史）
4. 可审计（可追溯建议链）
5. 安全（bounded + TTL + GC）
6. 不持久化（heap only, global reset 可丢）

### 7.3 Cache 结构

```typescript
const __recommendationCache: RecommendationCache = {
  records: [],          // RecommendationCandidate[]
  capacity: 50,         // 硬上限
  count: 0,
  totalGenerated: 0,
  totalNoRecommendation: 0,
  totalConflicts: 0,
};
```

---

## 八、与 A6.0 冻结契约的一致性

| A6.0 要求 | A6.6 遵守 | 验证 |
|-----------|:---------:|------|
| Shadow-Only | ✅ | REC-001~014 守卫 |
| 不修改 A6.1-A6.5 | ✅ | 只读 import |
| 不调用 Game API | ✅ | REC-003 |
| 不修改 Strategy | ✅ | REC-007 |
| 不自动执行 | ✅ | REC-011 (autoApply=false) |
| 不产出万能分数 | ✅ | REC-009 |
| Evidence 可追溯 | ✅ | REC-010 |
| 确定性 | ✅ | REC-005, REC-014 |
| 有界 Memory | ✅ | REC-001, REC-012 |

---

## 九、结论

**A6.6 架构设计完整。**

- 分层清晰（Domain 纯函数 + System 薄壳）
- 输入明确（A6.1-A6.5 Canonical Output）
- 输出明确（RecommendationCandidate[] + NO_RECOMMENDATION）
- 安全边界完整（14 个 REC 守卫）
- 生命周期完整（TTL + Supersede + GC）
- 确定性可证明
- CPU/Memory 可控
- 10 个反事实场景全覆盖
- 与 A6.0 冻结契约一致
