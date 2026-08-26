# A6 CANONICAL SOURCE AUDIT

> Generated: 2026-08-26
> Method: Search for duplicate data models, computation logic, caches, state, and lifecycles

## Methodology

For each canonical concept in A6, verify there is exactly ONE authoritative source.
A "helper function" is NOT a duplicate. A second data model / cache / state machine IS.

## Audit Results

### Experience

- **Canonical source**: `src/domain/intelligence/experience.ts`
  - `ExperienceRingBuffer`, `ExperienceRecord`, `createExperience`, `pushExperience`, etc.
- **System cache**: `__experienceCache` in `experience-collector-system.ts`
- **Duplicate?**: NO — no other module defines Experience types or maintains Experience state.

### Outcome

- **Canonical source**: `src/domain/intelligence/outcome.ts`
  - `OutcomeCollectionInput`, `collectOutcome()`, `computeOutcomeConfidence()`
- **Duplicate?**: NO

### Attribution

- **Canonical source**: `src/domain/intelligence/attribution.ts`
  - `AttributionInput`, `collectAttribution()`, `AttributionFactor`
- **Duplicate?**: NO

### Metrics

- **Canonical source**: `src/domain/intelligence/strategy-evaluation.ts` §1
  - `CANONICAL_EVALUATION_DIMENSIONS` (8 dimensions)
- **Also in**: `src/domain/intelligence/baseline.ts` (references `CONFIG_BASELINE_VALUES` with same 8 dimensions)
- **Duplicate?**: NO — baseline.ts uses the same dimension set as defined in strategy-evaluation.ts.

### Baseline

- **Canonical source**: `src/domain/intelligence/baseline.ts`
  - `Baseline`, `BaselineKey`, `buildBaseline()`, `extractHistoricalValues()`
- **Duplicate?**: NO

### Prediction

- **Canonical source**: `src/domain/intelligence/prediction/types.ts`
  - `Prediction`, `PredictionResult`, `PredictionWindow`, `PredictionEvidence`
- **Models**: `energy-shortage.ts`, `spawn-starvation.ts`
- **Ring buffer**: `prediction/ring-buffer.ts`
- **Duplicate?**: NO — no second prediction type system exists.

### Calibration

- **Canonical source**: `src/domain/intelligence/calibration/types.ts`
  - `ResolutionResult`, `CalibrationRingBuffer`, `ModelCalibrationProfile`
- **Resolution engine**: `calibration/resolve.ts`
- **Statistics**: `calibration/calibration.ts`
- **Metrics registry**: `calibration/metrics.ts` (resolutionMetricRegistry — Map for metric functions)
- **Duplicate?**: NO — A6.3's `resolve.ts` handles lifecycle (status changes), A6.4's `resolve.ts` handles calibration resolution. They are documented as independent and do not duplicate each other's logic.

### Reliability

- **Canonical source**: `src/domain/intelligence/reliability/types.ts`
  - `IntelligenceState`, `ModelReliabilityAssessment`, etc.
- **Compute**: `reliability/compute-state.ts`
- **Sub-modules**: `regime-fit.ts`, `temporal-drift.ts`, `conflict-detect.ts`, `freshness.ts`, `uncertainty.ts`
- **Duplicate?**: NO

### DecisionTrace (A5 input)

- **Canonical source**: `src/domain/strategy/decision-trace.ts`
- **A6 reads**: `__decisionTraceCache` (read-only, extracts DecisionRef only)
- **Duplicate?**: NO — A6 does not create a second decision trace.

## Duplicate Authority Check

| Concept | Canonical Source | Duplicate Found? | Severity |
|---------|------------------|-----------------|----------|
| Experience | experience.ts | NO | — |
| Outcome | outcome.ts | NO | — |
| Attribution | attribution.ts | NO | — |
| Metrics (8 dims) | strategy-evaluation.ts | NO | — |
| Baseline | baseline.ts | NO | — |
| Prediction | prediction/types.ts | NO | — |
| Calibration | calibration/types.ts | NO | — |
| Reliability | reliability/types.ts | NO | — |
| DecisionTrace | strategy/decision-trace.ts | NO | — |

**No DUPLICATED_AUTHORITY found.**
