# STATUS · 当前实现状态快照（唯一入口）

> **本文件是当前实现状态的唯一入口**（docs/README.md 三层体系中的现状层）：
> 回答「现在生产里跑的是什么、验证到什么等级」。目标架构以
> [architecture/](architecture/) 冻结蓝图为准；历史证据以 [research/](research/) 为准。
> 全仓状态类数字（系统数、schemaVersion、CpuTier、规模、门禁结果）以本文件为
> 引用出口；其他文档**不得另存手写快照数字**（结构裁决除外）。
>
> 刷新方式：改 `src/bootstrap.ts` / `src/config/` / 迁移链后，按 §6 的固定命令
> 重测并手工更新本文件；`npm run check:docs` 自动校验本文件口径与源码一致。

## 1. 快照元信息

| 项 | 值 |
| --- | --- |
| 快照日期 | 2026-08-28 |
| 基准 commit | `f9da278992d636ae8c41107691c7f0309a61296e`（dev 分支；本快照的工作树仅叠加 docs/ 治理改动与 `check:docs` 脚本，不影响生产 bundle） |
| 运行模式 | 官方 Screeps World · TypeScript bot（`dist/main.js` 由 rollup 打包） |
| 口径约定 | 概念模块 = SYSTEM_BOUNDARIES §1 的 15 模块；生产系统 = `bootstrap.ts` `registerSystem()` 实际注册项；源文件 = `src/systems/` 等实际文件。三者不是同一统计对象，不得互换 |

## 2. 核心口径（与源码一一对应）

| 项 | 当前值 | 源码真相源 |
| --- | --- | --- |
| 生产注册系统数 | **34**（`registerSystem` 调用数；R10 记 36、R11 正式修正为 34） | `src/bootstrap.ts` |
| 生产注册角色数 | **19**（`registerRole` 调用数） | `src/bootstrap.ts` |
| Memory schemaVersion | **42**（迁移链 42 步：0→42，逐级迁移） | `src/config/index.ts` `CONFIG.memory.schemaVersion`、`src/kernel/memory.ts` `MIGRATIONS` |
| CpuTier 枚举 | **四档**：`healthy / guarded / conserve / recovery`（不存在第五档） | `src/kernel/contracts.ts` |
| CpuTier bucket 阈值 | healthy 7000 / guarded 3000 / conserve 1000 / recovery 0（降级立即生效；恢复滞回 500 + 20 tick） | `src/config/index.ts` `CONFIG.cpu.tiers` |
| Emergency Survival Mode | **设计态，未实现**（发布运行态规范，见 [implementation/RELEASE_GATE_AND_ROLLBACK.md](implementation/RELEASE_GATE_AND_ROLLBACK.md) §5.2；不是 CpuTier 成员） | — |
| `src/` 规模 | 398 个 .ts / 103,242 行（kernel 19/5.3k、systems 40/19k、domain 260/65.9k、creeps 48/8k、telemetry 24/2.4k、config 4/1.6k、types 1/0.9k、根 2 文件） | 目录实测（刷新时重测） |
| 市场成交唯一写者 | **TerminalManager**（`Game.market.deal` 唯一调用点；不存在 `MarketManager`） | `src/systems/terminal-manager.ts` |

## 3. 门禁结果（本快照 commit 实测）

| 门禁 | 结果 |
| --- | --- |
| `npm run typecheck` | ✅ 0 error |
| `npm test`（unit + integration） | ✅ 344 文件 / 5260 测试全绿（2026-08-28 实测 @ 基准 commit；审查稿记录的 4 个失败已被远矿修复收敛） |
| `npm run build` | ✅ `dist/main.js` 生成（8.9s） |
| `npm run test:e2e` | ✅ smoke 3/3 通过（Node v24.18.0 实测；**注意**：isolated-vm 原生模块绑定 Node 24 ABI，Node 22 shell 下 E2E 加载失败——E2E/发布环境必须 v24+，与 `package.json` engines 一致） |
| `npm run check:docs` | ✅ 7 项文档一致性检查全过 |

## 4. 生产清单（15 概念模块 × 34 注册系统）

