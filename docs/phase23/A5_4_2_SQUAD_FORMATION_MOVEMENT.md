# A5.4.2 — Squad Formation & Tactical Movement 审计文档

## 1. 概述

### 1.1 阶段目标

解决「一个 Squad 如何作为一个战术单位移动，而不是 N 个 Creep 各走各的」。

### 1.2 前置条件

- A5.3 + A5.3.1：Military Architecture 已完成并冻结
- A5.4.0：Tactical Combat Contract & Boundary Design 已完成
- A5.4.1：Tactical Runtime Integration 已完成
- Git baseline：3104313

### 1.3 质量门槛

- typecheck PASS
- test PASS（47 tests, 2 test files）
- build PASS
- Architecture Guards PASS

## 2. 架构设计

### 2.1 数据流

```
TacticalSnapshot (A5.4.0)
    ↓
SquadSnapshot (本模块构建)
    ↓
Anchor → Formation → FormationSlot[] (每个 Member 的 DesiredPosition)
    ↓
SquadMovementIntent (Domain 只产出 Intent，不执行 Path)
    ↓
Movement Runtime (系统层薄壳 → PathFinder → registerMove)
```

### 2.2 分层契约

| 层 | 模块 | 职责 | 禁止 |
|---|---|---|---|
| Domain | `src/domain/tactical/squad-formation.ts` | 纯函数：Anchor 计算、Formation Slot、Cohesion、Movement Intent | 引用 Game/Memory/PathFinder/registerMove |
| System | `src/systems/squad-movement-runtime.ts` | 薄壳：采集运行时数据、调用纯函数、翻译为移动指令 | 做战术决策（由 domain 裁决） |
| Test | `tests/unit/tactical/a5-4-2-*.test.ts` | 验证纯函数行为 + Architecture Guards | — |

### 2.3 PathFinder 边界

- Domain 层（`squad-formation.ts`）绝不调用 PathFinder / moveTo / registerMove
- 系统层（`squad-movement-runtime.ts`）是唯一允许调用 PathFinder 的编队移动模块
- Path Leader 走 `moveToTarget`（复用现有三级缓存机制）
- 其他成员走 `registerMove` 到 Formation Slot（DesiredPosition）
- Traffic Manager 在 tick 末仲裁

## 3. 实现清单

### 3.1 Domain 层纯函数（`src/domain/tactical/squad-formation.ts`）

| 函数 | 用途 | 测试 ID |
|---|---|---|
| `computeSquadAnchor` | Centroid + Path Leader 选择 | FORM-001~006 |
| `computeFormationSlots` | LINE/WEDGE/COLUMN/CLUSTER/SCATTER 偏移 | FORM-007~010 |
| `computeCohesion` | INTACT/DEGRADED/BROKEN/CRITICAL 评级 | FORM-011~013 |
| `produceSquadMovementIntent` | 状态→目标映射 + Cohesion 判断 | FORM-014~016 |
| `detectSquadStuck` | 编队级卡位检测 | FORM-017~018 |
| `checkHealerCohesion` | Healer 掉队检测 | FORM-019~020 |
| `computeRetreatFormation` | 撤退阵型（CLUSTER + 优先级排序） | FORM-021~022 |
| `squadMovementIntentHash` | 确定性 Hash | FORM-023~024 |
| `buildSquadSnapshot` | 从 SquadPlan + runtime 数据构建快照 | FORM-025 |
| `assessFormationDegradation` | 阵型退化级别评估 | FORM-026 |
| `computeRegroupPoint` | 集结点计算 | FORM-027 |

### 3.2 阵型偏移语义

| 阵型 | 布局 | 适用场景 |
|---|---|---|
| LINE | 前排展开 + 后排展开（y±1） | 开阔地形正面展开 |
| WEDGE | 尖端在前，两翼后展 | 开阔地形突击 |
| COLUMN | 纵队前后排列（y 方向递增） | 狭窄通道行军 |
| CLUSTER | 围绕中心 8 邻域 | 撤退/防守紧凑编队 |
| SCATTER | 间隔 2 格分散 | 规避 AoE / 分散塔火力 |

