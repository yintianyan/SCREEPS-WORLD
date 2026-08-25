# Military Technical Debt Ledger — A5 Audit

> **审计日期**: 2026-08-25
> **约束**: 只报告，不修复。只提出修复方案，不实施。
> **严重级别**: BLOCKER > HIGH > MEDIUM > LOW

---

## 一、总览

| 级别 | 数量 | 是否阻塞 A5 FREEZE |
|------|------|-------------------|
| BLOCKER | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 5 | 否 |
| LOW | 3 | 否 |

**结论**: 无 BLOCKER / HIGH 级技术债。5 个 MEDIUM 问题不影响架构闭环，只是代码质量和接线优化。A5 可以正式冻结。

---

## 二、MEDIUM 技术债

### M1: WarPlan 双轨制 fallback

| 维度 | 内容 |
|------|------|
| **位置** | `src/systems/war-planner.ts` L77-80 |
| **现状** | war-planner.ts 在 war-planning-system 未产出 WarPlan 时，使用 `selectWarTarget()` / `decideSquadSize()` / `decideHealerCount()` 自行构建 WarPlan 写入 Memory.kernel.warPlan |
| **影响** | Operational 层双轨制。Canonical 路径是 `planMilitaryOperation()` [war-planning.ts]，Legacy fallback 仍在运行时生效，产出与 Canonical 不同质量的 WarPlan |
| **修复方案（不实施）** | 1. 删除 `selectWarTarget()` / `decideSquadSize()` / `decideHealerCount()` 函数体 |
| | 2. war-planner.ts 只读取 `globalCache.warPlanCache`，未产出时 return（不自行构建） |
| | 3. 验证 war-planning-system 在所有 posture=war 场景下都能产出 WarPlan |
| **优先级** | M2（冻结后第二优先修复 — 影响 Canonical 路径唯一性） |
| **依赖** | 无前置依赖；修复后需验证 war-planning-system 覆盖率 |

---

### M2: CombatCapability 代码复制

| 维度 | 内容 |
|------|------|
| **位置** | `tactical-runtime-system.ts` / `tactical-engagement-runtime.ts` / `combat-micro-runtime.ts` 各自 `buildCreepCapability()` |
| **现状** | 三个 runtime 系统各自实现了同型的 body → capability 解析函数，逻辑一致但代码不共享。Canonical `evaluateCombatCapability()` [capability.ts] 未被系统层调用 |
| **影响** | DRY 违反。如 body 解析逻辑变更（如 boost 倍率调整），需同步修改 4 处。不构成第二套评估算法（逻辑一致） |
| **修复方案（不实施）** | 1. 提取公共 runtime helper `buildCapabilityFromCreep(creep: Creep): CombatCapability` |
| | 2. 所有 runtime 系统调用此 helper |
| | 3. helper 内部调用 Canonical `evaluateCombatCapability()` |
| **优先级** | M4（冻结后第四优先修复 — 影响 CPU 效率和可维护性） |
| **依赖** | 可与 M5 一起修复（提取公共 runtime helper 时一并解决） |

---

### M3: Micro Decision 未被 Role 消费

| 维度 | 内容 |
|------|------|
| **位置** | `attacker.ts` 未 import / 未消费 `getMicroDecision()` / `globalCache.microDecisions` |
| **现状** | `combat-micro-runtime.ts` 产出 `CombatMovementDecision[]` 写入 `globalCache.microDecisions`，但 attacker.ts 的候选优先级链中无 microDecision 消费点。Micro 层的 kite / retreat / reposition 决策未传递到 Role 执行层 |
| **影响** | Micro 仲裁（RETREAT/SURVIVAL/KITE/ATTACK_RANGE/FORMATION/REPOSITION）产出但未实际影响 creep 行为。attacker 仍走 FocusFire/TacticalIntent/Legacy 候选链。A5.5 的微操功能在架构上完成但未接线 |
| **修复方案（不实施）** | 方案 A（推荐）：在 attacker.ts 候选链最前面添加 `attackByMicroDecision()` 候选，消费 `globalCache.microDecisions` 中的 `CombatMovementDecision`，按 action 类型执行对应移动/攻击 |
| | 方案 B：在上游 FocusFire/TacticalIntent 候选中融合 Micro Decision（如 microDecision.action === RETREAT 时短路候选） |
| **优先级** | M1（冻结后第一优先修复 — 影响实战效果） |
| **依赖** | 无前置依赖；修复后需验证 micro decision 与 traffic-manager 的移动仲裁不冲突 |

---

### M4: tacticalSupplyDemands 无消费者

