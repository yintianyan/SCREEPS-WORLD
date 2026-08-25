# A5.4.1 — Tactical Runtime Integration & Action Execution

## 状态：已完成并通过审计

## 质量门槛

| 门槛 | 结果 |
|------|------|
| `npm run typecheck` | ✅ PASS |
| `npm test` (286 files, 4039 tests) | ✅ PASS |
| `npm run build` | ✅ PASS |
| Architecture Guards (A5.4.1: 8 rules) | ✅ PASS |
| Runtime Integration Tests (TAC-R01~R13: 20 tests) | ✅ PASS |

## 核心目标

将 `WarPlan → TacticalObjective → TacticalDecision → RolePolicy → Creep Action` 链路接入 Runtime，建立战术适配器系统，实现意图映射与系统集成。

## 实现概要

### 1. Tactical Runtime System (`src/systems/tactical-runtime-system.ts`)

系统层薄壳，职责：
- 从 `globalCache` / `Game` / `Memory` 采集运行时状态
- 适配为 `TacticalSnapshot`（纯函数输入格式）
- 调用 domain 纯函数 `evaluateTacticalAction()` → `TacticalDecision`
- 调用 domain 纯函数 `assessObjectiveLifecycle()` → 生命周期转换
- 将 `TacticalDecision` 映射为 `RoleActionIntent` 写入 `globalCache.tacticalRoleIntents` 供角色消费
- `TacticalAbortSignal` → `globalCache.tacticalAbortSignals` 供 `recovery-execution-system` 消费
- `ReinforcementDemand` → 声明写入 `globalCache`（`war-planner` 执行孵化）
- `SupplyDemand` → `globalCache.tacticalSupplyDemands` 供 `logistics-planner` 消费
- `TacticalDecisionRecord` → `event-log` 供 `decision-trace` 消费

频率：`interval=10`，优先级 P2（在 `war-planner` 之后运行）。

### 2. 角色层集成

#### `attacker.ts`
- 新增 `readTacticalIntent()` — 从 `globalCache.tacticalRoleIntents` 读取战术指令（不导入 systems 层）
- 新增 `attackByTacticalIntent()` — 优先消费 Tactical Runtime 产出的 `RoleActionIntent`
- 无指令时回退到 Legacy 候选（`attackPowerBank` → `attackEnemies` → `attackStructures`）

#### `healer.ts`
- 新增 `readTacticalIntent()` — 同 attacker 模式
- 新增 `healByTacticalIntent()` — 优先消费 Tactical Runtime 产出的治疗指令
- 无指令时回退到 Legacy `healAllies`

### 3. Recovery Integration

`recovery-execution-system.ts` 新增 `consumeTacticalAbortSignals()`：
- 从 `globalCache.tacticalAbortSignals` 读取战术止损信号
- 转换为 `WarAbortSignal` 格式（`TacticalAbortReason` → `WarAbortReason` 映射）
- 复用既有 `mapAbortSignalsToRecoveryActions` 管线

### 4. Logistics Integration

`logistics-planner.ts` 新增 `tacticalSupplyDemands` 消费：
- 从 `globalCache.tacticalSupplyDemands` 读取补给需求
- 适配为 `DemandNode` 注入物流规划
- 只在 `advance` 相位 + `boosted` 编队时产出

### 5. Architecture Compliance

关键架构约束：
- **R3 守卫**：`creeps` 层不导入 `systems` 层（通过 `globalCache` 通信）
- **warAbortSignals 边界**：只有 `recovery-execution-system` / `war-planner` 可写
- **Domain Purity**：`tactical-runtime-system` 不做决策（决策由 domain 纯函数裁决）
- **Action 隔离**：`tactical-runtime-system` 不调用 `move()` / `attack()` / `heal()` / `spawnCreep()`

## 架构守卫（8 条）

| 编号 | 规则 | 验证 |
|------|------|------|
| AG-1 | tactical-runtime-system 不导入 creeps 层 | ✅ |
| AG-2 | 不直接写 warAbortSignals | ✅ |
| AG-3 | 不调用 spawnCreep / submitRequest | ✅ |
| AG-4 | creeps 层不导入 tactical-runtime-system | ✅ |
| AG-5 | 不调用 PathFinder.search | ✅ |
| AG-6 | 不调用 creep 动作 API | ✅ |
| AG-7 | recovery-execution-system 消费 tacticalAbortSignals | ✅ |
| AG-8 | logistics-planner 消费 tacticalSupplyDemands | ✅ |

## 运行时测试（20 条）

| 编号 | 测试 |
|------|------|
| TAC-R01 | tacticalRuntimeSystem 导出与结构 |
| TAC-R02 | TacticalRuntimeCache 字段定义 |
| TAC-R03 | attacker.ts 不导入 systems 层 |
| TAC-R04 | healer.ts 不导入 systems 层 |
| TAC-R05 | 不直接写 warAbortSignals |
| TAC-R06 | recovery-execution-system 消费 tacticalAbortSignals |
| TAC-R07 | logistics-planner 消费 tacticalSupplyDemands |
| TAC-R08 | attacker readTacticalIntent 从 globalCache 读取 |
| TAC-R09 | healer readTacticalIntent 从 globalCache 读取 |
| TAC-R10 | bootstrap 注册 tacticalRuntimeSystem |
| TAC-R11 | 全局 creeps 层不导入 systems 层 |
| TAC-R12 | tactical-runtime-system 不直接调用 Creep API |
| TAC-R13 | SupplyDemand 检测只在 advance 相位 |

## 修改文件清单

### 新增
- `src/systems/tactical-runtime-system.ts` — Tactical Runtime System（系统层薄壳）
- `tests/unit/tactical/a5-4-1-runtime-integration.test.ts` — 20 条运行时集成测试
- `tests/unit/tactical/a5-4-1-architecture.test.ts` — 8 条架构守卫

### 修改
- `src/creeps/roles/attacker.ts` — 新增 `readTacticalIntent` + `attackByTacticalIntent`
- `src/creeps/roles/healer.ts` — 新增 `readTacticalIntent` + `healByTacticalIntent`
- `src/systems/recovery-execution-system.ts` — 新增 `consumeTacticalAbortSignals`
- `src/systems/logistics-planner.ts` — 新增 `tacticalSupplyDemands` 消费
- `src/bootstrap.ts` — 注册 `tacticalRuntimeSystem`

## Legacy Migration

现有 attacker/healer 的 Legacy 行为路径已通过注释标记：
- 无 tactical intent 时回退到原有 `findClosestByRange` / `findWounded` / `findBuddy` 逻辑
- `attackByTacticalIntent` / `healByTacticalIntent` 在候选列表中排在第一位
- 不形成双轨决策——tactical intent 存在时优先执行，不存在时无缝回退

## 已知限制

1. **TerrainContext 简化**：当前使用默认值（`terrainType: "UNKNOWN"`），未接入完整 terrain 分析
2. **EnemyCapability 简化**：`engagementPolicy.enemyCapability` 使用默认值 0，未从实时 intel 采集
3. **CPU Benchmark 未执行**：需要实际 Screeps 运行时环境验证 1/2/5/10 squads 下的 CPU 消耗
4. **SupplyDemand 仅覆盖 energy**：矿物补给需求未实现（当前编队只需能量补给）
