# AGENTS.md

Screeps: World 的可扩展 TypeScript 框架，设计信条：**稳定内核 + 可插拔业务逻辑**，
生存闭环优先于发展速度。任何昂贵工作必须有 CPU 上限、缓存、失效条件和可降级路径。

改动前请先阅读本文件，再按“何时去读 plan.md 的哪一节”定位对应硬约束。
完整设计见 [docs/plan.md](docs/plan.md)；角色约束细节见
[docs/creep-behavior-constraints.md](docs/creep-behavior-constraints.md)；概览见 [README.md](README.md)。

## 目录 / 职责导航

| 路径 | 职责 | 关键文件 |
| --- | --- | --- |
| [src/main.ts](src/main.ts) | 仅导出 loop 入口 | `main.ts` |
| [src/bootstrap.ts](src/bootstrap.ts) | **唯一插件组合根**，注册 System 与 CreepRole | `bootstrap.ts` |
| [src/config/](src/config/) | 策略参数、CPU 阈值、body 模板的唯一入口 | [index.ts](src/config/index.ts)、[bodies.ts](src/config/bodies.ts) |
| [src/kernel/](src/kernel/) | tick 调度、错误隔离、内存迁移与预算 | [kernel.ts](src/kernel/kernel.ts)、[scheduler.ts](src/kernel/scheduler.ts)、[memory.ts](src/kernel/memory.ts)、[contracts.ts](src/kernel/contracts.ts)、[registry.ts](src/kernel/registry.ts)、[safe-run.ts](src/kernel/safe-run.ts) |
| [src/systems/](src/systems/) | 跨 creep / 跨房决策服务 | [room-snapshot.ts](src/systems/room-snapshot.ts)、[spawn-manager.ts](src/systems/spawn-manager.ts)、[construction-manager.ts](src/systems/construction-manager.ts)、[assignment-service.ts](src/systems/assignment-service.ts) |
| [src/creeps/](src/creeps/) | 单 creep 状态机，只执行已分配任务 | [role-runner.ts](src/creeps/role-runner.ts)、[harvester.ts](src/creeps/harvester.ts)、[hauler.ts](src/creeps/hauler.ts)、[builder.ts](src/creeps/builder.ts)、[movement.ts](src/creeps/movement.ts) |
| [src/domain/](src/domain/) | 纯 TypeScript 逻辑，可 Vitest 测试 | [spawn/](src/domain/spawn/)、[construction/](src/domain/construction/)、[layout/](src/domain/layout/)、[assignment/](src/domain/assignment/)、[economy/](src/domain/economy/) |
| [src/types/global.d.ts](src/types/global.d.ts) | 全局类型声明 | `global.d.ts` |
| [tests/](tests/) | 单测 + [integration/](tests/integration/) 场景/边界测试 | `*.test.ts` |

## 命令指针（与 [package.json](package.json) scripts 一致）

| 目的 | 命令 |
| --- | --- |
| 类型检查 | `npm run typecheck` （`tsc --noEmit`） |
| 测试（全部） | `npm test` （`vitest run`） |
| 单元测试 | `npm run test:unit` （`vitest run --exclude 'tests/integration/**'`） |
| 集成测试 | `npm run test:integration` |
| 构建 | `npm run build` （`rollup -c`） |
| 监听构建 | `npm run watch` （`rollup -c -w`） |

**合并前质量门槛**：执行 `npm run typecheck`、`npm test`、`npm run build` 全绿
（见 plan.md §8「质量门槛」）。

## 高风险区域与硬约束摘要

以下为不可妥协的硬约束。修改相关区域前，务必阅读 plan.md 对应小节。

### 内核与调度（`src/kernel/`）

- 内核只维护运行秩序，不感知具体角色或经济策略。→ plan.md **§2.1 分层原则**
- 20 CPU 看门狗：常态 < 12 CPU；四档 bucket（Healthy/Guarded/Conserve/Recovery）
  软/硬截止；降级立即生效，恢复需滞回。→ plan.md **§3.2 20 CPU 看门狗与降级执行**
