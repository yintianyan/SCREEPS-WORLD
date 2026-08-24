# EMPIRE_RESOURCE_VIEW — Empire 级资源聚合视图

> 日期：2026-08-24。阶段：A2 后半·步 4。
> 合同锚点：EMPIRE_SYSTEM_MODEL §1 Empire、STATE_OWNERSHIP §3.1 EmpireSituation。
> 实现：`src/domain/strategy/resource-view.ts` + `tests/unit/economy/capacity-profile.test.ts`。

## 1. 定位

Empire Resource View 是 **Read Model**——把各房 `RoomEconomicProfile` 聚合为
帝国级只读视图。不写 Room Memory、不控制 Creep、不绕过 Request Pool
（ECONOMY §6 红线 1/4，DECISION_AUTHORITY §1）。

## 2. 接口定义

```typescript
interface EmpireResourceView {
  tick: number;
  roomCount: number;
  // ── 总量指标 ──
  totalEnergy: number;       // Σ storageEnergy
  totalProduction: number;   // Σ estimatedIncome
  totalNetFlow: number;       // Σ netFlow（可负）
  totalReserve: number;      // Σ contractReserve
  minRiskBuffer: number;     // min riskBuffer（短板效应）
  avgEfficiency: number;     // 平均效率系数
  // ── 分类统计 ──
  coreRooms: number;
  productionRooms: number;
  candidateRooms: number;
  strugglingRooms: number;
  // ── Imbalance 信号 ──
  surplusRooms: string[];    // canExportEnergy=true
  deficitRooms: string[];    // needsEnergyAid=true
  hasImbalance: boolean;
  // ── 风险信号 ──
  hasStruggling: boolean;
  maxPressure: number;
  hasLiveThreat: boolean;
  // ── 派生 ──
  empireNetFlowPositive: boolean;
  empireSelfSufficiency: number;  // 0..1
}
```

## 3. 聚合规则

| 指标 | 规则 | 依据 |
| --- | --- | --- |
| totalEnergy | Σ 各房 storageEnergy | ECONOMY §2 Storage |
| totalProduction | Σ 各房 estimatedIncome | ECONOMY §2.1 Income |
| totalNetFlow | Σ 各房 netFlow EMA | ECONOMY §3 净流 |
| minRiskBuffer | min 各房 riskBuffer（短板效应） | ECONOMY §3 风险缓冲 |
| surplusRooms | canExportEnergy=true 的房 | ECONOMY §1.2 门控前置 |
| deficitRooms | needsEnergyAid=true 的房 | ECONOMY §1.2 受援侧 |
| empireSelfSufficiency | clamp(1 - |totalNetFlow|/totalProduction) | 帝国收支平衡度 |

## 4. 空数组安全

无房间时所有总量为 0，surplus/deficit 为空数组，health 回退为 Critical。

## 5. 消费方

| 消费方 | 用途 |
| --- | --- |
| `evaluateEconomicHealth()` | 健康度判定输入 |
| `detectImbalance()` | surplus/deficit 检测 |
| `allocateEmpireBudget()` | 预算分配基数 |
| `evaluateExpansionReadiness()` | 扩张门控输入 |
| `evaluateSafetyMargin()` | 安全边际计算 |
