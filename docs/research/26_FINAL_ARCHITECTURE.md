# 26 · 最终架构（FINAL_ARCHITECTURE）

> 研究套件的架构总纲。全部裁决与证据见 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
> （ADR-001…012）；机制事实见 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)；
> 红队攻击与修订见 [30_RED_TEAM_REVIEW.md](30_RED_TEAM_REVIEW.md)。

## 1. 世界观（总任务书 §25 的答案）

**Empire AI 不是一堆 Manager，也不是分层 Agent 社会，而是一组互相供养的闭环，
运行在确定性 tick 运行时上：**

```text
        ┌──────────────────────────── 演化闭环 ────────────────────────────┐
        │            （指标退化→诊断→有界调参→canary→保留/回滚）             │
        ▼                                                                   │
感知(闭眼世界快照) → 状态归一化 → 战略(姿态×预算) → 规划(议程) → 分配调度 → 执行 → 反馈
        ▲              (三级存储)      (帝国层)      (Agenda)  (Spawn/物流)  (Action)  (遥测/健康度)
        │                                                                   │
        └────────────────────── 知识闭环（intel TTL/置信度） ────────────────┘
   生存闭环（威胁→防御→恢复）与能量闭环（source→物流→消费）内嵌于房间层
```

任务书 §25 给出的 Perception→…→Learning 瀑布被**修正为闭环**：Learning/Adaptation
不是终点的独立层，而是 Feedback 上有界的参数调节（演化闭环），且战略层可被反馈
直接降级（posture 收缩）——这是对「瀑布模型」的关键推翻。

## 2. 分层总图与职责边界

```text
┌─────────────────────────── Kernel（运行秩序，不感知业务）───────────────────────────┐
│ 系统管线调度（P0生存→P1稳定→P2发展→P3增长，固定顺序） · safeRun 错误隔离+熔断冷却     │
│ 四档 CPU 看门狗（Healthy/Guarded/Conserve/Recovery，比例化+滞回）                     │
│ Memory 版本迁移（幂等/分tick） · 组合根注册 · 遥测采样                              │
├──────────────────────────── 系统层（Systems，跨 creep/跨房决策）────────────────────┤
│ 帝国战略（posture×budget 纯函数） · 议程/Operation 管理（远矿/扩张/战争车道）          │
│ 房间状态归一化 · Spawn Manager（唯一 spawnCreep 写者） · 分配服务（目标仲裁）          │
│ 建造管理（自有房） · 远矿管理（远端 site 唯一写者） · 防御塔控 · 交通仲裁（tick末签发）  │
│ Terminal/市场均衡（低频） · 情报系统（TTL/置信度） · 调参引擎 · 自愈监视              │
├──────────────────────────── 房间层（Room，本地经济闭环单元）─────────────────────────┤
│ 对本房 source 产能、人口、物流、建造、升级、本地防御负责；向上报告需求/产能/风险；      │
│ 能力门槛 phase（锚定 storage/link/terminal/factory/双spawn 相变点）；                 │
│ 不越过帝国预算消耗共享资源；单房故障域隔离。                                          │
├──────────────────────────── 执行层（Execution）───────────────────────────────────┤
│ 声明式 RolePolicy（gate/acquire/work/hold/onFlee/park/combat）+ 统一 role-runner     │
│ 共享 FSM（仅背包空/满、任务完成、威胁解除切状态） · 意图移动 + 寻路限频两级寻路        │
│ 禁止：全房 find / 自建 spawn 请求 / 直发 createConstructionSite / 每 tick 全图寻路   │
├──────────────────────────── 横切面（Cross-cutting）────────────────────────────────┤
│ 三级存储（瘦Memory/heap缓存/segment冷数据） · 观测（低频遥测导出） · 自愈（有界恢复）  │
│ LLM 边界：体外研究员/低频有界参数顾问，禁入 tick 路径（ADR-011）                      │
└────────────────────────────────────────────────────────────────────────────────────┘
```

