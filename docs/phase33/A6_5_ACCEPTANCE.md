# A6.5 Acceptance — 验收标准

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做验收标准定义，不修改任何代码  
> **基线**: A6.5 Architecture + Safety Boundary + Counterfactuals

---

## 一、验收维度

### 1.1 六大验收维度

| 维度 | 验证内容 | 优先级 |
|------|---------|--------|
| D1: Shadow-Only 隔离 | A6.5 不写入任何 cache，不修改上游 | P0 |
| D2: 确定性 | 相同输入 → 相同 IntelligenceState | P0 |
| D3: 正确性 | Regime/Drift/Conflict 检测结果正确 | P0 |
| D4: 有界性 | 内存有硬上限，不持久化 | P1 |
| D5: 可观测性 | IntelligenceState 可被 console.log 暴露 | P1 |
| D6: 退化防护 | 不产出万能分数，不解决冲突 | P0 |

---

## 二、D1: Shadow-Only 隔离

### 2.1 验收标准

| 测试 ID | 描述 | 通过条件 |
|---------|------|---------|
| D1-T1 | A6.5 System 层 run() 不写入 globalCache | `globalCache()` 在 run() 前后深比较一致 |
| D1-T2 | A6.5 Domain 层不引用 Game/Memory | 静态扫描无 `Game.` / `Memory.` / `RawMemory.` 引用 |
| D1-T3 | A6.5 不修改 A6.4 CalibrationRingBuffer | `__calibrationCache` 在 run() 前后深比较一致 |
| D1-T4 | A6.5 不修改 A6.3 PredictionRingBuffer | `__predictionCache` 在 run() 前后深比较一致 |
| D1-T5 | A6.5 不修改 Memory.kernel | `Memory.kernel` 在 run() 前后深比较一致 |

### 2.2 验证方法

```typescript
// 概念设计（非实现）
function testShadowOnly(): void {
  const g = globalCache();
  const beforeCal = JSON.stringify(g.__calibrationCache);
  const beforePred = JSON.stringify(g.__predictionCache);
  const beforeExp = JSON.stringify(g.__experienceCache);
  const beforeEval = JSON.stringify(g.__evaluationCache);
  const beforeMem = JSON.stringify(Memory.kernel);

  // 运行 A6.5
  intelligenceStateSystem.run(ctx);

  const afterCal = JSON.stringify(g.__calibrationCache);
  const afterPred = JSON.stringify(g.__predictionCache);
  const afterExp = JSON.stringify(g.__experienceCache);
  const afterEval = JSON.stringify(g.__evaluationCache);
  const afterMem = JSON.stringify(Memory.kernel);

  assert(beforeCal === afterCal, "A6.5 modified __calibrationCache");
  assert(beforePred === afterPred, "A6.5 modified __predictionCache");
  assert(beforeExp === afterExp, "A6.5 modified __experienceCache");
  assert(beforeEval === afterEval, "A6.5 modified __evaluationCache");
  assert(beforeMem === afterMem, "A6.5 modified Memory.kernel");
}
```

---

## 三、D2: 确定性

### 3.1 验收标准

| 测试 ID | 描述 | 通过条件 |
|---------|------|---------|
| D2-T1 | 100× replay stateHash 一致 | 100 次调用 `computeIntelligenceState()` → 100% 相同 hash |
| D2-T2 | PredictionConflict 顺序一致 | 100 次 → 冲突列表数量 + conflictHash 一致 |
| D3-T3 | ModelReliability 顺序一致 | 100 次 → 评估列表数量 + reliabilityHash 一致 |
| D2-T4 | 无 Math.random / Date.now | 静态扫描无 `Math.random` / `Date.now` / `Game.time` 引用 |

### 3.2 验证方法

```typescript
function testDeterminism(): void {
  const state = computeIntelligenceState(
    fixedPredictions,
    fixedResolutions,
    fixedProfiles,
    fixedFailureStats,
    fixedContext,
    100000,
  );

  const hashes: string[] = [];
  for (let i = 0; i < 100; i++) {
    const s = computeIntelligenceState(
      fixedPredictions,
      fixedResolutions,
      fixedProfiles,
      fixedFailureStats,
      fixedContext,
      100000,
    );
    hashes.push(s.stateHash);
  }

  assert(hashes.every(h => h === state.stateHash), "Determinism violation");
}
```

---

## 四、D3: 正确性

### 4.1 Regime Fit 验收

