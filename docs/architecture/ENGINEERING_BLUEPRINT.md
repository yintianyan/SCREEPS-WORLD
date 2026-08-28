# ENGINEERING_BLUEPRINT · 工程结构蓝图（冻结蓝图）

> 本文件是**源码结构契约**：src/ 目录树、15 模块落点映射、每目录六项合同、命名
> 规约与规模量级以此为准。目录结构**从架构推导**（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md)
> §1 十五模块 ＋ domain Service ＋ RolePolicy ＋ [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md)
> 分层），不照抄任务书示例树。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15。现状代码与本蓝图冲突时，
> 以蓝图为目标、代码为待迁移现状（AGENT.md 裁决规则 1；差异登记见 §5）。

## 1. 目录树合同（目标形态）

```text
src/
├── main.ts                  # 引擎入口：仅调 bootstrap 导出的 loop()，零业务逻辑
├── bootstrap.ts             # 唯一组合根（§4-①）：Registry.register* 的全仓库唯一调用点
├── kernel/                  # Kernel 内核（模块 1.1）＋平台组接口载体（Scheduler/StateStore/Metrics）
├── systems/                 # System 管线成员与唯一写者 Manager（15 模块中 11 个的落点）
├── domain/                  # Service 纯函数层（无 Game/Memory——lint 红线）
├── creeps/
│   ├── engine/              # role-runner（engine 类，模块 1.2 执行半部）
│   ├── movement/            # traffic-resolver / 寻路 / stuck-recovery（engine 类）
│   ├── roles/               # RolePolicy 声明集（每角色一文件，纯声明零驱动逻辑）
│   └── support/             # 执行层共享工具（快照适配 / 对象缓存）
├── config/                  # CONFIG 单一真相源（k 系数 / 频带 N / 权重 / bodies / 迁移注册）
└── types/                   # 环境类型与全局声明（@types/screeps 侧），零逻辑
tests/{unit,integration,e2e} # 测试入口，对应 [TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §2
```

## 2. 15 模块 → 目录落点映射表

模块名与八项登记以 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.n 为准；P 档
随八项登记，此处仅标注。规模量级是**量级锚**（数量级跳档须 ADR），非行数预算。

| 模块（§1.n） | 类型 | 目录落点 | P 档 | 规模量级 |
| --- | --- | --- | --- | --- |
| 1.1 Kernel | engine | `src/kernel/`（kernel / registry / safe-run / memory / segment-store / cadence / state-store / telemetry） | P0 | ~15–20 文件 / 4–5k 行 |
| 1.2 Execution Runtime | engine | `src/creeps/engine/` ＋ `src/creeps/movement/` | P0/P1 | ~8–10 文件 / 2–3k 行 |
| 1.3 World Model | System | `src/systems/room-snapshot.ts`＋`room-state.ts` | P0 | 2–3 文件 / 1–2k 行 |
| 1.4 Empire | Agent 载体 System | `src/systems/empire-strategy.ts`＋`src/domain/strategy/` | P1 | 3–5 文件 / 1–2k 行 |
| 1.5 Economy | System | `src/systems/economy.ts`＋`src/domain/economy/` | P1 | 3–5 文件 / 1–2k 行 |
| 1.6 Logistics | System | `src/systems/`（请求池 / link-system / terminal-manager）＋`src/domain/assignment/` | P0/P1/P2 | 4–6 文件 / 2–3k 行 |
| 1.7 Spawn | Manager | `src/systems/spawn-manager.ts`＋`src/domain/spawn/`（census / body） | P0 | 3–4 文件 / 1–2k 行 |
| 1.8 Construction | Manager×2 | `src/systems/construction-manager.ts`＋`remote-mining-manager.ts`＋`site-quota.ts`＋`src/domain/construction/`＋`src/domain/layout/` | P2 | 8–12 文件 / 3–4k 行 |
| 1.9 Defense | System | `src/systems/tower-defense.ts`＋`defense-planner.ts`＋`src/domain/defense/` | P0 | 3–5 文件 / 1–2k 行 |
| 1.10 Military | Manager | `src/systems/war-planner.ts`＋`src/domain/war/` | P2 | 3–5 文件 / 1–2k 行 |
| 1.11 Expansion | System | `src/systems/expansion-manager.ts`＋`src/domain/expansion/` | P2 | 3–4 文件 / 1–2k 行 |
| 1.12 Intelligence | System | `src/systems/room-observer.ts`＋`src/domain/intel.ts` | P2 | 2–3 文件 / 1k 行级 |
| 1.13 Agenda 管理 | System | `src/systems/agenda-manager.ts`（复核纯函数在 `src/domain/strategy/`） | P2 | 2–3 文件 / 1k 行级 |
| 1.14 Observability | System | `src/systems/telemetry-collector.ts`＋`src/kernel/telemetry.ts`（平台面） | P3＋P0 伴生 | 3–4 文件 / 1–2k 行 |
| 1.15 Self-Healing | System | `src/systems/self-healing.ts`（处置表数据在 `src/domain/`，只读） | P1 | 2–3 文件 / 1k 行级 |
| — domain Service 层 | Service | `src/domain/`（assignment / strategy / economy / spawn / construction / layout / defense / war / expansion / industry / remote / tuning / intel） | — | 合计 ~60 文件 / 11–13k 行 |
| — 执行声明层 | — | `src/creeps/`（roles / support 合计） | — | 合计 ~25 文件 / 4–5k 行 |