状态列口径：**Active** = 已注册进生产 bundle；**Pending Migration** = 已注册但按
R10 批 3 计划待合并；**Shadow-Only** = 设计源码存在但不进生产 bundle。
证据列 = 主要测试入口（完整层级见 [architecture/TEST_ARCHITECTURE.md](architecture/TEST_ARCHITECTURE.md)）。

| 概念模块 | 生产系统（注册名） | 源文件 | P 档 / 节奏 | 状态所有者要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| World Model | room-state | `src/systems/room-state.ts` | P0 / 每 tick | RoomState / ColonyState 唯一写者（必须最先运行） | Active | `tests/unit`（room/state 域） |
| World Model | （世界模型构建器） | `src/systems/room-snapshot.ts` | P0 / 每 tick | RoomSnapshot 每 tick 重建（经 `registerWorldModelBuilder` 注入，非 registerSystem） | Active | 同上 |
| Economy | economy | `src/systems/economy.ts` | P1 / 50t 房间错峰 | EconomyState（净流/储备/预算三指标） | Active | `tests/unit/economy/` |
| Economy（生产） | lab-system | `src/systems/lab-system.ts` | P1 / 每 tick 门控 | lab 反应 + boost 库存 | Active | `tests/unit`（lab 域） |
| Economy（生产） | factory-manager | `src/systems/factory-manager.ts` | P3 / 低频 | factory 商品 + powerSpawn battery 压缩 | Active | `tests/unit`（factory 域） |
| Economy（Power） | power-creep-manager | `src/systems/power-creep-manager.ts` | P3 / 低频 | GPL 消费闭环（create/upgrade/spawn） | Active | `tests/unit`（power 域） |
| Spawn | spawn-manager | `src/systems/spawn-manager.ts` | P0 / 每 tick | **spawnCreep 全局唯一写者**；SpawnState（车道/幂等 key/黑名单） | Active | `tests/unit`（spawn 域）+ integration |
| Logistics | logistics | `src/systems/logistics.ts` | P0 / 每 tick | 供需请求池（搬运 Demand 一等来源） | Active | `tests/unit/logistics/` |
| Logistics | logistics-planner | `src/systems/logistics-planner.ts` | P1 / 100t | 消费 networkSnapshot 产出 TransportPlan | **Pending Migration**（R10 批 3：并入 logistics） | `tests/unit`（logistics 域） |
| Logistics（分配） | assignment-system | `src/systems/assignment-system.ts` | P1 / 每 tick | 任务分配（先于 P1 角色；纯函数在 `src/domain/assignment/`） | Active | `tests/unit/logistics/assignment-*` |
| Logistics（link） | link-system | `src/systems/link-system.ts` | P1 / 每 tick 冷却内跳过 | link 网传输（冷却内跳过） | Active | `tests/unit/systems/link-*` |
| Logistics（terminal） | terminal-manager | `src/systems/terminal-manager.ts` | P3 / 低频 | **terminal 动作 + `Game.market.deal` 唯一写者**（TerminalManager） | Active | `tests/unit/logistics/terminal-*` |
| Empire | empire-strategy | `src/systems/empire-strategy.ts` | P1 / 每 tick 姿态 | posture 求值（唯一目标选择权落点） | Active | `tests/unit/strategy/` |
| Empire（聚合） | empire-economy | `src/systems/empire-economy.ts` | P1 / 100t | Empire Resource View / Health / Budget / Readiness 聚合 | Active | `tests/unit`（empire 域） |
| Empire（专业化） | specialization-planner | `src/systems/specialization-planner.ts` | P1 / 100t | 专业化机会评估 + 经济健康评估 | **Pending Migration**（R10 批 3：并入 empire-strategy） | `tests/unit`（specialization 域） |
| Agenda 管理 | agenda-manager | `src/systems/agenda-manager.ts` | P1 / 100t | AgendaItem 生命周期唯一写者（跨房调拨 Operation） | Active | `tests/unit`（agenda 域） |
| Construction | construction-manager | `src/systems/construction-manager.ts` | P2 / 10–50t | `createConstructionSite` 写者之一（自有房）；BuildQueue | Active | `tests/unit`（construction 域） |
| Construction（远矿） | remote-mining-manager | `src/systems/remote-mining-manager.ts` | P2 / 10t | `createConstructionSite` 写者之二（远矿房） | Active | `tests/unit/remote/` |
| Construction（布局） | layout-planner | `src/systems/layout-planner.ts` | P3 / 低频 | 布局队列推进（D2 下沉进行中，[ENGINEERING_BLUEPRINT](architecture/ENGINEERING_BLUEPRINT.md) §5-3） | Active | `tests/unit`（layout 域） |
| Defense | tower-defense | `src/systems/tower-defense.ts` | P0 / 每 tick | 塔动作唯一签发 | Active | `tests/unit/defense/` |
| Defense（规划） | defense-planner | `src/systems/defense-planner.ts` | P3 / 低频 | 防御规划（仅签发 rampart） | Active | `tests/unit/defense/` |
| Military | war-planning-system | `src/systems/war-planning-system.ts` | P2 / 10t | WarPlan 纯函数产出（写入 globalCache.warPlanCache） | Active | `tests/unit`（war 域） |
| Military | war-planner | `src/systems/war-planner.ts` | P2 / 战时事件式 | 唯一进攻执行决策者；attacker 孵化 | Active | `tests/unit`（war 域） |
| Military（战术） | tactical-runtime-pipeline | `src/systems/tactical-runtime-pipeline.ts` | P2 / 1t main + 内部分频 4 阶段 | R10 合并 A5.4.1–A5.4.4（war 姿态下运行） | Active | `tests/unit/tactical/` |
| Expansion | expansion-manager | `src/systems/expansion-manager.ts` | P3 / GCL 余量 | claim 新房执行（立项权在 Empire） | Active | `tests/unit`（expansion 域） |
| Expansion（评估） | expansion-planner | `src/systems/expansion-planner.ts` | P3 / 低频 | Pressure/Candidate/Cost/Risk/Plan 评估（不执行 claim） | Active | `tests/unit`（expansion 域） |
| Intelligence（观察） | room-observer | `src/systems/room-observer.ts` | P3 / 低频 | 房间观察（观察采集生产落点之一） | Active | `tests/unit`（observer 域） |
| Intelligence（侦察） | prospect-manager | `src/systems/prospect-manager.ts` | P3 / expansionAllowed | 侦察兵孵化（观察采集生产落点之二） | Active | `tests/unit`（prospect 域） |
| Military（准军事） | power-farm-manager | `src/systems/power-farm-manager.ts` | P3 / 低频 | PB 野采（power 自给，war 资源不双线） | Active | `tests/unit`（power-farm 域） |
| Observability | telemetry-collector | `src/systems/telemetry-collector.ts` | P3 / 低频采样 | L2 采样聚合（采集预算 ≤3% limit） | Active | `tests/unit`（telemetry 域） |
| Observability（kernel 面） | telemetry SDK 注册 | `src/telemetry/`（14 个 register*Metrics 调用） | 启动期 | L1 指标注册 + flush | Active | `tests/unit`（telemetry 域） |
| Execution Runtime（交通） | traffic-manager | `src/systems/traffic-manager.ts` | P0（post 阶段）/ 每 tick | tick 末按房仲裁，唯一 move 签发 | Active | `tests/unit`（traffic 域） |
| Self-Healing（诊断） | empire-health-system | `src/systems/empire-health-system.ts` | P1 / 100t | 8 维健康度 + Hysteresis + 失败传播 | **Pending Migration**（R10 批 3：并入 self-healing 概念容器，ADR 已裁决保留两系统分离） | `tests/unit`（empire-health 域） |
| Self-Healing（执行） | recovery-execution-system | `src/systems/recovery-execution-system.ts` | P1 / 10t | 消费 recoveryActions 翻译为 spawn/agenda/terminal/remote 指令 | Active（同上 ADR） | `tests/unit`（recovery 域） |
| 演化 / tuning | tuning-engine | `src/systems/tuning-engine.ts` | P3 / 500t | 读遥测调角色边界覆盖值（tuning 覆盖层） | Active | `tests/unit`（tuning 域） |
| CPU 政策 | pixel-system | `src/systems/pixel-system.ts` | P3 / bucket 满载 | 仅 Healthy 档生成 pixel | Active | `tests/unit`（pixel 域） |

