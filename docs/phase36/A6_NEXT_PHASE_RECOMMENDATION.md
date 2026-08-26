# A6 Next Phase Recommendation

> **阶段**: A6 Longitudinal Effectiveness Research
> **日期**: 2026-08-26
> **约束**: 纯研究，不写实现代码

---

## 一、最终裁决

### 裁决: **FREEZE**

A6.1–A6.6 全部保持 FROZEN。不进入 A6.7 Implementation。

---

## 二、裁决依据

### 2.1 A6 是否已经具备长期验证能力？

**否。**

当前 A6 具备的验证能力：

| 能力 | 状态 | 描述 |
|------|------|------|
| In-sample ECE | ✅ 已实现 | `computeECE()` |
| In-sample Brier Score | ✅ 已实现 | `computeBrierScore()` |
| Per-bucket calibration | ✅ 已实现 | `computeConfidenceBuckets()` |
| Drift detection | ✅ 已实现 | `detectCalibrationDrift()` |
| Regime compatibility check | ✅ 已实现 | `checkRegimeCompatibility()` |
| Sample sufficiency check | ✅ 已实现 | `MIN_SAMPLES_PER_BUCKET` 等 |
| Out-of-sample validation | ❌ 未实现 | 没有 train/test split |
| Temporal holdout | ⚠️ 部分实现 | 有 grace period 和窗口过滤，但 tick 关联不精确 |
| Recommendation outcome tracking | ❌ 未实现 | 没有跟踪推荐产生后的实际结果 |
| Regime-specific accuracy | ⚠️ 部分实现 | 有 regime sample count，没有独立 accuracy 输出 |
| Reliability discrimination | ❌ 未实现 | 没有 HIGH vs LOW reliability 的 accuracy 对比 |
| Evaluation future correlation | ❌ 未实现 | 没有 Evaluation → 未来 empireHealth 的相关性 |

### 2.2 缺什么？

**核心缺口**:

1. **Out-of-Sample 验证机制** — 当前所有统计都是 in-sample，无法判定模型泛化能力
2. **Temporal Holdout 严格隔离** — `__reserveHistory` 缺乏精确 tick 关联，存在 temporal leakage 风险
3. **Recommendation 结果跟踪** — 推荐产生后没有跟踪实际结果，无法判定 predictive value
4. **Regime-Specific Accuracy 独立输出** — 全局 ECE 可能掩盖 Regime-specific 的问题
5. **Survivorship Bias 修正** — 只统计"好情况"的 Resolution，可能高估模型表现

**非核心缺口**（可以等数据积累后再处理）:

6. Reliability discrimination 验证（需要足够样本）
7. Evaluation future performance correlation（需要长期数据）
8. Attribution accuracy 验证（需要独立判断标准）

### 2.3 是否需要新的 A6.7？

**不需要。**

原因：

1. **当前 A6 的架构是健全的** — Shadow-Only、无执行路径、无自证循环、无循环依赖。所有缺口都是"验证能力"缺口，不是"架构缺陷"。

2. **缺口需要的是数据积累，不是新代码** — Out-of-sample validation、regime-specific accuracy 等需要长期运行数据才能计算。当前系统刚上线，连 in-sample ECE 的 200 样本门槛都还没有达到。

3. **强行实施 A6.7 的边际价值有限** — 如果现在实施 out-of-sample validation 机制，但没有足够的数据来计算，这个机制只是空转。不如等数据积累到一定程度后再评估。

4. **已知风险不影响安全运行** — A6 完全停止帝国也照常运行。当前的 in-sample bias 和 temporal leakage 风险只影响 Shadow 数据的准确性，不影响帝国安全。

### 2.4 还是应该继续 FREEZE A6？

**是的，继续 FREEZE。**

理由：

1. **A6.1–A6.6 的 frozen contract 不需要修改** — 所有缺口都可以通过新增独立验证系统解决，不需要修改现有 frozen contract
2. **数据积累优先** — 当前最需要的是长期运行来积累足够样本（至少 2-3 周），而不是新代码
3. **避免过度工程** — A6 已经有 6 个子系统（A6.1-A6.6），继续增加新子系统的复杂度收益递减

---

## 三、最终判断回答

### A. A6 是否已经具备长期验证能力？

**否。** 具备基础验证能力（in-sample ECE/Brier Score/drift detection），但不具备长期验证能力（out-of-sample validation, recommendation outcome tracking, regime-specific accuracy）。

### B. 如果没有，缺什么？

1. Out-of-Sample 验证机制（train/test split）
2. Temporal Holdout 严格隔离（精确 tick 关联）
3. Recommendation 结果跟踪
4. Regime-Specific Accuracy 独立输出
5. Survivorship Bias 修正（Coverage Metric）

### C. 是否需要新的 A6.7？

**不需要。** 当前架构健全，缺口是验证能力缺口，不是架构缺陷。这些缺口可以等数据积累后通过独立验证系统解决。

### D. 如果需要，A6.7 应该是什么？

**不适用**（不需要新的 A6.7）。如果未来数据积累到足够量（200+ calibratable resolutions per model），可以考虑实施独立的 **Intelligence Effectiveness Validator**（影子系统，只读消费 A6 缓存数据，产出 effectiveness metrics）。但这是未来决策，不是当前决策。