| 测试 ID | 场景 | 通过条件 |
|---------|------|---------|
| D3-T1 | CF-1: Regime Profile 存在且充足 | `regimeFit.currentRegimeMatched = true`, `profileSource = "REGIME"` |
| D3-T2 | CF-2: Regime Profile 不存在 | `regimeFit.currentRegimeMatched = false`, `profileSource = "FALLBACK_GLOBAL"` |
| D3-T3 | CF-3: 样本不足 | `sampleSufficiency = "INSUFFICIENT_FOR_REGIME"` |
| D3-T4 | CF-10: Regime 冲突 | `conflict.type = "regime"` 存在 |

### 4.2 Temporal Drift 验收

| 测试 ID | 场景 | 通过条件 |
|---------|------|---------|
| D3-T5 | CF-4: Drift 检测 | `driftDetected = true`, `driftDirection = "DEGRADING"` |
| D3-T6 | CF-5: Improving 检测 | `driftDetected = true`, `driftDirection = "IMPROVING"` |
| D3-T7 | CF-6: 样本不足 | `driftDetected = false`, `driftDirection = "UNKNOWN"` |
| D3-T8 | CF-14: Profile Aging | `profileStale = true`, `freshness = "STALE"` |

### 4.3 Conflict Detection 验收

| 测试 ID | 场景 | 通过条件 |
|---------|------|---------|
| D3-T9 | CF-7: 逻辑冲突 | `predictionConflicts.length = 1`, `type = "logical"` |
| D3-T10 | CF-8: 因果链 | `predictionConflicts.length = 0` |
| D3-T11 | CF-9: Temporal 不一致 | `predictionConflicts.length = 1`, `type = "temporal"` |
| D3-T12 | CF-11: 全面恶化 | `predictionConflicts.length = 0`, uncertainty 标注 |

### 4.4 Cold Start 验收

| 测试 ID | 场景 | 通过条件 |
|---------|------|---------|
| D3-T13 | CF-12: 冷启动 | `calibrationHealth.status = "COLD_START"`, `dataSufficiency.sufficient = false` |
| D3-T14 | CF-13: 部分数据 | `dataSufficiency.modelsWithSufficientData = 0` |

---

## 五、D4: 有界性

### 5.1 验收标准

| 测试 ID | 描述 | 通过条件 |
|---------|------|---------|
| D4-T1 | IntelligenceState 不持久化 | run() 后 `globalCache.__intelligenceState` 不存在 |
| D4-T2 | IntelligenceState 大小有界 | `JSON.stringify(state).length <= 2048` |
| D4-T3 | modelReliability 有界 | `modelReliability.length <= 10` |
| D4-T4 | predictionConflicts 有界 | `predictionConflicts.length <= 5` |
| D4-T5 | uncertainty.sources 有界 | `uncertainty.sources.length <= 5` |

---

## 六、D5: 可观测性

### 6.1 验收标准

| 测试 ID | 描述 | 通过条件 |
|---------|------|---------|
| D5-T1 | IntelligenceState 可 console.log | run() 每 5000t 输出摘要 |
| D5-T2 | 守卫违规可 console.log | REL 守卫违规时输出 |
| D5-T3 | 冷启动有明确日志 | 冷启动时输出 "COLD_START" |
| D5-T4 | Drift 有明确日志 | drift 检测时输出 |

### 6.2 可观测输出格式（拟）

```
[100000] intelligence-state: models=2, conflicts=1, drift=DEGRADING, 
  coverage=2/7, sufficient=false, freshness=RECENT, uncertainty=epistemic
```

---

## 七、D6: 退化防护

### 7.1 验收标准

| 测试 ID | 描述 | 通过条件 |
|---------|------|---------|
| D6-T1 | 不产出 reliabilityScore | IntelligenceState 不含 `reliabilityScore` 字段 |
| D6-T2 | 不产出 IntelligenceScore | IntelligenceState 不含 `intelligenceScore` 字段 |
| D6-T3 | 不解决冲突 | A6.5 代码不包含 `selectHighest` / `resolveConflict` |
| D6-T4 | 不修改 Strategy | A6.5 代码不包含 `.posture =` / `.strategy =` |
| D6-T5 | 不降权预测 | A6.5 代码不包含 `applyWeight` / `downgrade` |
| D6-T6 | 不切换模型 | A6.5 代码不包含 `selectModel` / `switchModel` |

---

## 八、质量门槛

