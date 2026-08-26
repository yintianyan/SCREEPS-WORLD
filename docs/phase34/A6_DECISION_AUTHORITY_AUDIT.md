# A6 DECISION AUTHORITY AUDIT

> Generated: 2026-08-26
> Method: Code-level trace of all A6 domain functions and system shells

## Methodology

For each A6 module, answer: **Can this module decide strategy?**

"Decide strategy" = any of:
- Modify `Memory.kernel.strategy`
- Call spawn-manager / war-planner / construction-manager / logistics-planner
- Call any Game API write function
- Produce output that is consumed by any execution system
- Produce a recommendation/directive that auto-applies

## Audit Results

### Experience (A6.1) — Can decide strategy?

**NO.**

- `collectOutcome()` is a pure function that takes `OutcomeCollectionInput` and returns `OutcomeRecord`.
- `collectAttribution()` is a pure function that takes `AttributionInput` and returns `Attribution.
- ExperienceCollectorSystem only writes to `__experienceCache` (heap-only ring buffer).
- No module outside A6 reads `__experienceCache`.
- **Authority: Observe**

### Outcome (A6.1) — Can decide strategy?

**NO.**

- `OutcomeRecord` is a readonly data structure describing what happened after a decision.
- No execution system reads Outcome.
- **Authority: Observe**

### Attribution (A6.1) — Can decide strategy?

**NO.**

- `collectAttribution()` returns Attribution with `primaryCause`, `confidence`, `externalFactors`.
- Attribution is stored in Experience ring buffer, consumed only by A6.2 evaluation.
- No execution system reads Attribution.
- **Authority: Explain**

### Evaluation (A6.2) — Can decide strategy?

**NO.**

- `evaluateStrategy()` returns `StrategyEvaluation` with 8 independent dimension scores.
- `RecommendationCandidate` has `autoApply: false` as a **literal type** — TypeScript compiler enforces this.
- Evaluation result stored in `__evaluationCache` (heap-only).
- No execution system reads Evaluation.
- **Authority: Assess**

### Prediction (A6.3) — Can decide strategy?

**NO.**

- `predictEnergyShortage()` and `predictSpawnStarvation()` are pure functions returning `PredictionResult`.
- Predictions stored in `__predictionCache` (heap-only).
- No execution system reads Predictions.
- No code path exists where `prediction.confidence > X` triggers any action.
- **Authority: Forecast**

### Calibration (A6.4) — Can decide strategy?

**NO.**

- `resolvePrediction()` returns `ResolutionResult` — does NOT modify the Prediction object.
- `computeCalibrationStatistics()` returns `ModelCalibrationProfile[]` — stored in calibration ring buffer.
- No execution system reads Calibration results.
- Calibration does not modify Prediction, Strategy, or Runtime.
- **Authority: Measure prediction quality**

### Reliability (A6.5) — Can decide strategy?

**NO.**

- `computeIntelligenceState()` returns `IntelligenceState` — a transient read-only projection.
- A6.5 system does NOT write to any globalCache field (REL-001 verified by code inspection).
- No module outside A6 reads IntelligenceState.
- `IntelligenceState` has no `overallScore`, no `reliabilityScore`, no `intelligenceScore` (REL-012).
- No code path exists where `reliability > X` or `intelligence > X` triggers any action.
- **Authority: Assess trustworthiness (read-only)**

### IntelligenceState (A6.5) — Can decide strategy?

**NO.**

- `IntelligenceState` is a transient value computed and discarded each run.
- Not persisted in globalCache.
- Not read by any execution system.
- Contains multi-dimensional assessments, no single "score" with decision power.
- **Authority: Read-only projection**

## Summary

| Module | Authority | Decision Power? | BLOCKER? |
|--------|-----------|----------------|----------|
| Experience | Observe | NO | NO |
| Outcome | Observe | NO | NO |
| Attribution | Explain | NO | NO |
| Evaluation | Assess | NO | NO |
| Prediction | Forecast | NO | NO |
| Calibration | Measure | NO | NO |
| Reliability | Assess trustworthiness | NO | NO |
| IntelligenceState | Read-only projection | NO | NO |

**No BLOCKER found. A6 has zero decision authority over any execution system.**
