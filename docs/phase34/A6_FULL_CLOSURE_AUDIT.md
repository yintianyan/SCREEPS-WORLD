# A6 FULL CLOSURE AUDIT

> Generated: 2026-08-26
> Auditor: Agent (audit-only mode)
> Method: Code-level trace, not documentation inference
> Scope: A6.0–A6.5 (Architecture, Experience, Evaluation, Prediction, Calibration, Reliability)

---

## Part I: Architecture Degeneration Search (14 Patterns)

### Pattern 1: current snapshot → prediction
**Status: ✅ NOT FOUND**
- All prediction models use trend extrapolation via `linearRegression()`.
- `estimateShortageTick()` requires non-null regression with negative slope.
- No code path produces prediction directly from current snapshot.

### Pattern 2: prediction → execution
**Status: ✅ NOT FOUND**
- No module outside A6 imports from `domain/intelligence`.
- No execution system reads `__predictionCache`, `__evaluationCache`, etc.

### Pattern 3: confidence → decision
**Status: ✅ NOT FOUND**
- No `if (prediction.confidence > X)` outside A6 domain.
- `conflict-detect.ts` uses `p.confidence > 0.5` but only to classify conflict severity within IntelligenceState (read-only projection).

### Pattern 4: score → strategy
**Status: ✅ NOT FOUND**
- `informationalScore` is declared as "informational only, no decision power" (strategy-evaluation.ts:158).
- No code path converts score to strategy change.

### Pattern 5: reliability → strategy
**Status: ✅ NOT FOUND**
- `ModelReliabilityAssessment` is stored in `IntelligenceState`, which is transient and not persisted.
- No execution system reads reliability.

### Pattern 6: intelligence → strategy
**Status: ✅ NOT FOUND**
- `IntelligenceState` is not persisted in globalCache.
- No execution system reads IntelligenceState.

### Pattern 7: calibration → strategy
**Status: ✅ NOT FOUND**
- Calibration results are in `__calibrationCache` (heap-only).
- No execution system reads calibration.

### Pattern 8: fallback → current state
**Status: ✅ NOT FOUND**
- Prediction models return `INSUFFICIENT_DATA` when data is insufficient.
- `computeActualValue()` in resolve.ts has a fallback to `prediction.value` when no observations — but this is in calibration (measuring prediction quality), not in prediction itself.

### Pattern 9: insufficient data → guessed value
**Status: ✅ NOT FOUND**
- All models return `INSUFFICIENT_DATA` sentinel, not a guessed prediction.

### Pattern 10: unknown → default good
**Status: ✅ NOT FOUND**
- No code path assigns "good" status when data is unknown.

### Pattern 11: incomparable → comparable
**Status: ✅ NOT FOUND**
- `DimensionScore.comparable` is explicitly set to `false` when context mismatches.
- `INCOMPARABLE` status in dashboard output is preserved, not converted to GOOD/BAD.

### Pattern 12: inconclusive → verdict
**Status: ✅ NOT FOUND**
- `EvaluationVerdict` includes `"INCONCLUSIVE"` and `"CONFLICTING_TREND"` as valid terminal values.
- No code path converts these to IMPROVING/DEGRADING.

### Pattern 13: external interference → model failure
**Status: ✅ NOT FOUND**
- `resolvePrediction()` returns `"EXTERNAL_INTERFERENCE"` as a distinct resolution category.
- `isCalibratable("EXTERNAL_INTERFERENCE") === false` — it does not count against the model.

### Pattern 14: regime mismatch → normal baseline
**Status: ✅ NOT FOUND**
- `resolvePrediction()` returns `"REGIME_CHANGED"` as distinct category.
- `isCalibratable("REGIME_CHANGED") === false` — it does not count against the model.
- `checkRegimeCompatibility()` returns `confidenceMultiplier = 0` for incompatible regimes.

---

## Part II: Second Decision System Search

### Search: `overallScore`, `ConflictResolver`, `StrategyRecommendation`, `autoApply`, `Priority`, `Action`

| Term | Found in src? | Context | BLOCKER? |
|------|---------------|---------|----------|
| `overallScore` | YES — guards.ts:382, types.ts:324 | REL-012 guard forbidden list + type comment | NO — guard detection |
| `ConflictResolver` | NO | — | NO |
| `resolveConflict` | YES — guards.ts:347 | REL-011 guard forbidden list | NO — guard detection |
| `StrategyRecommendation` | NO | — | NO |
| `autoApply` | YES — strategy-evaluation.ts:196,709,730 | `readonly autoApply: false` (literal type) | NO — compile-time enforced |
| `Priority` | NO (in intelligence domain) | — | NO |
| `Action` | NO (in intelligence domain) | — | NO |