### 8.1 合并前强制

| 命令 | 要求 |
|------|------|
| `npm run typecheck` | ✅ 全绿 |
| `npm test` | ✅ 全绿 |
| `npm run build` | ✅ 全绿 |

### 8.2 测试覆盖率

| 模块 | 最低覆盖率 |
|------|----------|
| `reliability/types.ts` | 100%（类型定义） |
| `reliability/regime-fit.ts` | 90% |
| `reliability/temporal-drift.ts` | 90% |
| `reliability/conflict-detect.ts` | 90% |
| `reliability/data-sufficiency.ts` | 85% |
| `reliability/freshness.ts` | 85% |
| `reliability/uncertainty.ts` | 85% |
| `reliability/state-hash.ts` | 100% |
| `reliability/guards.ts` | 90% |
| `intelligence-state-system.ts` | 80% |

---

## 九、守卫验收

### 9.1 REL-001 ~ REL-012 守卫测试

| Guard | 测试方式 | 通过条件 |
|-------|---------|---------|
| REL-001 | 验证 run() 不写入 globalCache | ✅ 不写入 |
| REL-002 | 静态扫描 Domain 层 | ✅ 无 Game/Memory 引用 |
| REL-003 | 运行时检查 | ✅ 不调用 Game API |
| REL-004 | 深比较运行前/后状态 | ✅ 不修改运行时 |
| REL-005 | 100× replay | ✅ stateHash 一致 |
| REL-006 | 验证 globalCache 无 A6.5 字段 | ✅ 不持久化 |
| REL-007 | 静态扫描 run() | ✅ 无 createXxx 调用 |
| REL-008 | 静态扫描 | ✅ 无新 Metrics |
| REL-009 | 静态扫描 run() | ✅ 无 Strategy/Posture 修改 |
| REL-010 | 验证 IntelligenceState 含可追溯字段 | ✅ 有 profileHash / reliabilityHash |
| REL-011 | 静态扫描代码 | ✅ 无冲突解决代码 |
| REL-012 | JSON.stringify 扫描 | ✅ 无 reliabilityScore |

---

## 十、端到端验收

### 10.1 集成测试场景

| 测试 ID | 描述 | 输入 | 预期 |
|---------|------|------|------|
| E2E-T1 | 完整链路 | A6.1→A6.2→A6.3→A6.4→A6.5 | IntelligenceState 正常产出 |
| E2E-T2 | 冷启动 | 所有 Ring Buffer 空 | COLD_START 状态 |
| E2E-T3 | 部分数据 | A6.3+A6.4 有数据, A6.1+A6.2 空 | 部分维度有值 |
| E2E-T4 | 冲突场景 | 2 条互斥预测 | 1 条 logical conflict |
| E2E-T5 | Drift 场景 | 最近 ECE 远高于整体 ECE | DEGRADING |
| E2E-T6 | 安全不变式 | A6.5 完全停止 | 帝国照常运行 |

### 10.2 安全不变式

**核心不变式**: A6.5 的 `intelligence-state-system` 完全停止时，帝国必须照常安全运行。

**验证**: 在测试环境中注释掉 `intelligence-state-system` 的注册，运行 10000 tick，验证：
- ✅ Spawn 正常
- ✅ Construction 正常
- ✅ Creep 行为正常
- ✅ War/Defense 正常
- ✅ Economy 正常
- ✅ A6.1-A6.4 正常

---

## 十一、验收检查清单

### 11.1 实现前

- [ ] A6.4 Calibration 完全实现并测试通过
- [ ] A6.3 Prediction 完全实现并测试通过
- [ ] `stableStringify` / `fnv1a32Hex` 可复用
- [ ] `GuardResult` 类型可复用
- [ ] `buildPredictionContextSignature` 可复用

### 11.2 实现中

- [ ] Domain 层纯函数，不引用 Game/Memory
- [ ] System 层薄壳，只采集和编排
- [ ] REL-001 ~ REL-012 守卫全部实现
- [ ] CF-1 ~ CF-15 反事实场景全部覆盖
- [ ] IntelligenceState 不持久化

### 11.3 实现后

- [ ] `npm run typecheck` 全绿
- [ ] `npm test` 全绿
- [ ] `npm run build` 全绿
- [ ] D1 ~ D6 验收维度全部通过
- [ ] E2E 集成测试全部通过
- [ ] 安全不变式验证通过
- [ ] 守卫测试全部通过
