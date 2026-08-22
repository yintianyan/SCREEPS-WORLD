# IMPLEMENTATION_PHASES · 实施阶段（冻结蓝图）

> 本文件是**实施顺序契约**：Phase 序列、每 Phase 的目标 / 前置依赖 / 交付物 / 验收
> 门槛 / 关键风险 / 回退路径、A0–A5 门槛映射与非显然依赖以此为准。**顺序由依赖推导，
> 禁止按功能喜好重排**（research/27 §6 依赖图）；骨架是 research/27 的 P1–P12 验收制
> （ADR-012）。结构性修订必须走 ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)
> §15。验收场景与指标归 [TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md)；MVP 边界归
> [EMPIRE_MVP.md](EMPIRE_MVP.md)。

## 1. 总则

1. **先闭环再扩展**：任何时刻系统必须是完整的感知→决策→执行→反馈闭环；缺环时新增
   功能会加速失败（research/24 §1，ADR-012）。
2. **生存优先级不可倒置**：CPU 死亡循环是头号死因（R-01）——降级链（保 spawn＞保
   经济＞保发展）必须最先存在（research/27 §2）。
3. **每 Phase 交付「能力＋验收＋回退」三件套**，不交付代码行数（§5）。
4. **顺序刚性**：前置 Phase 未达验收门槛，禁止开工下一 Phase（唯一例外：按回退路径
   降级运行是合法态）。
5. **自愈横切**：不是最后一个 Phase 才做——每个 Phase 携带自己的故障注入验收
   （research/27 §6；research/24 §10.3「无测试的防线视为不存在」）。

## 2. Phase 合同（P1–P12）

### Phase 1 · 运行时基座 → A0

| 项 | 合同 |
| --- | --- |
| 目标 | 可运行内核：空 / 旧 / 坏 Memory 均可恢复，错误被隔离，可观测 |
| 前置依赖 | 无（一切的地基） |
| 交付物 | Kernel 四职能＋组合根＋迁移骨架＋三级存储骨架（[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md)、[MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) 全文契约；遥测 L1 骨架） |
| 验收门槛 | 空 / 损坏 / 旧版 Memory 三场景恢复；单系统抛错不中断 tick；bucket 压低触发降级且恢复走滞回（S2/S3/S8） |
| 关键风险 | R-11（reset 重建风暴→惰性重建＋首 tick 预算）；R-13（耦合回潮→架构回归测试先行） |
| 回退 | 内核骨架独立于业务，无回退依赖 |

### Phase 2 · 单房生存闭环 → A1（MVP 第一半）

| 项 | 合同 |
| --- | --- |
| 目标 | 空帝国零人工自举：采能→spawn→升级→基础建造 |
| 前置依赖 | P1 |
| 交付物 | 感知层（快照 / 归一化 / 派生索引）；静态矿工＋container；hauler 请求池最小版；集中 SpawnManager（含紧急直通）；upgrader；基础建造队列（research/27 §4 P2） |
| 验收门槛 | 空帝国自举：30 万 tick 达 RCL3+ 且 tower 在建，全程无人工 flag / console；关键角色死亡自动补位（S1/S6） |
| 关键风险 | R-16（冷启动失败——自举是一等公民路径）；R-02（能量饥饿前兆） |
| 回退 | 紧急车道保证灾后最小产能重建（能量 <300 自回 1 官方兜底） |

### Phase 3 · 产能闭环 → A2 前半

