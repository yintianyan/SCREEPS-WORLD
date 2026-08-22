# EMPIRE_MVP · 最小可行帝国（冻结蓝图）

> 本文件是 **MVP 定义契约**：MVP 等式、能力清单与禁止提前实现清单、验收场景、
> MVP 与完整架构的关系以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15。裁决依据 research/27 §5
> （MVP＝A1+A2）与 §3（A0–A5 门槛）；场景对齐 [TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md)
> §6 与 [ARCHITECTURE_VALIDATION.md](ARCHITECTURE_VALIDATION.md) Scenario A/G；
> 自治宣称纪律对齐 [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) §5。

## 1. MVP 定义合同

| 条款 | 内容 |
| --- | --- |
| 等式 | **MVP ＝ A1 ＋ A2**（research/27 §5 裁决），对应 Phase P1–P4（[IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md) §2） |
| 起点 | 空帝国：1 个 spawn、300 能量、空 Memory、零人工 flag / console 指令 |
| 终点 | 自举到 RCL4+ storage 稳定经济：能量净流为正、人口自动补位、低能量注入可自恢复 |
| 人工边界 | 人类只提供启动条件（发布代码）；运营期零人工干预为验收前提，不是优化目标 |
| 性质 | MVP 是「自治能力」的**最小可验证集合，不是功能清单**——每项能力都有可观察指标（§4）；「MVP＝能跑起来」无法验证自治，等于没定义（research/27 §7 否决） |

## 2. MVP 能力清单合同（启动→维持稳定链条）