各层「不负责什么」与 skill 参考的职责表一致：Sense 不改战略、执行不改 State、
creep 不向 spawn 越权发请求——边界违例即架构 bug。

## 3. 数据流（一个 tick 的生命周期）

```text
1. 感知：只读快照（可见房间对象、Memory、heap 缓存校验）→ RoomSnapshot/帝国态势
2. 归一化：房间状态刷新（分频：全量 N tick、增量每 tick）→ 派生索引（目标池/需求池）
3. 战略：态势快照 → posture + budget（确定性纯函数，滞回切换）
4. 议程：Agenda/Operation 复核（低频：预算/期限/取消条件检查）
5. 分配：人口缺口→spawn intent（幂等 key 合并）；供需池→物流租约；目标池→creep 绑定
6. 执行：RolePolicy 管线产出非移动动作；移动登记意图
7. 仲裁：交通系统 tick 末按房统一签发 move；寻路按限频执行
8. 反馈：遥测聚合（低频）；健康度计算；异常检测喂自愈；演化闭环调参
```

关键设计：**2–5 步全部在写者唯一的所有权模型下运行**（见
[25_ARCHITECTURAL_TRADEOFFS.md](25_ARCHITECTURAL_TRADEOFFS.md)）：spawnCreep 唯一
写者、site 创建两个写者、市场订单唯一写者、Memory 字段各有 owner——重复 tick /
global reset / 部分失败都不会产生重复对象。

## 4. 决策流（「现在最该做什么」的裁决链）

```text
帝国态势（威胁/经济净流/CPU健康/扩张机会）
  → 战略层：posture ∈ {peace, fortify, war, evacuate…}（允许行为集）
             budget ∈ {CPU/能量/人口 配额}（做多少）
  → 议程层：Agenda 项 = 中期承诺（远矿车道/扩张殖民/战争波次/重建），
             低频创建与复核，每项带 [预算, 期限, 取消条件, 结果核验]
  → 需求层：确定性系统从缺口推导 Demand（spawn 意图/搬运请求/建造申请/防御响应）
  → 执行层：RolePolicy × 分配服务 → Action
  → 反馈：结果核验 → 议程完成/失败记录 → 战略层指标修正
```

- Goal 不做每 tick 竞拍（ADR-003）；「Goal 竞争」= posture 允许集 ∩ 预算门控 ∩
  优先级序（P0>P1>P2>P3 + 饥饿老化）。
- Planner 生成的是**意图与预算**（Agenda/Demand），不是可执行计划序列——这回答了
  总任务书 §9「Planner 生成计划还是 Intent」：**Intent/Demand 为主，计划仅存在于
  Agenda 的里程碑描述中**。

## 5. 核心数据契约（类型学，不含 Game 引用）

| 契约 | 内容 | 存储 | owner |
| --- | --- | --- | --- |
| `EmpireSituation` | 威胁、经济净流、CPU 健康度、扩张机会、GCL | 派生（heap） | 感知/战略 |
| `RoomState` | phase、能量收支、人口、建造进度、防御状态、健康度 | Memory（瘦身）+派生 | 房间状态系统 |
| `PostureDecision` | posture + 各域 budget + 切换原因 | Memory（短） | 帝国战略 |
| `AgendaItem` | 类型（remote/expansion/war/rebuild）、预算、期限、取消条件、状态 | Memory | 议程管理 |
| `SpawnIntent` | 角色、body 模板×能量档、优先级、幂等 key、deadline | 运行时（合并后） | 各需求方→Spawn Mgr |
| `LogisticsRequest` | 供给方/需求方/资源/量/优先级/租约 | 运行时池 | 物流系统 |
| `IntelEntry` | 房间/玩家情报、TTL、置信度 | segment（冷） | 情报系统 |
| `TelemetryFrame` | CPU/bucket/经济/任务健康度聚合 | segment（低频） | 遥测 |

决策函数形如 `situation + state + policy → decision` 的纯函数（战略/分配/评分全部
可脱离真实服务器单测）。

## 6. 模块清单（推荐实现的完备集合）

