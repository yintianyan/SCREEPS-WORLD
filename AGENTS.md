# AGENTS.md

Screeps: World 的可扩展 TypeScript 框架，设计信条：**稳定内核 + 可插拔业务逻辑**，
生存闭环优先于发展速度。任何昂贵工作必须有 CPU 上限、缓存、失效条件和可降级路径。

改动前请先阅读本文件，再按“何时去读 plan.md 的哪一节”定位对应硬约束。
完整设计见 [docs/plan.md](docs/plan.md)；角色约束细节见
[docs/creep-behavior-constraints.md](docs/creep-behavior-constraints.md)；帝国运营总览见
[docs/empire-mind-map.md](docs/empire-mind-map.md)；技术债治理与已知取舍见
[docs/remediation-plan-2026-08.md](docs/remediation-plan-2026-08.md)；调参引擎设计见
[docs/tuning-improvement-design.md](docs/tuning-improvement-design.md)；概览见 [README.md](README.md)。

## 目录 / 职责导航

| 路径 | 职责 | 关键文件 |
| --- | --- | --- |
| [src/main.ts](src/main.ts) | 仅导出 loop 入口 | `main.ts` |
| [src/bootstrap.ts](src/bootstrap.ts) | **唯一插件组合根**，注册 System 与 CreepRole | `bootstrap.ts` |
| [src/config/](src/config/) | 静态策略参数、CPU 阈值、body 模板；[tuned.ts](src/config/tuned.ts) 是运行时调优覆盖层 | [index.ts](src/config/index.ts)、[bodies.ts](src/config/bodies.ts)、[tuned.ts](src/config/tuned.ts) |
| [src/kernel/](src/kernel/) | tick 调度、错误隔离、内存迁移与预算、遥测与 segment | [kernel.ts](src/kernel/kernel.ts)、[scheduler.ts](src/kernel/scheduler.ts)、[memory.ts](src/kernel/memory.ts)、[safe-run.ts](src/kernel/safe-run.ts)、[phase.ts](src/kernel/phase.ts)、[segment-store.ts](src/kernel/segment-store.ts)、[telemetry.ts](src/kernel/telemetry.ts) |
| [src/systems/](src/systems/) | 跨 creep / 跨房决策服务（P0–P3；注册顺序即同优先级执行顺序） | [room-state.ts](src/systems/room-state.ts)、[spawn-manager.ts](src/systems/spawn-manager.ts)、[assignment-service.ts](src/systems/assignment-service.ts)、[empire-strategy.ts](src/systems/empire-strategy.ts)、[construction-manager.ts](src/systems/construction-manager.ts)、[remote-mining-manager.ts](src/systems/remote-mining-manager.ts)、[tower-defense.ts](src/systems/tower-defense.ts)、[traffic-manager.ts](src/systems/traffic-manager.ts)、[tuning-engine.ts](src/systems/tuning-engine.ts)（完整清单见 [bootstrap.ts](src/bootstrap.ts)） |
| [src/creeps/engine/](src/creeps/engine/) | 共享执行引擎：RolePolicy 声明式动作管线 + 统一 FSM | [role-runner.ts](src/creeps/engine/role-runner.ts)、[lifecycle.ts](src/creeps/engine/lifecycle.ts)、[actions/](src/creeps/engine/actions/)、[support/](src/creeps/support/) |
| [src/creeps/roles/](src/creeps/roles/) | 角色策略（14 个）：只声明 gate/acquire/work/onFlee/park/combat | [harvester.ts](src/creeps/roles/harvester.ts)、[hauler.ts](src/creeps/roles/hauler.ts)、[builder.ts](src/creeps/roles/builder.ts)、[remote-harvester.ts](src/creeps/roles/remote-harvester.ts)、[remote-hauler.ts](src/creeps/roles/remote-hauler.ts)（完整清单见 [bootstrap.ts](src/bootstrap.ts)） |
| [src/creeps/movement/](src/creeps/movement/) | 寻路、traffic 意图账本、停车、卡位自愈 | [pathfinding.ts](src/creeps/movement/pathfinding.ts)、[traffic.ts](src/creeps/movement/traffic.ts)、[traffic-resolver.ts](src/creeps/movement/traffic-resolver.ts)、[parking.ts](src/creeps/movement/parking.ts)、[stuck-recovery.ts](src/creeps/movement/stuck-recovery.ts) |
| [src/domain/](src/domain/) | 纯 TypeScript 逻辑（不含 Game/Memory 访问），可 Vitest 测试 | [spawn/](src/domain/spawn/)、[assignment/](src/domain/assignment/)、[layout/](src/domain/layout/)、[economy/](src/domain/economy/)、[remote/](src/domain/remote/)、[defense/](src/domain/defense/)、[strategy/](src/domain/strategy/)、[tuning/](src/domain/tuning/)、[industry/](src/domain/industry/)、[expansion/](src/domain/expansion/) |
| [src/types/global.d.ts](src/types/global.d.ts) | 全局类型声明 | `global.d.ts` |
| [tests/](tests/) | 单测 + [integration/](tests/integration/) 场景/边界测试 + [e2e/](tests/e2e/) 私服全链路 | `*.test.ts` |

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

## 技术债治理状态（2026-08-01 复核）

- [docs/remediation-plan-2026-08.md](docs/remediation-plan-2026-08.md) 登记的 A–O
  十五项与 R1–R7 已闭环（Batch 1–5 分批完成；R5 为确认项）。