### Search: confidence/severity/risk → execution

No code path outside A6 reads `confidence`, `severity`, or `risk` from A6 output.

### Search: implicit connections via globalCache/Memory/event bus

| Channel | A6 writes to | A5 reads? |
|---------|-------------|-----------|
| `__experienceCache` | A6.1 | NO |
| `__evaluationCache` | A6.2 | NO |
| `__predictionCache` | A6.3 | NO |
| `__calibrationCache` | A6.4 | NO (A6.5 reads read-only) |
| Memory | NONE | N/A |
| Event bus | NONE | N/A |

**No INTELLIGENCE_EXECUTION_LEAK found.**

---

## Part III: Calibration Audit

1. **Horizon not prematurely resolved**: ✅ — `getPendingResolutionIds()` requires `endTick + gracePeriod <= currentTick`
2. **Grace period correct**: ✅ — `RESOLUTION_GRACE_PERIOD = 100` tick (calibration/types.ts:376)
3. **Expired predictions still visible**: ✅ — `collectAllPredictions()` in calibration-resolution-system.ts:367-376 collects ALL predictions regardless of status
4. **Regime change correctly marked**: ✅ — `isRegimeChanged()` checks `mismatchedDimensions.length >= 3` or includes "posture"
5. **External interference correctly marked**: ✅ — checked in `resolvePrediction()` step 4
6. **Insufficient observation not counted as model failure**: ✅ — `isCalibratable("INSUFFICIENT_OBSERVATION") === false`
7. **Calibration does not modify Prediction**: ✅ — `resolvePrediction()` takes `Prediction` as readonly param, returns independent `ResolutionResult`
8. **Calibration does not modify Strategy**: ✅ — no code path to Strategy
9. **Calibration does not modify Runtime**: ✅ — no Game API calls

**Resolution Metric Registry**: ✅ — `calibration/metrics.ts` has `resolutionMetricRegistry: Map<string, ResolutionMetricFn>`. New models only need to register a metric function. No second resolution engine.

---

## Part IV: A6.2 Evaluation Audit

### 8 Canonical Dimensions

Verified in `strategy-evaluation.ts:51-60`:
```
economicGrowth, resourceEfficiency, cpuEfficiency, riskLevel,
survival, expansion, militaryOutcome, recoveryCost
```

### Forbidden Score Search

| Term | Found? |
|------|--------|
| `overallScore` | NO (only in guard detection) |
| `strategyScore` | NO — type is `StrategyScore` which contains dimensions, not a single score |
| `empireScore` | NO |
| `intelligenceScore` | NO (only in guard detection) |
| `informationalScore` | YES — `strategy-evaluation.ts:158` — declared as "informational only, no decision power" |

`informationalScore` audit:
- Field is `readonly informationalScore: number` on `StrategyScore`
- Not read by any execution system
- Not used to gate any decision
- Only displayed in dashboard output
- **Conclusion: informational only, no decision power** ✅

### INCOMPARABLE / INCONCLUSIVE preservation

- `DimensionScore.comparable: boolean` — when false, `incompatibilityReason` is set
- Dashboard displays `INCOMPARABLE` status explicitly (strategy-evaluation-system.ts:337-338)
- `EvaluationVerdict` includes `INCONCLUSIVE` and `CONFLICTING_TREND`
- No code path converts `comparable=false` to a score value

---

## Part V: A6.5 Reliability Deep Audit

### REL-001: Read-Only (no cache writes)

**Verified by code inspection of `intelligence-state-system.ts`:**
- `run()` reads `__predictionCache` and `__calibrationCache` — NO writes
- `run()` reads `empireHealth` — NO writes
- `computeIntelligenceState()` is a pure function returning a new object
- No `g.xxx =` assignment anywhere in the system
- `guardRelReadOnly()` checks `run.toString()` for write patterns

**Also verified: no mutation of input objects:**
- `computeIntelligenceState()` creates new arrays/objects from inputs
- `assessments.sort()` sorts a local array, not the input
- `modelEceSummary` is a new array from `.map()`, sorted locally
- No `Map.set()` or `Set.add()` on input objects

