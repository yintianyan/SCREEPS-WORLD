# TEST_ARCHITECTURE · 测试架构（冻结蓝图）

> 本文件是**测试与验收契约**：八类测试层级、工具链与入口、验收指标与遥测共用、
> CI 门槛与 canary 发布以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15。依据：research/28（L1–L6 /
> S1–S10 / 纯函数律 / hivemind mock 先例 / TI featureFlags / Quorum CI 裁剪）、
> research/21（指标共用与发布门槛）、research/24 §10.3（防线→场景绑定）、
> research/27（A0–A5 门槛）；场景对齐 [ARCHITECTURE_VALIDATION.md](ARCHITECTURE_VALIDATION.md)
> Scenario A–J，合并门槛对齐 AGENT.md 质量门槛。

## 1. 八类测试层级合同

研究层六级（L1 静态 / L2 单元 / L3 集成 / L4 模拟 / L5 soak / L6 canary，
research/28 §10.1）在本冻结层映射为**八类测试 + 两项流程合同**：L1 归 §4 CI 门槛，
L6 归 §5 canary 发布；L2–L5 展开为下表八类。每类**能证明 / 不能证明**以此表为裁
决（官服 soak 当唯一测试＝用帝国尸体写测试报告，research/28 §11 否决）。

| # | 类别 | 研究层 | 测试对象与合同 | 能证明 / 不能证明 | 对接场景 |
| --- | --- | --- | --- | --- | --- |
| 1 | Unit 单元 | L2 | domain 纯函数（战略 / 分配评分 / body 计算 / 迁移链 n→n+1 逐步）。**纯函数律：决策函数体内出现 `Game.` / `RawMemory.` 引用即架构违规**（research/28 §10.3），由 §2 边界 lint 自动执行 | 输入输出正确性、幂等性 ／ 与真实 Game 对象的交互 | 全门槛地基 |
| 2 | Integration 集成 | L3 | AI＋运行时适配层接线：系统→动作、唯一写者、请求-满足闭环、回执律；fake adapter（Game/Memory/Room/Spawn/Market 最小假实现，hivemind mock 先例：模拟层进主仓库随代码共同演化）；强制 global reset 测试法（改 loop 引用名，forum 2185） | 接线与所有权 ／ 引擎真实语义 | S2/S3/S10 |
| 3 | Simulation 模拟 | L4 | 私服（screeps-server-mockup / Steam dedicated server）可控时序全场景：启动→升级→物流→敌袭→扩张；fake 只钉死官方文档＋引擎常量行为（research/03 事实层），防假绿 | 可控时序下的状态机 ／ 官服 tick 时序、多人冲突、真实 CPU 分布 | S 矩阵主战场 |
| 4 | Scenario 全程 | L4 | RCL1→RCL8 单房全程零人工指令 | 全链行为证据 ／ 多房与对抗 | Scenario A |
| 5 | Empire 多房 | L4/L5 | 2/5/10 房：殖民、调拨、远矿、仲裁、故障域隔离 | 多房协调与死锁防线 ／ 20+ 房规模（归 Stress） | Scenario B/C/D |
| 6 | Stress 压力 | L5 | 10/20/50 房 CPU 推演（[CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md) §3 公式验证）＋ soak 长跑（固定 seed / 录制输入）：无 Memory 单调膨胀、无任务饥饿、无 bucket 枯竭、reset 可恢复 | 长期不退化趋势 ／ 特定故障因果（只能看趋势）；私服 tick 与官服时序（2.5–5.5s 波动）不同构，性能结论只参考 | Scenario D/E/J；A5 门槛 |
| 7 | Failure 故障注入 | L4 | §6 场景注入矩阵 S1–S11：低能量 / spawn 忙 / 角色全灭 / 敌袭 / 低 bucket / global reset / 迁移 / 多房竞争 / 重复 tick / 冷启动 / 敌情过期 | 24 号五大类失败模式防线的「有测试」证明 ／ 未知组合态（自愈闭环兜底） | Scenario G/H/I/J |
| 8 | PvP 对抗 | L4 | 威胁 / 围城 / 诱饵注入（剧本库源自社区战例转译＋A4 实测积累）：诱饵不触发 war 授权、两房同 siege 仲裁、止损链 | 授权链与止损防线 ／ 对抗演化（R-15 残余，依赖战争账本复盘闭环） | Scenario F |

## 2. 工具链与入口合同

