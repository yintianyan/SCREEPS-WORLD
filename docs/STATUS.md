# STATUS · 当前实现状态快照（唯一入口）

> **文档体系冻结声明（2026-08-28）**：自本快照起，docs/ 三层体系（本文件＝现状、
> architecture/＝冻结契约、research/＝历史证据）作为唯一实现合同进入冻结态。
> 契约文档改动只走 [ARCHITECTURE_FREEZE.md](architecture/ARCHITECTURE_FREEZE.md)
> §15 ADR；本文件现状数字只经 §7 刷新程序与 `npm run docs:inventory` 更新；
> `npm run check:docs` 七项一致性检查为合并门槛（[architecture/TEST_ARCHITECTURE.md](architecture/TEST_ARCHITECTURE.md) §2/§4）。
> 下一步代码工作以 §6 重构 backlog 为唯一工作项来源（TEST_ARCHITECTURE §7 重构合同）。

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
| 快照日期 | 2026-08-29（war 轨 W1–W5 收口盘点） |
| 基准 commit | `5df48ee`（dev 分支；war 轨五项验收全落账 + E2E-023 断言双路径化，详见 §6 W1–W5） |
| 运行模式 | 官方 Screeps World · TypeScript bot（`dist/main.js` 由 rollup 打包） |
| 口径约定 | 概念模块 = SYSTEM_BOUNDARIES §1 的 15 模块；生产系统 = `bootstrap.ts` `registerSystem()` 实际注册项；源文件 = `src/systems/` 等实际文件。三者不是同一统计对象，不得互换 |

## 2. 核心口径（与源码一一对应）

| 项 | 当前值 | 源码真相源 |
| --- | --- | --- |
| 生产注册系统数 | **33**（`registerSystem` 调用数；R10 记 36、R11 修正为 34、B1 批 3 合并后 32、B4 新增 intelligence 后 33） | `src/bootstrap.ts` |
| 生产注册角色数 | **19**（`registerRole` 调用数） | `src/bootstrap.ts` |
| Memory schemaVersion | **43**（迁移链 43 步：0→43，逐级迁移；v43 = legacy intel 桥退役清理，R15/B7） | `src/config/index.ts` `CONFIG.memory.schemaVersion`、`src/kernel/memory.ts` `MIGRATIONS` |
| CpuTier 枚举 | **四档**：`healthy / guarded / conserve / recovery`（不存在第五档） | `src/kernel/contracts.ts` |
| CpuTier bucket 阈值 | healthy 7000 / guarded 3000 / conserve 1000 / recovery 0（降级立即生效；恢复滞回 500 + 20 tick） | `src/config/index.ts` `CONFIG.cpu.tiers` |
| Emergency Survival Mode | **设计态，未实现**（发布运行态规范，见 [implementation/RELEASE_GATE_AND_ROLLBACK.md](implementation/RELEASE_GATE_AND_ROLLBACK.md) §5.2；不是 CpuTier 成员） | — |
| `src/` 规模 | 352 个 .ts / 87,064 行（kernel 19/5.3k、systems 41/19k、domain 213/49.6k、creeps 48/8k、telemetry 24/2.4k、config 4/1.6k、types 1/0.9k、根 2 文件；B5 清理 Shadow-Only 47 文件后实测） | 目录实测（刷新时重测） |
| 市场成交唯一写者 | **TerminalManager**（`Game.market.deal` 唯一调用点；不存在 `MarketManager`） | `src/systems/terminal-manager.ts` |

## 3. 门禁结果（本快照 commit 实测）

| 门禁 | 结果 |
| --- | --- |
| `npm run typecheck` | ✅ 0 error |
| `npm test`（unit + integration） | ✅ 324 文件 / 4678 测试全绿（2026-08-29 war 轨收口实测） |
| `npm run build` | ✅ `dist/main.js` 生成 |
| `npm run test:e2e` | ✅ 全套件 29 文件 / 65 用例全绿（2026-08-31 市场链路验证实测 @Node v24.18.0，含 E2E-020 claim 链 / 021 诱饵对抗 / 022 战争账本 / 023 止损链 / 024 战后核验 / 026 市场交易链路）；**注意**：isolated-vm 原生模块绑定 Node 24 ABI，Node 22 shell 下 E2E 加载失败——E2E/发布环境必须 v24+，与 `package.json` engines 一致 |
| `npm run check:docs` | ✅ 7 项文档一致性检查全过 |

## 4. 生产清单（15 概念模块 × 33 注册系统）

状态列口径：**Active** = 已注册进生产 bundle；**Shadow-Only** = 设计源码存在但不进
生产 bundle。证据列 = 主要测试入口（完整层级见
[architecture/TEST_ARCHITECTURE.md](architecture/TEST_ARCHITECTURE.md)）。