| 项 | 合同 |
| --- | --- |
| 目标 | 稳定能量经济：净流可核算、断链可降级 |
| 前置依赖 | P2 |
| 交付物 | RCL4 storage 经济切换；能量收支核算三指标（[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §3）；请求池完整版（租约 / 超时回收 / 空载观测）；tower 补给并入物流 |
| 验收门槛 | 净流连续 5 万 tick 为正；hauler 空载率＜阈值；低能量注入限定 tick 内恢复（S4/S5） |
| 关键风险 | R-02（E2 能量饥饿——核算先于一切发展决策的本 Phase 化） |
| 回退 | container 缓冲兜底（断链 fallback 链，[LOGISTICS_ARCHITECTURE.md](LOGISTICS_ARCHITECTURE.md) §3） |

### Phase 4 · 房间发展自动化 → A2 后半（MVP 完成）

| 项 | 合同 |
| --- | --- |
| 目标 | RCL1→RCL6 全程无人工的房间发展 |
| 前置依赖 | P3 |
| 交付物 | 版本化布局模板＋约束适配；建造优先级与 site 配额；RCL5 link 网；热度铺路（采集→逐段建）；phase 推进（锚定相变点） |
| 验收门槛 | RCL1→RCL6 无人工干预且模板冲突只标 `blocked`；link 自动维持 storage 水位；道路只出现在实测热路径（Scenario A） |
| 关键风险 | R-10（Memory 膨胀→体积遥测）；R-06（卡位 / 无效 intent→卡位自愈） |
| 回退 | 模板版本迁移；blocked 结构不阻塞其余建造 |

### Phase 5 · 远矿 → A3 前半

| 项 | 合同 |
| --- | --- |
| 目标 | 远矿车道：带预算 / 期限 / 取消条件的 Operation |
| 前置依赖 | P4（人口与物流稳定才有余量） |
| 交付物 | 远矿车道 AgendaItem；reserver＋remote hauler；威胁感知自动撤退与恢复；ROI 核算（CPU 定价） |
| 验收门槛 | 远矿净收益连续为正才保持；敌袭自动暂停并 N tick 后恢复；Recovery 档远矿最先被砍；**恢复期无二次降级**（红队 A2 分批节流） |
| 关键风险 | R-03（掏空本土）；R-06；恢复风暴（A2） |
| 回退 | 降级为纯本地经济（社区先例：完全砍掉 remote 仍存活） |

### Phase 6 · 多房与帝国协调 → A3 中

| 项 | 合同 |
| --- | --- |
| 目标 | 房间注册、跨房调拨、市场：帝国层成立 |
| 前置依赖 | P5（运输余量与预算门控先存在） |
| 交付物 | 房间注册表；帝国态势快照（分频聚合，红队 A1）；跨房调拨（terminal＋运费核算）；市场系统（阈值制、getAllOrders 低频缓存、幂等键） |
| 验收门槛 | 单房故障（能量清零 / 失守模拟）不拖垮帝国；调拨遵守「本土净流为正」；无重复市场订单（S9） |
| 关键风险 | R-03（援助雪崩 M1→援助预算上限）；R-17（市场误操作） |
| 回退 | 调拨降级为房内自给模式 |

### Phase 7 · 扩张 → A3 完成

| 项 | 合同 |
| --- | --- |
| 目标 | 投资式扩张：评分＋门控＋自举车道＋失败降级 |
| 前置依赖 | P6；GCL 是硬上限（必要非充分） |
| 交付物 | 七因子评分＋硬否决项；G1–G5 门控（[EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §2）；「先 remote 尽调后 colonize」决策序；殖民自举五阶段；失败降级表 |
| 验收门槛 | 扩张决策可解释（评分＋门控快照记录）；殖民失败期限内自动降级为 remote 或放弃；帝国 CPU 不因扩张进入 Guarded 以下（S9/S11，多源新鲜度） |
| 关键风险 | R-03；R-16（自举超时）；R-15（A7 情报欺骗——不可根除，账本复盘） |
| 回退 | 收缩为既有房间运营 |

### Phase 8 · 防御体系 → A4 前半

| 项 | 合同 |
| --- | --- |
| 目标 | 威胁下不破防：分级、状态机、能量会计 |
| 前置依赖 | P4（结构布局）＋P3（能量核算）——**非 P7**（防御不依赖扩张） |
| 交付物 | 威胁检测与四级分级；防御状态机（normal→alert→siege→recovery→stabilizing）；tower 目标策略与围城能量会计；safemode 决策表（多房候选优先序，红队 A11）；min-cut rampart 维护 |
| 验收门槛 | 威胁注入触发正确分级与响应；围城模拟能量不枯竭（储备＋补给达标）；safemode 决策有记录与冷却遵守（S7） |
| 关键风险 | R-08（围城耗能——社区头号破防手段）；R-09（safemode 误用） |
| 回退 | fortify posture 静态防御 |

### Phase 9 · 军事 → A4 完成

| 项 | 合同 |
| --- | --- |
| 目标 | 受授权链约束的进攻能力 |
| 前置依赖 | **P8（防御成熟才有战争经济余量，ADR-009）＋P6（帝国资源调配）** |
| 交付物 | war posture 授权链（持续被打＋打得起）；war-planner 唯一进攻决策者；波次集结（build 相位 hold 归建、满编才 advance）；boost 前置；止损链；战后核验（`evaluateWarOutcome` 只信新鲜 intel） |
| 验收门槛 | 战争全程经济不越红线（战争账本）；止损触发即收摊；满编才推进；**诱饵不触发授权**（PvP 场景，Scenario F） |
| 关键风险 | R-15（对抗演化）；R-04（war↔fortify 振荡——退出滞回 ≥ 波次周期，红队 A3） |
| 回退 | 退 fortify；warBlacklist 冷却防死缠（可再试探，账本裁决） |

### Phase 10 · 高级经济（energy sink 规划）

| 项 | 合同 |
| --- | --- |
| 目标 | 后期能量有事可做：生产链与 sink 目标集 |
| 前置依赖 | P6 市场＋P7 扩张（矿物多样性） |
| 交付物 | lab 反应链（按真实倍率核算）；factory 商品链（按需而非解锁即建）；power 采集与 power creep；RCL8 后 sink 目标集（GCL farm / temple / power spawn / 军事储备，[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §4） |
| 验收门槛 | 每条生产链有输入库存 / 输出消费 / 降级策略；boost 库存满足军事 SLA |
| 关键风险 | R-17；E6 能量过剩（sink 空转——红队 A10 停滞误诊的正面防线） |
| 回退 | 生产链独立降级不伤基础经济 |

### Phase 11 · 自愈强化与 soak → A5

| 项 | 合同 |
| --- | --- |
| 目标 | 长期不退化的完整自愈闭环 |
| 前置依赖 | 全部（自愈是元能力，横切自 P1 起逐步强化，本 Phase 收口） |
| 交付物 | 完整六步恢复链与处置表（[FAILURE_RECOVERY_ARCHITECTURE.md](FAILURE_RECOVERY_ARCHITECTURE.md) 全文）；遥测面板（segment 低频导出）；S1–S11 注入矩阵全绿；长期 soak |
| 验收门槛 | A5：soak 无 Memory 单调膨胀、无任务饥饿、无 bucket 枯竭；global reset 后 MTTR 达标；S 矩阵全过 |
| 关键风险 | R-01（E1 恢复 MTTR 需真实官服数据）；R-10/R-11（趋势类退化） |
| 回退 | 降级到上一门槛状态运行（合法态） |

### Phase 12 · 跨 shard（可选，默认不启用）

| 项 | 合同 |
| --- | --- |
| 目标 | 仅当目标需要且 A5 达成后才裁决（research/27 §8） |
| 前置依赖 | A5 后裁决 |
| 交付物 | InterShardMemory＋portal 搬迁；跨 shard 状态与故障边界独立验证 |
| 验收门槛 | 跨 shard 状态一致性验证；本 shard 故障不连锁 |
| 关键风险 | 规模未知（20+ 房数据本就缺失，SYNTHESIS §5） |
| 回退 | 不启用即无成本 |

## 3. A0–A5 门槛映射表

| 门槛 | 名称 | 必须证明 | Phase | 场景 / 指标锚 |
| --- | --- | --- | --- | --- |
| A0 | 可运行 | 空 / 旧 Memory 可恢复；入口错误隔离；可观测 | P1 | S2/S3/S8；迁移幂等、降级滞回 |
| A1 | 生存闭环 | 空 Memory 自举无人工指令 | P2 | S1/S6；30 万 tick RCL3+ |
| A2 | 产能闭环 | 净流稳定；物流按供需；CPU/Memory 有预算 | P3–P4 | S4/S5；净流 5 万 tick 为正 |
| A3 | 多房自治 | 注册、远矿、调拨、扩张有优先级与取消条件 | P5–P7 | S9/S11；门控快照可解释 |
| A4 | 威胁下运营 | 情报置信度、状态机、战时经济、safemode 预算 | P8–P9 | S7＋PvP；战争账本红线 |
| A5 | 长期不退化 | soak 无膨胀 / 无饥饿 / 无枯竭、reset 可恢复 | P10+ | S 矩阵全过＋soak 趋势断言 |

（MVP＝A1＋A2＝P1–P4，见 [EMPIRE_MVP.md](EMPIRE_MVP.md) §1。）

## 4. 非显然依赖的显式声明

顺序约束中「看不出来但违反即返工」的依赖（research/27 §6）：

| # | 依赖 | 论据 | 违反后果 |
| --- | --- | --- | --- |
| 1 | **防御（P8）先于军事（P9）** | 战争经济依赖防御成熟度与止损链（ADR-009） | 战时经济红线被击穿；止损无 fortify 可退 |
| 2 | **远矿（P5）先于扩张（P7）** | 扩张门控需要远矿的 CPU / 收益定价实测数据（「先 remote 尽调后 colonize」同构） | 重承诺建立在未实测估值上（A7 情报欺骗面） |
| 3 | **自愈横切每 Phase** | 防线无测试＝不存在（research/24 §10.3）；每 Phase 带自己的故障注入验收 | P11 才补自愈＝前十个 Phase 的失败面全部裸奔 |
| 4 | **经济核算先于一切发展决策** | 净流 / 储备 / 预算三指标是 P2→P5+ 全部门控输入（A2 门槛前置；R-02/R-03） | E2 能量饥饿与 E3 掏空本土直通 |
| 5 | 市场与调拨（P6）先于高级经济（P10） | lab / factory 依赖矿物多样性与跨房物流 | 生产链无输入保障 |
| 6 | 基座（P1）先于一切 | 迁移 / 看门狗 / safeRun 是全部后续系统的运行前提 | 无 A0 即无验收地基 |
| 7 | P8 前置是 P3＋P4 而非 P7 | 防御依赖结构布局与能量核算，不依赖扩张（可并行于 P5–P7 窗口） | 无谓串行拖延 A4 |

## 5. 「完成」的定义（验收制合同）

| 条款 | 内容 |
| --- | --- |
| 出口＝指标 | 每 Phase 的完成判据是 §2 验收门槛列的**可观察指标**（场景断言 / 遥测数据），不是代码量、不是功能清单勾选（research/27 §2；ADR-012） |
| 证据义务 | 门槛跨越的宣称必须附 soak / 注入遥测证据（[AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) §5 升级义务；[TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §3 门槛绑定） |
| 部分完成 | 未达门槛＝未完成；**禁止「先合入下期补验」**——缺环时新增功能会加速失败（research/24 §1） |
| 回退是合同 | 每 Phase 必须携带回退路径；「降级到上一门槛状态运行」是合法运行态，不是失败态 |
| 发布纪律 | 每个 Phase 的合并与发布走 [TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §4–§5 门槛与 canary 序 |

## 6. Phase × 目录映射（对 [ENGINEERING_BLUEPRINT.md](ENGINEERING_BLUEPRINT.md) §1）

| Phase | 新增 / 主要改动目录 |
| --- | --- |
| P1 | `src/kernel/` 全部、`src/config/`、`src/types/`、`bootstrap.ts` / `main.ts`、`src/systems/telemetry-collector.ts`（L1 骨架） |
| P2 | `src/systems/room-snapshot / room-state / spawn-manager`、`src/domain/spawn/`、`src/creeps/`（engine / movement / 基础 roles） |
| P3 | `src/systems/`（请求池 / economy）、`src/domain/assignment/`＋`economy/` |
| P4 | `src/systems/construction-manager / site-quota / link-system`、`src/domain/layout/`＋`construction/` |
| P5 | `src/systems/remote-mining-manager`、`src/domain/remote/`、`src/creeps/roles/`（reserver / remote-\*） |
| P6 | `src/systems/empire-strategy / terminal-manager`、`src/domain/strategy/` |
| P7 | `src/systems/expansion-manager / agenda-manager`、`src/domain/expansion/` |
| P8 | `src/systems/tower-defense / defense-planner`、`src/domain/defense/` |
| P9 | `src/systems/war-planner`、`src/domain/war/`、`src/creeps/roles/`（attacker / healer） |
| P10 | `src/systems/lab-system / factory-manager / power-\*`、`src/domain/industry/` |
| P11 | `src/systems/self-healing / telemetry-collector`、`src/domain/tuning/`、S 矩阵收口 |
| P12 | `src/kernel/`（InterShardMemory 部件）＋新增跨 shard 模块（A5 后裁决） |

## 7. 一致性声明

本文件与 research/27 §3–§6（门槛 / 序列 / 依赖图）、[EMPIRE_MVP.md](EMPIRE_MVP.md)
（MVP＝P1–P4）、[TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §3/§6（门槛绑定与
注入矩阵）、[ENGINEERING_BLUEPRINT.md](ENGINEERING_BLUEPRINT.md)（目录落点）、
[EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §5（P7 降级表）、
[MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md)（P9 止损链）、
[FAILURE_RECOVERY_ARCHITECTURE.md](FAILURE_RECOVERY_ARCHITECTURE.md)（P11 收口
契约）同一时刻必须一致；Phase 增删、顺序调整、门槛改写必须同步其余各处并走 ADR。