## 3. 每目录六项合同

### 3.1 `src/kernel/`（含 `main.ts` / `bootstrap.ts`）

| 项 | 合同 |
| --- | --- |
| Purpose | 维护 tick 运行秩序 |
| Responsibilities | 仅四职能：固定顺序调度、safeRun 错误隔离、四档看门狗、Memory 迁移；平台组接口（Scheduler / StateStore / Metrics）载体 |
| Dependencies | **禁止 import** `src/systems`、`src/creeps`、`src/domain` 业务符号（唯一例外 R9：`pruneDeadCreepCache` 一行白名单，KERNEL §8）；被全体经公开接口依赖 |
| Public API | `loop()` / `Registry.register*`（仅组合根可调）/ `safeRun()` / `budgetTier()` / StateStore / Metrics |
| State | 看门狗档位、熔断 / 冷却计数、`schemaVersion`（Memory 瘦，STATE_OWNERSHIP §3） |
| Tests | `tests/unit/kernel`＋`tests/integration`（S2/S3/S8：reset / 迁移 / 低 bucket） |

### 3.2 `src/systems/`

| 项 | 合同 |
| --- | --- |
| Purpose | 跨 creep / 跨房决策系统与唯一写者资源代理 |
| Responsibilities | 15 模块中 11 个的行为载体（§2 表）；每个成员在 SYSTEM_BOUNDARIES §1 登记完整八项，未登记者不予合并 |
| Dependencies | 按 [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) §1 图；兄弟系统间禁止横向 import 直读内部状态（跨系统只经 Public Interface）；写者间（Spawn ↔ Construction ↔ Market）禁止互调 |
| Public API | 各模块 Public Interface 行＝查询组 / 执行组接口（[RUNTIME_API_DESIGN.md](RUNTIME_API_DESIGN.md) §2/§4） |
| State | STATE_OWNERSHIP §3.1–§3.8 各 Owner 字段（EmpireState / RoomState / SpawnState / EconomyState / MilitaryState / IntelState / AgendaItem / TelemetryState） |
| Tests | `tests/unit/systems`＋各 domain 子域单测；integration 接线；e2e 场景 |

### 3.3 `src/domain/`

| 项 | 合同 |
| --- | --- |
| Purpose | 无状态纯逻辑集合（Service）：决策＝`situation + state + policy → decision` 纯函数 |
| Responsibilities | 分配评分、战略求值、布局计算、body 体型、处置表数据、tuning 参数评估 |
| Dependencies | **零运行时依赖、永不反向 import** systems / kernel / creeps；**禁止出现 `Game.` / `Memory.` / `RawMemory.` 标识符**（纯函数律，DEPENDENCY_GRAPH §3-5，lint 红线） |
| Public API | 服务组接口（[RUNTIME_API_DESIGN.md](RUNTIME_API_DESIGN.md) §3：GoalService / PlanningService / OperationService / DemandService / TaskService 概念签名） |
| State | 无自有状态（编译期常量表除外；处置表是只读数据） |
| Tests | `tests/unit` 主力：纯函数全输入输出覆盖＋迁移链 n→n+1 逐步测 |