### 3.3 Cohesion 阈值

| 阵型 | DEGRADED | BROKEN | healerBroken | aliveBroken |
|---|---|---|---|---|
| CLUSTER | >3 | >5 | >3 | <0.5 |
| COLUMN | >4 | >7 | >4 | <0.5 |
| LINE | >4 | >6 | >3 | <0.5 |
| WEDGE | >4 | >6 | >3 | <0.5 |
| SCATTER | >6 | >10 | >5 | <0.5 |

### 3.4 状态→目标映射

| TacticalState | 目标 | 模式 | 优先级 |
|---|---|---|---|
| FORMING | 集结点 | ABSOLUTE | 50 |
| MOVING | 目标房中心 | OBJECTIVE_RELATIVE | 70 |
| POSITIONING | 目标位置附近 | OBJECTIVE_RELATIVE | 60 |
| ENGAGING | 当前位置附近 | OBJECTIVE_RELATIVE | 80 |
| DISENGAGING | 撤退方向 | ABSOLUTE | 75 |
| RETREATING | 撤退房间 | ABSOLUTE | 85 |
| REGROUPING | 集结点 | ABSOLUTE | 90 |
| COMPLETED | 当前位置 | ABSOLUTE | 0 |
| ABORTED | 撤退房间 | ABSOLUTE | 95 |

### 3.5 系统层薄壳（`src/systems/squad-movement-runtime.ts`）

- **频率**：interval=1（每 tick 运行）
- **优先级**：P2（在 tactical-runtime 之后运行）
- **阶段**：main（在角色之前——先产出 SquadMovementIntent 供角色消费）
- **存储**：heap only — global reset 可丢

公共 API：
- `getSquadMovementIntent(squadId)` — 查询编队移动意图
- `getCreepFormationSlot(creepName)` — 查询 creep 的 Formation Slot

### 3.6 Bootstrap 注册

`squadMovementSystem` 已注册到 `bootstrap.ts`，在 `tacticalRuntimeSystem` 之后运行。

## 4. 测试覆盖

### 4.1 单元测试（`a5-4-2-squad-formation.test.ts`）

- FORM-001~006：computeSquadAnchor（Centroid + Path Leader + 跨房 + 确定性）
- FORM-007~010：computeFormationSlots（分配 + 优先级 + 阵型偏移 + 确定性）
- FORM-011~013：computeCohesion（INTACT + DEGRADED/BROKEN + CRITICAL）
- FORM-014~016：produceSquadMovementIntent（FORMING + MOVING + Cohesion BROKEN）
- FORM-017~018：detectSquadStuck（Anchor 前进 + 累积卡位）
- FORM-019~020：checkHealerCohesion（正常 + 掉队）
- FORM-021~022：computeRetreatFormation（优先级 + CLUSTER）
- FORM-023~024：squadMovementIntentHash（确定性 + 区分性）
- FORM-025：buildSquadSnapshot
- FORM-026：assessFormationDegradation
- FORM-027：computeRegroupPoint

**总计：38 个测试用例，全部通过。**

### 4.2 Architecture Guards（`a5-4-2-architecture.test.ts`）

- Domain Purity：不引用 Game/Memory/RawMemory/console/PathFinder/moveTo/registerMove
- Domain Purity：不使用 Math.random/Date.now
- Domain Purity：不 import systems/creeps/kernel
- System Boundary：不引用 evaluateTacticalAction/assessObjectiveLifecycle
- System Boundary：不直接调用 attack()/heal()/spawnCreep()
- Bootstrap Registration：squadMovementSystem 已注册
- Barrel Export：squad-formation 已从 index.ts 导出
- Determinism：纯函数无副作用

**总计：9 个测试用例，全部通过。**

