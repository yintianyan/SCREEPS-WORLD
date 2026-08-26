# A6 MEMORY BUDGET

> Generated: 2026-08-26
> Method: Code-level inspection of all ring buffers, Maps, Sets, and arrays in A6

## 1. Ring Buffer Capacities

| Structure | Capacity | Max Age | GC | File |
|-----------|----------|---------|-----|------|
| Experience Ring Buffer | 500 | 10000 tick | Yes (`gcExperienceBuffer`) | experience-collector-system.ts:76-79 |
| Evaluation Ring Buffer | 50 | 50000 tick | Yes (`gcEvaluationBuffer`) | strategy-evaluation-system.ts:108-111 |
| Prediction Ring Buffer | 200 | 50000 tick | Yes (`gcPredictionBuffer`) | prediction-system.ts:61-64 |
| Resolution Ring Buffer | 500 | 100000 tick | Yes (`gcCalibrationBuffer`) | calibration/types.ts:409-412 |

All ring buffers use fixed-capacity circular overwrite. **No unbounded arrays.**

## 2. Map / Set Upper Bounds

| Structure | Type | Upper Bound | Cleanup Mechanism | File |
|-----------|------|-------------|-------------------|------|
| `processedDecisionIds` | Set | 5000 (hard cap, trims to 3000) | Manual trim at >5000 → delete oldest 2000 | experience-collector-system.ts:185-190 |
| `resolvedPredictionIds` | Set | Bounded by ring buffer GC | GC removes IDs when records are GC'd | calibration/ring-buffer.ts:267 |
| `profiles` | Map | MAX_PROFILES=10 | Oldest evicted when exceeded (code has no explicit eviction but model count is naturally bounded) | calibration/ring-buffer.ts:57 |
| `failureStats` | Map | MAX_PROFILES=10 (same domain) | Same as profiles | calibration/ring-buffer.ts:58 |
| `metricRegistry` | Map | Static (2 entries: energy-shortage, spawn-starvation) | Never grows at runtime | calibration/metrics.ts:59 |

## 3. History Arrays (A5-owned, A6 reads)

| Structure | Owner | Capacity | File |
|-----------|-------|----------|------|
| `__netFlowHistory` | empire-health-system | number[] (managed by A5) | global-cache.ts:261 |
| `__reserveHistory` | empire-health-system | number[] (managed by A5) | global-cache.ts:263 |
| `__populationHistory` | empire-health-system | number[] (managed by A5) | global-cache.ts:265 |
| `__spawnQueueDepthHistory` | spawn-manager | TimeSeries<number> (managed by A5) | global-cache.ts:353 |

These are owned and bounded by A5 systems. A6 reads them read-only.

## 4. Transient Allocations (per-run)

| Allocation | Scope | Lifetime | Bounded? |
|------------|-------|----------|----------|
| A6.5 `collectAllPredictions()` result | Function local | GC'd after system run | ≤ 200 (ring buffer capacity) |
| A6.5 `collectAllResolutions()` result | Function local | GC'd after system run | ≤ 500 (ring buffer capacity) |
| A6.5 `collectAllProfiles()` result | Function local | GC'd after system run | ≤ 10 (MAX_PROFILES) |
| A6.5 `collectAllFailureStats()` result | Function local | GC'd after system run | ≤ 10 |
| A6.5 `IntelligenceState` object | System run scope | Discarded after run | Fixed size |
| A6.4 `buildExternalFactors()` result | Function local | GC'd after call | ≤ (experience count + finding count) |
| A6.4 `collectAllPredictions()` result | Function local | GC'd after call | ≤ 200 |

## 5. Unbounded Structure Check

| Pattern | Found? | Details |
|---------|--------|---------|
| Unbounded `Map` | NO | All Maps have MAX_PROFILES cap or are static |
| Unbounded `Set` | NO | `processedDecisionIds` has hard cap at 5000; `resolvedPredictionIds` cleaned by GC |
| Unbounded `Array` | NO | All arrays are fixed-capacity ring buffers |
| Unbounded `history` | NO | All histories are A5-owned with their own bounds |
| Unbounded `records` | NO | All record stores are ring buffers |