<!-- inventory:begin —— 本表由 `npm run docs:inventory` 从 bootstrap.ts 生成合并（手工列按键保留），勿整表手工重排 -->
| 概念模块 | 生产系统（注册名） | 源文件 | P 档 / 节奏 | 状态所有者要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| World Model | room-state | `src/systems/room-state.ts` | P0 / 每 tick | RoomState / ColonyState 唯一写者（必须最先运行） | Active | `tests/unit`（room/state 域） |
| Economy | economy | `src/systems/economy.ts` | P1 / 50t 房间错峰 | EconomyState（净流/储备/预算三指标） | Active | `tests/unit/economy/` |
| Spawn | spawn-manager | `src/systems/spawn-manager.ts` | P0 / 每 tick | **spawnCreep 全局唯一写者**；SpawnState（车道/幂等 key/黑名单） | Active | `tests/unit`（spawn 域）+ integration |
| Defense | tower-defense | `src/systems/tower-defense.ts` | P0 / 每 tick | 塔动作唯一签发 | Active | `tests/unit/defense/` |
| Empire | empire-strategy | `src/systems/empire-strategy.ts` | P1 / 每 tick 姿态 | posture 求值（唯一目标选择权落点）；专业化规划并入（100t 相位门，见下方 helper 表） | Active | `tests/unit/strategy/` |
| Empire（聚合） | empire-economy | `src/systems/empire-economy.ts` | P1 / 100t | Empire Resource View / Health / Budget / Readiness 聚合 | Active | `tests/unit`（empire 域） |
| Agenda 管理 | agenda-manager | `src/systems/agenda-manager.ts` | P1 / 100t | AgendaItem 生命周期唯一写者（跨房调拨 Operation） | Active | `tests/unit`（agenda 域） |
| Logistics | logistics | `src/systems/logistics.ts` | P0 / 每 tick | 供需请求池（搬运 Demand 一等来源）；帝国物流规划并入（100t 相位门，见下方 helper 表） | Active | `tests/unit/logistics/` |
| Logistics（分配） | assignment-system | `src/systems/assignment-system.ts` | P1 / 每 tick | 任务分配（先于 P1 角色；纯函数在 `src/domain/assignment/`） | Active | `tests/unit/logistics/assignment-*` |
| Logistics（link） | link-system | `src/systems/link-system.ts` | P1 / 每 tick 冷却内跳过 | link 网传输（冷却内跳过） | Active | `tests/unit/systems/link-*` |
| Economy（生产） | lab-system | `src/systems/lab-system.ts` | P1 / 每 tick 门控 | lab 反应 + boost 库存 | Active | `tests/unit`（lab 域） |
| Construction | construction-manager | `src/systems/construction-manager.ts` | P2 / 10–50t | `createConstructionSite` 写者之一（自有房）；BuildQueue | Active | `tests/unit`（construction 域） |
| Construction（远矿） | remote-mining-manager | `src/systems/remote-mining-manager.ts` | P2 / 10t | `createConstructionSite` 写者之二（远矿房） | Active | `tests/unit/remote/` |
| Intelligence（写者） | intelligence | `src/systems/intelligence.ts` | P2 / 10t（老化 100t 相位门） | **IntelState 唯一写者**（R14）：三分置信度 + TTL 分档 + 房间域 heap 环形覆盖 + 玩家域 segment 冷存；查询走只读 API | Active | `tests/unit/intel/` + `tests/unit/systems/intelligence.test.ts` |
| Self-Healing（诊断） | empire-health-system | `src/systems/empire-health-system.ts` | P1 / 100t | 8 维健康度 + Hysteresis + 失败传播（ADR 裁决与 recovery-execution 保留分离） | Active | `tests/unit`（empire-health 域） |
| Self-Healing（执行） | recovery-execution-system | `src/systems/recovery-execution-system.ts` | P1 / 10t | 消费 recoveryActions 翻译为 spawn/agenda/terminal/remote 指令 | Active（同上 ADR） | `tests/unit`（recovery 域） |
| Military | war-planning-system | `src/systems/war-planning-system.ts` | P2 / 10t | WarPlan 纯函数产出（写入 globalCache.warPlanCache） | Active | `tests/unit`（war 域） |
| Military | war-planner | `src/systems/war-planner.ts` | P2 / 战时事件式 | 唯一进攻执行决策者；attacker 孵化 | Active | `tests/unit`（war 域） |
| Military（战术） | tactical-runtime-pipeline | `src/systems/tactical-runtime-pipeline.ts` | P2 / 1t main + 内部分频 4 阶段 | R10 合并 A5.4.1–A5.4.4（war 姿态下运行） | Active | `tests/unit/tactical/` |
| Construction（布局） | layout-planner | `src/systems/layout-planner.ts` | P3 / 低频 | 布局规划编排薄壳（stage 纯核已下沉 domain/layout，[ENGINEERING_BLUEPRINT](architecture/ENGINEERING_BLUEPRINT.md) §5-3 ✅） | Active | `tests/unit`（layout 域） |
| Defense（规划） | defense-planner | `src/systems/defense-planner.ts` | P3 / 低频 | 防御规划（仅签发 rampart） | Active | `tests/unit/defense/` |
| Intelligence（观察） | room-observer | `src/systems/room-observer.ts` | P3 / 低频 | 房间观察（观察采集生产落点之一） | Active | `tests/unit`（observer 域） |
| CPU 政策 | pixel-system | `src/systems/pixel-system.ts` | P3 / bucket 满载 | 仅 Healthy 档生成 pixel | Active | `tests/unit`（pixel 域） |
| Logistics（terminal） | terminal-manager | `src/systems/terminal-manager.ts` | P3 / 低频 | **terminal 动作 + `Game.market.deal` 唯一写者**（TerminalManager） | Active | `tests/unit/logistics/terminal-*` |
| Economy（生产） | factory-manager | `src/systems/factory-manager.ts` | P3 / 低频 | factory 商品 + powerSpawn battery 压缩 | Active | `tests/unit`（factory 域） |
| Economy（Power） | power-creep-manager | `src/systems/power-creep-manager.ts` | P3 / 低频 | GPL 消费闭环（create/upgrade/spawn） | Active | `tests/unit`（power 域） |
| Expansion | expansion-manager | `src/systems/expansion-manager.ts` | P3 / GCL 余量 | claim 新房执行（立项权在 Empire） | Active | `tests/unit`（expansion 域） |
| Expansion（评估） | expansion-planner | `src/systems/expansion-planner.ts` | P3 / 低频 | Pressure/Candidate/Cost/Risk/Plan 评估（不执行 claim） | Active | `tests/unit`（expansion 域） |
| Military（准军事） | power-farm-manager | `src/systems/power-farm-manager.ts` | P3 / 低频 | PB 野采（power 自给，war 资源不双线） | Active | `tests/unit`（power-farm 域） |
| Intelligence（侦察） | prospect-manager | `src/systems/prospect-manager.ts` | P3 / expansionAllowed | 侦察兵孵化（观察采集生产落点之二） | Active | `tests/unit`（prospect 域） |
| Observability | telemetry-collector | `src/systems/telemetry-collector.ts` | P3 / 低频采样 | L2 采样聚合（采集预算 ≤3% limit） | Active | `tests/unit`（telemetry 域） |
| 演化 / tuning | tuning-engine | `src/systems/tuning-engine.ts` | P3 / 500t | 读遥测调角色边界覆盖值（tuning 覆盖层） | Active | `tests/unit`（tuning 域） |
| Execution Runtime（交通） | traffic-manager | `src/systems/traffic-manager.ts` | P0（post 阶段）/ 每 tick | tick 末按房仲裁，唯一 move 签发 | Active | `tests/unit`（traffic 域） |
| World Model | （世界模型构建器） | `src/systems/room-snapshot.ts` | P0 / 每 tick | RoomSnapshot 每 tick 重建（经 `registerWorldModelBuilder` 注入，非 registerSystem） | Active | 同上 |
| Observability（kernel 面） | telemetry SDK 注册 | `src/telemetry/`（14 个 register*Metrics 调用） | 启动期 | L1 指标注册 + flush | Active | `tests/unit`（telemetry 域） |
<!-- inventory:end -->

