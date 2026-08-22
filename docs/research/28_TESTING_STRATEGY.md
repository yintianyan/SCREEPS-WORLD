# 28 · 测试与验收策略（TESTING STRATEGY）

> 研究文档 · 结论等级：**设计裁决**。骨架来源：autonomy-acceptance 参考文档
> （A0–A5 分级、场景矩阵、指标门槛、测试层级）；验收门槛对齐
> [27_IMPLEMENTATION_ROADMAP.md](27_IMPLEMENTATION_ROADMAP.md)；失败注入场景对齐
> [24_FAILURE_MODES.md](24_FAILURE_MODES.md)；指标定义共用
> [21_OBSERVABILITY.md](21_OBSERVABILITY.md)。核查日：2026-08-22。

## 1. Problem

自治帝国无法用「玩一玩看看」验收：无人值守意味着**每个 bug 的发现者要么是测试，
要么是帝国尸体**。同时 Screeps 的测试环境有四个特殊性：运行时 API 不可在本地
直接执行（Game/Memory 是宿主注入）、tick 以天为单位流逝（RCL8 约 3 周）、global
reset 与服务器时序不可控、对抗行为无法确定性重放。本文裁决：测试分几层、每层
能证明什么不能证明什么、场景注入矩阵长什么样、验收指标如何与遥测共用——并论证
架构本身（纯函数决策）如何决定可测性上限。

## 2. Research Questions

- 测试层级如何划分？每层的证据强度与成本？
- 为什么纯函数决策是可测性的结构性前提（决策与 Game 解耦）？
- 场景注入矩阵的完备集是什么？如何与 A0–A5 门槛对齐？
- 官方 Simulation 与私服各自能证明/不能证明什么？
- 社区工具链（profiler/私服/CI）有哪些现成先例？
- 验收指标如何避免「指标墓地」（与 21 号共用一份）？

## 3. Existing Solutions（测试金字塔在 Screeps 的适配）

标准测试金字塔（单元>集成>E2E）在 Screeps 不能直接套用，需要两个修正：

1. **「单元」的定义被架构决定**：只有决策被写成 `situation + state + policy →
   decision` 的纯函数（ADR-003；26 号 §5），才存在可脱离服务器单测的单元。
   决策函数内出现 `Game.` 引用即测试性 bug——这把可测性从「测试工程问题」
   升级为「架构约束」。
2. **「E2E」分裂为三级**：官方 Simulation（游戏内回放）/ 私服（可控时序）/
   官服 soak（真实不可控）——三级的证据强度与成本完全不同（§10.1）。

参考框架（autonomy-acceptance §4）：静态 → 单元 → 集成（fake adapter）→ 模拟/
私服 → soak → canary 六级；官方 Simulation 适合逻辑回归但**不能单独证明线上
CPU、服务器 tick 时序、多人冲突或长期数据增长**。

## 4. Screeps Community Practice（测试现状与先例）

- **多数开源 bot 无系统测试**：六大 bot 源码中仅 The International 有
  `featureFlags.spec.ts`（带测试的特性开关）与 `migration.ts`（显式迁移可测）
  的工程先例（源码级调研，CONFIRMED）。社区普遍依赖官服实跑+事后修。
- **Quorum 的 CI 自动部署**：GitConsensus 合并后 CI 每日自动部署 MMO——「发布
  即测试」的最激进形态；同时其 sos_lib 自带 profiler/stormtracker（观测即测试
  基础设施）。（CONFIRMED）
- **hivemind 仓库含 mock 目录**：证明「模拟层可进主仓库、随代码共同演化」的
  工程形态可行（2026-08-22 抽查复核，CONFIRMED）。
- **强制 global reset 测试法**：社区技巧——修改 loop 引用名即可触发 reset，
  用于验证 heap 重建路径（forum 2185，CONFIRMED；22 号引用同源）。
- **screeps-profiler**：函数级 CPU profile 是社区标配——性能测试的证据面
  （CONFIRMED；21/20 号引用同源）。
- **私服生态**：Steam 官方 dedicated server + 社区 launcher/mod 生态，可离线
  跑可控 tick 的完整服务器；Quorum CI 证明私服/官服部署可编排。
