# docs/ 导航

本目录是文档唯一索引入口。AGENTS.md 只保留 agent 行为约束，不承载文档索引与历史台账。

## 文档三层体系与真相源

| 层 | 位置 | 性质 | 真相源地位 |
| --- | --- | --- | --- |
| **架构蓝图（冻结契约）** | [architecture/](architecture/) | Phase-1 冻结蓝图（36 份，2026-08-23 重执行）：合同体裁，结构裁决见 [ARCHITECTURE_FREEZE.md](architecture/ARCHITECTURE_FREEZE.md)（§15=唯一修订通道） | 已冻结领域以蓝图为目标、代码为待迁移现状（差距与迁移见 [IMPLEMENTATION_PHASES.md](architecture/IMPLEMENTATION_PHASES.md)；现状登记见 [ENGINEERING_BLUEPRINT.md](architecture/ENGINEERING_BLUEPRINT.md) §5） |
| 调研存档 | [research/](research/) | Phase-0 调研（2026-08-22 重执行：官方机制引擎常量级核查 + 7 家 bot 源码考古 + 社区经验 + 双红队），导航 [research/00_EXECUTIVE_SUMMARY.md](research/00_EXECUTIVE_SUMMARY.md) | 证据链，不直接裁决实现；机制数值以 [research/03_SCREEPS_GAME_CONSTRAINTS.md](research/03_SCREEPS_GAME_CONSTRAINTS.md) 为单一真相源 |
| 实施记录 | [implementation/](implementation/) | 各阶段实施/合规快照 + [TECH_DEBT_LEDGER.md](implementation/TECH_DEBT_LEDGER.md) 技术债台账 | 随代码演进即过时，仅供回溯 |

裁决规则：**蓝图与代码冲突时，若该领域蓝图已冻结则以蓝图为目标（代码按
IMPLEMENTATION_PHASES 迁移）；若蓝图未覆盖，以代码与内联注释为准**。

## 速查：何时读哪个文档

| 触发场景 | 阅读 |
| --- | --- |
| 总览 / 冻结契约 / 15 问 | [ARCHITECTURE_EXECUTIVE_SUMMARY.md](architecture/ARCHITECTURE_EXECUTIVE_SUMMARY.md)、[ARCHITECTURE_FREEZE.md](architecture/ARCHITECTURE_FREEZE.md)、[EMPIRE_ARCHITECTURE.mmd](architecture/EMPIRE_ARCHITECTURE.mmd) |
| 概念语义（Goal/Policy/Demand/Task/Agenda…17 概念） | [EMPIRE_SYSTEM_MODEL.md](architecture/EMPIRE_SYSTEM_MODEL.md)、[GOAL_POLICY_PLAN_MODEL.md](architecture/GOAL_POLICY_PLAN_MODEL.md) |
| 谁有权决定什么 / 冲突裁决 | [DECISION_AUTHORITY_MODEL.md](architecture/DECISION_AUTHORITY_MODEL.md) |
| 改状态结构 / 加字段 | [STATE_OWNERSHIP_MODEL.md](architecture/STATE_OWNERSHIP_MODEL.md)、[MEMORY_ARCHITECTURE.md](architecture/MEMORY_ARCHITECTURE.md) |
| 改调度 / CPU 预算 / 降级 | [KERNEL_ARCHITECTURE.md](architecture/KERNEL_ARCHITECTURE.md)、[CPU_EXECUTION_MODEL.md](architecture/CPU_EXECUTION_MODEL.md)、[TICK_LIFECYCLE.md](architecture/TICK_LIFECYCLE.md) |
| 新增/修改系统模块 / 命名 | [SYSTEM_BOUNDARIES.md](architecture/SYSTEM_BOUNDARIES.md)（含 Module Boundary Rules）、[DEPENDENCY_GRAPH.md](architecture/DEPENDENCY_GRAPH.md)、[RUNTIME_API_DESIGN.md](architecture/RUNTIME_API_DESIGN.md) |
| 改 Spawn 逻辑 | [SPAWN_ARCHITECTURE.md](architecture/SPAWN_ARCHITECTURE.md) |
| 改物流 / link / terminal / 市场 | [LOGISTICS_ARCHITECTURE.md](architecture/LOGISTICS_ARCHITECTURE.md)、[ECONOMY_ARCHITECTURE.md](architecture/ECONOMY_ARCHITECTURE.md) |
| 改建造 / 布局 | [CONSTRUCTION_ARCHITECTURE.md](architecture/CONSTRUCTION_ARCHITECTURE.md) |
| 改远矿 / 扩张 | [EXPANSION_ARCHITECTURE.md](architecture/EXPANSION_ARCHITECTURE.md)、[PLANNING_ARCHITECTURE.md](architecture/PLANNING_ARCHITECTURE.md)（Agenda 契约） |
| 改战争 / 防御 / 止损 | [MILITARY_ARCHITECTURE.md](architecture/MILITARY_ARCHITECTURE.md)、[DEFENSE_ARCHITECTURE.md](architecture/DEFENSE_ARCHITECTURE.md) |
| 改情报 / 侦察 / intel | [INTELLIGENCE_ARCHITECTURE.md](architecture/INTELLIGENCE_ARCHITECTURE.md) |
| 改 Agent/LLM 边界 | [AGENT_ARCHITECTURE.md](architecture/AGENT_ARCHITECTURE.md)、[LLM_BOUNDARY.md](architecture/LLM_BOUNDARY.md) |
| 故障处置 / 自愈 / 告警 | [FAILURE_RECOVERY_ARCHITECTURE.md](architecture/FAILURE_RECOVERY_ARCHITECTURE.md) |
| 写测试 / 发布门槛 | [TEST_ARCHITECTURE.md](architecture/TEST_ARCHITECTURE.md) |
| 规划实施 / Phase 顺序 / MVP | [IMPLEMENTATION_PHASES.md](architecture/IMPLEMENTATION_PHASES.md)、[EMPIRE_MVP.md](architecture/EMPIRE_MVP.md)、[ENGINEERING_BLUEPRINT.md](architecture/ENGINEERING_BLUEPRINT.md) |
| 架构溯源 / 冲突调和 / 验证 / 红队 | [RESEARCH_INDEX.md](architecture/RESEARCH_INDEX.md)、[RESEARCH_SYNTHESIS.md](architecture/RESEARCH_SYNTHESIS.md)、[ARCHITECTURE_RECONCILIATION.md](architecture/ARCHITECTURE_RECONCILIATION.md)、[ARCHITECTURE_VALIDATION.md](architecture/ARCHITECTURE_VALIDATION.md)、[ARCHITECTURE_RED_TEAM.md](architecture/ARCHITECTURE_RED_TEAM.md) |
| 评估技术债 / 已知取舍 | [TECH_DEBT_LEDGER.md](implementation/TECH_DEBT_LEDGER.md)、[ENGINEERING_BLUEPRINT.md](architecture/ENGINEERING_BLUEPRINT.md) §5、[research/25_ARCHITECTURAL_TRADEOFFS.md](research/25_ARCHITECTURAL_TRADEOFFS.md) |
| 评估风险 / 降级策略 | [research/29_RISK_REGISTER.md](research/29_RISK_REGISTER.md)、[research/24_FAILURE_MODES.md](research/24_FAILURE_MODES.md) |
| 调研证据 / 机制事实核查 | [research/RESEARCH_SOURCES.md](research/RESEARCH_SOURCES.md)、[research/03_SCREEPS_GAME_CONSTRAINTS.md](research/03_SCREEPS_GAME_CONSTRAINTS.md)、[RESEARCH_EXECUTIVE_SUMMARY.md](RESEARCH_EXECUTIVE_SUMMARY.md) |