**注册角色（19）**：worker(P0 灾后恢复)、defender/harvester/hauler/distributor/remote-harvester/remote-hauler/remote-defender/core-clearer/carrier(P1)、upgrader/builder/reserver/claimer/mineral-miner/attacker/healer(P2)、scout/pb-collector(P3)——与 `CONFIG.roles` 白名单强制 parity（role-config-parity 测试）。

**未单独注册的生产源文件**（被注册系统内部消费，非独立管线成员）：

| 文件 | 消费者 | 说明 |
| --- | --- | --- |
| `src/systems/tactical-runtime-system.ts`、`squad-movement-runtime.ts`、`tactical-engagement-runtime.ts`、`combat-micro-runtime.ts` | tactical-runtime-pipeline | R10 合并后的 4 阶段实现文件，经 pipeline 注册 |
| `src/systems/logistics-planner.ts` | logistics（100t 相位门内调用） | 帝国物流规划（TransportPlan/运力/健康度/Accounting）——原独立系统，B1 合并为 helper |
| `src/systems/specialization-planner.ts` | empire-strategy（100t 相位门内调用） | 专业化规划（Opportunity 执行门控/远矿健康度/Supply Contract 维护）——原独立系统，B1 合并为 helper |
| `src/systems/site-quota.ts` | construction-manager、remote-mining-manager、global-cache | site 配额共享实现 |