- 所有系统与 creep 走 `safeRun`，单点错误不得中断整 tick；相同错误每 25 tick 限流。
  → plan.md **§3.3 错误边界**

### 内存与迁移（`src/kernel/memory.ts`）

- Memory 只存 ID、枚举、少量数字和短 key；禁止写入完整路径/历史/运行时索引。
  → plan.md **§7 性能优化 · §2.3 数据所有权**
- **迁移规范**：每次结构变更升版本；迁移必须幂等；先写新字段验证后删旧字段；
  所有步骤成功才更新 `schemaVersion`；大迁移按 cursor 分 tick。
  新增 Memory 字段须同时更新类型、迁移与 plan.md。→ plan.md **§3.4 版本化 Memory**

### 插件注册（`src/bootstrap.ts`）

- `bootstrap.ts` 是唯一组合根；新增角色/系统只改此文件与新模块，**不改 Kernel**。
- 名称全局唯一 kebab-case，重复注册启动即失败；模块顶层禁止访问 `Game`/`Memory`。
  → plan.md **§4 插件注册规范**

### Creep 行为（`src/creeps/`）

- 角色是小状态机，只在背包空/满或任务完成时切状态，防抖动。
- 角色**禁止**全房 `find`、全局扫描、创建 Spawn 请求、重规划建筑、每 tick 调
  `PathFinder.search`；优先复用 RoomSnapshot 索引与缓存 `targetId`。
  → plan.md **§5.1 全角色硬约束**；细节见 [docs/creep-behavior-constraints.md](docs/creep-behavior-constraints.md)
- 移动仅在主动作返回 `ERR_NOT_IN_RANGE` 时触发，本地 `maxRooms: 1` + `reusePath`。
  → plan.md **§5.7.5 移动服务与路径预算**

### Spawn（`src/systems/spawn-manager.ts`）

- Spawn Manager 是**唯一**能调用 `spawnCreep` 的模块，角色不得自行孵化。
- 请求按稳定 key 幂等合并，`spawning` 与已提交请求须计入人口；P0 灾后恢复优先，
  可用能量达 200 立即生成 `[WORK,CARRY,MOVE]`。→ plan.md **§5.4 Spawn 孵化**

### 建造（`src/systems/construction-manager.ts`）

- construction-manager 是**唯一**创建 construction site 的模块，消费版本化 BuildQueue。
- 全局每 tick 最多创建 1 个 site；每房最多 1 critical + 2 normal；P0/P1 缺口时不建普通
  site。道路依据实测交通热度逐段添加，绝不预铺全房。→ plan.md **§5.5 建筑建造和维修**

### 布局（`src/domain/layout/`、`src/systems/layout-planner.ts`）

- 布局是版本化蓝图 + 低频局部适配 + 队列化执行；核心结构建成后冲突只标 `blocked`，
  不自动拆改。模板改动须递增 `templateId`/`layout.version` 并写迁移。
  → plan.md **§5.6 布局与建造的技术实施方案**

## 何时读 plan.md 的哪一节（速查）

| 触发场景 | 阅读小节 |
| --- | --- |
| 改角色行为 / 新增角色 | §5.1 角色硬约束、§5.7 Creep 技术实施 |
| 改 Memory 结构 / 加字段 | §3.4 版本化 Memory（迁移规范）、§2.3 数据所有权 |
| 改调度 / CPU 预算 | §3.2 看门狗降级、§7 性能优化 |
| 改 Spawn 逻辑 | §5.4 Spawn 孵化 |
| 改建造 / 布局 | §5.5 建造维修、§5.6 布局实施 |
| 注册新插件 | §4 插件注册规范 |
| 写测试 / 覆盖边界 | §8 测试策略、§9.1 边界场景清单 |
| 评估风险 / 降级策略 | §9 风险与应对措施 |
