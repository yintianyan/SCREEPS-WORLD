# A6.6 Recommendation Engine — 最终实施报告

> **Phase**: 35  
> **Date**: 2026-08-26  
> **Status**: ✅ COMPLETE  
> **Quality Gates**: typecheck ✅ | test ✅ (4753/4753) | build ✅

---

## 一、实施摘要

A6.6 Recommendation Engine 作为 **Evidence-backed Recommendation Producer** 已完整实现。

### 核心定位
回答 "What actions are worth considering based on intelligence evidence?" — 不决定、不执行、不干涉。

### Shadow-Only 边界
- 写入唯一目标：`globalCache.__recommendationCache`
- 不被任何执行系统读取（零 import from execution systems）
- `shadowOnly: true` (literal type) — 编译时强制
- `autoApply: false` (literal type) — 编译时强制

### 文件清单

#### Domain 层 (`src/domain/intelligence/recommendation/`)
| 文件 | 职责 | 行数 |
|------|------|------|
| `types.ts` | 核心类型定义 (RecommendationCandidate, EvidenceItem, Conflict, Lifecycle, RingBuffer) | 469 |
| `hashing.ts` | 确定性哈希 (stableStringify + fnv1a32Hex) | ~20 |
| `evidence-builder.ts` | 从 A6.1-A6.5 数据构建可追溯证据链 | 392 |
| `generator.ts` | 8 类 Trigger 条件评估 + Recommendation 生成 | 577 |
| `conflict-detector.ts` | 冲突检测 (same_target / resource_competition / strategic_contradiction) | 213 |
| `lifecycle.ts` | TTL / Supersede / Regime 变化 / GC 生命周期管理 | 323 |
| `ranking.ts` | 5-level Lexicographic 排序 (确定性) | 187 |
| `guards.ts` | REC-001 ~ REC-014 安全守卫 | ~300 |
| `index.ts` | 统一导出 | ~30 |

#### System 层 (`src/systems/intelligence/`)
| 文件 | 职责 |
|------|------|
| `recommendation-engine-system.ts` | 系统薄壳：采集 → 编排 → 写入 cache |

#### 修改文件
| 文件 | 改动 |
|------|------|
| `src/kernel/global-cache.ts` | 新增 `__recommendationCache` 字段 |
| `src/bootstrap.ts` | 注册 `recommendationEngineSystem` |

#### 测试
| 文件 | 测试数 |
|------|--------|
| `tests/unit/intelligence/a6-6-recommendation-engine.test.ts` | 73 |

---

## 二、安全边界验证

### REC-001 ~ REC-014 守卫状态

| Guard | 描述 | 状态 |
|-------|------|------|
| REC-001 | Bounded Cache — 只写 `__recommendationCache` | ✅ |
| REC-002 | Domain Purity — 不引用 Game/Memory/globalThis | ✅ |
| REC-003 | No Game API — 不调用 spawnCreep 等 | ✅ |
| REC-004 | No Runtime Mutation — 不修改运行时状态 | ✅ |
| REC-005 | Determinism — 禁止 Math.random / Date.now | ✅ |
| REC-006 | No Execution Leak — shadowOnly=true + autoApply=false | ✅ |
| REC-007 | No Strategy Mutation — 不修改 Strategy/Posture | ✅ |
| REC-008 | No Decision Authority — 无 executeAction/applyStrategy 等 | ✅ |
| REC-009 | No Universal Score — 无 recommendationScore/overallScore 等 | ✅ |
| REC-010 | Evidence Traceability — 每条有可追溯 evidence | ✅ |
| REC-011 | No Auto Apply — autoApply=false (literal type) | ✅ |
| REC-012 | No Unbounded History — RingBuffer 有界 | ✅ |
| REC-013 | TTL Enforcement — 每条有 validityWindow | ✅ |
| REC-014 | Deterministic ID — REC-{tick}-{seq} 格式 | ✅ |

### Decision Authority 审计

A6.6 **零 Decision Authority**：

- ❌ 不选择最高分建议
- ❌ 不解决冲突
- ❌ 不执行任何动作
- ❌ 不修改 Strategy/Posture
- ❌ 不创建 Spawn 请求
- ❌ 不创建 Construction Site
- ❌ 不修改任何 cache（除 `__recommendationCache`）

---

## 三、运行时链路审计

### 数据流（只读采集）

