# A6 ACTUAL RUNTIME GRAPH

> Generated: 2026-08-26
> Method: Code-level trace of bootstrap.ts, system files, domain files, global-cache.ts
> This graph is built from REAL code, not documentation.

## 1. System Registration (bootstrap.ts)

All 5 A6 systems registered in `bootstrap.ts` lines 120-143, all in P3 phase:

```
.registerSystem(experienceCollectorSystem)      // A6.1
.registerSystem(strategyEvaluationSystem)       // A6.2
.registerSystem(predictionSystem)               // A6.3
.registerSystem(calibrationResolutionSystem)    // A6.4
.registerSystem(intelligenceStateSystem)        // A6.5
```

## 2. Per-System Runtime Profile

### A6.1 experience-collector-system

| Property | Value |
|----------|-------|
| **System name** | `experience-collector` |
| **Cadence** | 100t (interval=100) |
| **Phase** | `post` |
| **Priority** | 3 (P3) |
| **globalCache reads** | `__decisionTraceCache`, `empireHealth`, `recoveryStats`, `logisticsHealth`, `warPlanCache` |
| **globalCache writes** | `__experienceCache` (init + ring buffer + processedDecisionIds Set) |
| **Domain calls** | `collectOutcome()`, `collectAttribution()`, `createExperience()`, `attachOutcome()`, `attachAttribution()`, `finalizeExperience()`, `pushExperience()`, `gcExperienceBuffer()` |
| **Output** | ExperienceRecord in `__experienceCache.ringBuffer` |
| **Downstream consumer** | A6.2 (reads `__experienceCache.ringBuffer`), A6.4 (reads `__experienceCache` for external factors) |
| **Execution side effects** | NONE (no Game API calls) |
| **Classification** | **Producer + Shadow Output** |

### A6.2 strategy-evaluation-system

| Property | Value |
|----------|-------|
| **System name** | `strategy-evaluation` |
| **Cadence** | 500t (interval=500) |
| **Phase** | `post` |
| **Priority** | 3 (P3) |
| **globalCache reads** | `__experienceCache`, `empireHealth`, `recoveryStats`, `logisticsHealth` |
| **globalCache writes** | `__evaluationCache` (init + ring buffer) |
| **Domain calls** | `evaluateStrategy()`, `buildBaseline()`, `buildBaselineKey()`, `extractHistoricalValues()`, `buildEvaluationEvidence()`, `validateEvidenceCompleteness()` |
| **Output** | StrategyEvaluation in `__evaluationCache.ringBuffer` |
| **Downstream consumer** | A6.4 (reads `__evaluationCache` for external factors) |
| **Execution side effects** | NONE |
| **Classification** | **Producer + Shadow Output** |

### A6.3 prediction-system

| Property | Value |
|----------|-------|
| **System name** | `prediction` |
| **Cadence** | 500t (interval=500) |
| **Phase** | `post` |
| **Priority** | 3 (P3) |
| **globalCache reads** | `empireHealth`, `__netFlowHistory`, `__reserveHistory`, `__spawnQueueDepthHistory`, `__populationHistory` |
| **globalCache writes** | `__predictionCache` (init + ring buffer + lastRunTick) |
| **Domain calls** | `predictEnergyShortage()`, `predictSpawnStarvation()`, `isValidPrediction()`, `createPredictionRingBuffer()`, `pushPrediction()`, `expireOverduePredictions()`, `gcPredictionBuffer()`, `createTimeSeries()`, `pushSample()` |
| **Output** | Prediction in `__predictionCache.ringBuffer` |
| **Downstream consumer** | A6.4 (reads `__predictionCache.ringBuffer`), A6.5 (reads `__predictionCache.ringBuffer`) |
| **Execution side effects** | NONE |
| **Classification** | **Producer + Shadow Output** |

### A6.4 calibration-resolution-system

| Property | Value |
|----------|-------|
| **System name** | `calibration-resolution` |
| **Cadence** | 500t (CALIBRATION_INTERVAL=500) |
| **Phase** | `post` |
| **Priority** | 3 (P3) |
| **globalCache reads** | `__predictionCache`, `__reserveHistory`, `__spawnQueueDepthHistory`, `__experienceCache`, `__evaluationCache`, `empireHealth` |
| **globalCache writes** | `__calibrationCache` (init + ring buffer + profiles Map + failureStats Map + lastProfileTick) |
| **Domain calls** | `resolvePrediction()`, `computeCalibrationStatistics()`, `updateProfile()`, `createCalibrationRingBuffer()`, `pushResolution()`, `gcCalibrationBuffer()`, `getPendingResolutionIds()`, `isPredictionResolved()`, `validateCalibrationBuffer()`, `makePredictionContext()` |
| **Output** | ResolutionResult in `__calibrationCache.ringBuffer`, ModelCalibrationProfile in profiles Map |
| **Downstream consumer** | A6.5 (reads `__calibrationCache.ringBuffer`) |
| **Execution side effects** | NONE |
| **Classification** | **Producer + Shadow Output** |