- R8/R9/R10 已闭环：R8 回归测试见
  [tests/unit/role/should-idle-hook.test.ts](tests/unit/role/should-idle-hook.test.ts)；
  R9 按既定方案「接受现状并在注释登记」落实（[kernel.ts](src/kernel/kernel.ts) 权衡注释）；
  R10 注释已修正（[constraint-placer.ts](src/domain/layout/constraint-placer.ts)）。
- 仍为已知取舍：远矿 container **维修**链缺失（建造链已由 P0-A 补齐），
  见 [docs/empire-mind-map.md](docs/empire-mind-map.md)「已知裂缝备忘」裂缝二。

## 高风险区域与硬约束摘要

以下为不可妥协的硬约束。修改相关区域前，务必阅读 plan.md 对应小节。

### 内核与调度（`src/kernel/`）

- 内核只维护运行秩序，不感知具体角色或经济策略。→ plan.md **§2.1 分层原则**
- **已登记例外（R9）**：kernel 直接 import 业务侧 `pruneDeadCreepCache`
  （100 tick 低频的 global 缓存卫生钩子），权衡与演化条件已注释登记；
  出现 3+ 个维护钩子时再提取 registry 钩子机制。
- 四档 bucket 看门狗（Healthy/Guarded/Conserve/Recovery）：软/硬上限按
  `Game.cpu.limit` 比例化（官服 20 CPU 下与历史绝对值等价）；降级立即生效，
  恢复需滞回。→ plan.md **§3.2 看门狗与降级执行**
- 所有系统与 creep 走 `safeRun`，单点错误不得中断整 tick；非关键连续失败 3 次
  进入 50–200 tick 冷却（P0 永不冷却）；相同错误每 25 tick 限流。
  → plan.md **§3.3 错误边界**

### 内存与迁移（`src/kernel/memory.ts`）

- Memory 只存 ID、枚举、少量数字和短 key；禁止写入完整路径/历史/运行时索引。
  → plan.md **§7 性能优化 · §2.3 数据所有权**
- **迁移规范**：每次结构变更升版本；迁移必须幂等；先写新字段验证后删旧字段；
  所有步骤成功才更新 `schemaVersion`；大迁移按 cursor 分 tick。
  新增 Memory 字段须同时更新类型、迁移与 plan.md（当前 `schemaVersion = 20`，
  见 `CONFIG.memory`）。冷数据（布局 overrides/blocked）走 RawMemory segment。
  → plan.md **§3.4 版本化 Memory**

### 插件注册（`src/bootstrap.ts`）

- `bootstrap.ts` 是唯一组合根；新增角色/系统只改此文件与新模块，**不改 Kernel**。
- 名称全局唯一 kebab-case，重复注册启动即失败；模块顶层禁止访问 `Game`/`Memory`。
  → plan.md **§4 插件注册规范**

### Creep 行为（`src/creeps/`）

- 角色是声明式 `RolePolicy`（gate/acquire/work/onFlee/park/combat），由
  engine/role-runner 统一驱动；共享 FSM 只在背包空/满、任务完成或威胁解除时
  切状态，防抖动。
- 角色**禁止**全房 `find`、全局扫描、创建 Spawn 请求、调 `createConstructionSite`、
  每 tick 调 `PathFinder.search`；优先复用 RoomSnapshot 与 kernel 预构建索引，
  缓存 `targetId`。→ plan.md **§5.1 全角色硬约束**；细节见
  [docs/creep-behavior-constraints.md](docs/creep-behavior-constraints.md)
- 移动默认走 traffic-manager 后置系统：角色登记意图，tick 末按房仲裁统一签发
  `move`；寻路带三档限频（目标量化、repath 冷却、每房 search 上限），
  本地 `maxRooms: 1`。→ plan.md **§5.7.5 移动服务与路径预算**

### Spawn（`src/systems/spawn-manager.ts`）

- Spawn Manager 是**唯一**能调用 `spawnCreep` 的模块，角色不得自行孵化。
- 请求按稳定 key 幂等合并，`spawning` 与已提交请求须计入人口；P0 灾后恢复优先，
  可用能量达 200 立即生成 `[WORK,CARRY,MOVE]`；队列带黑名单冷却（SP-2）、
  请求撤销通道与 `recycle` 回收通道。→ plan.md **§5.4 Spawn 孵化**

### 建造（`src/systems/construction-manager.ts`、`src/systems/remote-mining-manager.ts`）

- site 创建仅两个写者：construction-manager（自有房）+ remote-mining-manager
  （远矿房，P0-A 收编）；角色层只写 `needContainer` 申请标记，禁止调
  `createConstructionSite`。
- 全局存量上限 `CONFIG.construction.maxGlobalSites`（7，含远矿 siteCount 账本）；
  每房最多 3 normal + 2 road + 1 critical；自有房 emergency site 优先于远矿 site。
  道路依据实测交通热度逐段添加，绝不预铺全房。→ plan.md **§5.5 建筑建造和维修**

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
| 改远矿 / 扩张 / 帝国姿态 | §12.1–12.4、[docs/empire-mind-map.md](docs/empire-mind-map.md) |
| 改调参 / 遥测 / CPU 预算 | [docs/tuning-improvement-design.md](docs/tuning-improvement-design.md)、§3.2、§7 |
| 评估技术债 / 已知取舍 | [docs/remediation-plan-2026-08.md](docs/remediation-plan-2026-08.md) |
| 注册新插件 | §4 插件注册规范 |
| 写测试 / 覆盖边界 | §8 测试策略、§9.1 边界场景清单 |
| 评估风险 / 降级策略 | §9 风险与应对措施 |
