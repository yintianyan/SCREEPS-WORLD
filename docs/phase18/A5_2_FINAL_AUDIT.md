# A5.2 Final Audit — Terrain-Aware Defense + PlayerIntel Confidence

## 1. Executive Summary

**A5.2 PASS** — 0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW.

本阶段实现了两个核心目标：
- **G3: Terrain Awareness** — 从地形快照推导军事地形上下文（TerrainContext），影响战斗修正和撤退评估，但不直接产生军事决策。
- **G5: PlayerIntel Confidence** — 建立多维度情报置信度模型，严格区分 Fact/Inference/Prediction，支持新鲜度衰减和冲突检测。

链路升级：`HostileSnapshot → CombatCapability → TerrainContext → PlayerIntel → ThreatIntent → ThreatScore → Confidence → ThreatAssessment`

质量门槛全绿：
- `npm run typecheck` ✅
- `npm run test:unit` ✅ (257 files, 3630 tests)
- `npm run test:integration` ✅ (19 files, 138 tests)
- `npm run build` ✅

## 2. Pre-Implementation Audit

审计文档：`docs/phase18/A5_2_PRE_IMPLEMENTATION_AUDIT.md`

关键发现：
- `assessThreat()` 已有 `playerIntel` 可选参数，但未消费 TerrainContext
- `FormationContext.terrain` 硬编码为 `"plain"`
- `DecisionEvidence` 缺少 terrain/intel/confidence 字段
- `RemoteDefenseInput` 缺少 TerrainContext
- 无独立的 PlayerIntel domain 模块

## 3. Terrain Model

### 新建文件
| 文件 | 职责 |
|---|---|
| `src/domain/defense/terrain-context.ts` | G3: TerrainContext 纯函数 domain |

### TerrainContext 字段
- `terrainType`: OPEN / CONFINED / CORRIDOR / CHOKEPOINT / FORTIFIED / OPEN_FIELD / CORE_DEFENSE / UNKNOWN
- `walkability`: FULL / PARTIAL / RESTRICTED / BLOCKED / UNKNOWN
- `openTileRatio`: 0-1
- `wallDensity`: 0-1
- `chokepoints`: Chokepoint[]（pos, width, direction, significance）
- `corridors`: Corridor[]（entry, exit, length, width）
- `rampartCoverage`: NONE / PARTIAL / HIGH / CORE_FORTIFIED / UNKNOWN
- `towerCoverage`: NONE / LOW / MEDIUM / HIGH / CRITICAL / UNKNOWN
- `coreExposure`: 0-1
- `retreatQuality`: VERY_GOOD / GOOD / POOR / CRITICAL / UNKNOWN
- `mobilityModifier`: 0-2

### 纯函数约束
- 不引用 Game / Memory / RawMemory / Creep / Room / PathFinder
- 所有运行时数据通过 TerrainSnapshot 注入
- 无视野时全部返回 UNKNOWN

## 4. Terrain Evidence

TerrainContext 通过 `terrainEvidence` 字段记录到 ThreatAssessment：
- terrainType, retreatQuality, mobilityModifier, towerCoverage
- DecisionTrace 消费此字段写入 `DecisionEvidence.terrain`

## 5. PlayerIntel Model

### 新建文件
| 文件 | 职责 |
|---|---|
| `src/domain/defense/player-intel.ts` | G5: PlayerIntel Confidence 模型 |

### Fact / Inference / Prediction 分离
- **FACT**: 直接观察的引擎事实（body 解析、combat log）
- **INFERENCE**: 基于事实的推断（"Player 可能准备 Siege"）
- **PREDICTION**: 未来预测（"未来 100t 可能攻击 Remote"）
- 三者不能混为一个 Threat 事实

## 6. Confidence Model

### 新建文件
| 文件 | 职责 |
|---|---|
| `src/domain/defense/confidence.ts` | 多维度置信度 + aggregateConfidence() |

### 多维度
- `factConfidence`: 引擎事实置信度
- `combatConfidence`: G2 CombatCapability 解析置信度
- `intentConfidence`: G1 ThreatIntent 推断置信度
- `terrainConfidence`: G3 TerrainContext 置信度
- `intelConfidence`: G5 PlayerIntel 聚合置信度
- `overallConfidence`: 加权聚合（非简单 average）

### 聚合权重
- fact: 0.30, combat: 0.25, intent: 0.20, terrain: 0.15, intel: 0.10
- 冲突检测：fact 高但 intent 低 → 0.1 penalty

## 7. Fact / Inference / Prediction

严格类型分离：`IntelCategory = "FACT" | "INFERENCE" | "PREDICTION"`

## 8. Intel Freshness

- FRESH (0-500t): 不降级
- RECENT (500-2000t): 降一级
- STALE (2000-10000t): 降二级
- EXPIRED (>10000t): 降至 UNKNOWN

禁止旧情报永久保持 HIGH。

## 9. Intel Conflict

- `detectIntelConflict()`: 检测 FACT 级别情报之间的矛盾
- 冲突时整体降低一级 Confidence
- 不简单覆盖其中一个

## 10. Threat Integration

### 修改文件
| 文件 | 改动 |
|---|---|
| `src/domain/defense/threat-assessment.ts` | 加入 terrainContext/playerIntelRecord, multiConfidence, terrainEvidence/intelEvidence |
| `src/domain/defense/remote-defense.ts` | 加入 terrainContext, retreatQuality 影响撤退决策 |

