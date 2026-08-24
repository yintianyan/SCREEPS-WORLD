# EMPIRE_PLANNER_INPUT — 帝国级规划输入汇总

> 日期：2026-08-24。阶段：A2 后半·步 10。
> 合同锚点：DATA_FLOW §2 决策流。
> 实现：`src/domain/strategy/planner-input.ts`。

## 1. 定位

本阶段最终交付物——把步 1–9 的全部产出汇总为一个 `EmpirePlannerInput`，
供下一阶段（A3 / Multi-Room Empire Execution）的 Planner 消费。

## 2. 链路

```
Room Economy
  ↓ buildRoomEconomicProfile (步 1)
Room Economic Profile
  ↓ buildEmpireResourceView (步 4)
Empire Resource View
  ↓ evaluateEconomicHealth (步 5)
Empire Economic Health
  ↓ detectImbalance (步 6)
Resource Imbalance
  ↓ evaluateExpansionReadiness (步 8)
Expansion Readiness
  ↓ buildEmpirePlannerInput (步 10)
Empire Planner Input  ← 最终产出
```

## 3. 接口

```typescript
interface EmpirePlannerInput {
  tick: number;
  profiles: readonly RoomEconomicProfile[];
  capacityProfiles: readonly RoomCapacityProfile[];
  resourceView: EmpireResourceView;
  health: EconomicHealthResult;
  imbalance: ResourceImbalanceResult;
  budget: EmpireBudget;
  readiness: ExpansionReadinessResult;
  safetyMargin: SafetyMarginResult;
  summary: string;  // 人类可读摘要
}
```

## 4. Observability

`formatEmpireSummary()` 生成帝国经济摘要：

```
Empire
---------------------
Rooms: 3
Energy: 80,100
Production: +29/tick
Net: +13.0/tick
Deficit Rooms: 1
Surplus Rooms: 2
Imbalance: YES
Budget: reserve=24030 survival=0 prod=...
Health: growing
Safety: 0.72
Expansion: READY
```

## 5. 系统侧薄壳

`empire-economy.ts`（System）每 100 tick 调用纯函数链 → 写入
`Memory.kernel.empireEconomy`（瘦快照）。不写 Room Memory。