| 维度 | 内容 |
|------|------|
| **位置** | `logistics-planner.ts` 未读取 `globalCache.tacticalSupplyDemands` |
| **现状** | tactical-runtime-system 的 `detectSupplyDemand()` 产出 `SupplyDemand` DTO 写入 `globalCache.tacticalSupplyDemands`，但 logistics-planner 不读取此字段。战争后勤信号产出但未注入 A4 物流系统 |
| **影响** | 战时 squad 的能量/boost 补给需求不会触发物流 dispatch。Military 不自行创建 Transport Plan（架构正确），但信号链路断裂 |
| **修复方案（不实施）** | 1. logistics-planner.ts 在构建 DemandNode 列表时读取 `globalCache.tacticalSupplyDemands` |
| | 2. 将 SupplyDemand 转换为 DemandNode 注入物流网络 |
| | 3. 设置优先级权重（war 时 supply demand 优先级高于 economy） |
| **优先级** | M3（冻结后第三优先修复 — 影响战争后勤） |
| **依赖** | 需与 A4 Empire Resource Network 的 DemandNode 接口对齐 |

---

### M5: SquadPlan 重复构建 3 次

| 维度 | 内容 |
|------|------|
| **位置** | `tactical-runtime-system.ts` / `squad-movement-runtime.ts` / `tactical-engagement-runtime.ts` 各自 `buildSquadPlanFromWarPlan()` |
| **现状** | 同一 tick 内，三个 runtime 系统各自独立调用 `querySquad()` + `buildSquadPlanFromWarPlan()`，重复采集编队成员、解析 capability、构建 SquadPlan |
| **影响** | CPU 浪费 — 同一 SquadPlan 在同一 tick 内被构建 3 次。war 时每 3-10 tick 浪费 2 次完整构建。CombatCapability 也被解析 3+ 次（与 M2 叠加） |
| **修复方案（不实施）** | 1. 提取公共 runtime helper `getSquadPlan(warPlan, tick): SquadPlan` |
| | 2. 首次调用时构建并写入 `globalCache.squadPlanCache` |
| | 3. 后续调用直接读取缓存（per-tick 失效） |
| **优先级** | M4（冻结后第四优先修复 — 影响 CPU 效率） |
| **依赖** | 可与 M2 一起修复（提取公共 runtime helper） |

---

## 三、LOW 技术债

### L1: Formation 选择逻辑两处同型

| 维度 | 内容 |
|------|------|
| **位置** | `state-machine.ts` `selectFormation()` + `formation.ts` `selectFormationForTerrain()` |
| **现状** | 两处 switch 逻辑同型：OPEN→WEDGE, CHOKEPOINT→COLUMN, FORTIFIED→LINE, default→CLUSTER |
| **影响** | 如阵型策略变更需同步修改两处 |
| **修复方案** | state-machine.ts 调用 formation.ts 的 `selectFormationForTerrain()`，删除内联版本 |
| **优先级** | LOW — 不影响运行时行为 |

---

### L2: TerrainContext 在所有 runtime 中使用 UNKNOWN 默认值

| 维度 | 内容 |
|------|------|
| **位置** | tactical-runtime-system.ts / squad-movement-runtime.ts / combat-micro-runtime.ts |
| **现状** | 所有 runtime 系统在构建 Snapshot 时使用 `{ terrainType: "UNKNOWN", ... }` 默认值，不消费 A5.2 TerrainContext 的真实地形分析结果 |
| **影响** | Micro 层的 tower avoidance / kite / formation 选择在 UNKNOWN 地形下使用保守默认值，不是真实地形感知 |
| **修复方案** | runtime 系统从 RoomSnapshot 读取 TerrainContext（如已由 room-state 采集），注入 Snapshot |
| **优先级** | LOW — 影响战术精度但不影响架构闭环 |

---

### L3: estimateThreatScore 是粗略评分

| 维度 | 内容 |
|------|------|
| **位置** | `tactical-engagement-runtime.ts` `estimateThreatScore()` |
| **现状** | 使用 `cap.attack + cap.rangedAttack + cap.heal * 0.5 + cap.toughParts * 10` 粗略评分，不调用 Canonical `assessThreat()` |
| **影响** | FocusFire 的 TargetCandidate 评分使用粗略值，不影响 ThreatLevel/ThreatIntent |
| **修复方案** | 可不修——这是局部辅助评分，不构成第二套 Threat Assessment |
| **优先级** | LOW — 不影响架构正确性 |

---

## 四、冻结后修复优先级排序

| 优先级 | 技术债 | 修复理由 | 预计工作量 |
|--------|--------|---------|-----------|
| 1 | M3 (Micro Decision 未接线) | 影响实战效果 — 微操决策产出但未消费 | 1-2 文件修改 |
| 2 | M1 (WarPlan 双轨制) | 影响 Canonical 路径唯一性 — Legacy fallback 仍生效 | 1 文件修改 |
| 3 | M4 (SupplyDemand 未消费) | 影响战争后勤 — 物流信号断裂 | 1-2 文件修改 |
| 4 | M2 + M5 (代码复制 + 重复构建) | 影响 CPU 效率和可维护性 | 提取公共 helper |
| — | L1-L3 (LOW) | 不影响运行时行为 | 择机修复 |

---

## 五、不修复的理由

根据用户约束：

> ❌ 不重构现有架构
> ❌ 不因为发现 LOW TODO 就顺手修复
> 如果发现 BLOCKER/HIGH：只报告，不修复
> 如果发现 MEDIUM：只提出修复方案，不实施

本次审计严格遵循上述约束。所有修复方案仅为记录，不实施。