**Shadow-Only（R11 裁决）——已清理（2026-08-29，B5）**：原孤岛 `src/domain/intelligence/`
（46 文件，A6 智能层）与 `src/domain/strategy/decision-trace.ts` 已删除，仅验证设计源码的
24 个测试文件（`tests/unit/intelligence/`、`tests/unit/phase37/closure/`、`tests/unit/calibration/`
等）同步移除；src 无孤岛文件，bundle parity 守卫绿，`check:docs` 第 5 项继续守护已删文件
不复活。恢复注册须走新 ADR（R14 裁决不恢复 A6 智能层）。

> ~~tests/e2e/scenarios/11-decision-trace.test.ts 与 R11 冲突~~——已随 B3 移除（2026-08-29）：
> 生产唯一 outcome 发射点为扩张完成路径，单房 E2E 场景不可达，重定向即空断言；
> 通用长稳断言由 E2E-006（10000t）覆盖（[INTELLIGENCE_ARCHITECTURE.md](architecture/INTELLIGENCE_ARCHITECTURE.md) §0）。

## 5. 验证等级现状（等级定义见 [architecture/ARCHITECTURE_VALIDATION.md](architecture/ARCHITECTURE_VALIDATION.md) §0）

| 等级 | 当前状态 |
| --- | --- |
| Design-Verified | ✅ 十场景（Scenario A–J）+ 双红队闭合（冻结日 2026-08-23） |
| Code-Verified | ✅ 基准 commit + B6 验证轨工作树：typecheck 0 error + 4727 测试全绿 + build 成功 + smoke 3/3（§3） |
| Integration-Verified | ✅ 私服 mockup 集成场景 @ sv43：单房全链（E2E-016 20k+50k+100k+200k+300k tick）+ 多房并行与故障隔离（E2E-017）+ 低 CPU 四档链（E2E-015）+ ESM 全链（E2E-018）+ terminal 决策权（E2E-019）+ P3 旁路整环（p3-bypass-loop） |
| Soak-Verified | ◐ **sv=43 当前版本证据已建立**（E2E-016：20k+50k+100k+200k+300k tick RCL1→5 自举 + 200k tick RCL5 起步注入轨 / 0 JS 错误 / Memory ≤ 15KB / criticalViolations=0，E7 builderVisits + E7 阈值校准 5000t + E8 死 creep 清理 + E9 阈值校准 5000t + TD-001 弃目标黑名单 + repathLimit 2→4 调优，绑定齐全）；整体升级 Soak-Verified 待 hostile/恢复维度当前版本证据与 RCL6→8（[CANARY_SOAK_PROCEDURE.md](implementation/CANARY_SOAK_PROCEDURE.md) §5）；sv=39 旧数据集为 Historical Evidence |
| Release-Ready | ❌ 不满足（Soak-Verified 整体升级待 hostile/恢复与 RCL7→8；发布流程未执行——见 RELEASE_GATE canary 序） |

**Blocked 项登记**（不得描述为已发布能力；B6 验证轨 2026-08-29 启动后状态）：

- ◐ RCL1→8 私服 soak 覆盖：sv=43 已实测 RCL1→5 自然晋级（E2E-016 自举轨 300k tick，criticalViolations=0，RCL5@t=85k 自然达成，link 网络@t=105k 开始分散交通）+ RCL6 注入轨 500k tick 全通过（criticalViolations=0，jsErrors=0，bucket=10000 全程，tier=healthy 全程，extensions@t=30k 建成 11 个，storage 耗尽后仍存活 20k+ tick；upRate=0.03/t — 注入能量耗尽后 upgrader 停滞但帝国不死亡）；RCL7→8 待更长程 soak
- ◐ 多房私服 soak：双自有房并行 + spawn 竞争 + 一房全灭故障隔离已实测（E2E-017）；terminal 决策权语义已锁定（E2E-019：Plan 活跃压制 self-aid）；claim 授权全链已实测（E2E-020 @ sv43，2026-08-29）；Plan 驱动互济证据（E2E-019 energy-aid）；site quota 极限注入待继续
- ✅ 市场交易链路验证（E2E-026 @ sv43，2026-08-31）：NPC 订单 DB 注入 → Game.market.getAllOrders 返回 2 订单（1 sell + 1 buy）→ Game.market.deal/calcTransactionCost API 可用 → 0 JS 错误 → Memory 有界；动态定价系统（market-pricing + deal-scheduler + terminal-policy）纯函数层全链路审查通过；降级路径：tier≠healthy/guardied 或 bucket<minBucket 时 terminal-manager 跳过（非生存关键）；global reset 恢复：marketPrices heap 存储，reset 后首 tick refreshMarketPrices 重建，fallback 值在行情空窗期兜底
- ✅ war 轨对抗验证（Scenario F 四门槛）：诱饵不触发授权（E2E-021）、fact 真目标授权 + 经济不越红线（E2E-022）、止损触发即收摊（E2E-023，伤亡/经济双路径）、战后核验 intel 一致（E2E-024）——详见 §6 W1–W5
- ◐ 低 CPU 私服 soak：四档 tier 降级链 + bucket 逼近枯竭已实测（E2E-015）；P3 饥饿旁路 E2 整环闭环已实测（p3-bypass-loop，2026-08-29）——仅剩 E2 触发的自然 soak 窗口证据
- ✅ global reset 恢复实测：E2E-005 注入场景 @ sv43 全绿（2026-08-29）
- ✅ tier 切换实测：四档全链 + 滞回爬升 @ sv43（E2E-015，此前历史 soak 全程 healthy）
- ◐ 旧 soak 数据 schema 错位（sv=39 历史集为 Historical Evidence，代码 sv=43）：sv=43 20k+50k+100k+200k+300k tick 深度 soak 已绿（criticalViolations=0，E7/E8/E9/TD-001/repathLimit 修复后）；500k+ tick 继续积累
- ✅ Emergency Survival Mode 已实现（R17，2026-08-29：createBudget 状态机 + P0 车道收缩 + E2E-018 注入全链验证；发现于 RELEASE_GATE §5.2 设计态规范的最后一项内核能力缺口）