## 5. 文件清单

| 文件 | 类型 | 行数 | 用途 |
|---|---|---|---|
| `src/domain/tactical/squad-formation.ts` | Domain 纯函数 | ~1387 | Anchor/Slot/Cohesion/Intent/Stuck/Retreat/Hash |
| `src/systems/squad-movement-runtime.ts` | System 薄壳 | ~500 | 采集→纯函数→移动指令 |
| `src/domain/tactical/index.ts` | Barrel | ~22 | 导出 squad-formation |
| `src/bootstrap.ts` | 组合根 | ~190 | 注册 squadMovementSystem |
| `tests/unit/tactical/a5-4-2-squad-formation.test.ts` | 测试 | ~450 | FORM-001~027 |
| `tests/unit/tactical/a5-4-2-architecture.test.ts` | 测试 | ~120 | Architecture Guards |
| `docs/phase23/A5_4_2_SQUAD_FORMATION_MOVEMENT.md` | 审计文档 | 本文件 | — |

## 6. 技术决策记录

### 6.1 Anchor 选择：Centroid + Path Leader 混合方案

**选择**：Centroid Anchor + Leader Path 混合方案

**理由**：
- Leader Path（方案 A）：Leader 死亡则 Anchor 丢失，编队瞬间散架
- Centroid Path（方案 B）：Centroid 是抽象点，不能直接 PathFinder
- **混合方案**：Anchor = Centroid（用于 Formation Slot + Cohesion），Path = 从最接近 Centroid 的存活成员计算

**优势**：Leader 死亡时 Centroid 自动重算，新 Leader 自动产生，编队不散架。

### 6.2 移动执行：Path Leader + Formation Slot

**选择**：Path Leader 走 `moveToTarget`（复用现有三级缓存），其他成员走 `registerMove` 到 DesiredPosition

**理由**：
- 不另建编队专用 PathFinder 缓存——复用现有 `moveToTarget` 的三级缓存（持久化→走廊共享→精确目标共享→新算）
- 其他成员走单步 `registerMove`——由 Traffic Manager 仲裁
- 避免每个成员独立 PathFinder.search（CPU 爆炸）

### 6.3 Stuck Detection：编队级 vs 个体级

**选择**：编队级 Stuck Detection 基于 Anchor 位置变化

**级别**：
- NONE：Anchor 本 tick 前进
- INDIVIDUAL：Anchor 1-2 tick 未前进
- SQUAD_LIGHT：3-5 tick
- SQUAD_HEAVY：6-10 tick
- SQUAD_BLOCKED：>10 tick

**Recovery**：SQUAD_HEAVY/BLOCKED 时清除共享路径，下 tick 重算。

## 7. 后续演进路径

### 7.1 本阶段不实现（明确排除）

- 复杂 Combat Micro（Focus Fire、Kiting、Body Block）
- 完整 Heal Target 选择算法
- 动态阵型切换（基于实时地形变化）
- 多 Squad 协同作战

### 7.2 下一阶段候选（A5.4.3+）

- Combat Micro：Focus Fire 目标选择
- Terrain-Aware Formation：基于实时地形数据动态选择阵型
- Multi-Squad Coordination：多编队协同
- Squad Boost Management：编队级 boost 资源管理

## 8. 合规性检查

| 规则 | 状态 | 备注 |
|---|---|---|
| Domain 纯函数律 | PASS | 不引用 Game/Memory/PathFinder |
| System 薄壳律 | PASS | 不做战术决策 |
| PathFinder 边界 | PASS | Domain 不调 PathFinder |
| Bootstrap 注册 | PASS | squadMovementSystem 已注册 |
| Architecture Guards | PASS | 9/9 tests passed |
| 确定性 | PASS | 相同输入→相同输出→相同 Hash |
| CPU 预算 | PASS | interval=1, P2, 复用现有缓存 |
| Memory 预算 | PASS | heap only, global reset 安全 |