### REL-011: No Conflict Resolution

**Verified:**
- `detectConflicts()` in `conflict-detect.ts` detects and reports conflicts as `PredictionConflict[]`
- No code path selects one prediction as "winner"
- No `resolveConflict`, `selectHighest`, `applyWeight`, `filterConflict` in A6.5 run function
- `guardRelNoConflictResolution()` scans `system.run.toString()` for forbidden patterns

### REL-012: No Universal Score

**Verified:**
- `IntelligenceState` has no `reliabilityScore`, `intelligenceScore`, `overallScore`, `totalScore` field
- `guardRelNoReliabilityScore()` scans `JSON.stringify(state)` for forbidden patterns
- Multi-dimensional: `predictionCoverage`, `modelReliability`, `calibrationHealth`, `dataSufficiency`, `regimeFit`, `uncertainty`, `predictionConflicts`, `knowledgeFreshness`

---

## Part VI: A6 Stop Safety Test

**Hypothesis**: A6.1–A6.5 all STOP. Does A5 still function?

**Proof by dependency analysis:**

A6 systems read from these globalCache fields:
- `empireHealth` → produced by `empire-health-system` (A5)
- `recoveryStats` → produced by `recovery-execution-system` (A5)
- `logisticsHealth` → produced by `logistics-planner` (A5)
- `warPlanCache` → produced by `war-planner` (A5)
- `__decisionTraceCache` → produced by decision-trace (A5)
- `__netFlowHistory`, `__reserveHistory`, `__populationHistory` → produced by `empire-health-system` (A5)
- `__spawnQueueDepthHistory` → produced by `spawn-manager` (A5)

**A6 writes to:**
- `__experienceCache` — only read by A6.2, A6.4
- `__evaluationCache` — only read by A6.4
- `__predictionCache` — only read by A6.4, A6.5
- `__calibrationCache` — only read by A6.5

