# ROOM_ECONOMIC_PROFILE — Room Economic Contract 接口定义

> 日期：2026-08-24。阶段：A2 后半·步 1。
> 合同锚点：EMPIRE_SYSTEM_MODEL §1 Room 接口、ECONOMY §2 九概念 + §3 三指标、
> STATE_OWNERSHIP §3.5–§3.6、DEP_GRAPH §3-5（domain 纯函数禁 Game/Memory）。
> 实现：`src/domain/economy/room-profile.ts` + `tests/unit/economy/room-profile.test.ts`。

## 1. 设计意图

当前 Empire 层（`empire-strategy.ts`）直接遍历 `Memory.rooms[r]` 字段拼凑
`RoomStrategyInput`——这是蓝图允许的（DATA_FLOW §1），但缺少一个显式的
**Room Economic Contract**：Room 向 Empire 暴露的标准化、类型安全的只读接口。

本模块把分散的三个数据源组装为一个标准化 Read Model：

| 数据源 | 来源 | 更新频率 |
| --- | --- | --- |
| RoomSnapshot | kernel 每 tick 重建 | 每 tick |
| RoomMemory | room-state (P0) + economy (P1/50t) 写入 | 每 tick / 每 50 tick |
| EconomyQuery | economy.ts 的 queryEconomy() 公开接口 | 每 50 tick |

## 2. 接口定义

### 2.1 RoomEconomicProfile

```typescript
interface RoomEconomicProfile {
  // ── 基础设施状态 ──
  roomName: string;
  rcl: number;
  hasSpawn: boolean;
  hasStorage: boolean;
  hasTerminal: boolean;

  // ── Economy 三指标（ECONOMY §3）──
  netFlow: number;           // 净流 EMA（能量/tick，可负）
  contractReserve: number;   // 合同储备（storage+terminal+link 水位）
  riskBuffer: number;        // 风险缓冲（断供耐受 tick 数）
  estimatedIncome: number;   // 估计收入（产能×效率系数）
  efficiency: number;         // 效率系数（0..1）
  drift: number;              // 最近一窗 drift
  economyTick: number;        // 最近核算 tick

  // ── 储备与可用量（ECONOMY §2.1）──
  storageEnergy: number;
  storageCapacity: number;
  storageRatio: number;       // 0..1
  energyAvailable: number;
  energyCapacityAvailable: number;
  storageNearFull: boolean;
  sourceCount: number;

  // ── 殖民相位 ──
  colonyPhase: ColonyPhase;
  colonyState: ColonyState;
  economyPressure: number;   // 0.0–1.0
  lastHostileAt: number | undefined;
  hasLiveThreat: boolean;
  controllerDowngradeRisk: boolean;
  claimSecure: boolean;

  // ── 派生判定 ──
  economicClass: RoomEconomicClass;
  netFlowPositive: boolean;
  selfSufficiency: number;   // 0..1
  isStruggling: boolean;
}
```

### 2.2 RoomEconomicClass

| 分类 | 条件 | Empire 角色定位 |
| --- | --- | --- |
| `core` | RCL≥6 + storage + colonyState=normal | 帝国基座，可承担调拨源/代孵/sponsor |
| `production` | RCL4-5 + storage + colonyState=normal | 自立但无余力对外输出 |
| `candidate` | RCL<4 或无 storage | 需关注/扶植，无对外输出能力 |
| `struggling` | colonyState ∈ bootstrap/recovery/defense | 净消耗者，需支援或至少不被抽离 |

### 2.3 调拨门控谓词

| 函数 | 用途 | 合同锚点 |
| --- | --- | --- |
| `canExportEnergy(profile)` | 判定房间是否具备对外输出能力 | ECONOMY §1.2 调拨门控前置 |
| `needsEnergyAid(profile)` | 判定房间是否需要外部能量援助 | ECONOMY §1.2 受援侧 |

**canExportEnergy 前置**：非困难态 + 有 storage + 净流为正 + storageRatio≥0.3
**needsEnergyAid 前置**：困难态 OR (净流负 + riskBuffer<400) OR (storageRatio<0.1 + income<5)

## 3. 纯函数清单

| 函数 | 签名 | 合同 |
| --- | --- | --- |
| `classifyRoomEconomic` | (rcl, hasStorage, colonyState) → RoomEconomicClass | EMPIRE_SYSTEM_MODEL §1 Room |
| `computeSelfSufficiency` | (netFlow, estimatedIncome) → number(0..1) | ECONOMY §2.1 |
| `buildRoomEconomicProfile` | (snapshot, roomMem, economy, tick) → RoomEconomicProfile | EMPIRE_SYSTEM_MODEL §1 Room Report |
| `canExportEnergy` | (profile) → boolean | ECONOMY §1.2 |
| `needsEnergyAid` | (profile) → boolean | ECONOMY §1.2 |

## 4. 架构边界验证

| 边界 | 验证 |
| --- | --- |
| domain 不引用 systems | ✅ EconomyQueryInput 在 domain 层定义，结构兼容 EconomyQuery |
| domain 不引用 Game/Memory | ✅ 合规测试 R1 第三条通过 |
| kernel 导入仅 type-only | ✅ `import type { RoomSnapshot, ColonyState }` |
| 不写任何状态 | ✅ 全部纯函数，只读组装 |

## 5. 测试覆盖

| 测试 ID | 场景 | 数量 |
| --- | --- | --- |
| A2B-001 | classifyRoomEconomic 四分类边界 | 4 |
| A2B-001 | computeSelfSufficiency 边界 | 4 |
| A2B-001 | buildRoomEconomicProfile 完整组装 | 6 |
| A2B-001 | canExportEnergy 门控 | 6 |
| A2B-001 | needsEnergyAid 门控 | 6 |
| **合计** | | **26** |

## 6. 质量门槛

| 门槛 | 结果 |
| --- | --- |
| `npm run typecheck` | ✅ 通过 |
| `npm test`（2665 项） | ✅ 全绿 |
| `npm run build` | ✅ 通过 |
| 架构合规测试 | ✅ 8/8 通过 |