### E. 还是应该继续 FREEZE A6？

**是的，继续 FREEZE。** 数据积累优先于验证能力建设。

### F. 目前最大的 Intelligence 风险是什么？

**In-sample bias。** 当前所有统计都是 in-sample 的——ECE、Brier Score、drift detection 都基于全部 Resolution。没有 holdout 验证意味着 ECE 可能低估真实校准误差。如果未来 Recommendation 被消费，消费方可能被"看起来很好"的 ECE 误导。

### G. 目前最大的 Prediction 风险是什么？

**泛化能力未知。** `computeDirectionCorrect()` 使用相对误差 < 50% 作为方向正确的代理——这不是真正的方向预测。线性回归的 R² 是 in-sample 拟合度，不保证泛化。没有 out-of-sample accuracy，无法判定 Prediction 是否真正有效。

### H. 目前最大的 Calibration 风险是什么？

**Temporal leakage。** `buildObservations()` 从 `globalCache.__reserveHistory` 读取数据——这个数组作为 `number[]` 存储，缺乏精确的 tick 关联。`baseTick = endTick - (len - 1) * 100` 的反推方式在数组长度变化时可能偏移，导致错误的 tick 关联。

### I. 目前最大的 Reliability 风险是什么？

**无前瞻性验证。** Reliability 的 assessment（drift detection, sample sufficiency, regime fit）全部基于 in-sample 统计。没有验证"HIGH reliability 是否真的比 LOW reliability 更准确"——Reliability 的 assessment 可能与实际表现不一致。

### J. Recommendation 是否真的具有长期价值？

**当前无法判定。** Recommendation 有完善的 lifecycle 管理（TTL, supersede, conflict detection）和 confidence propagation（min evidence confidence 硬约束），但没有结果跟踪——推荐产生后没有跟踪实际结果，无法判定 predictive value。

但从架构角度看，Recommendation 的设计是健全的：
- Evidence chain 完整可追溯
- Confidence propagation 有硬约束
- Shadow-Only 和 autoApply=false 是编译器强制的
- TTL 防止 stale recommendation

**如果未来建立了结果跟踪机制并能验证 predictive value，Recommendation 将具有长期价值。**

---

## 四、建议行动

### 4.1 立即行动

| 行动 | 描述 | 优先级 |
|------|------|--------|
| FREEZE A6.1–A6.6 | 保持所有 frozen contract 不变 | P0 |
| 长期运行 | 让 A6 在 live 环境中持续运行，积累数据 | P0 |
| 监控 | 定期检查 `calibrationBufferStats()` 输出，确认数据在积累 | P1 |

### 4.2 中期行动（数据积累到 200+ calibratable 后）

| 行动 | 描述 | 优先级 |
|------|------|--------|
| 评估 ECE | 当 calibratableCount ≥ 200 时，检查 in-sample ECE 是否合理 | P1 |
| 评估 drift | 当有足够 recent + overall Resolution 时，检查 drift detection 是否触发 | P2 |
| 评估 coverage | 检查 calibratable / total ratio，判断 survivorship bias 程度 | P2 |

### 4.3 长期行动（数据积累到足够后）

| 行动 | 描述 | 优先级 |
|------|------|--------|
| 评估 out-of-sample | 当有足够数据时，实施 train/test split 评估泛化能力 | P3 |
| 评估 regime-specific | 当有足够 per-regime 样本时，评估 regime-specific accuracy | P3 |
| 评估 recommendation value | 当有足够 recommendation 历史时，评估 predictive value | P3 |

---

## 五、已知技术债登记

| ID | 描述 | 严重性 | 状态 |
|----|------|--------|------|
| TD-A6-001 | `__reserveHistory` 缺乏精确 tick 关联（temporal leakage 风险） | 中等 | 已知，待数据积累后评估 |
| TD-A6-002 | In-sample ECE bias（没有 train/test split） | 中等 | 已知，待数据积累后评估 |
| TD-A6-003 | `computeDirectionCorrect()` 使用误差代理而非真方向预测 | 低 | 已知，不影响安全运行 |
| TD-A6-004 | Attribution confidence 是规则赋值，非历史校准 | 低 | 已知，不影响安全运行 |
| TD-A6-005 | 没有 Recommendation 结果跟踪 | 低 | 已知，Shadow-Only 下不影响安全运行 |

---

## 六、总结

A6 Intelligence 架构在**结构性隔离**方面是健全的——Shadow-Only、无执行路径、无自证循环、无循环依赖、confidence propagation 有硬约束。

当前的主要缺口是**长期有效性验证能力**——没有 out-of-sample validation、没有 recommendation outcome tracking、没有 regime-specific accuracy。但这些缺口**不影响当前帝国的安全运行**，且**需要数据积累才能解决**。

**最终裁决: FREEZE A6.1–A6.6。进入长期运行和数据积累阶段。不实施 A6.7。**

如果未来数据积累到足够量（200+ calibratable per model, 30+ per regime, 50+ recommendations），再评估是否需要实施独立验证系统。