| 环节 | 能力（必须） | 契约来源 | 验收挂钩 |
| --- | --- | --- | --- |
| 启动 | 组合根自举：空 / 旧版 / 损坏 Memory 三场景可恢复；迁移骨架幂等 | [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2/§7；[MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) §3 | A0；S1/S3 |
| 观察 | RoomSnapshot 每 tick 重建＋RoomState 归一化＋派生索引；角色层禁全房 `find` | [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.3；[DATA_FLOW.md](DATA_FLOW.md) §1 | A1 |
| 经济 | bootstrap 期 harvester 直供 → 静态矿工＋container → RCL4 storage 经济切换；净流 / 储备 / 风险缓冲三指标核算 | [LOGISTICS_ARCHITECTURE.md](LOGISTICS_ARCHITECTURE.md)（不含 terminal/link 网）；[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §3 | A2；S4 |
| 孵化 | census（双口径）→demand→replacement horizon 管道；车道制＋幂等 key＋紧急直通（≥200 能量 `[WORK,CARRY,MOVE]`） | [SPAWN_ARCHITECTURE.md](SPAWN_ARCHITECTURE.md) §2–§3 | A1/A2；S5/S6 |
| 执行 | RolePolicy 钩子管线（gate/acquire/work/onFlee/hold/park/combat）＋role-runner＋交通仲裁 | [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.2；[TICK_LIFECYCLE.md](TICK_LIFECYCLE.md) ⑦⑧ | A1 |
| 建设 | 版本化布局蓝图＋全局 / 每房 site 配额＋实测热度逐段铺路；冲突只标 `blocked` | [CONSTRUCTION_ARCHITECTURE.md](CONSTRUCTION_ARCHITECTURE.md) | A2；Scenario A |
| 升级 | upgrader 吃净流盈余（early-economy ≤30% 产能），不是默认消费者 | [ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §2.1 | A2 |
| 维持稳定 | 自动补位；低能量恢复；看门狗降级链；遥测最小集＋WARN/TAKEOVER 通道；creep 级 / 任务级自愈对账 | [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §3；[FAILURE_RECOVERY_ARCHITECTURE.md](FAILURE_RECOVERY_ARCHITECTURE.md) §1–§2 | A2；S4/S6/S8 |

MVP 期 Policy 允许以「固定 peace 姿态＋能量域预算」最小实现存在（能量门控必须真实
生效——经济核算先于一切发展决策）；完整四态 posture 与 war 授权链推迟（P8/P9），
但「任何系统不得改 posture」等裁决权条款自 MVP 起即有效（[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1）。

## 3. 不在 MVP 内清单（明示禁止提前实现）

| 禁止项 | 归属 Phase | 禁止理由（依据） |
| --- | --- | --- |
| Remote mining 远矿 | P5 | 人口与物流余量未稳（R-03）；扩张门控需要远矿 ROI 定价数据（research/27 §6 非显然依赖） |
| Expansion / 殖民 | P7 | 依赖 P5 实测数据与 P6 帝国协调；未实测估值上的重承诺是 A7 情报欺骗面 |
| Terminal / 跨房调拨 / 市场 | P6 | 单房阶段无跨房语义；市场摩擦需要经济核算先行（R-17） |
| Labs 反应链 | P10 | 依赖 P6 市场＋P7 矿物多样性 |
| Factory / 商品链 / power | P10 | 同上；按需而非解锁即建 |
| Military / attacker / 战争 | P9 | 防御先于军事（ADR-009：战争经济依赖防御成熟度）；「代码存在≠战争开始」——提前实现进攻路径违反授权链 |

| 条款 | 内容 |
| --- | --- |
| 禁止形态 | MVP 期间**禁止**实现上表模块的任何运行时行为路径；接口骨架可按 [RUNTIME_API_DESIGN.md](RUNTIME_API_DESIGN.md) §7 演进规则预留，但不得带行为 |
| 边界说明 | tower **site 建造**在 MVP 内（验收判据「tower 在建」是结构层）；威胁分级、防御状态机、safemode 属 P8，不在 MVP 内 |
| 机理依据 | 缺环时新增功能会加速失败——每个新功能都是新的状态源与消费方，感知→决策→执行→反馈闭环存在缺口时副作用在缺口处累积（research/24 §1，ADR-012） |

## 4. 验收场景合同（复现 research/27 §5）

| # | 场景 | 断言（可观察指标） | 门槛 / 注入 |
| --- | --- | --- | --- |
| 1 | 自举 | 从 1 spawn＋300 能量、空 Memory、零人工指令，30 万 tick 内达 RCL3+ 且 tower 在建；miner/hauler/upgrader/builder 自动就位 | A1；S1 |
| 2 | 稳定经济 | 达到并稳定运营 RCL4+ storage 经济；能量净流连续 5 万 tick 为正；hauler 空载率＜阈值 | A2；S4 前置 |
| 3 | 自动补位 | 关键角色（miner/hauler）死亡自动补位，人口缺口有界 | A1/A2；S6 |
| 4 | 低能量自恢复 | 清空 storage 注入后限定 tick 内恢复净流为正；无二次降级振荡（红队 A2） | A2；S4 |
| 5 | 孵化不丢单 | spawn 持续忙压测：无静默丢单（一切 intent 有回执）、P0 不被饿死 | A2；S5 |
| 6 | CPU 有账 | 全程 CPU 有预算与降级记录（遥测档案：档位分布、超预算计数、Memory 体积环比） | A2「CPU/Memory 有预算」；S8 |

## 5. MVP 内必须可用的恢复路径合同

MVP 不是「只会happy path」的演示——以下恢复路径**必须在 MVP 交付物内真实生效**
（对应 [FAILURE_RECOVERY_ARCHITECTURE.md](FAILURE_RECOVERY_ARCHITECTURE.md) §2 的
前七类；远矿 / 殖民类第 8–9 条不适用）：

| 恢复路径 | MVP 形态 | 验收注入 |
| --- | --- | --- |
| 卡位自愈 | N tick 位移不变→强制重算 / 绕行 / 弃任务回池 | 卡位计数遥测 |
| 死任务回收 | 租约 TTL＋心跳，到期回池，回执不静默 | S10 前置 |
| 孵化饥饿 | 内核级紧急直通＋body 降档出单＋deadline 撤销 | S5 |
| 物流降级 | fallback 链 L1–L3（link 断→container 缓冲→本地直供）；L4 phase 降级评估仅失效语境 | S4 |
| 规划防振荡 | AgendaItem（若 MVP 期启用最小 agenda）minDuration＋重建冷却 | 切换频率遥测 |
| CPU 降级链 | 四档看门狗全档位可进可出（含 Recovery） | S8 |
| Memory 恢复 | 迁移幂等重试＋global reset 惰性重建＋体积遥测 | S2/S3 |

MVP 整体出口判据：§4 六场景全绿 **且** 上表恢复路径全部有注入证据——两者缺一，
MVP 不得宣称达成（自治宣称纪律，[AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) §5）。

## 6. MVP 与完整架构的关系合同

| 条款 | 内容 |
| --- | --- |
| 子集原则 | MVP 是**同一架构的子集，不是原型另起炉灶**——同一 Kernel、同一组合根、同一所有权模型、同一目录结构（[ENGINEERING_BLUEPRINT.md](ENGINEERING_BLUEPRINT.md)）；原型分叉＝第二真相源，禁止 |
| 必须成立的契约 | 下表十项自 MVP 起即全部生效，不允许「MVP 简化版」： |
| 暂缓但不得违反 | war 授权链、Intel segment 四域、GCL 管理、跨房调拨门控在 MVP 期不实现，但**不得引入与之冲突的捷径**（如第二个 `spawnCreep` 写者、角色直发 `createConstructionSite`、EventBus 中枢）——这些是永久红线而非阶段性目标 |
| 演进路径 | MVP → A3 → A4 → A5 按 [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md) 推进；每跨越一个门槛的宣称必须附 soak 遥测证据（[AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) §5 升级义务） |

**MVP 必须成立的十项契约**：① Kernel 四职能（调度 / safeRun / 看门狗 / 迁移）；
② 唯一组合根 bootstrap.ts；③ 唯一写者（spawnCreep / site 唯二 / move 仲裁 / 市场
预留）；④ 三级存储准入＋幂等迁移五步；⑤ RolePolicy 声明式角色＋engine 统一驱动；
⑥ 纯函数律（决策函数无 Game/Memory）；⑦ 熔断器与 P0 永不熔断；⑧ 回执律（无静默
丢单）；⑨ 遥测三级管线最小集＋TAKEOVER 通道；⑩ 验收制（每步演进有指标出口）。

## 7. 一致性声明

本文件与 research/27 §3/§5、[IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md)
（P1–P4 合同＝MVP 实施）、[TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §3/§6
（门槛绑定与 S 场景）、[ARCHITECTURE_VALIDATION.md](ARCHITECTURE_VALIDATION.md)
Scenario A/G、[AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) §5（自治诚实分级：
MVP 达成后的现状表述＝「A1+A2 已自治域清单＋残余人工介入点清单」，禁止把设计含
表述为已运行）同一时刻必须一致；任何一处修订必须同步其余各处并走 ADR。