### A6.5 intelligence-state-system

| Property | Value |
|----------|-------|
| **System name** | `intelligence-state` |
| **Cadence** | 500t (INTELLIGENCE_STATE_INTERVAL) |
| **Phase** | `post` |
| **Priority** | 3 (P3) |
| **globalCache reads** | `__predictionCache`, `__calibrationCache`, `empireHealth` |
| **globalCache writes** | **NONE** (REL-001: Read-Only) |
| **Domain calls** | `computeIntelligenceState()`, `makePredictionContext()`, `validateIntelligenceState()`, `guardRelReadOnly()`, `guardRelNoStrategyMutation()`, `guardRelNoNewSampler()` |
| **Output** | IntelligenceState (transient, not persisted) |
| **Downstream consumer** | NONE — no module outside `src/systems/intelligence/` or `src/domain/intelligence/` reads IntelligenceState |
| **Execution side effects** | NONE |
| **Classification** | **Read-Only Projection** |

## 3. Data Flow Graph

```
┌─────────────────────────────────────────────────────────────────┐
│ A5 / Business Systems (P1-P2 phase)                             │
│                                                                  │
│  empire-health-system ──→ globalCache.empireHealth               │
│  spawn-manager ────────→ globalCache.__spawnQueueDepthHistory   │
│  empire-health-system ──→ globalCache.__netFlowHistory           │
│  empire-health-system ──→ globalCache.__reserveHistory           │
│  empire-health-system ──→ globalCache.__populationHistory        │
│  decision-trace ────────→ globalCache.__decisionTraceCache       │
│  recovery-execution ─────→ globalCache.recoveryStats              │
│  logistics-planner ─────→ globalCache.logisticsHealth           │
│  war-planner ───────────→ globalCache.warPlanCache               │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ (read-only)
┌─────────────────────────────────────────────────────────────────┐
│ A6 Intelligence Layer (P3 post phase)                           │
│                                                                  │
│  A6.1 experience-collector (100t)                                │
│    reads: __decisionTraceCache, empireHealth, recoveryStats...  │
│    writes: __experienceCache                                     │
│    calls: collectOutcome(), collectAttribution() [pure]          │
│                                                                  │
│  A6.2 strategy-evaluation (500t)                                │
│    reads: __experienceCache, empireHealth...                     │
│    writes: __evaluationCache                                     │
│    calls: evaluateStrategy() [pure]                              │
│                                                                  │
│  A6.3 prediction (500t)                                          │
│    reads: __netFlowHistory, __reserveHistory...                  │
│    writes: __predictionCache                                     │
│    calls: predictEnergyShortage(), predictSpawnStarvation()      │
│                                                                  │
│  A6.4 calibration-resolution (500t)                              │
│    reads: __predictionCache, __experienceCache...               │
│    writes: __calibrationCache                                   │
│    calls: resolvePrediction(), computeCalibrationStatistics()    │
│                                                                  │
│  A6.5 intelligence-state (500t)                                 │
│    reads: __predictionCache, __calibrationCache                 │
│    writes: NOTHING (REL-001)                                     │
│    calls: computeIntelligenceState() [pure]                      │
│    output: transient IntelligenceState (not persisted)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                         NO DOWNSTREAM CONSUMER
              (no module outside A6 reads A6 output)
```

## 4. Execution Authority Matrix

| System | Can call Game API? | Can modify Strategy? | Can spawn? | Can build? | Can move creeps? |
|--------|-------------------|---------------------|------------|------------|-----------------|
| A6.1 | NO | NO | NO | NO | NO |
| A6.2 | NO | NO | NO | NO | NO |
| A6.3 | NO | NO | NO | NO | NO |
| A6.4 | NO | NO | NO | NO | NO |
| A6.5 | NO | NO | NO | NO | NO |

## 5. Query Function Export Audit

| Function | Exported from | Called by (non-A6) |
|----------|---------------|-------------------|
| `getExperienceRecords()` | experience-collector-system | NONE |
| `getExperienceStats()` | experience-collector-system | NONE |
| `printExperienceDashboard()` | experience-collector-system | NONE |
| `getEvaluationResults()` | strategy-evaluation-system | NONE |
| `printEvaluationDashboard()` | strategy-evaluation-system | NONE |

**Conclusion**: All A6 query functions are exported but have zero external callers. No execution system imports from `domain/intelligence/`.
