# A6.2 — Baseline Design

> **阶段**: A6.2 Strategy Evaluation & Baseline
> **日期**: 2026-08-26
> **状态**: 已实现

---

## 一、三类 Baseline

| 类型 | 来源 | 可用性 | 说明 |
|------|------|--------|------|
| **CONFIG BASELINE** | 静态配置值 | 始终可用 | 从 EmpireHealth Hysteresis 阈值推导 |
| **HISTORICAL BASELINE** | Experience Ring Buffer | 有足够历史时 | mean + median + variance + outlier(IQR) |
| **COMMUNITY BASELINE** | 社区平均值 | **UNAVAILABLE** | 无可靠数据，不伪造 |

### 1.1 为什么不伪造 Community Baseline

Screeps 社区没有公开的标准 benchmark 数据集。不同玩家、不同 shard、不同阶段的策略效果差异极大。伪造"社区平均值"会引入虚假比较基准，导致 Evaluation 输出误导性结论。

当前标注为 `UNAVAILABLE`，不使用。

---

## 二、CONFIG Baseline Values

| 维度 | 基准值 | 来源 |
|------|--------|------|
| economicGrowth | 0.70 | EmpireHealth recoverToStable 阈值 |
| resourceEfficiency | 0.75 | logistics deliveryRate 目标 0.9 保守 |
| cpuEfficiency | 0.75 | CpuTier healthy/guarded 正常水平 |
| riskLevel | 0.75 | develop 姿态 threatHealth=stable |
| survival | 0.70 | EmpireHealth enterDegraded 阈值 |
| expansion | 0.50 | 扩张成功率 50% 社区公认 |
| militaryOutcome | 0.50 | 胜率 50% 中性期望 |
| recoveryCost | 0.75 | 恢复成功率 75% 健康水平 |

---

## 三、BaselineKey — 绑定 Strategy Identity

```typescript
interface BaselineKey {
  strategyId: string;      // 策略类型
  phase: string;            // 帝国阶段
  contextSignature: string; // RCL range + room count range + threat level
}
```

### 3.1 Context Signature 编码

```
rclRange: early(1-3) / mid(4-6) / late(7-8)
roomRange: single(1) / small(2-3) / medium(4-6) / large(7+)
threatLevel: low / medium / high / critical
```

**不同 RCL/规模/威胁下的 baseline 不可混合。**

---

## 四、统计稳健性

不只用 `average(history)`，同时计算：

| 指标 | 方法 | 说明 |
|------|------|------|
| mean | 算术平均 | 基础统计 |
| median | 中位数 | 抗异常值 |
| variance | 方差 | 衡量离散度 |
| outlier | IQR 方法 (1.5×IQR) | 剔除极端值 |
| confidence | 加权综合 | 样本数 + 方差 + 时间新鲜度 |

---

## 五、公平性验证

### 5.1 Context Compatibility Check

比较前检查：
- RCL range
- Empire size (room count range)
- Threat level
- War posture
- Resource context

不匹配 → `baseline = INCOMPARABLE`，硬比较被拒绝。

### 5.2 Regime Mismatch Detection

检测历史基准的上下文与当前上下文是否匹配：

```
RCL range mismatch → rcl_range
Room count range mismatch → room_count
Threat level mismatch → threat_level
Posture mismatch → posture
Resource context mismatch → resource_context
```

不匹配数越多 → severity 越高 → confidence 越低。

---

## 六、样本充足性

| 维度 | 最低样本数 | 理由 |
|------|-----------|------|
| economicGrowth | 5 | 多系统耦合，需更多样本 |
| resourceEfficiency | 5 | 物流波动大 |
| cpuEfficiency | 10 | CPU 受 tick 负载影响 |
| riskLevel | 3 | 威胁变化快 |
| survival | 3 | 变化慢 |
| expansion | 2 | 事件低频 |
| militaryOutcome | 3 | 事件低频但重要 |
| recoveryCost | 3 | 事件中频 |

样本不足 → `INCONCLUSIVE`，不强行 BETTER/WORSE。

---

## 七、Baseline 构建

```
if history.length >= minSamples:
    → HISTORICAL baseline (mean + median + variance + outlier removal)
elif history.length > 0:
    → CONFIG baseline with reduced confidence
else:
    → CONFIG baseline with low confidence (0.3)
```

---

## 八、时间窗口

| 类型 | 范围 | 状态 |
|------|------|------|
| short_term | ~500 tick | ✅ implemented |
| medium_term | ~2000 tick | deferred (A6.3+) |
| long_term | ~10000 tick | deferred (A6.3+) |

Evaluation Window 必须是显式对象（`startTick`, `endTick`, `duration`, `type`），禁止 `currentTick - arbitrary history`。

---

## 九、短期 vs 长期冲突

如果 short-term = improving 但 long-term = degrading → 输出 `CONFLICTING_TREND`，不掩盖时间维度。
