# A3.4 Architecture Audit — Empire Expansion Stabilization & Autonomous Colony Validation

> 日期：2026-08-24。阶段：A3.4 — Stability + Autonomous Colony Validation。
> 基线：A3.3 Expansion Execution 已完成（纯函数状态机 + 25 Contract + 17 E2E 测试全绿）。
> A3.3 Final Report 未找到（`docs/phase7/` 仅有 Architecture Audit），以 A3.3 代码 + 测试为基线。

---

## 0. 审计方法论

本审计**逐文件追踪真实调用链**，回答 A3.4 Task Spec 的 10 个核心问题。
每个结论均标注源码路径与关键函数，不依赖文件名猜测。

### 审计范围

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/systems/expansion-manager.ts` | 1161 | A3.3 执行状态机 + Bootstrap Lane |
| `src/systems/expansion-planner.ts` | ~290 | A3.2 Intelligence 层 + Plan 生命周期推进 |
| `src/domain/expansion/execution-state.ts` | 272 | 纯函数状态机（11 状态 + 转换表） |
| `src/domain/expansion/economic-activation.ts` | 153 | 经济激活三段判据 |
| `src/domain/expansion/empire-integration.ts` | — | 帝国集成 5 系统覆盖 |
| `src/domain/expansion/bootstrap.ts` | 95 | 自举决策纯函数 |
| `src/domain/expansion/execution-operation.ts` | 224 | Operation 模型 |
| `src/domain/economy/room-profile.ts` | 375 | Room Economic Profile |
| `src/domain/strategy/room-registry.ts` | 146 | Room Registry |
| `src/domain/economy/phase.ts` | ~327 | Colony Phase + ColonyState 映射 |
| `src/systems/room-state.ts` | ~230 | P0 每 tick 状态评估 |
| `src/systems/spawn-manager.ts` | ~450 | 唯一 spawnCreep 调用者 |
| `src/systems/agenda-manager.ts` | ~600 | Resource Network 系统侧 |
| `src/systems/empire-economy.ts` | ~245 | Empire 经济聚合 |
| `src/creeps/roles/worker.ts` | 86 | Worker 角色（Pioneer 复用） |
| `src/creeps/roles/builder.ts` | 115 | Builder 角色（Pioneer 复用） |
| `src/creeps/roles/claimer.ts` | 44 | Claimer 角色 |
| `src/creeps/engine/role-runner.ts` | ~170 | Creep 执行引擎 |
| `tests/integration/expansion/a3-3-e2e.test.ts` | 777 | A3.3 E2E 测试 |
| `tests/unit/expansion/a3-3-contract.test.ts` | 1154 | A3.3 Contract 测试 |

---

## 1. 新 Room 是否已经完全进入 Normal Room Runtime？

### 1.1 状态机终态分析

**A3.3 Execution State Machine** 的终态是 `COMPLETED`：

```
expansion-manager.ts:advanceIntegrating()
  ├── CP5 passed (Economic Activation + Empire Integration)
  ├── canHandover(integrationResult, econResult.activated) === true
  ↓
  expansion.state = "completed"
  expansion.checkpointsPassed = 5
  Memory.kernel.expansion = undefined  ← 清除扩张状态
