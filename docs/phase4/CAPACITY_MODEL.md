# CAPACITY_MODEL — Room 产能容量剖面

> 日期：2026-08-24。阶段：A2 后半·步 3。
> 合同锚点：ECONOMY §2.1 Income、§2.3 能量预算公式、GOAL_POLICY_PLAN §4 五域预算。
> 实现：`src/domain/economy/capacity-profile.ts`。

## 1. 五域容量

| 域 | 定义 | 来源 |
| --- | --- | --- |
| Energy Production | source 数 × 名义产能(10/tick) × 效率系数 | `accounting.ts estimateIncome()` |
| Energy Storage | storage + terminal + link 总容量 | snapshot 结构 |
| Spawn Capacity | spawn + extension 总容量 | `snapshot.energyCapacityAvailable` |
| Logistics Capacity | hauler 编制 × 参考运力 / 50（近似吞吐） | `CONFIG.economy.referenceCarryCapacity` |
| Construction Capacity | builder 编制 × 50（近似吞吐） | 近似 |

## 2. 瓶颈判定

五域中利用率最高者即为瓶颈：

| 瓶颈 | 条件 |
| --- | --- |
| production | efficiency < 0.5 |
| storage | reserveUtilization > 0.9 |
| spawn | spawnUtilization < 0.2 |
| logistics | logisticsThroughput < effectiveCapacity |
| construction | constructionThroughput < effectiveCapacity |
| none | 无明显瓶颈 |

## 3. 接口

```typescript
interface RoomCapacityProfile {
  roomName: string;
  sourceCount: number;
  nominalCapacity: number;
  efficiency: number;
  effectiveCapacity: number;
  utilization: number;
  storageCapacity: number;
  terminalCapacity: number;
  linkCapacity: number;
  totalReserveCapacity: number;
  reserveUtilization: number;
  spawnCapacity: number;
  spawnUtilization: number;
  spawnCount: number;
  haulerCount: number;
  referenceCarry: number;
  logisticsThroughput: number;
  builderCount: number;
  constructionThroughput: number;
  bottleneck: "production" | "storage" | "spawn" | "logistics" | "construction" | "none";
}
```

## 4. 与 RoomEconomicProfile 的关系

- `RoomEconomicProfile` 侧重组算（收支/储备/风险）
- `RoomCapacityProfile` 侧重产能（上限/利用率/瓶颈）
- 两者互补，共同构成 Room 向 Empire 暴露的完整经济剖面