## 仓库结构导航

| 路径 | 职责 | 关键文件 |
| --- | --- | --- |
| [src/main.ts](../src/main.ts) | 仅导出 loop 入口 | `main.ts` |
| [src/bootstrap.ts](../src/bootstrap.ts) | **唯一插件组合根**，注册 System 与 CreepRole | `bootstrap.ts` |
| [src/kernel/](../src/kernel/) | tick 调度、错误隔离、内存迁移与预算、遥测与 segment | `kernel.ts`、`scheduler.ts`、`memory.ts`、`safe-run.ts`、`telemetry.ts` |
| [src/systems/](../src/systems/) | 跨 creep / 跨房决策服务（P0–P3 管线成员） | `spawn-manager.ts`、`construction-manager.ts`、`remote-mining-manager.ts`、`tower-defense.ts`、`traffic-manager.ts` 等（完整清单见 [bootstrap.ts](../src/bootstrap.ts) 与蓝图 [SYSTEM_BOUNDARIES.md](architecture/SYSTEM_BOUNDARIES.md)） |
| [src/creeps/](../src/creeps/) | RolePolicy 声明 + 共享执行引擎 + 移动/交通 | `engine/role-runner.ts`、`roles/*`、`movement/*` |
| [src/domain/](../src/domain/) | 纯 TypeScript 逻辑（禁 Game/Memory），可 Vitest 测试 | `spawn/`、`assignment/`、`layout/`、`economy/`、`remote/`、`defense/`、`strategy/`、`industry/`、`expansion/` 等 |
| [src/types/global.d.ts](../src/types/global.d.ts) | 全局类型声明 | `global.d.ts` |
| [tests/](../tests/) | 单测 + integration 场景 + e2e 私服全链路 | `*.test.ts`（层级合同见 [TEST_ARCHITECTURE.md](architecture/TEST_ARCHITECTURE.md)） |

> 冻结蓝图与现状代码的差距（如 event-bus 违规、assignment-service 归位、layout
> 边界）登记于 [ENGINEERING_BLUEPRINT.md](architecture/ENGINEERING_BLUEPRINT.md) §5
> 与 [TECH_DEBT_LEDGER.md](implementation/TECH_DEBT_LEDGER.md)。