| 层 | 工具与入口（package.json scripts 为唯一口径） | 先例与义务 |
| --- | --- | --- |
| 静态 | `npm run typecheck` / `npm run build`（rollup） | AGENT.md 质量门槛 |
| Unit | Vitest `tests/unit/`（`npm run test:unit`），目录镜像 src 子域（kernel/spawn/logistics/…/architecture） | 纯函数律；迁移链逐步测（research/18 §10.3） |
| Integration | Vitest `tests/integration/`（`npm run test:integration`）＋ fake adapter | 唯一写者断言；注册表查重与钩子签名校验（红队 A4） |
| Simulation / Scenario / Empire / Failure / PvP | 私服 e2e `tests/e2e/`（`npm run test:e2e`；冒烟 `test:e2e:smoke`），screeps-server-mockup 驱动 | hivemind mock 先例；场景脚本必须进矩阵（§6），禁止场外手写脚本不登记（research/28 §11） |
| Stress / soak | 私服长跑＋官服 soak；数据经遥测采集 | 指标先有基线再跑（§3） |
| 遥测断言 | L3 TelemetryFrame（segment）→ 体外只读采集器（`tools/private/empire-collector`）→ 断言 | 体外平面只读不写（research/21 §10.3） |
| 架构回归 | dependency-cruiser 类工具以 [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) §1 图为期望集 diff；lint：`import/no-cycle`＋分区 `no-restricted-imports`（src/domain 禁 Game/Memory；src/kernel 禁业务 import，R9 白名单一行；角色目录禁 `Room.find`）；bundle parity 守卫（R12 登记 · R20③ 收敛至 `tests/integration/framework/bundle-parity.test.ts`——dist 仅在 build 后存在，守卫必须在 build 之后：注册系统/角色 name 全部出现在 `dist/main.js`、已裁决删除模块不得回流 bundle）；文档一致性 `npm run check:docs`（链接 / 术语 / schemaVersion / 注册数 / Shadow-Only / soak 标记 / 实现入口七项） | 任何新增环、未登记边、bundle 回流或文档失真即门槛红（DEPENDENCY_GRAPH §4 六项义务） |

## 3. 验收指标与遥测共用合同（一鱼两吃）

| 条款 | 内容 |
| --- | --- |
| 唯一定义源 | 指标定义＝research/21 §10.1 最小集（CPU p50/p95/p99、bucket floor 与档位分布、超预算 / 降级 / 跳过计数、Memory 字节数与环比、孤儿条目数、globalResetCount 与重建耗时、能量净流、spawn 利用率、hauler 空载率、任务年龄 / 饥饿率、威胁发现延迟、MTTR）。**禁止第二套定义**（[DATA_FLOW.md](DATA_FLOW.md) §3 条款 3） |
| 四要素 | 每指标必须定义正常区间、WARN 阈值、采样频率、TTL——缺一不进清单（防指标墓地，research/21 §10.5）；告警基于平滑值防单 tick 误报 |
| 一鱼两吃 | L2 平滑值同时是自治算法输入（门控 / tuning / 自愈对账）与验收数据——不为验收单独造第二套 |
| 门槛绑定 | A0＝S2/S3/S8；A1＝自举断言＋S1/S6；A2＝净流 / 空载阈值＋S4/S5；A3＝S9/S11＋调拨门控；A4＝S7＋战时经济红线；A5＝soak 趋势断言（无单调膨胀 / 无饥饿 / 无枯竭）＋S 矩阵全过 |

## 4. CI 门槛合同

| 条款 | 内容 |
| --- | --- |
| 合并门槛 | `npm run typecheck`、`npm test`、`npm run build` 全绿＝合并门槛（AGENT.md；与 scripts 清单一致：typecheck / test / test:unit / test:integration / build / watch） |
| PR 编排 | PR → 静态＋Unit＋Integration（分钟级）→ 私服冒烟（场景矩阵子集）→ 放行 → 官服 canary（§5）→ 全量 |
| 架构测试 | 循环依赖静态检查、边界 lint、依赖图 diff、组合根运行时断言全部并入门槛链（DEPENDENCY_GRAPH §4 六项义务） |
| 覆盖率 | 覆盖率只是辅助信号——验收以场景矩阵＋指标门槛为准（覆盖率崇拜防线，research/28 §8） |
| 注入隔离 | 注入钩子与断言设施编译期剔除或 flag 隔离（TI featureFlags 先例），禁止进生产 bundle 的 tick 路径 |
| 测试税 | 生产内测试相关成本仅遥测采集（≤3% limit）与运行时断言（限 debug 构建 / 低频采样）；测试本体在 tick 外执行，对生产 CPU 贡献为零（research/28 §9） |

## 5. canary 发布合同

| 条款 | 内容 |
| --- | --- |
| 发布门槛（缺一不发布） | ① 代码 / 配置 / 规则集固定；② 正常路径＋至少一条故障路径有测试；③ 无未解释失败；④ 指标达阈值；⑤ 迁移可回滚（旧版遇高版本只读不写）；⑥ 有降级、告警、回滚方案；⑦ 发布报告列事实 / 假设 / 未覆盖 / 下一步（autonomy-acceptance §5；research/28 §10.4） |
| canary 序 | 非生产分支 / 低风险房先行 → 遥测观察多窗口（趋势断言）→ 放量全量；参数与结构变更一律走 canary（R-18 调参护栏；演化闭环窗口＋canary＋回滚） |
| 否决 | Quorum 全自动合并＋每日部署全形态**不采纳**——发布自动化超过测试自动化时，坏代码跑得更快（research/28 §10.5）；自动化程度与测试证据强度挂钩 |
| 回滚语义 | 回滚＝部署旧版代码＋依赖迁移回退语义（停在旧字段并存中间态，MEMORY §3 步 5）；禁止「热修数据」绕过迁移 |