**注册角色（19）**：worker(P0 灾后恢复)、defender/harvester/hauler/distributor/remote-harvester/remote-hauler/remote-defender/core-clearer/carrier(P1)、upgrader/builder/reserver/claimer/mineral-miner/attacker/healer(P2)、scout/pb-collector(P3)——与 `CONFIG.roles` 白名单强制 parity（role-config-parity 测试）。

**未单独注册的生产源文件**（被注册系统内部消费，非独立管线成员）：

| 文件 | 消费者 | 说明 |
| --- | --- | --- |
| `src/systems/tactical-runtime-system.ts`、`squad-movement-runtime.ts`、`tactical-engagement-runtime.ts`、`combat-micro-runtime.ts` | tactical-runtime-pipeline | R10 合并后的 4 阶段实现文件，经 pipeline 注册 |
| `src/systems/site-quota.ts` | construction-manager、remote-mining-manager、global-cache | site 配额共享实现 |

**Shadow-Only（R11 裁决，不进生产 bundle、不被任何 src 文件导入）**：

| 源码 | 内容 | 测试 | 处置 |
| --- | --- | --- | --- |
| `src/domain/intelligence/`（约 20 文件） | A6 智能层（attribution/baseline/calibration/experience/outcome/prediction/recommendation/reliability/strategy-evaluation/uoem） | `tests/unit/intelligence/*`——**只验证设计源码** | 后续分批清理；恢复须走新 ADR |
| `src/domain/strategy/decision-trace.ts` | 决策追溯纯函数设计源码 | `tests/unit/strategy/a4-7-decision-trace.test.ts`——**只验证设计源码** | 同上 |

