# GOAL_POLICY_PLAN_MODEL · 目标—策略—计划概念模型契约

> 本文件是 Goal / Policy / Plan（含 Directive 收编）四个概念的**冻结契约**：概念定义、
> 生命周期、posture 合同与预算门控语义以本文为准；结构性修订必须走
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，不得静默修改。
> 依据：[ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md) §2/§3/§5、
> [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1、research/06、research/08、
> research/30（A3）。

## 1. 概念合同

### 1.1 Goal ＝ 声明式常量谓词（declarative constant predicate）

| 条款 | 内容 |
| --- | --- |
| 定义 | 「维持/达到/避免 + 指标 + 阈值 + 优先级类」的谓词，**编译期常量集合**，描述可接受状态（如「每房能量净流 ≥ 0（平滑）」）。依据 research/06 §10.1。 |
| 必须 | 全部 Goal 在常量代码中声明并按 P0–P3 分优先级类；验收语义（§5）必须可由遥测指标判定。 |
| 禁止 | Goal **不得实例化、不得写入 Memory、不得拥有运行时权重或 update 路径**；不存在 Goal 竞拍引擎（调和 §2）。「某个 Goal 这 tick 是否生效」仅等于三个静态判定的合取：(a) 当前 posture 允许其行为类别；(b) 所属域预算余量为正；(c) 更高优先级类未占满预算（research/06 §10.1 裁决性转译）。 |
| 失败防线 | 任何给 Goal 加「权重重算/运行时新增删除」的改动是评审红线（research/06 §8「Goal 层复辟竞拍」；目标选择权弥散＝变相 Multi-Agent）。 |

### 1.2 Policy ＝ posture × budget 纯函数

| 条款 | 内容 |
| --- | --- |
| 定义 | 以态势快照（situation snapshot，摘要级值类型）为输入、以 posture（§3）与五域预算（§4）为输出的**确定性纯函数及其参数表**。它是全系统唯一受限 Agent 的载体（见 [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md)）。 |
| 必须 | 输入只能是态势快照，**禁止读 `Game` 全局或任何可变全局态**（同输入同输出，可快照回放单测，research/05 §8）；求值按态势分频（N tick 全量聚合 + 每 tick 增量，快照未刷新则沿用上次决策——红队 A1 修订）。 |
| 禁止 | Policy 不得执行动作、不得直接调用 Game 写接口（EMPIRE_SYSTEM_MODEL §1）；任何系统不得改 posture（决策权总表，[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1）。 |

### 1.3 Plan ＝ 收窄概念（无独立 Plan 对象）

| 条款 | 内容 |
| --- | --- |
| 定义 | Plan **仅指 AgendaItem 内的里程碑（milestone）描述与预算分解**（如殖民自举五阶段）。 |
| 禁止 | 系统中**不存在独立的 Plan 对象、Plan 层或 Planner 组件**（调和 §4）；Plan 不是可执行动作序列——tactical 层禁序列规划（research/07 §5）。里程碑是**验收判据**（行为证据），不是执行脚本。 |
| 例外声明 | 本质上顺序敏感的工作（lab 反应链配平、成组 boost 前置）允许在 AgendaItem 内保留**有界内部顺序表**——这是显式声明的妥协点，P10 裁决（research/07 §7）。 |

### 1.4 Directive 收编说明

系统中不存在名为「Directive」的运行时类型（调和 §3）：其中期承诺语义被 **AgendaItem**
（带预算/期限/取消条件/属地/结果核验）完整承载，瞬时执行语义被 **Demand/Task**（§2）
承载。帝国→房间的下发通道保留「Directive-channel」这一**通道名**，但其载体只能是
AgendaItem、调拨令与预算，绝无独立 Directive 对象。收编理由：①「Directive」在社区
语义过载（flag 包装/军事命令/政治指令）；② bonzAI Operation–Mission 与 TI request
双先例证明两层（中期承诺 + 带租约执行单元）已足够；③ 六态生命周期（research/08）
已覆盖 Task 全程，无需第三种对象。

## 2. 修正后的完整生命周期（环，非线性链）

> 任务书 §11 的线性链被修订为环：Policy 授权开 Agenda，**Agenda 与房间稳态共同生成
> Demand**（research/08 §10.3 修正点 1）。链上「Demand 在 Agenda 前」仅对「触发立项
> 的 Demand」（如扩张申请）成立。

```text
Goal(常量谓词集) → Policy 求值 → AgendaItem 立项 → Demand 生成 → Task 认领
   → Execution → Outcome 反馈 → AgendaItem 更新 → Goal 谓词终态判定
        ↑______________________ 遥测/指标修正态势 ______________________|
```

| # | 环节 | 谁创建 | 谁决定 | 何时运行 | 失败语义 |
| --- | --- | --- | --- | --- | --- |
| 1 | Goal 常量谓词集 | 常量代码（设计时冻结） | 无运行时决定者 | 编译期 | 不适用（无运行时状态）；验收语义失效＝谓词改版，走 §15 修订 |
| 2 | Policy 求值（posture×budget） | 常量代码 + tuning 参数表 | **Policy 纯函数**（唯一） | 态势分频（快照未刷新则沿用上次决策，天然幂等） | 求值异常由 safeRun 隔离，沿用上次 PostureDecision；posture 卡死由最大持续期兜底强制复评（research/06 §8） |
| 3 | AgendaItem 立项 | **帝国垄断**（立项权唯一） | Policy 允许集 ∩ 预算门控 ∩ 优先级序 | 低频复核窗（50–200 tick 级，见 [PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §2） | 立项失败＝不立项（无副作用）；Recovery 档禁止新建（P2 冻结） |
| 4 | Demand 生成 | Agenda 生命周期内持续声明 + 房间稳态缺口 | 各确定性推导函数 | 每 tick（heap 上重推导，tick 末丢弃） | **Demand 不持久化、失败＝下一 tick 自然消失**；触发立项的 Demand 例外转译进 AgendaItem 字段（调和 §2） |
| 5 | Task 认领（租约） | 分配服务（绑定仲裁唯一） | 评分认领规则 | 每 tick | 租约六态 offered→claimed→succeeded/failed/expired/cancelled（research/08 §10.4 同一状态机，其表述为 pending/assigned/completed/…——命名以本表与 [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) 为准）；TTL+heartbeat 到期自动回池防泄漏 |
| 6 | Execution | RolePolicy 声明 + 唯一写者签发 | 角色相位 + 写者规则 | 每 tick | safeRun 隔离单点错误；连续失败进冷却（P0 永不冷却） |
| 7 | Outcome 反馈 | 执行者/写者上报 | 核验谓词 | 事件时 | **禁止静默丢单**：一切 Intent/Request 必有回执（accepted/rejected/completed/failed/expired），拒绝也落遥测（research/08 §8） |
| 8 | AgendaItem 更新（完成/取消/降级/续期） | 帝国（Agenda 复核） | 复核规则（里程碑验收=行为证据） | 低频复核窗 | 取消=优雅收尾（撤离/冻结，不硬断执行体）；minDuration 内除 P0 冲突不可取消 |
| 9 | Goal 谓词终态判定 | 复核时的验收评估 | 验收语义（§5） | 复核窗 + soak 聚合 | 判定只修正战略指标与允许集，**不创建/销毁 Goal 常量**；错误判定由行为证据窗口约束 |

## 3. posture 四态合同表

> 滞回铁律（research/06 §10.2，与 CPU 看门狗同构）：进入需持续窗口 T_in，退出窗口
> T_out > T_in；**同 tick 至多切一档**；每次切换写 `PostureDecision{posture, reason,
> snapshotRef}` 进 Memory（仅切换 tick 写入，平稳期零写入）。任一 posture 有最大持续期
> 兜底（超期强制复评，防滞回条件 bug 困死）。

| posture | 进入条件（持续 T_in） | 退出条件（持续 T_out>T_in） | 滞回窗口约束 | 允许的 Agenda 类别 | 预算语义 |
| --- | --- | --- | --- | --- | --- |
| `peace` | 默认态 | 威胁/经济红线触发转移（走 fortify/war 各自进入条件） | — | 扩张殖民、远矿车道、重建、准军事（power bank/SK farming，ROI 门控非 war 授权）全开 | 发展预算全开；军费仅维持（P3） |
| `fortify` | 威胁预警（intel 置信度≥阈值）或被打但可守 | 威胁解除（intel TTL 过期且无新接触） | T_out ≥ 2×T_in 初值，soak 校准 | 暂停扩张与远矿**新开**（既有车道进入收缩评估）；防御建设最优先；重建开放 | 防御建设预算置顶；P2/P3 收紧；经济维持 |
| `war` | 持续被打 ∧ 打得起（ADR-009 授权链，见 [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1） | 止损链触发（伤亡超 squadSize×casualMultiplier / 经济压力持续超标经 warPressureTicks）或胜利核验完成 | **退出滞回 ≥ 一个完整波次周期**（集结+推进+战后核验，红队 A3）；minDuration 由波次周期推导，禁止拍脑袋定值 | 进攻波次（唯一授权，仅 war-planner 执行）；扩张冻结；远矿按战区收缩 | 战争基金预算线划出：基金内军事消耗**不与经济发展竞争**；基金耗尽→强制退 fortify |
| `evacuate`（按房） | 房间评估为不可守（防御纵深×储备×援军时效全不达标） | 撤离完成或威胁消除 | 同房评估滞回 | **房间级评估、帝国级批准**（上报→战略层确认→作为 Agenda 项下发），不占全局 posture 槽位（research/06 §10.2 裁决） | 该房只保人口与可搬运资产；帝国侧收缩 GCL 槽位 |

**硬约束**：`war` 姿态是进攻的唯一授权来源；代码存在进攻能力 ≠ 战争开始（AGENT.md
战争条款一致）。姿态切换带 minDuration 承诺（防振荡三防线第一、二线，见
[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §4）。

## 4. 五域预算 EMA 与门控合同

> 形式化母型：TooAngel 三指标源码级核查（research/06 §5，CONFIRMED）。域集采用
> [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) 口径：**CPU、能量、人口、物流、
> 军事**五域（research/06 §10.3 原型域集含 construction；建造存量约束由建造配额体系
> `[CONFIG.construction]` 承载，不重复设域）。对每个资源域 d：

```text
平滑：    S_d(t) = S_d(t-1) + (x_d(t) - S_d(t-1)) / D_d     # EMA，D_d 按域定（等效时间常数≈D_d tick）
余量：    h_d = margin_d - S_d(consumed)                     # 例 CPU 域：h = limit - S(cpuUsed)
开放条件： h_d > open_d  ∧  (h_d - 新承诺人均负载) > floor_d  # 人均化判定（TooAngel haveEnoughSystemResources 母型）
关闭条件： h_d < close_d                                    # 冻结新增承诺
滞回带：   余量轴上 open_d > close_d，带内维持既有承诺状态
持续期：   解冻方向需连续 N_d tick 满足（冻结方向立即生效——与看门狗「降级立即、恢复滞回」同构）
```

**门控语义合同**：

| 条款 | 内容 |
| --- | --- |
| 必须 | 输入复用看门狗/遥测已采集量（cpu used、heap、memory 长度、净流、队列深度），不新增每 tick 采样；参数 (D_d, open_d, close_d, N_d, floor_d) 全部进 tuning 覆盖层，soak 回填。 |
| 域实例 | **CPU**：S(cpuUsed)/rooms > S(cpuIdle) → 冻结新增房间/车道承诺；**能量**：S(净流)<0 连续 N tick → 冻结 P2/P3 承诺，本土净流为正是一切对外援助/扩张的前置；**人口**：spawn 队列深度+孵化能量占用超限 → 收紧非 P0 孵化；**军事**：warPressureTicks 止损链即关闭条件实例化；**物流**：断链数/空载率超阈 → 收缩远矿车道承诺。 |
| 禁止 | 无平滑直接比原始值（单 tick 毛刺驱动战略切换）；人均门控**必须**与最差房门控双条件并用（防单房热点被均值掩盖，research/06 §8；分位数门控 A3 后回填）。 |
| 符号口径 | research/06 §10.3 括注「close_d > open_d」按**消耗轴**理解（消耗升破更高线才关闭）；本合同统一按**余量轴**书写为 open_d > close_d，两轴等价、以本节公式为唯一口径。 |

## 5. Goal 五终态与 Agenda 处置

> Goal 常量无运行时状态，「终态」判定的是**Goal 的当次追求**（其名下 Agenda 组合的
> 验收语义，research/06 §10.5）。Goal 本体唯一的「状态变化」是进入/离开 posture 允许集。

| 终态 | 语义 | 触发 | 对应 Agenda 处置 |
| --- | --- | --- | --- |
| `completed` 完成 | 验收条件达成（结果核验通过） | 复核发现里程碑达成（行为证据） | 记录结果事件（战争为 WarOutcome，只信新鲜 intel）；释放预算 |
| `cancelled` 取消 | 上游撤销：posture 切换使允许集关闭，或预算域关闭 | 战略层转移 | 优雅收尾：撤离/冻结，**不硬断执行体**；下层在各自复核周期自行发现 |
| `expired` 过期 | 超期未完成但非失败 | deadline + 宽限期 | 降级或重立案（带失败计数） |
| `demoted` 降级（含 superseded） | 追求强度/范围下调，或被同目标下更优 Agenda 组合取代 | 重规划 / 资源收缩 | 旧项标记取代者 id；预算下调但承诺关系保留 |
| `unreachable` 不可达（failed） | 期限内不可达或执行体全灭 | deadline 到期 / 止损链 | 目标进 blacklist 冷却（war 为 warBlacklist）；预算回收；冷却期内**禁止重建** |

**重规划 ＝ 同一 Goal 下更换 Agenda 组合**，不触碰 posture（除非关闭条件满足）。
取消的层级语义（research/08 §10.4）：任何一层取消**不向上触发连锁取消**——上层在
自己的复核周期里发现下层 Outcome 变化。

## 6. 评审红线（汇总）

1. Goal 实例化/入 Memory/带权重重算——立即否决（§1.1）。
2. Policy 读 `Game` 全局或执行动作——立即否决（§1.2）。
3. posture 无滞回/无 minDuration/war 退出窗口 < 波次周期——立即否决（§3，红队 A3）。
4. Demand 持久化进 Memory（除立项转译字段）——立即否决（§2 环节 4）。
5. 静默丢单（Intent/Request 无回执）——立即否决（§2 环节 7）。