```

**关键发现**：当 `Memory.kernel.expansion = undefined` 后，`expansion-manager.run()` 在下 tick 进入 `if (!expansion)` 分支：

```typescript
// expansion-manager.ts:90-101
if (!expansion) {
  if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
  if ((Game.cpu.bucket ?? 0) < 5000) return;
  if ((Memory.kernel.expansionPausedUntil ?? 0) > ctx.tick) return;
  if (Memory.kernel.strategy?.expansionAllowed !== true) return;
  tryConsumePlan(ctx);  ← 只消费新 Plan，不管理已完成 Room
  return;
}
```

**判定**：✅ 新 Room 在 `Memory.kernel.expansion = undefined` 后，不再被 expansion-manager 的状态机管理。
Room 进入 Normal Room Runtime 的条件是 `controller.my === true`。

### 1.2 Normal Room Runtime 路径

新 Room（`controller.my === true`）在下一个 tick 自动进入 Normal Runtime：

| 系统 | 覆盖路径 | 自动接入 |
| --- | --- | --- |
| room-state (P0) | `ctx.snapshots()` 遍历所有 `controller.my` 房 | ✅ 自动 |
| spawn-manager (P0) | `ctx.snapshots()` 遍历，读 `roomMem.spawnQueue` | ✅ 自动 |
| economy (P1) | `queryEconomy(roomName)` 按房名查询 | ✅ 自动 |
| empire-economy (P1) | `ctx.snapshots()` 构建 Profile | ✅ 自动 |
| agenda-manager (P1) | `ctx.snapshots()` 构建 Room Registry + Supply/Demand | ✅ 自动 |
| construction-manager (P2) | `ctx.snapshots()` 遍历，读 `buildQueue` | ✅ 自动 |
| layout-planner (P3) | 读 `Memory.rooms[roomName].layout` | ✅ 由 A3.3 `seedLayoutAnchor` 写入 |
| defense (P0/P2) | tower-defense 读 snapshot.threatCreeps | ✅ 自动 |
| assignment-service (P1) | `pool.getRoomTasks(home)` 按房分配 | ✅ 自动 |

**判定**：✅ 新 Room 在 `controller.my === true` 后自动进入 Normal Room Runtime。
所有核心系统通过 `ctx.snapshots()` 遍历自有房，不依赖扩张状态机。

---

## 2. Bootstrap 是否仍然持续运行？

### 2.1 Bootstrap Lane 独立性分析

`runBootstrapLane(ctx)` 在 `expansion-manager.run()` 的**第一行**被调用（L87），
**独立于扩张状态机**：

```typescript
run(ctx: TickContext): void {
  // 自举车道（审计修复，W38S59 事故实证）：owned 无 spawn 的房不在扩张状态机
  // 覆盖内 —— 任务 success/aborted 即离场，本地 spawnQueue 无 spawn 永不可孵化，
  // 建造无 builder 可用，唯一活路是姊妹房代孵 bootstrap 组。生存级，独立于
  // 姿态与扩张任务；CPU 极轻（仅快照字段 + 已有房间的免费查询）。
  runBootstrapLane(ctx);     ← 无条件执行
  const expansion = Memory.kernel.expansion;
  if (!expansion) { ... }    ← 扩张状态机
}
```

### 2.2 Bootstrap 触发条件

```typescript
// runBootstrapLane 遍历 ctx.snapshots()
// 加入 rooms[] 的条件：
//   1. snapshot.controller?.my === true（自有房）
//   2. room.find(FIND_MY_SPAWNS).length === 0（无 spawn）
// → 仅对 owned 但无 spawn 的房触发
```

**判定**：⚠️ Bootstrap Lane 会在新 Room **无 spawn** 时持续运行。

### 2.3 Bootstrap 退出条件

```typescript
// runBootstrapLane 清除条件
if (room.find(FIND_MY_SPAWNS).length > 0) {
  delete kernel.bootstrap[snapshot.roomName];  ← 有 spawn 即清除
  // 可能加入 sponsorPool
  continue;
}
```

**判定**：✅ 新 Room 一旦建成 spawn，Bootstrap Lane 自动清除该房的台账。
但⚠️ 如果 spawn 被毁（如被攻击），Bootstrap 会重新介入——这是**灾后恢复**的正确行为，不是 Expansion 残留。

### 2.4 Bootstrap 幂等性

`decideBootstrapRooms()` 纯函数使用 `ledger` 追踪波次和冷却：
- `BOOTSTRAP_COOLDOWN_TICKS = 2500`：派波后 2500 tick 内不重复
- `abandoned` 标记：永久跳过弃房
- 波次计数有界

**判定**：✅ Bootstrap 是幂等的。不会无限重复。但 A3.4 需要测试：Expansion COMPLETED 后 Bootstrap 不会重新触发。

---

## 3. Expansion Executor 是否仍然持有控制权？

### 3.1 COMPLETED 后的清理

```typescript
// expansion-manager.ts:advanceIntegrating()
if (cp5.passed && canHandover(integrationResult, econResult.activated)) {
  expansion.state = "completed";
  updatePlanStatus(expansion.planId ?? "", "COMPLETED");
  Memory.kernel.expansion = undefined;  ← 清除
  return;
}
```

```typescript
// expansion-manager.ts:advanceExecutionStateMachine() case "completed"
case "completed":
  console.log(`[${ctx.tick}] expansion: ${expansion.target} already completed, cleaning up`);
  updatePlanStatus(expansion.planId ?? "", "COMPLETED");
  Memory.kernel.expansion = undefined;  ← 清除
  break;