> ⚠️ `tests/e2e/scenarios/11-decision-trace.test.ts` 断言生产运行日志出现 decision-trace
> 输出；R11 后生产 bundle 无该模块与日志发射点，该 E2E 与 R11 冲突，在重定向或
> 移除前不得作为生产行为证据（[INTELLIGENCE_ARCHITECTURE.md](architecture/INTELLIGENCE_ARCHITECTURE.md) §0）。

## 5. 验证等级现状（等级定义见 [architecture/ARCHITECTURE_VALIDATION.md](architecture/ARCHITECTURE_VALIDATION.md) §0）

| 等级 | 当前状态 |
| --- | --- |
| Design-Verified | ✅ 十场景（Scenario A–J）+ 双红队闭合（冻结日 2026-08-23） |
| Code-Verified | ✅ 本快照 commit：typecheck 0 error + 5258 测试全绿 + build 成功（§3） |
| Integration-Verified | ◐ 单房私服链路有历史证据；多房/低 CPU 场景未覆盖（见 Blocked） |
| Soak-Verified | ❌ **无当前版本 soak 证据**。旧数据集（sv=39 ≠ 当前 42）整体降级为 Historical Evidence 且 artifact 绑定待补（[CANARY_SOAK_PROCEDURE.md](implementation/CANARY_SOAK_PROCEDURE.md) §5） |
| Release-Ready | ❌ 不满足（Soak-Verified 缺失 + 下列 Blocked 项） |

**Blocked 项登记**（不得描述为已发布能力）：

- RCL1→5 私服 soak 覆盖缺失（历史数据仅覆盖 RCL6+ 证据）
- 多房私服 soak 全项（第二房 Claim→Bootstrap、spawn 竞争、site quota、能量互济、故障隔离）
- 低 CPU 私服 soak 全项（模拟 MMO 20 CPU、四档 tier 切换实测、bucket 枯竭）
- global reset 恢复实测（历史 soak 0 次 reset）
- tier 切换实测（历史 soak 全程 healthy）
- 旧 soak 数据 schema 错位（sv=39 vs 42）
- Emergency Survival Mode 未实现（设计态规范）
- R10 批 3 系统合并未执行（specialization-planner / logistics-planner / empire-health 归并）

## 6. 本文件维护方式

固定刷新命令（更新对应章节后提交）：

```bash
git rev-parse HEAD                      # §1 基准 commit
grep -c "registerSystem(" src/bootstrap.ts   # §2 系统数（应为 34，变化须走 ADR）
grep -c "registerRole(" src/bootstrap.ts     # §2 角色数
grep "schemaVersion" src/config/index.ts     # §2 schema
npm run typecheck && npm test && npm run build   # §3 门禁
npm run check:docs                      # 校验本文件口径与源码一致
```