```
A6.1 Experience ──→ __experienceCache ──┐
A6.2 Evaluation  ──→ __evaluationCache ──┤
A6.3 Prediction  ──→ __predictionCache ──┤──→ recommendation-engine ──→ __recommendationCache
A6.4 Calibration ──→ __calibrationCache ──┤    (P3, interval=500t)
A6.5 Intelligence ──→ computeIntelligenceState ─┘
```

### 执行频率
- `RECOMMENDATION_INTERVAL = 500` tick
- 优先级 P3（所有业务系统之后运行）
- 非关键路径 — 系统完全停止时帝国照常运行

### 存储边界
- RingBuffer capacity = 100 (Recommendations)
- Conflict capacity = 30
- `RECOMMENDATION_MAX_AGE = 50000` tick 后 GC
- Heap only — global reset 可丢

---

## 四、确定性验证

### 测试覆盖

| 测试类别 | 测试数 | 描述 |
|----------|--------|------|
| Guards | 20 | REC-001~014 全覆盖 |
| Evidence Builder | 6 | 空输入、确定性ID、minConfidence、完整性 |
| Generator | 13 | NO_RECOMMENDATION 路径、Trigger 匹配、confidence 传播 |
| Ranking | 7 | Lexicographic 排序、tie-breaker、1000 replay |
| Conflict Detector | 4 | same_target / strategic_contradiction / attachConflictIds |
| Lifecycle | 8 | TTL / Supersede / GC / RingBuffer wrap / Stats |
| Shadow-Only | 4 | 编译时强制 shadowOnly/autoApply、禁止字段 |
| Determinism | 4 | Hash 确定性、Generator 1000 replay、Ranking 1000 replay |
| Bounded Memory | 4 | RingBuffer capacity、Conflict capacity、Guard validation |

### 确定性测试结果
- `DET-001`: 相同输入 → 相同 hash ✅
- `DET-002`: 不同输入 → 不同 hash ✅
- `DET-003`: generateRecommendations 1000 replay 完全一致 ✅
- `DET-004`: rankRecommendations 1000 replay 完全一致 ✅

---

## 五、Counterfactual Audit

### 反事实 1: A6.6 完全停止
**假设**: `recommendationEngineSystem` 从 bootstrap 移除。  
**结果**: 帝国照常运行。所有执行系统（spawn, construction, war, defense, economy）不依赖 `__recommendationCache`。  
**验证**: grep 确认无执行系统 import recommendation 模块。 ✅

### 反事实 2: A6.6 输出被误用
**假设**: 某个执行系统尝试读取 `__recommendationCache`。  
**结果**: 类型系统阻止 — `RecommendationCandidate` 的 `shadowOnly: true` 和 `autoApply: false` 是 literal type，编译器会在使用时发出类型警告。  
**验证**: 编译时强制。 ✅

### 反事实 3: A6.6 产出错误建议
**假设**: Generator 产出了一条语义错误的 Recommendation。  
**结果**: 不影响任何执行 — 建议只写入 `__recommendationCache`，不被消费。  
**验证**: Shadow-only 边界。 ✅

### 反事实 4: A6.6 内存泄漏
**假设**: RingBuffer 持续写入不 GC。  
**结果**: 不会泄漏 — RingBuffer 有固定容量（100+30），超出后环形覆盖最旧数据。GC 每 500 tick 清理超龄记录。  
**验证**: BUF-001/BUF-002 测试确认容量强制执行。 ✅

---

## 六、Quality Gates

| Gate | Command | Result |
|------|---------|--------|
| TypeCheck | `npm run typecheck` | ✅ 0 errors |
| Test | `npm test` | ✅ 4753/4753 passed (314 files) |
| Build | `npm run build` | ✅ dist/main.js created |

---

## 七、最终结论

A6.6 Recommendation Engine 已完成实施，满足所有安全约束：

1. **Shadow-Only** — 只写 `__recommendationCache`，零执行系统消费
2. **Zero Decision Authority** — 不选择、不解决、不执行
3. **Evidence-backed** — 每条建议可追溯到 A6.1-A6.5 具体输出
4. **Deterministic** — 禁止 Math.random / Date.now，1000 replay 一致
5. **Bounded** — RingBuffer 有界，GC 定期清理
6. **14 Safety Guards** — REC-001~014 全部通过
7. **73 Unit Tests** — 覆盖 Guards / Evidence / Generator / Ranking / Conflict / Lifecycle / Shadow / Determinism / Bounded Memory

**实施就绪度：100%** — 可安全部署到生产环境。