```

**判定**：✅ COMPLETED 后 `Memory.kernel.expansion = undefined`，Executor 不再持有控制权。

### 3.2 残留风险：`completed` 状态短暂存在

在 `advanceIntegrating()` 设置 `expansion.state = "completed"` 后，
到 `Memory.kernel.expansion = undefined` 之间没有 `return` 或 `break` 阻断
后续代码——但实际代码有 `return;` 在设置后立即退出函数。

下 tick `expansion-manager.run()` 看到 `Memory.kernel.expansion === undefined`，
进入 `tryConsumePlan()` 分支——不会重新管理已完成的 Room。

**判定**：✅ 不存在控制权残留。

---

## 4. Pioneer 是否仍然承担普通经济任务？

### 4.1 Pioneer 角色分析

A3.3 的 Pioneer 使用的是**普通 worker 和 builder 角色**，不是特殊角色：

```typescript
// expansion-manager.ts:submitPioneers()
const squad: ReadonlyArray<{ role: string; count: number }> = [
  { role: "worker", count: CONFIG.expansion.pioneerWorkers },
  { role: "builder", count: CONFIG.expansion.pioneerBuilders },
];
// submitRequest → { role: "worker"/"builder", home: expansion.target }
```

### 4.2 Pioneer 行为

Worker 和 Builder 的 RolePolicy 是声明式的（`src/creeps/roles/worker.ts`、`builder.ts`）：

- **Worker**：`acquire: [pickupDroppedEnergy(), harvestSource()]` → `work: [fillAssignmentTarget(), repairCritical(), fillTarget(), upgradeController()]`
- **Builder**：`acquire: [pickupDroppedEnergy(), withdrawStorageCapped(), withdrawClosestNonSourceContainer(), harvestSource()]` → `work: [repairFreshRampart(), repairUrgentRoads(), buildAssignmentSite(), buildNearestSite(), repairContainerDecay(), repairCritical(), fillTarget(), repairRoads(), repairFortifications()]`

**关键发现**：这些角色的 `home` 被设置为 `expansion.target`（新 Room）。
当 `Memory.kernel.expansion = undefined` 后，这些 creep 继续存在并工作——
它们的 `home` 仍是新 Room，行为完全正常。

### 4.3 Pioneer Graduation

**判定**：✅ Pioneer 自动"毕业"为普通 worker/builder。
- 没有特殊的 `pioneer` 角色——worker/builder 在 expansion 期间被 spawn 时设置 `home: target`，之后就是普通 creep
- role-runner 按 `creep.memory.home` + `creep.memory.role` 驱动，不检查 expansion 状态
- 这些 creep 自然到期死亡后，spawn-manager 按 `evaluateDemand` 正常补充

### 4.4 缺失：Pioneer 退役/回收机制

**判定**：⚠️ 当前没有 Pioneer 显式退役机制。
- Pioneer worker/builder 寿终后由 spawn-manager 的 `recyclePass` 回收残值
- `evaluateDemand` 按新 Room 的实际需求（harvesterCount、fillTargets、buildQueue）重新评估
- 如果新 Room 经济已稳定，worker 数量会自然收敛（demand 不再生成 worker 请求）
- **但**：如果新 Room 仍有 construction site，worker 可能被保留——这是正常行为

**结论**：不需要显式 Pioneer 退役——角色复用机制使 Pioneer 自然过渡为普通经济单位。
但 A3.4 需要验证：COMPLETED 后，新 Room 的人口不会因 Pioneer 到期而崩溃。

---

## 5. 是否存在 Expansion-specific shortcuts？

### 5.1 代码搜索结果

| 检查项 | 结果 | 详情 |
| --- | --- | --- |
| 新 Room 专用分支 | ❌ 不存在 | 所有系统通过 `ctx.snapshots()` 统一处理 |
| Expansion 特殊经济规则 | ❌ 不存在 | `evaluateDemand` 按 `colonyState` 门禁，不按 expansion 状态 |
| Expansion 特殊 spawn 优先级 | ⚠️ 存在 | Pioneer 请求 `priority: 2`（P2），但这是正常的——expansion 完成后不再生成 |
| Bootstrap 特殊路径 | ⚠️ 存在但合理 | `runBootstrapLane` 独立于 expansion 状态机，对 owned 无 spawn 的房触发——这是灾后恢复机制 |
| `colonyState` 特殊值 | ❌ 不存在 | 新 Room 的 `colonyState` 由 `room-state.ts` 每 tick 按 `evaluateColonyPhase` 统一计算 |

### 5.2 colonyState 生命周期

```
新 Room claim 后:
  room-state.ts 每 tick:
    harvesterCount = sourceOccupancy + pendingHarvesters
    → harvesterCount < sourceCount → phase = "bootstrap"
    → colonyState = "bootstrap"

  随着采集者就位:
    harvesterCount >= sourceCount → phase = "growth"
    → colonyState = "normal"（无威胁时）

  spawn-manager 按 colonyState 门禁:
    "bootstrap" → P1 降级（关键路径保护）
    "normal" → 正常优先级
