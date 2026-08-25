# A5.2 Pre-Implementation Audit

## 审计目标

追踪真实调用链，确认 A5.2 改动范围和边界。**禁止根据文件名猜功能。**

## 1. 调用链追踪

### 1.1 Threat Assessment 链路（A5.1 已建立）

```
room-state.ts (P0, 每 tick)
  → buildThreatAssessment() (系统层薄壳, room-state.ts 内部函数)
    → HostileSnapshot 转换 (Creep → 纯数据)
    → RoomContext 构建 (从 RoomSnapshot 提取)
    → DefenseContext 构建
    → assessThreat() (domain/defense/threat-assessment.ts 纯函数)
      → analyzeHostileBody() → evaluateCombatCapability() (G2)
      → aggregateCombatCapability()
      → computeCombatPower()
      → inferThreatIntent()
      → computeThreatScore()
      → scoreToLevel()
      → levelToPosture()
    → 写入 globalCache.threatAssessments (Map<roomName, ThreatAssessment>)
```

**关键发现**：
- `assessThreat()` 接受 `ThreatAssessmentInput`，其中 `playerIntel` 和 `remoteContext` 为可选参数
- 当前 `buildThreatAssessment()` **不传 playerIntel**（注释标记 A5.2 扩展点）
- `computeCombatPower()` 的 `FormationContext.terrain` 硬编码为 `"plain"`
- `ThreatConfidence` 只有 4 档：`"fact" | "stale" | "inferred" | "unknown"` — 需扩展为多维度 Confidence

### 1.2 Tower Defense 链路

```
tower-defense.ts (P0, 每 tick)
  → 消费 globalCache.threatAssessments (只读 estimatedIntent.intent)
  → selectFocusTarget() → selectTowerTarget() (domain/defense/tower-target.ts)
  → assessEngagement() (domain/defense/tower-engagement.ts)
  → SIEGE override: 检查 threatAssessment?.estimatedIntent.intent === "SIEGE"
```

**关键发现**：
- tower-defense 只消费 `estimatedIntent.intent`，不消费 TerrainContext
- TerrainContext 集成点：`selectFocusTarget` 的目标优先级 + `assessEngagement` 的暴露估计

### 1.3 Remote Defense 链路

```
remote-mining-manager.ts (P2, interval 10)
  → buildRemoteThreatAssessment() (系统层薄壳, 调用 assessThreat())
  → decideRemoteDefenseAction() (domain/defense/remote-defense.ts 纯函数)
    → evaluateRemoteExpectedValue()
    → 输出 CONTINUE / PAUSE / ESCORT / RETREAT / ABORT
  → 写入 globalCache.remoteDefenseDecisions
```

**关键发现**：
- `RemoteDefenseInput` 不包含 TerrainContext — 需新增
- `decideRemoteDefenseAction` 的撤退安全性判定 `canRetreatSafely = pathCost <= 3` 过于粗粒度
- TerrainContext 集成点：retreatQuality → 撤退决策、escortRisk → 护航风险评估

### 1.4 Decision Trace 链路

```
decision-trace-system.ts (P3, interval 100)
  → collectDefenseDecisions()
    → 消费 globalCache.threatAssessments
    → 消费 globalCache.remoteDefenseDecisions
    → 构建 DecisionRecord (含 DecisionEvidence)
```

**关键发现**：
- `DecisionEvidence` 有 `threat` 字段但无 `terrain` 和 `intel` 字段 — 需扩展
- DecisionEvidence 是 `readonly` 接口，新增字段是兼容的（可选属性）

### 1.5 PlayerIntel 现状

```
threat-assessment.ts:
  PlayerIntelSummary {
    username: string
    threatIndex: number  // 0-100 单一数字
    blacklist: boolean
    lastActiveRoom?: string
    nemesisDistance?: number
  }
```

**关键发现**：
- `PlayerIntelSummary.threatIndex` 是单一数字 — 需改造为 Evidence 链
- `inferThreatIntent` 只在 FULL_ASSAULT 分支使用 `playerIntel`，且只读 `threatIndex`
- **没有独立的 PlayerIntel domain 模块** — 需建立 `src/domain/defense/player-intel.ts`
- **没有 Intel Freshness / Source / Conflict 处理** — 全部缺失

### 1.6 Terrain 现状

