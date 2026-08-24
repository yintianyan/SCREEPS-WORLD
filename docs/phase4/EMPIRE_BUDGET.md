# EMPIRE_BUDGET — 帝国经济预算分配

> 日期：2026-08-24。阶段：A2 后半·步 7。
> 合同锚点：GOAL_POLICY_PLAN §4 五域预算、ECONOMY §2.1-7 Reservation。
> 实现：`src/domain/strategy/budget.ts`。

## 1. 预算域

| 域 | 含义 | 分配规则 |
| --- | --- | --- |
| Reserve | 战略储备（不可触碰） | totalEnergy × (emergencyRatio + coreRatio) |
| Survival | 困难房援助 + 紧急孵化 | 有 struggling 时 = available × survivalExtraRatio |
| Production | 维持日常生产消费 | remaining × productionRatio |
| Infrastructure | 基建投资 | remaining × infrastructureRatio |
| Expansion | 扩张储备 | health ≥ stable 时 = totalEnergy × expansionRatio |
| Free | 预算外浮动 | remaining - production - infrastructure |

## 2. Reserve Policy

| 健康度 | Reserve 占比 | 说明 |
| --- | --- | --- |
| Critical/Deficit | emergency only (20%) | 收紧保守层 |
| Stable/Growing/Healthy | emergency + core (30%) | 正常保守层 |

## 3. 扩张保护

- Critical/Deficit 时 expansion = 0（不扩张）
- Expansion 不超过 available - survival（不抽干生存预算）
- Expansion 不得把 Core Room 经济抽干（ECONOMY §6 红线 1）

## 4. 接口

```typescript
interface EmpireBudget {
  tick: number;
  totalEnergy: number;
  reserve: number;
  survival: number;
  production: number;
  infrastructure: number;
  expansion: number;
  free: number;
  reserveRatio: number;
  expansionAvailableRatio: number;
}
```

## 5. 预算一致性

各域之和 ≤ totalEnergy（下取整保证不超支）。