```

**判定**：✅ colonyState 是 Room 级状态，不是 Expansion 级状态。
新 Room 通过正常的 room-state 系统自动从 `bootstrap` → `growth` → `steady`，
不需要 expansion-manager 介入。

### 5.3 Integration 评估的硬编码

```typescript
// expansion-manager.ts:advanceIntegrating()
const integrationInput: EmpireIntegrationInput = {
  inOwnedRoomsList: true,    // ← 硬编码：controller.my 已验证
  hasSnapshot: true,         // ← 硬编码：ctx.snapshots 包含该房
  inEconomyStats: true,      // ← 硬编码：简化
  spawnManaged: true,        // ← 硬编码：简化
  defenseCovered: true,      // ← 硬编码：简化
  hasVersionedLayout: Memory.rooms[expansion.target]?.layout !== undefined,
};
```

**判定**：⚠️ Integration 评估中 5 个字段有 4 个被硬编码为 `true`。
这是 A3.3 的简化实现——COMPLETED 判据可能过于乐观。
A3.4 需要修复为从真实系统状态验证。

---

## 6. 是否存在新 Room 专用分支？

### 6.1 全系统交叉检查

| 系统 | 新房专用分支 | 详情 |
| --- | --- | --- |
| room-state | ❌ | `ctx.snapshots()` 统一遍历 |
| spawn-manager | ❌ | `ctx.snapshots()` 统一遍历 + `evaluateDemand` 统一评估 |
| economy | ❌ | `queryEconomy(roomName)` 按房名查询 |
| empire-economy | ❌ | `ctx.snapshots()` 构建 Profile |
| agenda-manager | ❌ | `ctx.snapshots()` 构建 Registry |
| construction-manager | ❌ | 统一遍历 + `buildQueue` |
| layout-planner | ❌ | 读 `Memory.rooms[roomName].layout` |
| defense | ❌ | tower-defense 读 snapshot |
| assignment-service | ❌ | `pool.getRoomTasks(home)` 按房分配 |
| role-runner | ❌ | 按 `creep.memory.home` 驱动 |

**判定**：✅ 不存在新 Room 专用分支。所有系统通过 `ctx.snapshots()` 统一处理。

---

## 7. 是否存在"特殊 Room"逻辑？

### 7.1 Sponsor Pool 筛查

```typescript
// expansion-manager.ts:runBootstrapLane() L805
if (snapshot.rcl >= CONFIG.expansion.sponsorMinRcl &&
    Memory.rooms[snapshot.roomName]?.colonyState === "normal") {
  sponsorPool.push({ room: snapshot.roomName, capacityAvailable: snapshot.energyCapacityAvailable });
}
```

这是 Bootstrap Lane 选择 sponsor 的条件——只选择 `RCL >= sponsorMinRcl && colonyState === "normal"` 的房。
这不是"特殊 Room"逻辑，而是经济能力门槛（sponsor 需有足够容量）。

### 7.2 Economic Class 分级

```typescript
// room-profile.ts:classifyRoomEconomic()
// struggling > candidate > production > core
// 按 RCL + hasStorage + colonyState 统一分类
```

**判定**：✅ 新 Room 会被自动分类为 `candidate`（RCL<4 或无 storage）或 `struggling`（colonyState 为 bootstrap/recovery）。
随着 RCL 提升，自动升为 `production` → `core`。这是正常经济分级，不是"特殊 Room"逻辑。

---

## 8. 是否存在 externalEnergyInflow 隐式依赖？

### 8.1 Economic Activation 的外部依赖检测

```typescript
// economic-activation.ts:evaluateEconomicActivation()
const selfSustaining = input.externalEnergyInflow === 0 && netPositive;
// → externalEnergyInflow > 0 时不激活
```

### 8.2 expansion-manager 中的 externalEnergyInflow 估算

```typescript
// expansion-manager.ts:estimateExternalInflow()
function estimateExternalInflow(targetRoom: string, sponsorRoom: string): number {
  const transporters = Object.values(Game.creeps).filter(
    c => c.memory.home === targetRoom &&
      c.memory.role === "transporter" &&
      c.memory.assignment === (sponsorRoom as never),
  );
  return transporters.length * 50;  // 简化：每个 transporter 50 energy/tick
}
```

**判定**：⚠️ `estimateExternalInflow` 的实现过于简化：
1. 检查 `assignment === sponsorRoom` — `assignment` 是 `CreepAssignment` 对象，不是字符串，类型不匹配
2. 每个 transporter 50 energy/tick 是粗略估算
3. 没有区分"Bootstrap 输血"与"正常 Empire 资源调拨"

### 8.3 Resource Network 正常调拨 vs Bootstrap 输血

```
正常 Empire 调拨（agenda-manager）：
  Room A (surplus) → Operation → carrier → Room B (deficit)
  ← 这是 Normal Empire Logistics