> 重构侧待办的唯一工作项清单见 §6 重构 backlog（B1–B6）；验证侧 Blocked 的执行
> 顺序亦在该节统一编排。

## 6. 重构 backlog（现状治理轨 · 代码实现期唯一工作项来源）

依据 TEST_ARCHITECTURE §7 重构合同执行：每项完成必须交付行为保持四件套
（测试集合不变＋e2e smoke＋架构合规含 R12＋清单刷新）。**本表冻结为工作项清单；
新增/删除/改序走 FREEZE §15。**

| # | 工作项 | 合同依据 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- |
| B1 | R10 批 3 有效合并：specialization-planner→empire-strategy、logistics-planner→logistics | FREEZE R10 追记 · BLUEPRINT §5-12 | 注册数 34→32 并经 §7 程序刷新 STATUS；行为保持四件套 | ✅ 2026-08-28（四件套：测试 344 文件/5260 用例与基线逐数一致、smoke 3/3 @Node24、合规测试含 R12 全绿、清单已刷新；相位核对 spec=16/logi-planner=4/agenda=72 两两错开，数据时序零漂移） |
| B2 | layout-planner D2 剩余下沉：`planStage0-3` 四个规划函数参数注入后下沉 `src/domain/layout/` | BLUEPRINT §5-3 | domain/layout 纯函数律 lint 绿；layout-planner 行数收敛至锚带 | ✅ 2026-08-28（四核下沉：`buildStage0PlanData`/`planCoreStage`/`planLogisticsStage`/`planSpawnRebuild`；layout-planner 1033→790 行；domain 纯函数律自检干净；四件套与 B1 同标准全绿） |
| B3 | E2E-011（decision-trace）与 R11 对齐：重定向为遥测 outcome 断言或移除 | BLUEPRINT §5-13 | tests/e2e 无 R11 冲突断言；E2E 全套件可跑通 | ✅ 2026-08-29（**裁决移除**——生产唯一 outcome 发射点为扩张完成路径，单房 E2E 场景不可达，重定向即空断言；通用长稳断言由 E2E-006（10000t，同断言更严）覆盖。全套件 18 文件 / 54 用例全绿 @Node v24.18.0（908s）；运行窗口内被移除的 11-decision-trace 文件记 1 个 failed suite 为删除工件，非测试失败） |
| B4 | 情报架构 ADR 裁决：实现完整版（IntelState 唯一写者/segment/三分置信度）vs 登记生产简化版（`Memory.rooms[].intel`+lastSeen）为当前合同 | BLUEPRINT §5-14 | FREEZE §15 新 ADR 行 + 受影响文档同步标注 | ✅ 2026-08-29（**裁决：实现完整版**→ FREEZE R14：`intelligence` 系统注册 32→33，IntelState 唯一写者/三分置信度/TTL 分档/环形覆盖/玩家域 segment 冷存/硬门槛查询落地；legacy 桥只读并存，消费者迁移为 war 轨前置；新增 25 测试全绿） |
| B5 | Shadow-Only 分批清理：`src/domain/intelligence/`（46 文件）+ `src/domain/strategy/decision-trace.ts` | FREEZE R11 · BLUEPRINT §5-11 | src 无孤岛文件；bundle parity 守卫绿；**前置依赖 B4 裁决**（选完整版则转恢复注册轨） | ✅ 2026-08-29（**R14 裁决完整版落地但 A6 智能层不恢复（R14 原文），按清理轨执行**：src 孤岛 47 文件已删除（domain/intelligence 46 + decision-trace 1），测试侧删 24 文件 / 619 用例（channel-isolation 瘦身保留生产 outcome-channel 断言、a5-1 死 import 清理）；门禁全绿——typecheck 0 error、322 文件/4666 用例、build 成功、smoke 3/3 @Node24、compliance+bundle-parity 对新 dist 复跑绿、bundle 零 shadow 标记；契约文档 6 处同步） |
| B6 | 验证轨启动（Blocked 项的执行编排，属代码/运行期，非纯重构）：低 CPU 私服 soak（触发 tier 降级链）→ global reset 注入 → sv=42 单房 soak 重跑 | STATUS §5 · CANARY §5 | §5 Blocked 前三项有当前版本证据；A1/A2 升级为 Code/Soak-Verified | ✅ 2026-08-29（**启动完成**——三项环境类证据齐：①低 CPU 四档 tier 降级链 + 滞回爬升实测（E2E-015，driver 记账实证 + 逐档注入，0 JS 错误、全程存活）；②global reset 注入 @ sv43（E2E-005 全套件绿）；③sv=43 单房 soak 重跑 20,000 tick（E2E-016：RCL1→3 自然晋级、Memory ≤ 11KB、0 JS 错误）。证据登记 CANARY §5.1/§5.3（绑定 commit/sv/tick/collectedAt）。**继续项（深度升级 A1/A2 至 Soak-Verified）**：50k+ tick 深度 soak、RCL4→8、多房全项、P3 饥饿旁路 E2 专项注入——属持续运行轨，不再阻塞代码工作项） |
| W1 | war 授权硬门槛接入：war-planner/war-planning-system 目标选择切换 `intelActionUsable`（fact 级 + 年龄上限）；demobilize 战后核验非 fact 降级 unknown | FREEZE R18 | 行为保持四件套；stale-but-fresh intel 不再授权（INTELLIGENCE §5） | ✅ 2026-08-29（`0b7c21a`：目标选择与战后核验只认 fact 级情报；由 W2/W3 对抗场景双向验证——诱饵 stale 不授权（E2E-021）、fact 真目标授权（E2E-022）） |
| W2 | 诱饵对抗场景（Scenario F）：空城伪装/诱饵塔不触发授权 | FREEZE R18 | 诱饵不触发授权（Phase 9 验收） | ✅ 2026-08-29（`e1865a7`：E2E-021 三连通过 warSeen/decoyAuthorized=false/jsErrors=0；顺带修复注入 creep 缺 store 字段引发的首 1500t 静默死区——buildSnapshots 防御 + WorldBuilder canonical store 形态） |
| W3 | war 账本证据：战争全程经济不越红线的 e2e 战例 | FREEZE R18 | 战争全程经济不越红线（Phase 9 验收） | ✅ 2026-08-29（`cfd3d73`：E2E-022——fact 真目标授权 + warPressureTicks 峰值 0（无持续越限）+ colonyState 全程不入 recovery + storage 谷值 32.6k ≥ 8000 + spawned 19 ≤ 止损上限 + war 中途零振荡；框架增 addHostileTower——无主建筑对 FIND_HOSTILE_STRUCTURES 双盲） |
| W4 | 止损链实测：spawned 超限收摊 / warBlacklist 冷却 / 满编才 advance | FREEZE R18 | 止损触发即收摊；满编才推进（Phase 9 验收） | ✅ 2026-08-29（E2E-023：真实敌方 bot 塔防 AI 战损源 + 不可破塔 → REASON_ATTRITION@8361/8371 两连触发、outcome=failure、满额黑名单 20000t、warPlan 清除、warStandDownUntil +2000t、12 advance 样本全部满编（canBoost=false 降级裸攻无宽限）——诊断附带证实 harvester 换代空窗 bootstrap 闪烁是 war 姿态不稳根因，场景以周期补种封死） |
| W5 | 战后核验战例：evaluateWarOutcome 只信战后新鲜 fact 级观察 | FREEZE R18 | 战后核验证据（Phase 9 验收） | ✅ 2026-08-29（E2E-024 两连通过：demobilize 全链路核验——war 立项@5001 → POSTURE 翻转触发核验@6551/6631 → outcome=failure 严格对应核验时点 fresh fact（towers=1 塔未破不判胜）→ 满额黑名单 20000t + plan 清除 + 冷却期内不重立项。unknown→半额/success→无黑名单分支由 evaluateWarOutcome 单测层覆盖；E2E 构造「战后情报失明」与编队视野保鲜动力学冲突（mockup post-t0 注入 TTL 语义异常 + attacker 在房即为视野源），登记为结构限制不再追） |
| B7（已收口存档） | 情报消费者迁移：war-planner / expansion-manager / remote-mining-manager / power-farm-manager / prospect-manager / empire-strategy 从 legacy `Memory.rooms[].intel` 直读迁移到 IntelQuery 只读 API；迁移完成后 legacy 桥退役 | FREEZE R14 | 全部消费者走 IntelQuery；legacy `Memory.rooms[].intel` 写侧下线（schema 届时按迁移规范处理）；行为保持四件套 | ✅ 2026-08-29（**FREEZE R15 ADR 登记**：11 消费者文件迁移 IntelQuery——B7 行名 6 系统 + 考古增补 war-planning-system / expansion-planner / tactical-runtime-system / specialization-planner / room-observer；IntelEntry 新增 observedBy 归属房；查询 API 扩充 queryRoomIntel 枚举 + intelPayloadView 视图；观察采集改 `globalCache.intelHandoff` 交接通道（room-observer 管线写、intelligence 采用清空，唯一写者不变）；legacy 桥写侧下线 + v43 迁移清理存量（sv 42→43，迁移测试 1 文件/3 用例）；R11 白名单 +11 条公开查询边。四件套：typecheck 0 error、323 文件/4668 用例全绿、build 成功、E2E 全套件 18 文件/54 用例 @Node24（887s）、compliance+bundle-parity 绿、check:docs 全绿。多房 subject 去重语义收敛已由 R15 追认，多房 soak 验证归验证轨持续项） |
| T1 | tests/support 统一脚手架内核 + 常量 SSOT 接线：`@screeps/driver` constants 升显式 devDep；setup.ts 私有 FIND 编码退役改注入官方值；TestWorld 本地常量表（RCL_PROGRESS/PART_COST/BUILD_COST/FIND_*）删除改 import；e2e parity 哨兵场景落地 | FREEZE R20 | 行为保持四件套；被假常量污染的 integration 断言预期值修正逐例登记（R20④豁免条款）；parity 场景绿 | ✅ 2026-08-30（`8c309cf`+`1b945db`：driver 5.3.0 显式 devDep；setup 官方值注入；TestWorld 四表退役——BUILD_COST.spawn 30000→15000 漂移修正后 integration 零断言破损（R20④豁免未触发）；E2E-028 parity 80 键全一致，登记 mockup 保真度缺口 BASE_MINERALS。**事故教训**：driver 主模块拉起 isolated-vm 原生链——unit/integration 因此需完整安装，`--ignore-scripts` 安装会 297 套件全加载失败（8c309cf 的 deploy run 即此因，T2 完整安装后自愈）） |
| T2 | e2e 冒烟进 deploy 门禁（§4 PR 编排落地）+ AGENT.md 命令清单对齐 §2 口径 + bundle parity 守卫归一 integration 侧（§2 登记位置修订） | FREEZE R20 | CI deploy workflow 含 smoke 步骤且绿；compliance.test.ts dist-skip 分支删除 | ✅ 2026-08-30（`ee1a6ab`+`0b44009`：deploy 全量 npm ci + smoke 步骤，run 8m35s/8m57s 绿；AGENT.md 清单对齐；parity 守卫归一 integration 侧（§2 修订）+ 顺带修复 CI 全量安装阻断根因——顶层 isolated-vm 残留 devDep 删除 `f5701f3`） |
| T3 | 断言/错误过滤/census 归并：e2e `isJsError` 26 处 → `support/errors` 唯一实现；`SnapshotInspector.structureCensus()` 新增；16-soak 内联 CENSUS 字符串改 inspector 查询（证据行输出格式不变） | FREEZE R20 | 行为保持四件套；grep 验证仓内 `function isJsError` 本地定义为 0 | ✅ 2026-08-30（`a9e5f7e`+`1b945db`：16 本地函数 + 9 内联 + 1 helper → support/errors 唯一实现；SnapshotInspector 增 structureCensus/roleBodyPartHistogram/controllerProgress/siteCensus/creepHitPoints 引擎真值查询（roomObjects 按 type ∈ STRUCTURE_* 判别——DB 原始对象无 structureType 字段）；16-soak CENSUS 字符串退役、证据行格式保持） |
| T4 | unit 工具层归并：role-helpers 升格 `support/factories`；makeStore×3 雷同、孪生 makeBudget、3 影子 mockSnapshot、makeSnapshot×16、makeContext×10、makeCreep×6 归并 defaults+overrides；150 文件 import 迁移后删 role-helpers.ts | FREEZE R20 | 行为保持四件套（测试集合数与断言语义不变）；role-helpers.ts 删除 | ◐ 2026-08-31（**批①完成**：`9cd8926` role-helpers 357 行升格 support/factories + 过渡 re-export；`a9e5f7e` mockCapacityStore 归并 room-state 系 makeStore×3 + 孪生 makeBudget 上提 + MockPos/MockCreepOpts 死导出转内部。**批②完成**：`dd6d980` 新增 `mockRoomStateCtx` 共享工厂，4 个 room-state 单元测试 makeCtx 归并（room-state/src-ratio/defense-stale/observer），清理 TickContext 死 import，4727 测试全绿。**批②审计结论**：其余 31 个本地 makeSnapshot/makeContext/makeCreep 工厂签名和返回类型各异（TacticalSnapshot/EmpireSnapshot/RecoveryWorldSnapshot 等不同类型），属于领域特定构造器，不可安全归并。**批③缓期**：150 文件 import 迁移 role-helpers→support/factories 触及并行轨活跃区，移至低流量窗口执行；role-helpers.ts 过渡 barrel 保留） |
| T5 | 孤儿治理：integration Assertions 10 个零调用方法、tickRunner 单例、stuckCreeps、两 barrel 22 个死 re-export、SnapshotInspector 零调用方法、disasterRoom、run-e2e.mjs/smoke-e2e.cjs 删除；e2e/setup.ts 与 rebuild-driver-snapshot.js 双实现合一；fixtures/inject.ts 依 R19⑥ 触摸即迁移启用（16/25/26 soak 直调点先行） | FREEZE R20 · R19⑥ | 行为保持四件套；零引用导出清单清零或转在用 | ◐ 2026-08-31（**已完成**：Assertions 10 方法+工厂、GameInspector.stuckCreeps、tickRunner 单例、SnapshotInspector 6 查询方法、两 barrel 22 死 re-export、run-e2e.mjs/smoke-e2e.cjs 删除（`a9e5f7e`+`80bd7d1`）；inject.ts 转在用——injectSpawnEnergy/injectFriendlyTower 落地 07/04。**缓期项追加完成**：disasterRoom 删除（01-disaster-recovery 改用 standardRoom 直调）、e2e/setup.ts↔rebuild-driver-snapshot.js 双实现合一（setup 委托 scripts 调用，消除 60 行重复逻辑）（`eef16fa`）。**剩余缓期**：存量场景 inject 全量迁移——同 T4 并行轨避让） |
| T6 | 标题-断言对齐：07-energy-crisis 前提真实化（新增 `injectSpawnEnergy` 具名注入，R19② 白名单登记）；03-storage-construction 补 storage site 断言；04-tower-defense 补 hostile hits 下降断言（world.roomObjects 真值） | FREEZE R20 · R19② | 三场景断言与标题一致且绿 | ✅ 2026-08-31（`80bd7d1`+`1b945db`：07 前提真实化后绿（recovery 档 200 能量可孵化）；03 补 storage site 真值断言绿（4/4）；04 补 hostile 受伤/击杀真值断言——**根因定位修复**：`addBot` 将 controller level 覆盖为 1，夹具 `rcl3RoomWithTower` 设的 level=3 被抹去，tower 在 RCL1 下 `checkStructureAgainstController` 返回 false → `attack` 返回 `ERR_RCL_NOT_ENOUGH`(-14)。E2E-004 与 E2E-012 setup 补 `controllerLevel: 3` 后 3/3 + 6/6 全绿。src/systems/tower-defense.ts 零改动——防御逻辑正确，断链在测试基础设施层 |

