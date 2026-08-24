# EMPIRE_ECONOMIC_HEALTH — 帝国经济健康度判定

> 日期：2026-08-24。阶段：A2 后半·步 5。
> 合同锚点：GOAL_POLICY_PLAN §4 五域预算、ECONOMY §3 三指标。
> 实现：`src/domain/strategy/economic-health.ts`。

## 1. 健康度枚举

| 状态 | 含义 | 条件 |
| --- | --- | --- |
| Critical | 生存危机 | hasStruggling || (netFlow<0 && riskBuffer<200) || 无房间 |
| Deficit | 整体入不敷出 | netFlow<0（无困难房） |
| Stable | 收支平衡但储备/自给不足 | netFlow≥0 但 riskBuffer<500 或 selfSufficiency<0.5 |
| Growing | 净流为正 + 有核心房 + 自给度达标 | netFlow>0 + core≥1 + selfSufficiency≥0.5 |
| Healthy | Growing 强化版 | core≥2 + selfSufficiency≥0.7 + riskBuffer≥1000 |

## 2. 判定逻辑（优先级从高到低）

1. Critical：有困难房 / 无房间 / 净流为负且风险缓冲极低
2. Deficit：净流为负但无困难房
3. Stable：净流非负但储备或自给度不足
4. Growing：净流为正 + 核心房 + 自给度达标
5. Healthy：Growing 强化版

## 3. 输出

```typescript
interface EconomicHealthResult {
  health: EmpireEconomicHealth;
  evidence: string;      // 人类可读证据链
  netFlow: number;
  totalProduction: number;
  hasStruggling: boolean;
  hasLiveThreat: boolean;
  hasImbalance: boolean;
}
```

## 4. 可解释性

每个判定结果携带 `evidence` 字符串，记录关键阈值/数值，供自治审计。