Bootstrap 输血：
  sponsor 房 → spawn worker → worker 带能量去 target 房
  ← 这是 Bootstrap Support
```

**判定**：⚠️ 当前 `estimateExternalInflow` 不区分两种来源。
`agenda-manager` 的 Operation（carrier）和 expansion 的 Pioneer（worker/builder）
是不同的能量流入路径，但 `estimateExternalInflow` 只检测 transporter 角色，
不检测 carrier 角色（Operation 创建的跨房搬运工）。

**A3.4 需修复**：
1. `estimateExternalInflow` 应检测 carrier 角色而非 transporter
2. 应区分 Operation 类型的能量流入（supply Operation = 正常调拨）
3. 应记录 `externalEnergyInflow` 的来源（logistics vs bootstrap）

---

## 9. Empire Integration 是否真正完成？

### 9.1 Integration 硬编码分析

如 §5.3 所述，`advanceIntegrating()` 中的 `EmpireIntegrationInput` 有 4 个字段被硬编码为 `true`：

| 字段 | 硬编码 | 真实检查应来自 | 严重度 |
| --- | --- | --- | --- |
| `inOwnedRoomsList` | `true` | `controller.my` 已验证 → ✅ 可接受 | 🟢 |
| `hasSnapshot` | `true` | `ctx.snapshots()` 包含该房 → ✅ 可接受 | 🟢 |
| `inEconomyStats` | `true` | `queryEconomy(roomName)` 应返回非 undefined | 🟡 |
| `spawnManaged` | `true` | `Memory.rooms[roomName].spawnQueue` 应存在 | 🟡 |
| `defenseCovered` | `true` | `snapshot.threatCreeps` 被读取 → ✅ 可接受 | 🟢 |
| `hasVersionedLayout` | 从 Memory 检查 | `Memory.rooms[target]?.layout !== undefined` | ✅ |

**判定**：⚠️ `inEconomyStats` 和 `spawnManaged` 被硬编码为 `true`，
但实际可能未完全接入（如果 economy 系统未对该房运行过核算）。

### 9.2 COMPLETED 后的真实接入验证

新 Room COMPLETED 后：
- **room-state (P0)**：下 tick 自动覆盖（`ctx.snapshots()` 遍历）
- **spawn-manager (P0)**：下 tick 自动覆盖
- **economy (P1)**：`queryEconomy(roomName)` 在 economy 系统运行时自动覆盖
- **agenda-manager (P1)**：每 100 tick 构建 Profile 时自动覆盖
- **empire-economy (P1)**：每 100 tick 聚合时自动覆盖

**判定**：✅ Integration 在 COMPLETED 后**确实会自动完成**——因为所有系统通过 `ctx.snapshots()` 统一遍历。
但 ⚠️ Integration 评估在 COMPLETED 之前可能过于乐观（硬编码）。

---

## 10. Room 是否能够脱离 Expansion Lifecycle 独立运行？

### 10.1 Expansion Lifecycle 回顾

```
expansion-planner.ts (P1, 100t)
  → Memory.kernel.expansionPlans[] (WAITING_EXECUTION)