```
domain/layout/terrain-analysis.ts:
  - computeDistanceField() — Chamfer 3-4 Distance Transform
  - opennessAt() — 查询某格开放度
  - findOpenRegion() — 找开放区域
  - countBlockedCells() — 核心区域阻挡格计数

domain/layout/min-cut-defense.ts:
  - computeMinCutDefense() — 最小割防御规划

domain/defense/fortification.ts:
  - buildFortificationContext()
  - classifyFortification()
  - resolveUnderSiege()
```

**关键发现**：
- 已有地形分析能力（DistanceField），但无军事地形上下文（TerrainContext）
- min-cut 和 fortification 是建造层概念，不是实时战术评估
- **需建立 `src/domain/defense/terrain-context.ts`** — 纯函数，消费 Snapshot

### 1.7 Combat Capability（G2，不需修改）

```
domain/combat/capability.ts:
  - evaluateCombatCapability() → CombatCapability (9 维度)
  - aggregateCombatCapability() → AggregateCapability
  - computeCombatPower() → CombatPower (粗粒度估计, 禁止作为唯一决策依据)
  - FormationContext.terrain: "plain" | "swamp" | "road"
```

**关键发现**：
- `FormationContext.terrain` 只有 3 档，且只影响 mobility 估计
- A5.2 的 TerrainContext 是更高层概念（chokepoint/corridor/fortified 等）
- `CombatCapability.mobility` 是 estimate — TerrainContext 应修正它，而非修改 Capability 本身

## 2. 改动范围

### 2.1 新建文件

| 文件 | 职责 |
|---|---|
| `src/domain/defense/terrain-context.ts` | G3: TerrainContext 纯函数 domain |
| `src/domain/defense/player-intel.ts` | G5: PlayerIntel Confidence 模型 |
| `src/domain/defense/confidence.ts` | Confidence Model: 多维度置信度 + aggregateConfidence() |
| `tests/unit/defense/terrain-context.test.ts` | G3 测试 |
| `tests/unit/defense/player-intel.test.ts` | G5 测试 |
| `tests/unit/defense/threat-integration-a5-2.test.ts` | Threat Integration T01-T07 |

### 2.2 修改文件

| 文件 | 改动 |
|---|---|
| `src/domain/defense/threat-assessment.ts` | 升级链路：加入 TerrainContext + PlayerIntel + Confidence |
| `src/domain/defense/remote-defense.ts` | 消费 TerrainContext（retreatQuality 等） |
| `src/systems/tower-defense.ts` | 消费 TerrainContext（towerExposure） |
| `src/systems/room-state.ts` | buildThreatAssessment 注入 TerrainContext |
| `src/systems/remote-mining-manager.ts` | buildRemoteThreatAssessment 注入 TerrainContext |
| `src/systems/decision-trace-system.ts` | DecisionEvidence 增加 terrain/intel/confidence |
| `src/domain/strategy/decision-trace.ts` | DecisionEvidence 类型扩展 |
| `src/kernel/global-cache.ts` | 新增 terrainContextCache / playerIntelCache |

### 2.3 不修改文件

| 文件 | 原因 |
|---|---|
| `src/domain/combat/capability.ts` | G2 不变，TerrainContext 不修改 CombatCapability |
| `src/kernel/contracts.ts` | RoomSnapshot 不变（TerrainContext 是 domain 层概念） |
| `src/config/index.ts` | 无新 CONFIG 常量（Terrain/Intel 参数在 domain 层自洽） |

## 3. 风险清单

| 风险 | 级别 | 缓解 |
|---|---|---|
| assessThreat 签名变更破坏旧测试 | MEDIUM | ThreatAssessmentInput 新增可选字段，向后兼容 |
| TerrainContext 计算成本 | MEDIUM | 纯函数 + globalCache 缓存 + 低频更新 |
| PlayerIntel 无限增长 | MEDIUM | TTL + GC + 有界 Map |
| 双重 Threat 计算 | LOW | 保持 assessThreat 唯一入口，不新增并行评估 |
| DecisionEvidence 扩展 | LOW | 新增可选字段，不破坏旧消费者 |

## 4. CPU 预算

- TerrainContext: 缓存于 globalCache，低频更新（地形不变，只随建筑变化失效）
- PlayerIntel: 增量更新，TTL 过期自动清理
- assessThreat: 新增 TerrainContext + PlayerIntel 参数为可选，不增加无威胁时的 CPU

## 5. 结论

调用链清晰，改动范围可控。A5.1 的 `assessThreat()` 设计已预留扩展点（playerIntel / remoteContext 为可选参数），A5.2 的集成路径是「填充扩展点 + 新增 TerrainContext 维度 + 升级 Confidence 模型」。