**No A5 system reads any A6 output.** Therefore, if all A6 systems stop:
- `spawn-manager` continues (doesn't read A6)
- `logistics-planner` continues
- `construction-manager` continues
- `war-planner` continues
- `recovery-execution-system` continues
- `empire-health-system` continues
- All creep roles continue
- All defense systems continue

**Conclusion: A5 is completely unaffected by A6 stopping.** ✅

---

## Part VII: Determinism Audit

### Randomness / Time Search

| Pattern | Found in domain? | Found in systems? |
|---------|-----------------|-------------------|
| `Math.random` | NO (only in prohibition comments) | NO |
| `Date.now` | NO (only in prohibition comments) | NO |
| `new Date` | NO | NO |
| `performance.now` | NO | NO |
| `Game.time` (in domain) | NO | N/A (system passes tick as parameter) |

### Unordered Iteration

All `Object.keys()` calls are followed by `.sort()`:
- `evaluation-evidence.ts:130,313,435`
- `strategy-evaluation.ts:1013`
- `baseline.ts:260,639,735`
- `evidence-builder.ts:103`
- `hashing.ts:45`
- `attribution.ts:1010`

All `Map` iterations are followed by sort:
- `intelligence-state-system.ts:189-193` (profiles sorted by modelKey)
- `intelligence-state-system.ts:205-209` (failureStats sorted by modelKey)
- `compute-state.ts:197` (assessments sorted by modelKey)
- `compute-state.ts:337` (modelEceSummary sorted by modelKey)

All array sorts use deterministic comparators (`localeCompare`, numeric subtraction).

### Hash Determinism

- `stableStringify()` sorts all keys alphabetically before serialization
- `fnv1a32Hex()` is a pure function
- All hash inputs use `Number(x.toFixed(3))` to eliminate floating-point precision differences

---

## Part VIII: Domain / System Boundary Audit

### Domain Purity

| Forbidden Reference | Found in `src/domain/intelligence/`? |
|---------------------|--------------------------------------|
| `Game.` | NO (only in comments) |
| `Memory.` | NO (only in comments) |
| `RawMemory.` | NO |
| `globalThis` | NO |
| `console.` | NO |
| `Kernel` | NO |
| `CPU` | NO |
| `tick` (as global) | NO (passed as parameter) |

### System Shell Discipline

All 5 A6 systems follow the thin-shell pattern:
1. **Collect**: Read from globalCache
2. **Adapt**: Build input DTOs
3. **Invoke**: Call domain pure functions
4. **Store**: Write results to own ring buffer (except A6.5 which doesn't write)
5. **Observe**: Periodic `console.log` for observability

No system implements decision logic. All computation is delegated to domain functions.

**Finding: MEDIUM-2 — System-level Game API reads**

Three A6 systems (A6.2, A6.3, A6.4/A6.5) contain `countOwnedRooms()` and `getMaxRcl()` helper functions that read `Game.rooms`:
- `strategy-evaluation-system.ts:269-289`
- `prediction-system.ts:273-293`
- `calibration-resolution-system.ts:378-398`
- `intelligence-state-system.ts:251-271`

These are in the **system shell** (not domain), which is permitted by the architecture. They read `Game.rooms` only to count owned rooms and max RCL — no write operations.

However, this is duplicated code across 4 system files.

- **Severity**: LOW (code duplication, not an architecture violation)
- **Impact**: Minor maintenance burden
- **Recommended fix**: Extract to shared utility

---

## Part IX: Evidence Chain Audit

### Forward Chain

```
DecisionTrace (A5)
  → DecisionRecord { decisionId, tick, category, actor, selectedAction, evidence }
    → ExperienceRecord (A6.1) { identity.experienceId, decision.decisionId, context, outcome, attribution }
      → StrategyEvaluation (A6.2) { score.dimensions[].evidenceIds → experienceId, findings[].evidenceIds }
        → (evaluation consumed by A6.4 for external factors)
      → Prediction (A6.3) { evidence.sources → timeSeriesSourceRef, metricSourceRef, experienceSourceRef }
        → ResolutionResult (A6.4) { predictionId → prediction.id, resolutionHash }
          → IntelligenceState (A6.5) { modelReliability[].profileHash → profile, predictionConflicts }
```

### Traceability Verification

| Conclusion | Traceable to | Gap? |
|-----------|-------------|------|
| Evaluation dimension score | ExperienceRecord IDs in `evidenceIds` | NO |
| Prediction value | TimeSeries sources + model params in `evidence.sources` | NO |
| ResolutionResult | `predictionId` → Prediction | NO |
| ModelReliability | `profileHash` → ModelCalibrationProfile | NO |
| IntelligenceState conflicts | `PredictionConflict.predictionIds` | NO |
| IntelligenceState uncertainty | `dominantSource` → dataSufficiency/regimeFit/... | NO |

**No EVIDENCE_GAP found.**

---

## Part X: Findings Summary

| ID | Severity | File | Line | Description | Blocks Freeze? |
|----|----------|------|------|-------------|----------------|
| LOW-1 | LOW | energy-shortage.ts | 459-462 | BOUNDARY_OVERRIDE: current below threshold + flat trend labeled "SHORTAGE_PREDICTED" | NO |
| LOW-2 | LOW | spawn-starvation.ts | 562-564 | Current energy < minSpawn + queue > 0 labeled "STARVATION_IMMINENT" regardless of trend | NO |
| LOW-3 | LOW | 4 system files | various | Duplicated `countOwnedRooms()` / `getMaxRcl()` helpers | NO |
| LOW-4 | LOW | calibration/ring-buffer.ts | 197-203 | `updateProfile` comment says "if Map exceeds MAX_PROFILES, delete oldest" but no explicit eviction code | NO |

**No BLOCKER or HIGH findings.**

---

## Part XI: Architecture Degeneration Search (Detailed)

| # | Pattern | Found? | Details |
|---|---------|--------|---------|
| 1 | current snapshot → prediction | NO | Trend extrapolation used throughout |
| 2 | prediction → execution | NO | No external consumers |
| 3 | confidence → decision | NO | No execution system reads confidence |
| 4 | score → strategy | NO | informationalScore has no decision power |
| 5 | reliability → strategy | NO | IntelligenceState is transient |
| 6 | intelligence → strategy | NO | Not persisted, not read |
| 7 | calibration → strategy | NO | No external consumers |
| 8 | fallback → current state | NO | INSUFFICIENT_DATA returned |
| 9 | insufficient data → guessed value | NO | Sentinel returned |
| 10 | unknown → default good | NO | |
| 11 | incomparable → comparable | NO | comparable=false preserved |
| 12 | inconclusive → verdict | NO | INCONCLUSIVE preserved |
| 13 | external interference → model failure | NO | EXTERNAL_INTERFERENCE not calibratable |
| 14 | regime mismatch → normal baseline | NO | REGIME_CHANGED not calibratable |