- **社区共识的负面教训**：官服直接 soak 当唯一测试 = 用帝国尸体写测试报告
  （reddit 8mowvu 类案例的根源之一）。

## 5. Existing Bot Analysis（可测性设计对比）

| Bot | 可测性形态 | 评价 |
| --- | --- | --- |
| TI | featureFlags.spec + migration.ts + 托管遥测 | 开源 bot 中工程最好；静态类双层使决策可提取 |
| Quorum | CI 自动部署 + profiler + stormtracker | 「持续发布+持续观测」先例；缺场景注入 |
| Overmind | 内置 profiler + 版本迁移模块 | 性能与迁移可测；OO 实例化抬高 fake 成本 |
| hivemind | mock 目录 + settings.local 定制层 | 模拟层进主仓库的现役形态 |
| TooAngel | 无测试，靠十年官服实跑 + World Driven 自动合并 | 孤例不可复制：单人纪律+幸存者偏差 |
| bonzAI/KasamiBot | 无测试/源码不可考 | — |

**收敛**：可测性投入与项目存续正相关（TI/hivemind/Quorum 是维护最久的三个）；
且**没有任何一家靠官服 soak 单独存活到高水平**——观测+模拟+CI 三件套齐的
（Quorum 形态）才撑得起自治宣称。

## 6. Advantages（本策略的收益）

1. **验收可执行**：A0–A5 每门槛有场景矩阵与指标阈值（27 号），「达到 A1」是
   可复现实验结论而非体感。
2. **决策回归**：纯函数单测让「改一处策略不悄悄破坏另一处」成为可能——这是
   演化闭环（tuning）敢自动调参的前提。
3. **故障演练**：注入矩阵让 24 号五大类失败模式的防线全部「有测试的防线」
   （24 号 §10.3 治理要求）。
4. **回滚安全**：canary 层（先低风险房/分支）使发布回滚成为流程而非祈祷。

## 7. Disadvantages（测试税，诚实代价）

- fake adapter（Game/Room/Spawn/Market 最小假实现）是持续维护面：引擎行为
  更新（R-14 机制变更）时 fake 必须同步，否则假绿。
- 场景矩阵本身是文档资产，与 24/27 号三向对齐有漂移风险。
- soak 与 canary 以真实时间计费（RCL8≈3 周），不可压缩；私服时序与官服 tick
  时长（2.5–5.5s 波动）不同构，性能结论只能参考。
- 断言/注入钩子若进生产 bundle 有 CPU 与体积成本（§9）。

## 8. Failure Modes（测试自身的失败模式）

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| 假绿（fake 漂移） | 私服/官服行为与单测不一致 | fake 只覆盖官方文档+引擎常量钉死的行为（03 号）；私服层定期抽查真实路径 |
| 覆盖率崇拜 | 高覆盖率但场景矩阵全红 | 验收以场景矩阵+指标门槛为准，覆盖率只是辅助信号 |
| 官服-only 心态 | 「私服过了就行」或「官服跑着看」 | 六层级各司其职：官服只产 soak 数据与告警，不当功能测试场 |
| 注入残留 | 测试钩子进生产影响 tick | 注入设施编译期剔除/flag 隔离（TI featureFlags 先例） |
| 场景矩阵腐烂 | 矩阵与 24/27 号漂移 | 三文档互引+红队每轮对照（24 号 §10.3） |
| soak 指标无基线 | 跑了半年不知道什么是「正常」 | 每指标先定义正常区间/WARN 阈值（21 号 §10.5 四要素） |

## 9. CPU Implications

- 测试本体（静态/单元/集成）在 tick 外执行，对生产 CPU 贡献为零。
- 生产内的测试相关成本只有两项且已预算化：遥测采集（≤limit 3%，21 号 §9）与
  运行时断言（写者越权断言等——建议限 debug 构建/低频采样开启，28 号 §7 第 4
  条防线）。
- soak 是唯一能测量真实 CPU 曲线（p50/p95/p99 漂移）的层级——其数据直接回流
  20 号预算模型与 25 号 T-08/T-13 的标定。

## 10. Recommended Design

### 10.1 六级测试层级（每层：能证明 / 不能证明 / 工具）