### 3.4 `src/creeps/`

| 项 | 合同 |
| --- | --- |
| Purpose | 声明式执行层：RolePolicy ＋ 统一驱动 engine |
| Responsibilities | roles/ 只声明钩子（gate/acquire/work/onFlee/hold/park/combat）与共享 FSM；engine/ 统一驱动；movement/ 交通仲裁与寻路限频、卡位自愈 |
| Dependencies | **仅两条**：Kernel（safeRun）＋ World Model（快照只读）（SYSTEM_BOUNDARIES §1.2）；禁止 import 战略与业务系统（DEPENDENCY_GRAPH §3-1）；禁止直达 SpawnManager / Construction |
| Public API | `runCreep(policy, creep)` / `registerIntent()` / `resolveRoomTraffic()` |
| State | CreepState（identity / targetId / 心跳 / 失败计数，STATE_OWNERSHIP §3.4）；TrafficState（tick 内瞬时，§3.9） |
| Tests | `tests/unit/creeps|role|movement`；integration 接线（意图→仲裁→move）；e2e 执行场景 |

### 3.5 `src/config/` 与 `src/types/`

| 项 | 合同 |
| --- | --- |
| Purpose | CONFIG 单一真相源；环境类型声明 |
| Responsibilities | k 系数与滞回 N、频带 N 值、权重初值、bodies 模板、metrics 清单、`schemaVersion` 常量与迁移注册、Memory 类型＋默认值工厂三件套 |
| Dependencies | 被全体 import，自身零业务 import（types 除外）；文档中数字仅为快照（AGENT.md） |
| Public API | `CONFIG` 常量树（运行时唯一真相源） |
| State | 无（tuning 覆盖层运行时叠加，见 `src/domain/tuning/`） |
| Tests | `tests/unit/migration`＋config 一致性（三件套缺一即红） |

## 4. 结构条款（七条）

| # | 条款 |
| --- | --- |
| ① | **唯一组合根**：`bootstrap.ts` 是 `Registry.register*` 的全仓库唯一调用点（RUNTIME_API §5 Scheduler 行）；新增角色 / 系统只改 bootstrap 与新模块，**不改 Kernel**；名称全局唯一 kebab-case，重复注册启动即失败；模块顶层禁止访问 `Game` / `Memory` |
| ② | **domain 纯函数律**：`src/domain` 出现 Game / Memory / RawMemory 引用即 lint 红；Game 动作只允许出现在唯一写者（systems 内 Manager）与执行运行时（creeps/engine·movement、kernel） |
| ③ | **systems 管线成员制**：每成员带 P0–P3 标注（降级牺牲序）与频带登记（SYSTEM_BOUNDARIES §1 Tick Frequency 行）；后缀判据五条（System / Service / Manager / engine / Agent，SYSTEM_BOUNDARIES §2.1），Manager 仅限唯一写者；禁止 Coordinator / Handler / Controller 及一切空转命名，「只是转发 / 只是 if-else 分派」的模块必须删除 |
| ④ | **creeps＝RolePolicy＋engine**：roles/ 纯声明、engine/ 统一驱动；角色禁止全房 `find`、全局扫描、创建 Spawn 请求、调 `createConstructionSite`、每 tick `PathFinder.search`（AGENT.md；lint 分区规则） |
| ⑤ | **分层一致性**：目录分层＝DEPENDENCY_GRAPH §1 分层（组合根→kernel→感知→战略→业务→写者→执行→横切）；import 权限＝调用权限（RUNTIME_API §7-3）；CI 架构回归以 §1 图为期望集 diff，新增边不在允许表即失败 |
| ⑥ | **命名规约**：文件与模块名一律 kebab-case（如 `spawn-manager.ts`、`assignment-service.ts`）；测试文件 `*.test.ts` 镜像被测目录；目录名用单数领域词（domain/）或复数惯用词（systems/ / creeps/ / config/） |
| ⑦ | **规模量级**：全仓 ~160 文件 / ~36k 行（现状盘点口径：kernel 20/4.3k、systems 25/10.5k、domain 61/11.5k、creeps 46/7.8k、config 4/1.6k）；蓝图约束的是**结构与职责归属**而非行数，任何使目录数量级跳档的扩张（如 domain 翻倍）须 ADR |