## 6. 场景注入矩阵合同（S1–S11）

每场景五要素：触发输入 / 预期 / 允许副作用 / 恢复上限 / 告警与 fallback
（autonomy-acceptance §2）。S1–S10 编号与 research/28 §10.2 冻结一致；**S11 敌情
过期为本层新增登记**（覆盖任务书 §28 清单中的「敌情过期」，绑定 M8 防线，走
research/24 §10.3 新场景入库流程）。

| # | 场景 | 注入方法 | 预期行为（断言） | 门槛 | 失败类 |
| --- | --- | --- | --- | --- | --- |
| S1 | 空 Memory 冷启动 | 清空 Memory＋heap | 1 spawn＋300 能量自举，30 万 tick 达 RCL3+ 且 tower 在建 | A1 | P4 |
| S2 | global reset | 改 loop 引用名（forum 2185 法） | 首 tick 惰性重建不超预算，MTTR 达标 | A0/A5 | A2 |
| S3 | Memory 迁移（旧 schema） | 注入 n−1 版 Memory | 迁移幂等、先写新后删旧、中断可重放 | A0 | A5 |
| S4 | 低能量 | 清空 storage/extension | 限定 tick 内恢复净流为正，无二次降级振荡 | A2 | E2 |
| S5 | spawn 持续忙 | 压满孵化队列 | 无静默丢单（有 outcome）、P0 不被饿死 | A2 | X3 |
| S6 | 关键角色全灭 | 批量杀 miner/hauler | replacement 自动补位，人口缺口有界 | A1/A2 | X4 |
| S7 | 敌袭注入 | 私服刷敌编队 | 威胁分级正确、能量不枯竭、safemode 决策有日志 | A4 | E4/M7 |
| S8 | 低 bucket | 人工压 bucket 至 Recovery | 降级顺序正确（P3→P2）、恢复走滞回 | A0/A5 | E1 |
| S9 | 多房竞争 | 多房同时申请扩张 / 调拨 | 无死锁、仲裁按优先级、无重复订单 | A3 | M2/M4 |
| S10 | 重复 tick / 重复提交 | 同 tick 重放 intent/request | 幂等键去重，无 double-spawn / 重复 site | 全门槛 | X6 |
| S11 | 敌情过期 | 注入超 TTL intel 后触发扩张尽调 / 战争评估 | 多源新鲜度硬门槛拒绝；stale/inferred 禁当 fact | A3 | M8 |

矩阵完备性纪律（research/24 §10.3）：**每条防线必须绑定一个可注入场景——无测试
的防线视为不存在**；反向检查（防线→场景）每红队评审轮执行一次；新场景入库流程＝
事故（或注入）→ 归类五层 → 登记 → 绑防线 → 进矩阵。矩阵与 research/24/27 三向
对齐防漂移。

## 7. 重构合同（行为保持证据要求）

重构（系统合并 / 函数下沉 / 重命名 / 死代码清理）**不产生新自治能力**，其价值是
把代码收敛到合同、降低维护成本；其唯一风险是行为漂移。合同如下：

| 条款 | 内容 |
| --- | --- |
| 工作项来源 | 重构只允许以 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 已登记裁决 ＋ [ENGINEERING_BLUEPRINT.md](ENGINEERING_BLUEPRINT.md) §5 现状登记 ＋ [STATUS.md](../STATUS.md) 重构 backlog 为工作项来源；无登记来源的重构提案先走 ADR |
| 行为保持证据（四件套，缺一不合并） | ① `npm test` 测试集合（文件数＋用例数）与断言语义不变——允许新增断言，**禁止删除断言来转绿**；② `npm run test:e2e:smoke` 通过；③ 架构合规测试全绿（含 R12 bundle parity：注册系统名全部在 bundle、已删模块不回流）；④ 受影响系统的 cadence/优先级注释与 [STATUS.md](../STATUS.md) 生产清单同步刷新（`npm run docs:inventory`） |
| 禁止搭便车 | 重构变更禁止夹带行为变更（新功能 / 参数调整 / 阈值改动）——行为变更走 Phase 实施或 ADR，混入重构 PR 直接驳回 |
| 完成定义 | backlog 项完成 ＝ 行为保持证据齐全 ＋ [STATUS.md](../STATUS.md) / [ENGINEERING_BLUEPRINT.md](ENGINEERING_BLUEPRINT.md) §5 状态列更新 ＋（注册数变化时）FREEZE §15 追记 |

## 8. 一致性声明

本文件与 AGENT.md 质量门槛、[ARCHITECTURE_VALIDATION.md](ARCHITECTURE_VALIDATION.md)
（Scenario A–J ↔ §1 八类）、[FAILURE_RECOVERY_ARCHITECTURE.md](FAILURE_RECOVERY_ARCHITECTURE.md)
（§2 九类故障 ↔ §6 矩阵）、[EMPIRE_MVP.md](EMPIRE_MVP.md) §4（MVP 验收场景）、
[IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md)（各 Phase 验收门槛 ↔ §3 门槛
绑定）、[DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) §4（静态检查义务）同一时刻必须
一致；任何一处修订必须同步其余各处并走 ADR。