expansion-manager.ts (P3, CONFIG.expansion.interval)
  → tryConsumePlan() → Memory.kernel.expansion = { state, target, ... }
  → advanceExecutionStateMachine()
  → ... → advanceIntegrating()
  → Memory.kernel.expansion = undefined (COMPLETED)
```

### 10.2 COMPLETED 后的 Room 依赖链

```
COMPLETED 后:
  Memory.kernel.expansion = undefined
  Memory.kernel.expansionPlans 中该 Plan status = "COMPLETED"

  Room 依赖:
  ├── room-state (P0, 1t) → colonyState 自动计算
  ├── spawn-manager (P0, 1t) → evaluateDemand 自动评估
  ├── economy (P1, 50t) → queryEconomy 自动核算
  ├── agenda-manager (P1, 100t) → Profile + Supply/Demand 自动构建
  ├── construction-manager (P2) → buildQueue 自动处理
  ├── layout-planner (P3) → layout 已写入
  ├── assignment-service (P1) → getRoomTasks 自动分配
  └── defense → snapshot.threatCreeps 自动检测
```

**判定**：✅ Room 在 COMPLETED 后完全脱离 Expansion Lifecycle，进入 Normal Room Runtime。
所有系统通过 `ctx.snapshots()` 自动覆盖，不需要 expansion-manager 介入。

### 10.3 唯一残留：Bootstrap Lane

⚠️ `runBootstrapLane` 仍会在 Room 无 spawn 时触发。
但这不是 Expansion Lifecycle 的一部分——它是**独立的灾后恢复机制**。
如果新 Room 的 spawn 被毁，Bootstrap 会从最近的 sponsor 房代孵 worker——
这是正确的生存行为，不是扩张残留。

---

## 11. 分类矩阵

### 11.1 Already Exists（可复用，无需修改）

| 能力 | 源码位置 | 状态 |
| --- | --- | --- |
| Normal Room Runtime 自动接入 | `ctx.snapshots()` 全系统 | ✅ 完整 |
| colonyState 统一计算 | `room-state.ts` P0 每 tick | ✅ 完整 |
| Economic Profile 统一构建 | `empire-economy.ts` + `agenda-manager.ts` | ✅ 完整 |
| Room Registry 自动注册 | `agenda-manager.ts` 每 100 tick | ✅ 完整 |
| Spawn Demand 统一评估 | `spawn-manager.ts` + `evaluateDemand` | ✅ 完整 |
| Pioneer 自动毕业 | worker/builder 角色复用 | ✅ 完整 |
| Expansion Runtime Exit | `Memory.kernel.expansion = undefined` | ✅ 完整 |
| Plan COMPLETED 标记 | `updatePlanStatus(planId, "COMPLETED")` | ✅ 完整 |
| Bootstrap 幂等 | `decideBootstrapRooms` + 冷却 + 弃房 | ✅ 完整 |
| Resource Network 自动接入 | `agenda-manager.ts` 构建 Supply/Demand | ✅ 完整 |
| Colony Phase 统一映射 | `phase.ts:phaseToColonyState` | ✅ 完整 |

### 11.2 Missing（需新建）

| 能力 | 说明 | 建议位置 |
| --- | --- | --- |
| **Autonomy Age** | Economic Activation 后连续运行的 tick 数 | `src/domain/expansion/autonomy.ts` (新) |
| **Stability Score** | 可解释的 Colony 稳定性评分 | `src/domain/expansion/stability-score.ts` (新) |
| **Colony Stability Dashboard** | 新房稳定性可观测性 | `src/domain/expansion/colony-dashboard.ts` (新) |
| **Expansion Cooldown** | 防止扩张级联的冷却窗口 | 扩展 `plan-lifecycle.ts` 或 `expansion-planner.ts` |
| **Expansion Rate Limit** | 单位时间活跃扩张上限 | 扩展 `expansion-planner.ts` |
| **Colony Failure Detection** | 新房经济衰退检测 | `src/domain/expansion/colony-failure.ts` (新) |
| **No Re-bootstrap Guard** | 禁止对 Colony 重新 Bootstrap | `expansion-manager.ts` 条件门禁 |
| **Expansion ROI Tracking** | Before/After 扩张指标对比 | `src/domain/expansion/roi-tracker.ts` (新) |
| **Death Spiral Regression Test** | 回归测试 | `tests/integration/` (新) |

### 11.3 Reusable（需适配但无需重写）

| 能力 | 当前状态 | A3.4 适配 |
| --- | --- | --- |
| `estimateExternalInflow` | 检测 transporter + assignment 类型不匹配 | 改为检测 carrier + 区分 Operation 来源 |
| `EmpireIntegrationInput` | 4 字段硬编码为 true | 从真实系统状态验证 |
| `evaluateEconomicActivation` | 500 tick 门槛 | 保持，增加 1k/5k/10k 里程碑 |
| `runBootstrapLane` | 无条件执行 | 加入 Colony 防重 Bootstrap 门禁 |
| `expansion-planner.ts` | 无 Cooldown / Rate Limit | 加入冷却窗口 + 并发上限 |
| `CONFIG.expansion` | 无 cooldown / rateLimit 参数 | 新增配置项 |

### 11.4 Conflict（架构冲突）

| 冲突 | 严重度 | 解决方案 |
| --- | --- | --- |
| Integration 硬编码 vs 真实验证 | 🟡 中 | `advanceIntegrating` 从真实系统状态验证 |
| `estimateExternalInflow` 类型不匹配 | 🟡 中 | 重写为检测 carrier + Operation 来源 |
| Bootstrap Lane 可能对新 Colony 重新触发 | 🟡 中 | 加入"Colony COMPLETED 后不 Bootstrap"门禁 |
| 无 Expansion Cooldown 可能导致级联 | 🔴 高 | `expansion-planner.ts` 加入冷却窗口 |

### 11.5 Technical Debt

| 债务 | 来源 | 影响 |
| --- | --- | --- |
| `estimateExternalInflow` 实现有 bug | `expansion-manager.ts:1152-1160` | Economic Activation 可能误判 |
| Integration 评估硬编码 | `expansion-manager.ts:600-608` | COMPLETED 判据过于乐观 |
| 无 Autonomy Age 追踪 | 不存在 | 无法判断 Colony 稳定时长 |
| 无 Stability Score | 不存在 | 无法量化 Colony 健康度 |
| 无 Expansion Cooldown | `expansion-planner.ts` | 可能级联扩张 |
| A3.3 无 Final Report | `docs/phase7/` 缺失 | 缺少 A3.3 完成证据链 |

---

## 12. 10 个核心问题回答汇总

| # | 问题 | 判定 | 详情 |
| --- | --- | --- | --- |
| 1 | 新 Room 是否已完全进入 Normal Room Runtime？ | ✅ 是 | COMPLETED 后所有系统自动覆盖 |
| 2 | Bootstrap 是否仍持续运行？ | ⚠️ 有条件 | 无 spawn 时运行，有 spawn 后清除——是灾后恢复机制 |
| 3 | Expansion Executor 是否仍持有控制权？ | ✅ 否 | COMPLETED 后 `expansion = undefined` |
| 4 | Pioneer 是否仍承担普通经济任务？ | ✅ 是 | Pioneer = worker/builder，自动毕业为普通角色 |
| 5 | 是否存在 Expansion-specific shortcuts？ | ⚠️ 有 | Integration 硬编码 + Pioneer P2 优先级 |
| 6 | 是否存在新 Room 专用分支？ | ✅ 否 | 所有系统统一通过 `ctx.snapshots()` |
| 7 | 是否存在"特殊 Room"逻辑？ | ✅ 否 | colonyState/EconomicClass 统一计算 |
| 8 | 是否存在 externalEnergyInflow 隐式依赖？ | ⚠️ 有 | `estimateExternalInflow` 实现有 bug |
| 9 | Empire Integration 是否真正完成？ | ⚠️ 基本完成 | 硬编码乐观但 COMPLETED 后确实自动接入 |
| 10 | Room 能否脱离 Expansion Lifecycle 独立运行？ | ✅ 能 | COMPLETED 后完全进入 Normal Runtime |

---

## 13. A3.4 实施优先级

### Phase 1: 修复现有问题（前置必须）

1. **修复 `estimateExternalInflow`** — 正确检测 carrier + 区分 Operation 来源
2. **修复 Integration 硬编码** — 从真实系统状态验证
3. **加入 Colony 防重 Bootstrap 门禁** — COMPLETED 后不重新 Bootstrap

### Phase 2: 新建稳定性机制

4. **Autonomy Age** — Economic Activation 后连续运行 tick 数
5. **Stability Score** — 可解释的 Colony 稳定性评分
6. **Colony Stability Dashboard** — 可观测性
7. **Expansion Cooldown** — 防止级联扩张
8. **Expansion Rate Limit** — 并发上限（默认 1）

### Phase 3: 失败检测与恢复

9. **Colony Failure Detection** — 经济衰退检测
10. **Normal Recovery** — 禁止重新 Bootstrap，走正常恢复路径
11. **Expansion ROI Tracking** — Before/After 指标对比

### Phase 4: 测试

12. **25+ Contract Tests** — A3.4-001..025
13. **5+ E2E Tests** — A3.4-E2E-001..005
14. **Death Spiral Regression Test** — 回归测试
15. **10k Tick Stability Test** — 长期稳定性

### Phase 5: 验证

16. **Multi-Colony Test** — Core + Colony A + Colony B
17. **Real Environment Validation** — 10k tick 真实环境
18. **Final Report** — A3_4_FINAL_REPORT.md

---

## 14. 架构裁决

| 裁决 | 决定 |
| --- | --- |
| 是否新建 System | ❌ 不新建，复用现有 expansion-manager + expansion-planner |
| 是否新建角色 | ❌ 不新建，Pioneer = worker/builder |
| 是否新建 Spawn 系统 | ❌ 不新建 |
| 是否新建 Logistics | ❌ 不新建 |
| 是否新建 Economy | ❌ 不新建 |
| Integration 评估 | ✅ 修复硬编码为真实验证 |
| External Inflow 估算 | ✅ 修复为检测 carrier + 区分来源 |
| Autonomy Age | ✅ 新建纯函数模块 |
| Stability Score | ✅ 新建纯函数模块 |
| Expansion Cooldown | ✅ 扩展 expansion-planner |
| Rate Limit | ✅ 扩展 expansion-planner |
| Colony Failure Detection | ✅ 新建纯函数模块 |
| Bootstrap 防重 | ✅ expansion-manager 加入条件门禁 |
| 10k Tick Test | ✅ 新建测试 |
| 25+ Contract Tests | ✅ 新建测试 |
| 5+ E2E Tests | ✅ 新建测试 |

---

## 15. 执行风险

| 风险 | 等级 | 缓解措施 |
| --- | --- | --- |
| 修复 Integration 硬编码导致 COMPLETED 推迟 | 🟡 中 | 渐进式修复，先验证再替换 |
| Expansion Cooldown 过长导致扩张停滞 | 🟡 中 | 冷却窗口可配置，默认保守 |
| Colony Failure Detection 误判 | 🟡 中 | 多指标交叉验证，非单维度 |
| 10k Tick 测试环境限制 | 🟢 低 | 纯函数状态机测试 + 真实环境分阶段 |
| Multi-Colony 测试复杂度 | 🟡 中 | 先单 Colony 稳定再扩展 |

---

**Audit 完成。** 下一步：按优先级实施 A3.4。