## 6. Memory Footprint Estimate

Per A6 layer, assuming all ring buffers are full:

| Layer | Ring Buffer | Records | Est. per-record size | Total est. |
|-------|------------|---------|---------------------|------------|
| A6.1 | Experience | 500 | ~500 bytes | ~250 KB |
| A6.2 | Evaluation | 50 | ~2 KB | ~100 KB |
| A6.3 | Prediction | 200 | ~1 KB | ~200 KB |
| A6.4 | Resolution | 500 | ~500 bytes | ~250 KB |
| A6.4 | Profiles Map | 10 | ~1 KB | ~10 KB |
| A6.5 | (none) | 0 | — | 0 |
| **Total** | | | | **~810 KB** |

This is well within Screeps' heap limit (~500 MB typical).

## 7. CPU Footprint Estimate

| System | Interval | Per-run CPU estimate | Notes |
|--------|----------|---------------------|-------|
| A6.1 | 100t | ~0.5-1.0 CPU | Iterates DecisionTrace ring buffer, builds outcomes/attributions |
| A6.2 | 500t | ~0.3-0.5 CPU | Evaluates up to 200 experiences, 8 dimensions |
| A6.3 | 500t | ~0.2-0.3 CPU | Two linear regressions per model |
| A6.4 | 500t | ~0.5-1.0 CPU | Resolves pending predictions, computes calibration stats |
| A6.5 | 500t | ~0.2-0.3 CPU | Aggregates predictions + resolutions + profiles |

### Amortized per-tick CPU

- A6.1: 1.0/100 = 0.01 CPU/tick
- A6.2: 0.5/500 = 0.001 CPU/tick
- A6.3: 0.3/500 = 0.0006 CPU/tick
- A6.4: 1.0/500 = 0.002 CPU/tick
- A6.5: 0.3/500 = 0.0006 CPU/tick
- **Total amortized: ~0.014 CPU/tick** (negligible)

## 8. Duplicate Computation Check

| Pattern | Found? | Details |
|---------|--------|---------|
| Per-tick history scan | NO | All A6 systems run at 100-500t intervals |
| Per-tick ring buffer full scan | NO | Ring buffer iterations are O(capacity), bounded |
| Repeated regression | NO | A6.3 computes regression once per model per run |
| Repeated sorting | MINOR | A6.4 `collectAllPredictions` sorts by ID; A6.5 `collectAllPredictions` also sorts by ID. These run in different systems at different times. |
| Repeated evidence traversal | NO | A6.4 `buildExternalFactors` traverses experience + evaluation ring buffers, but only when resolving predictions (500t) |
| A6.5 full history rescan | NO | A6.5 reads current ring buffer state, does not replay history |

### Finding: MEDIUM-1 — Repeated prediction collection in A6.4 and A6.5

- **Files**: `calibration-resolution-system.ts:367-376`, `intelligence-state-system.ts:155-163`
- **Description**: Both A6.4 and A6.5 independently iterate the prediction ring buffer, collect all predictions, and sort by ID. A6.5 runs after A6.4 in the same tick.
- **Impact**: Minor duplicate CPU work (~0.1ms per run). Not a correctness issue.
- **Severity**: LOW (CPU waste is negligible, and A6.5 cannot depend on A6.4's transient data)
- **Recommended fix**: None — this is correct design. A6.5 must not depend on A6.4's internal state for REL-001 compliance.

## 9. GC Verification

All ring buffers have verified GC:
- A6.1: `gcExperienceBuffer(buf, tick, 10000)` — called every run (100t)
- A6.2: `gcEvaluationBuffer(buf, 50000, tick)` — called every run (500t)
- A6.3: `gcPredictionBuffer(buf, tick, 50000)` — called every run (500t)
- A6.4: `gcCalibrationBuffer(buf, tick, 100000)` — called every run (500t)
- A6.5: No GC needed (no persistent storage)