| 层级 | 能证明 | 不能证明 | 工具与先例 |
| --- | --- | --- | --- |
| L1 静态 | 类型/边界/模块入口/schema 一致性 | 行为正确性 | typecheck/lint/build 三门槛 + Memory schema 检查（autonomy-acceptance §4；与实施仓库质量门槛一致） |
| L2 单元（纯函数决策） | 战略/分配/评分/body 计算/迁移的输入输出正确性、幂等性 | 与真实 Game 对象的交互 | 决策纯函数化（ADR-003）；迁移链 n→n+1 逐步测（18 号 §10.3） |
| L3 集成（fake adapter） | 系统→动作的接线、唯一写者、请求-满足闭环 | 引擎真实语义 | Game/Memory/Room/Spawn/Market 最小 fake（hivemind mock 先例） |
| L4 模拟/私服 | 启动→升级→物流→敌袭→扩张全场景、可控时序下的状态机 | 官服 tick 时序、多人冲突、真实 CPU 分布 | 私服 + 场景注入矩阵（§10.2）；官方 Simulation 仅作逻辑回归 |
| L5 soak | 长期不退化（Memory 无单调膨胀/无饥饿/bucket 不枯竭）、reset 恢复 | 特定故障的因果（只能看趋势） | 固定 seed/录制输入长跑 + 21 号遥测；官服与私服双形态 |
| L6 canary | 参数/结构变更在真实环境的安全性 | 大范围同时失效 | 非生产分支/低风险房先行，观察多窗口再放量（ADR-012 回滚纪律） |

### 10.2 场景注入矩阵（与 27 号门槛、24 号失败类对齐）

每个场景按 autonomy-acceptance §2 定义五要素（触发输入/预期/允许副作用/恢复
上限/告警与 fallback）；下表为总控视图：

| # | 场景 | 注入方法 | 预期行为（断言） | 门槛 | 失败类 |
| --- | --- | --- | --- | --- | --- |
| S1 | 空 Memory 冷启动 | 清空 Memory+heap | 从 1 spawn+300 能量自举，30 万 tick 达 RCL3+ | A1 | P4 |
| S2 | global reset | 改 loop 引用名（forum 2185 法） | 首 tick 惰性重建不超预算，MTTR 达标 | A0/A5 | A2 |
| S3 | Memory 迁移（旧 schema） | 注入 n−1 版 Memory | 迁移幂等、先写新后删旧、中断可重放 | A0 | A5 |
| S4 | 低能量 | 清空 storage/extension | 限定 tick 内恢复净流为正 | A2 | E2 |
| S5 | spawn 持续忙 | 压满孵化队列 | 无静默丢单（有 outcome）、P0 不被饿死 | A2 | X3 |
| S6 | 关键角色全灭 | 批量杀 miner/hauler | replacement 自动补位，人口缺口有界 | A1/A2 | X4 |
| S7 | 敌袭注入 | 私服刷敌编队 | 威胁分级正确、能量不枯竭、safemode 决策有日志 | A4 | E4/M7 |
| S8 | 低 bucket | 人工压 bucket 至 Recovery | 降级顺序正确（P3→P2），恢复走滞回 | A0/A5 | E1 |
| S9 | 多房竞争 | 多房同时申请扩张/调拨 | 无死锁、仲裁按优先级、无重复订单 | A3 | M2/M4 |
| S10 | 重复 tick/重复提交 | 同 tick 重放 intent/request | 幂等键去重，无 double-spawn/重复 site | 全门槛 | X6 |

矩阵完备性纪律：24 号 §10.3 要求「每条防线绑定一个可注入场景」——反向检查
（防线→场景）每红队评审轮执行一次。

### 10.3 纯函数决策的可测性论证（架构级）

- 战略层（posture×budget）、分配评分、body 计算、迁移步骤全部是
  `输入快照 → 输出决策` 的纯函数（26 号 §5 契约表）——L2 可全覆盖。
- Game 依赖只允许出现在三处：感知层（构建快照）、执行层（签发 intent）、
  adapter 封装。评审规则：**决策函数体内出现 `Game.`/`RawMemory.` 引用即
  架构违规**（与 ADR-004 的角色禁令同级）。
- 这同时是 LLM 边界的测试面：L2 体外顾问只能改参数白名单，而参数生效路径
  在 L2/L6 有回归（23 号 §10.2）。