## 7. 已知技术债（非阻塞，登记待后续修复）

| ID | 描述 | 根因 | 影响 | 修复方向 |
| --- | --- | --- | --- | --- |
| TD-001 ✅ | pathFailure 循环：Level 3 弃目标后立即重新分配相同目标 | `clearTarget` 清除 `targetId` 但不记录黑名单；下一 tick `getAssignment` → `chooseTaskForRole` 可重新选中同方向目标 → 4 tick 后再次 Level 3 → 循环 | 100k soak stage 6-7（RCL3）`consec` 高达 155（upgrader）和 91（hauler）；不影响 bucket（10000 全程）或 JS 错误（0），但在 E8 产生噪音违例 | ✅ 2026-08-31 已修复：`clearTarget` 记录 `abandonedTaskId` + `abandonedAt` tick；`requestAssignment` 冷却期内（14t）过滤同 id 任务，全部被过滤时回退原始列表防空闲饥饿；200k soak 验证 RCL4 稳定期 pathFailure 基本消除 |

## 8. 本文件维护方式

固定刷新命令（更新对应章节后提交）：

```bash
git rev-parse HEAD                      # §1 基准 commit
grep -c "registerSystem(" src/bootstrap.ts   # §2 系统数（变化须走 ADR）
grep -c "registerRole(" src/bootstrap.ts     # §2 角色数
grep "schemaVersion" src/config/index.ts     # §2 schema
npm run typecheck && npm test && npm run build   # §3 门禁
npm run check:docs                      # 校验本文件口径与源码一致（七项）
npm run docs:inventory                  # 重构后刷新 §4 生产清单（按系统名合并保留手工列）
```
