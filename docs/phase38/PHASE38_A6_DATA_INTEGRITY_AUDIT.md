# PHASE38 · A6 数据完整性审计（A6 Data Integrity Audit）

> 范围：任务书 §十二 —— A6.1–A6.6 数据契约矩阵；只验证、不修改（冻结契约完好）
> 每条数据标注 SOURCE / IDENTITY / TIME / REGIME / CONFIDENCE / RESOLUTION / ATTRIBUTION

## 1. 数据契约矩阵

### L1 DecisionTrace ring → experience-collector pending

| 维度 | 值 |
|---|---|
| SOURCE | decision-trace 8 类采集器（真实 runtime state） |
| IDENTITY | **事件级**：decisionId 全等匹配 + processedDecisionIds 去重 |
| TIME | ring cap 1000 / age-GC 2000t vs Set trim 5000——数量级论证 Set 永后逐出 → 无复活重扫 ✅ |
| 判定 | **GREEN** |

### L2 Outcome 七通道真实性

| 通道 | SOURCE | IDENTITY | 真实性判定 |
|---|---|---|---|
| war | warPlanCache.plan 单槽 | plan 槽位 | ⚠️ MEDIUM：双 war 交替时 B 的终态可被记到 A（500t 窗口） |
| recovery | recoveryStats.succeeded/failedCount | 无 delta 基线 | ❌ **HIGH：终身累计计数器**——每个决策继承帝国历史平均成功率（outcome.ts:187-220 ← recovery-lifecycle.ts:756-771，主审复核属实）→ **系统性假 Outcome（P1, A6-R）** |
| economic | empireHealth before/after score | context 快照 | ⚠️ MEDIUM：before 取自采集时刻（≤100t 后）；±0.05 迟滞噪声可跨 SUCCESS/FAILURE 阈 |
| logistics | logisticsHealth level | before **硬编码 "stable"**（:394） | ❌ **HIGH：降级期决策获幻影 PARTIAL_SUCCESS**（P1, A6-SL） |
| spawn | exp.context.metrics（队列深度） | BEFORE 值喂 AFTER 分类（:401-406） | ❌ **HIGH：决策时非空队列 → 恒 FAILURE，与后续无关**（P1, A6-SL） |
| defense | threat 字段从未填充 | — | ⚠️ 结构性死亡：全部 UNRESOLVED（静默数据缺口，P3） |
| expansion | lastExpansionOutcome(decisionId) | **事件级严格相等** | ⚠️ 匹配机制 GREEN；上游写入端缺陷见 EXP-1/2/3（提前 SUCCESS/reset 重建/单槽丢失） |

### L3 Experience → Attribution

- 归因重读**当前** empireHealth/recoveryStats/logisticsHealth 而非 outcome 时刻快照 → 迟到归因漂移（MEDIUM-LOW）。
- computeAttributionConfidence（attribution.ts:875）零调用 = 死代码；置信度衰减设计未接线（CONF-1/P2）。

### L4 Prediction → Resolution

- **无未来泄漏**：观测过滤严格 [startTick,endTick]（:219,:234）；resolve 闸 endTick+100≤tick（ring-buffer:178）✅（CF-LONG-11 固化测量延迟语义）
- 缺陷：采样时间戳反推假设均匀节奏（CAL-1a）；regime 一票否决的结构性损失（CAL-1b）；cap 200 静默驱逐未到期预测。

### L5 Recommendation confidence ≤ min(evidence confidence)

**VERIFIED**：generator.ts:54-87 起点即 trace.minConfidence，仅 ×0.7/×0.5 衰减因子 + :83 硬 clamp
`Math.min(confidence, trace.minConfidence)`——单调性成立。但绝对值依赖 evidence-builder 手选常数
（computeOutcomeConfidence 导入未用），「单调不虚高」成立、「数值可信」存疑。

### L6 Shadow-Only / 无执行消费者（本轮复验）

grep `__recommendationCache/__calibrationCache/__predictionCache/__experienceCache/__evaluationCache`
全库：读写全部限定于 src/systems/intelligence/*；bootstrap 注册注释即唯一外部引用。
六个系统零 Game API 变更调用（spawnCreep 等字符串仅出现于 guards 白名单用于违规检测）。
**冻结契约完好，无新 Decision Authority。GREEN。**

## 2. 综合判定

| 链路 | 判定 |
|---|---|
| L1 决策摄取 | GREEN |
| L2 Outcome 真实性 | **RED**（recovery/logistics/spawn 三通道系统性失真；expansion 上游写入端 P0） |
| L3 Attribution | YELLOW（回溯污染+死代码） |
| L4 Prediction/Resolution | YELLOW（无泄漏✅，损失型缺陷×3） |
| L5 Confidence 单调性 | GREEN（机制）/ YELLOW（绝对值） |
| L6 边界隔离 | GREEN |

**A6 数据总体不可信（在 §2 RED/YELLOW 缺陷修复前）。冻结正确，解冻条件 = 主册 §2 BLOCKER 清零。**

## 3. 修复优先序建议（供下一阶段，不在本阶段实施）

1. Outcome 写入端事件化（EXP 组根修，覆盖 expansion/war 两通道的单槽问题）。
2. recovery 改 delta-since-decisionTick 基线；logistics/spawn 补 BEFORE/AFTER 双快照。
3. defense 通道要么接通 threatAssessments 输入要么显式下线。
4. 接线 computeOutcomeConfidence 或删除，消除「看起来有校准实际没有」的假象。