## 5. 现状登记（待迁移差异，不改本蓝图）

以下现状与蓝图冲突，按 AGENT.md 裁决规则 1 以本蓝图为目标收敛。

| # | 现状 | 蓝图目标 | 状态 |
| --- | --- | --- | --- |
| 1 | ~~`src/kernel/event-bus.ts` 存在~~ | 违反 KERNEL §1.1 否决清单（EventBus 中枢） | ✅ 已删除 |
| 2 | ~~`src/systems/assignment-service.ts`~~ → `src/systems/assignment-system.ts` | 文件重命名：Service 后缀不准确（实现 System 接口并注册在 bootstrap）；纯函数已下沉 `domain/assignment/` | ✅ 已重命名 |
| 3 | `src/systems/layout-planner.ts`（1033 行）与 `src/domain/layout/` 并存 | 布局纯函数归 `src/domain/layout/`，系统侧只留队列推进与 site 签发。D2 归位已完成 `makeTryAddTask`/`planHubRoads`/`shouldPlan`/`isPositionBuildable`/`findSpawnRelocationPosition` 五个函数下沉。`planStage0-3` 四个核心规划函数仍含 Game/Memory/globalCache 副作用，需进一步提取参数注入后下沉。 | ⏳ D2 归位部分完成 |
| 4 | `src/systems/empire-health-system.ts`（435行）+ `recovery-execution-system.ts`（1083行） | 模块 1.15 蓝图落点为 `src/systems/self-healing.ts`。ADR 裁决：**保留分离**。两系统职责不同（empire-health=诊断/8维评估/失败传播图；recovery-execution=执行/spawn请求/任务抢占），各自有独立 CPU 节奏、状态所有权和降级序。合并为单文件将产生 1500+行巨文件，降低整洁度。蓝图落点 `self-healing.ts` 作为概念性容器，实际由两个系统协作实现。 | ✅ ADR 裁决保留分离 |
| 5 | `src/kernel/` 含 ring-buffer / event-log 等待归类部件 | 属平台组设施，保留在 kernel 但须在八项之外登记为「内核部件」，不承载业务语义 | ⏳ 部分已清理 |
| 6 | `src/kernel/decision-trace.ts` 已删除 | 原属内核部件；删减式重构移除后未同步更新本表 | ✅ 已删除 |
| 7 | `src/telemetry/EvaluationRegistry.ts` 已删除 | 原属遥测管线；删减式重构移除 evaluation-system 后遥测 barrel 不再导出 | ✅ 已删除 |
| 8 | bootstrap.ts 实际注册 34 系统 / 19 角色 | R10 预期 36 系统 → R11 ADR 裁决正式修正为 34（intelligence-pipeline/decision-trace/evaluation 正式删除） | ✅ R11 裁决完成 |
| 9 | ~~角色层存在 `Room.find` / `Object.values(Game.creeps)` 违规~~ | 蓝图条款 ④ 禁止角色全房 find 和全局扫描 | ✅ 已收敛到 `creeps/support/room-scans.ts` |
| 10 | ~~Kernel 直接 import 业务模块（room-snapshot / defense / pathfinding）~~ | 蓝图 §3.1 禁止 Kernel import 业务符号；唯一登记例外为 pruneDeadCreepCache | ✅ buildRoomSnapshot 通过 Registry 注入，classifyThreats 内联为 CONFIG 判定，MINCUT_ALGO_VERSION 改参数注入 |

## 6. 一致性声明

本文件与 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1（15 模块八项）、
[DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) §1–§3（依赖边与禁令）、
[RUNTIME_API_DESIGN.md](RUNTIME_API_DESIGN.md) §5–§6（平台面与权限矩阵）、
[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3（状态归属）、
[TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §2（测试入口）、AGENT.md（组合根 /
角色 / 命名条款）同一时刻必须一致；目录增删、模块落点变化必须先改本文并走 ADR。
