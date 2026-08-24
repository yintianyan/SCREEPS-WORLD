# ECONOMIC_SAFETY_MARGIN — 经济安全边际联动模型

> 日期：2026-08-24。阶段：A2 后半·步 9。
> 合同锚点：ECONOMY §3 riskBuffer、GOAL_POLICY_PLAN §4、EXPANSION §2 G1–G5。
> 实现：`src/domain/strategy/safety-margin.ts`。

## 1. 设计意图

防止「库存高但产能低」的假富裕误判。不只看库存——
storage 很高但 production 很低 / population 很低 / critical requests 很多时，
Expansion Readiness 必须下降。

## 2. 五维子分数

| 维度 | 满分条件 | 零分条件 | 权重 |
| --- | --- | --- | --- |
| Production Safety | netFlow ≥ 10/tick | netFlow ≤ 0 | 0.30 |
| Reserve Safety | riskBuffer ≥ 1000 | riskBuffer ≤ 200 | 0.20 |
| Health Safety | 无困难房 + 无活威胁 | 有困难房 | 0.25 |
| Self-Sufficiency Safety | selfSufficiency ≥ 0.7 | selfSufficiency = 0 | 0.15 |
| Population Safety | struggling=0 | struggling=roomCount | 0.10 |

## 3. 综合分数

```
score = Σ(子分数 × 权重)
```

范围 [0, 1]，越高越安全。

## 4. 假富裕防护

| 场景 | 库存 | 产能 | 结果 |
| --- | --- | --- | --- |
| 正常健康 | 50000 | +10/tick | score > 0.5 |
| 假富裕 | 100000 | -2/tick | score < 0.5 |

## 5. 消费方

- `Expansion Readiness`：safety score 作为扩张门控的辅助信号
- `Empire Planner Input`：safety score 记入汇总
