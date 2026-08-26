# PHASE38 · 状态生命周期审计（State Lifecycle Audit）

> 范围：任务书 §三 —— 全量 Map/Set/Array/RingBuffer/Cache/History/Registry/Memory.kernel/globalCache/module-level state
> 方法：grep 全部写入点 + 逐结构追踪 Owner/Writer/Reader/Capacity/GC/GC频率/Lifetime/Reset 行为

## 1. 重点点名结构逐一裁决

### snapshotRegistry（decision-trace-system）
- **Owner**: `__decisionTraceCache`（heap, globalThis epoch）
- **Writer**: buildSnapshot 各采集器 `.set(hash, snapshot)`（:149,:245,:324,:427,:521 等 8 处）
- **Reader**: evictStaleSnapshots 自身；checkTraceIntegrity（孤儿检测）；dashboard 完整性展示。**无业务 reader 按 hash 回取**（replayDecision 仅测试用）
- **Cap/GC**: 无容量上限，但未提交修复新增 `evictStaleSnapshots`（每 500t）：收集 ring 中 lifecycle!==EXPIRED 记录的 inputSnapshotHash 集，删除 registry 中不在集合内的键
- **GC 正确性**: ✅ 不删仍被引用的（ACTIVE/RESOLVED 保护）；✅ 会删仅被 EXPIRED 引用的——已验证无 resolve-by-hash 读径，驱逐安全（CF-LONG-10 固化该前提）
- **残留风险**: checkTraceIntegrity 在「读」接口中改写记录 lifecycle（诊断副作用，P3）
- **判定：CLOSED（本轮修复属实）**

### processedExpansionPlanIds
- Set, cap>500 时 FIFO 删 200（:901-903）。dedupKey = planId ?? `expansion:${target}:${startedAt}`
- 见 TD-39 裁决（主册 §7）：trim 本身六问全 NO。残差：legacy Memory 缺 planId 时 fallback 键随 startedAt 漂移 → 同一 operation 可重复 Decision（EXP-2 关联项，非 trim 引起）

### hysteresisCache（expansion-planner.ts:57）⚠️ 新确认无界
- 模块级 `Map<planId, {ticks, lastTick}>`，key=`room@discoveredAt`（plan.ts:95）
- Writer: planner 迟滞推进 :155-164；**Deleter: 无**（grep 全库零删除）
- Plan 再生铸造新 id → 条目只增不减。增速=每条新 plan 一条目（每扩张尝试+1），100k tick 数百条目、单条 <100B——不致命但违背「无单调膨胀」验收线
- Reset 行为：global reset 随模块 heap 清空
- **判定：SHOULD_FIX（GC-1）——与 snapshotRegistry 同型，建议同款引用集驱逐或 cap+LRU**

### DecisionTrace RingBuffer（domain ring, cap 1000）
- pushRecord 覆盖最老；gcTrace 分龄：ACTIVE→ARCHIVED(>1000t)→删除(>2000t)，EXPIRED 原地置 undefined
- 下游 experience-collector 以原始数组槽位遍历 + decisionId 去重 → rollover 幂等（CF-LONG-12 固化）
- 已知缺陷：gcTrace 打洞后重算 count 使 getRecentRecords 起点退化为 0（查询返回最旧而非最新直至回填）——查询语义缺陷非数据损坏（GC-2）

### Experience/Prediction/Calibration/Recommendation RingBuffers（A6, heap）
| Buffer | Cap | Age GC | 过期语义 | 判定 |
|---|---|---|---|---|
| __experienceCache | 500 | 10kt gcExperienceBuffer | 超龄清槽 | ✅ 有界 |
| evaluation | 50 | 50kt | 同 | ✅ |
| prediction | 200 | rollover 即弃 | 未到期即被覆盖→永不 resolve（静默损失） | ⚠️ CAL-1 关联，损失非污染 |
| calibration resolution | 500 + MAX_PROFILES=10 | 100kt | resolvedIds 随 GC 修剪 | ✅ |
| recommendation | 100 + conflicts 30 | 50kt | 整体过期 | ✅ |

### __experienceCache/__evaluationCache/__predictionCache/__calibrationCache/__recommendationCache
全部 heap-only、cap 明确、reset 可丢声明成立；消费者全部在 src/systems/intelligence/* 内部（L6 复验）。

### Memory.kernel 关键字段
- expansion：单槽，6 个清理点全覆盖终态（见 EXPANSION_IDENTITY 分册）
- expansionBlacklist / warBlacklist / prospectCooldown / spawnBlacklist / nukesInFlight：均有 prune（各自 run 内 TTL 清理，空表删除）
- stats/skipReasons/expectations：窗口重置或整槽替换，有界

## 2. 全结构普查表

见 PHASE38_RESOURCE_GROWTH_AUDIT.md §3 表格（Owner/Writer/Reader/Cap/GC/Lifetime/Reset 26 行全列）。
摘要：**唯一 NO CAP/NO GC 结构 = hysteresisCache**；其余为 tick-stamped 重建（1 tick 寿命）、ring 覆盖、TTL prune 或 deadline 过滤之一。

## 3. GC 三类风险的专项回答（任务书 §三）

1. **GC 是否可能删除仍被引用的数据？**
   - evictStaleSnapshots：否（引用集保护 ACTIVE/RESOLVED；EXPIRED 释放已证明安全）
   - gcExperienceBuffer：按 identity.tick 年龄清理，pending 经验超 maxAge 被清——这是「到期未决」的合法回收，上游 UNRESOLVED 兜底在先
   - processedDecisionIds trim：ring 先于 Set 驱逐（数量级论证见 A6 分册 L1），无复活重扫
2. **GC 是否留下失效数据？**
   - layout segment 丢房残留、intel 只写不清（R1 P3 遗留，未修，登记 TECHNICAL_DEBT）
   - EXPIRED 决策记录的孤儿标记路径 ≤100t 内被下轮 gc 清除
3. **reset 后是否真正清空？**
   - heap 全清（含五个 A6 cache、两个 processedSet、lastExpansionOutcome、snapshotRegistry）
   - Memory 侧由迁移链自愈；EXP-2 是 reset 后「清空过度导致的重建副作用」，不是清空不完全

## 4. 结论

状态生命周期工程整体健康：26 个普查结构中 25 个有明确界与回收路径。唯一结构性遗漏是 hysteresisCache；
snapshotRegistry 修复经验证正确。所有「理论有限实际可能无限」候选（processedSets、blacklists、histories）
经数量级论证均在可达范围内有界。
