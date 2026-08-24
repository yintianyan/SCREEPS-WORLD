# RESOURCE_IMBALANCE_MODEL — 跨房资源余缺检测

> 日期：2026-08-24。阶段：A2 后半·步 6。
> 合同锚点：ECONOMY §1.2 调拨门控。
> 实现：`src/domain/strategy/imbalance.ts`。

## 1. 定位

Empire 每个周期从 `EmpireResourceView` + 各房 `RoomEconomicProfile` 中
发现 surplus 房与 deficit 房，生成 `TransferCandidate` 列表。
**只检测，不执行调拨**（A2 后半红线）。

## 2. 检测逻辑

### 2.1 Surplus 计算

```typescript
function computeSurplus(profile, exportRatio = 0.3): number
```
- 门控前置：`canExportEnergy(profile) = true`
- surplus = `storageEnergy × exportRatio`（保守估值，不抽干）

### 2.2 Deficit 计算

```typescript
function computeDeficit(profile): number
```
- 门控前置：`needsEnergyAid(profile) = true`
- 有产能：`|netFlow| × 200`（预计 200 tick 缺口），clamp [1000, 5000]
- 无产能：固定 2000

### 2.3 匹配算法

贪心匹配：
1. deficit 房按缺口量降序排列
2. surplus 房按余量降序排列
3. 每个 deficit 房匹配一个 surplus 房（不做多源合并）
4. amount = min(surplus, deficit)

## 3. 输出

```typescript
interface ResourceImbalanceResult {
  tick: number;
  hasImbalance: boolean;
  candidates: TransferCandidate[];
  surplusCount: number;
  deficitCount: number;
}
```

## 4. 严格禁止

- ❌ 不执行跨房运输
- ❌ 不下 terminal 订单
- ❌ 不绕过 Request Pool
- ✅ 只产出 TransferCandidate 候选列表