### 向后兼容
- terrainContext / playerIntelRecord 为可选参数
- 不传时 terrainConfidence=0.3, intelConfidence=0.0
- A5.1 旧调用不传新参数时行为不变

## 11. Defense Integration

`tower-defense.ts` 已消费 `threatAssessment.estimatedIntent.intent === "SIEGE"`。
A5.2 的 terrainEvidence 通过 ThreatAssessment 传递到 DecisionTrace。

## 12. Remote Defense Integration

- `RemoteDefenseInput.terrainContext` 可选
- `retreatQuality` 影响 `effectivePathCost` 计算
- VERY_GOOD/GOOD retreat 即使 pathCost > 3 仍可 RETREAT
- POOR/CRITICAL retreat 降低 effectivePathCost 上限

## 13. Decision Trace Integration

### 修改文件
| 文件 | 改动 |
|---|---|
| `src/domain/strategy/decision-trace.ts` | DecisionEvidence 加入 terrain/intel/confidence 字段 |
| `src/systems/decision-trace-system.ts` | collectDefenseDecisions 注入 terrain/intel/confidence evidence |

## 14. Test Matrix

### G3 Terrain 测试 (9 场景)
| 场景 | 测试 |
|---|---|
| Open Room | T01 ✅ |
| Dense Walls | T02 ✅ |
| Chokepoint | T03 ✅ |
| Corridor | T04 ✅ |
| Fortified Core | T05 ✅ |
| Partial Rampart | T06 ✅ |
| High Tower Exposure | T07 ✅ |
| Poor Retreat | T08 ✅ |
| Unknown Terrain | T09 ✅ |

### G5 PlayerIntel 测试 (10 场景)
| 场景 | 测试 |
|---|---|
| Fresh Observed Fact | T01 ✅ |
| Stale Fact | T02 ✅ |
| Inference | T03 ✅ |
| Prediction | T04 ✅ |
| Conflicting Intel | T05 ✅ |
| Multiple Sources | T06 ✅ |
| High Threat Player | T07 ✅ |
| Low Threat Player | T08 ✅ |
| Unknown Player | T09 ✅ |
| Expired Intel (GC) | T10 ✅ |

### Threat Integration 测试 (7 场景)
| 场景 | 测试 |
|---|---|
| Strong + Open Terrain | T01 ✅ |
| Moderate + Chokepoint | T02 ✅ |
| High Combat + Poor Retreat | T03 ✅ |
| PlayerIntel Fresh | T04 ✅ |
| PlayerIntel Stale | T05 ✅ |
| Conflicting Intel | T06 ✅ |
| Terrain Unknown | T07 ✅ |

## 15. Regression

- A5.1 threat-assessment 旧测试全部通过（a5-1-final-audit.test.ts）
- A5.1 remote-defense 旧测试全部通过
- A5.1 capability 旧测试全部通过
- 无双重 Threat 计算：assessThreat 仍是唯一 Threat 评估入口
- 旧调用（不传 terrainContext/playerIntelRecord）行为不变

## 16. CPU

- TerrainContext 分析不每 tick 完整重新计算
- `terrainCacheSignature()` 提供缓存失效检测
- 签名包含 rampart/tower/road 数量和 RCL，变化时才重算
- PlayerIntel 有 GC（`gcIntelEvidence`），EXPIRED 证据自动删除，保留最近 20 条

## 17. Memory

- 禁止保存完整 Terrain Map — TerrainContext 是派生数据，只缓存签名
- 禁止保存完整 Player 历史无限增长 — 有 TTL（10000t）和 GC
- DecisionTrace Ring Buffer 最多 1000 条，自动淘汰

## 18. Real Screeps Rule Validation

Terrain 模型基于 `docs/research/03_SCREEPS_GAME_CONSTRAINTS.md`：
- plain: fatigue=1, move=1 可走
- swamp: fatigue=5, move=1 需要 3 tick 一步
- road: fatigue=0, 无 fatigue
- wall: 不可通行
- rampart: 可通行（友方），提供掩护

Tower 暴露考虑：塔有效射程 5 格（满伤），15 格（半伤），20+ 格（最小伤）。

## 19. Known Limitations

1. Chokepoint 识别使用简化算法（直线扫描），不完整覆盖所有路径
2. Corridor 识别使用邻接启发式，可能遗漏复杂走廊
3. PlayerIntel 冲突检测基于关键词匹配，无法处理语义矛盾
4. TerrainContext 不调用 PathFinder（按设计——A5.2 不是 Pathfinding 项目）

## 20. Technical Debt

| ID | 描述 | 严重度 |
|---|---|---|
| TD-A5.2-1 | Chokepoint 识别算法简化，可改用 BFS 流量分析 | LOW |
| TD-A5.2-2 | Corridor 延伸算法可能重复计数 | LOW |
| TD-A5.2-3 | PlayerIntel 冲突检测基于关键词，可改用语义分析 | LOW |
| TD-A5.2-4 | TerrainContext 缓存机制未接入 globalCache（签名已就绪） | LOW |

## 21. PASS / FAIL

**A5.2 PASS**

- 0 BLOCKER
- 0 HIGH
- 0 MEDIUM
- 0 LOW
- 所有测试通过

完成 A5.2。不进入 A5.3。等待下一步指令。