### 10.4 验收指标（与 21 号共用一份，禁止第二套定义）

- 基础集（21 号 §10.1）：CPU p50/p95/p99、bucket floor 与档位分布、超预算/
  降级/跳过计数、Memory 字节数与环比、孤儿条目数、globalResetCount 与重建
  耗时、能量净流、spawn 利用率、hauler 空载率、任务年龄/饥饿率、威胁发现
  延迟、MTTR（注入实验测）。
- 门槛绑定（27 号）：A1=自举断言+S1；A2=净流/空载阈值+S4/S5；A3=S9+调拨门控；
  A4=S7+战时经济红线；A5=soak 趋势断言（无单调膨胀/无饥饿/无枯竭）。
- 发布门槛（autonomy-acceptance §5）：代码/配置/规则集固定；正常+至少一条
  故障路径有测试；无未解释失败；指标达阈值；迁移可回滚；有降级告警回滚方案；
  发布报告列事实/假设/未覆盖/下一步。

### 10.5 CI 与发布编排（Quorum 先例裁剪）

- 最小 CI：PR → L1/L2/L3（分钟级）→ 私服 L4 冒烟（场景矩阵子集）→ 人工或
  规则放行 → 官服 canary 房观察 → 全量。
- 不采纳 Quorum 的全自动合并+每日部署（其停更教训之一：发布自动化超过测试
  自动化时，坏代码跑得更快）；自动化程度与测试证据强度挂钩。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 官服 soak 当唯一测试 | 无人值守下 bug 发现者=尸体；RCL8≈3 周的迭代周期不可接受 |
| 全量 TDD/覆盖率 KPI | Screeps 的价值密度在场景与趋势，不在行覆盖；覆盖率崇拜已列 §8 |
| 完整复刻引擎的 fake | 引擎行为面巨大，fake 漂移必然；fake 只钉死 03 号事实层 |
| 自动化合并+自动部署（Quorum 全形态） | 测试证据强度不足以支撑无人发布（§10.5） |
| 官方 Simulation 作为主战场 | 不能证明线上 CPU/tick 时序/多人冲突/长期增长（autonomy-acceptance §4） |
| 每场景手写脚本不进矩阵 | 不可回归、不可审计；矩阵是唯一事实源 |

## 12. Open Questions

1. 私服 tick 与官服时序差异的定量影响：性能阈值是否需要私服/官服双档
   （20 号 §12.4 同源问题）。
2. soak 的最小时长与「无退化」的统计判据（A5 数据回填前只能给保守值）。
3. 对抗场景（S7 敌编队）的剧本库从哪来：社区战例（55aapi 等）可转译多少？
   其余需 A4 实测积累。
4. fake adapter 的维护分工：跟随引擎常量 diff（R-14 监测）的更新流程需在
   实施期定案。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| screeps-grandmaster-perspective/references/autonomy-acceptance.md | 领域经验 | 六级测试层级、场景矩阵五要素、指标与发布门槛（本文 §3/§10 骨架） | LIKELY（方法论，与 bot 证据一致） |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source | 源码 | featureFlags.spec.ts、migration.ts 工程先例 | CONFIRMED |
| https://github.com/ScreepsQuorum/screeps-quorum（+ Reddit 710p9n） | 源码/社区 | CI 每日自动部署 MMO、GitConsensus 自动合并 | CONFIRMED |
| https://github.com/Mirroar/hivemind（2026-08-22 抽查复核） | 源码 | 仓库含 mock 目录（模拟层进主仓库） | CONFIRMED |
| https://screeps.com/forum/topic/2185/ | 论坛 | 强制 global reset 测试法 | CONFIRMED |
| https://github.com/screepers/screeps-profiler | 工具 | 函数级 CPU profile 社区标配 | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/8mowvu/ 等死亡案例（见 RESEARCH_SOURCES.md C 节） | 社区 | 「官服当唯一测试场」的代价 | CONFIRMED |
| [27_IMPLEMENTATION_ROADMAP.md](27_IMPLEMENTATION_ROADMAP.md) §3/§11 + [21_OBSERVABILITY.md](21_OBSERVABILITY.md) §10 + [24_FAILURE_MODES.md](24_FAILURE_MODES.md) §8 | 本套件 | 门槛对齐、指标共用、失败类映射 | — |