| 模块 | 优先级类 | 唯一权力 |
| --- | --- | --- |
| kernel（调度/看门狗/迁移/safeRun） | — | tick 秩序 |
| 帝国战略（posture×budget） | P1 | 目标选择权（唯一受限 Agent） |
| 议程管理（Operation 生命周期） | P2 | 中期承诺的创建/取消 |
| 房间状态归一化 + 快照 | P0 | 派生索引 |
| Spawn Manager | P0 | `spawnCreep` |
| 分配服务 | P0 | 目标-执行者绑定仲裁 |
| 建造管理 / 远矿管理 | P2 | `createConstructionSite`（各管一半） |
| 防御塔控 + 威胁评估 | P0 | tower 动作 |
| 交通仲裁 | P1 | move 签发 |
| Terminal/市场 | P2 | 市场订单 |
| 情报系统 | P2 | intel 写入 |
| 调参引擎 + 自愈监视 | P1 | 有界参数调整 |
| RolePolicy 集 + role-runner | — | 无（执行） |

## 7. 规模化分析（1 房 → 30+ 房）

- CPU 预算模型：固定开销（内核+战略+遥测，O(1)）+ 房间线性项（状态/物流/建造，
  O(rooms)，目标 ≤1.5 CPU/房）+ creep 项（O(creeps)，靠 RolePolicy 薄执行与意图
  仲裁压平）+ 远矿项（O(remote rooms)，~1 CPU/房，ROI 定价）。
- 防爆炸机制：分频（全量刷新 N tick / 增量每 tick）、Recovery 档按
  P3→P2 逐级砍负载（远矿最先、军事集结暂停、建造限流）、扩张门控（指数平滑
  CPU/heap/memory 指标，TooAngel 十年验证）。
- Memory：体积 = O(rooms)（每房固定小节）+ O(active agendas) + O(spawn queue)，
  intel/遥测/历史全走 segment——膨胀上限可控。

## 8. 与总任务书 §31 建议树的对照（保留/推翻）

| 任务书建议 | 裁决 | 理由 |
| --- | --- | --- |
| World/Perception/Intelligence/World Model 分四层 | 合并为「感知+状态归一化」+ 情报系统 | 四层切分是语义重复；情报独立因存储层不同（segment） |
| Empire 内含 Strategy/Goals/Policies/Planning | 保留但重定义：Strategy=posture×budget；Planning=Agenda（低频） | 拒绝每 tick Goal 竞拍（ADR-003） |
| Operations 层 | 保留（=Agenda/Operation 车道） | bonzAI/Overmind 双先例 |
| Rooms 层 | 保留 + 能力门槛 phase | 全社区收敛 |
| Economy/Logistics/Spawn/Construction/Defense/Military 平铺 | 保留为系统层成员（优先级类归属见表 §6） | 唯一写者模型需要统一管线 |
| Execution 层 | 保留 + 声明式 RolePolicy 强约束 | ADR-004 |

## 9. 红队修订记录

首版架构（含「每房间独立 Strategy 实例」「全量 Memory 快照回写」）经红队攻击后
修订，详见 [30_RED_TEAM_REVIEW.md](30_RED_TEAM_REVIEW.md) 修订表。

## 10. Open Questions

1. posture 集合的最小完备集（peace/fortify/war 之外 evacuate 是否独立姿态）。
2. 30 房以上帝国战略层的分频周期需要实测数据校准。
3. 多 shard 期 InterShardMemory 的引入方式（推迟到 A5 后裁决）。

## 11. Evidence / Sources

本文是套件结论的汇编，证据散布于各主题文档与 [RESEARCH_SOURCES.md](RESEARCH_SOURCES.md)；
核心裁决证据：7 家调研 bot 架构收敛（[02_EXISTING_BOT_ANALYSIS.md](02_EXISTING_BOT_ANALYSIS.md)）、
社区十教训（[01_SCREEPS_AI_LANDSCAPE.md](01_SCREEPS_AI_LANDSCAPE.md)）、
官方机制约束（[03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)）。
