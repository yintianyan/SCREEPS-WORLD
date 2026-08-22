# 06 · Goal 与 Policy 系统：姿态、预算与目标语义

> 研究文档 · 结论等级：**设计裁决**（ADR-003 的深度论证）。战略层 = posture ×
> budget 确定性纯函数；本文给出 Goal 的表达方式、posture 状态机、budget 门控的
> 公式化（TooAngel 三指标的源码级形式化）与三层目标映射。Agent 判据见
> [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md)；架构裁决见
> [05_AGENT_ARCHITECTURE.md](05_AGENT_ARCHITECTURE.md)。

## 1. Problem

「帝国现在最该追求什么」是自治系统的第一决策。经典陷阱有两个：一是**效用竞拍**
（每 tick 对所有候选目标重算效用分取最高）——CPU 不可承受且决策抖动；二是
**静态脚本**（写死的发展路线）——无法应对威胁与资源变化。本文裁决 Goal 如何表达、
Policy（posture × budget）如何设计、目标如何在三个时间尺度上映射、取消与重规划
的语义是什么。

## 2. Research Questions

- Goal 应该以什么形式表达？为什么不做显式竞拍？
- posture 状态机的进入/退出条件与滞回如何设计？
- budget 门控的数学形式是什么（TooAngel 三指标的形式化与推广）？
- strategic / operational / tactical 三层目标各由什么载体承载？
- Goal 的取消与重规划语义是什么（谁有权取消、何时触发）？

## 3. Existing Solutions（问题域一般解法）

- **效用系统（Utility AI）**：对每个 (目标, 上下文) 对打分，选最高。优点是表达
  力；缺点是分数设计无物理约束、每 tick 重算贵、参数间耦合导致抖动。
- **GOAP 的目标选择**：按目标优先级+可达性选择，规划在目标确定之后。目标集本身
  仍需人工排序。
- **机器人 policy 状态机**：`normal → alert → siege → recovery` 式显式状态+转换
  条件+退出条件，被防御域广泛使用（skill 参考 community-lessons；22 号 §4）。
- **控制论的滞回（hysteresis）**：切换系统进入/退出条件分离，防止在阈值附近
  抖振——温控器是原型。Screeps 的 CPU 看门狗已用同款（19 号 §10.3）。
- **平滑统计门控**：用指数移动平均（EMA）滤掉单 tick 噪声后再与阈值比较——
  TooAngel 的实践（§5 形式化）。

## 4. Screeps Community Practice

- **没有任何存活 bot 对高层目标做每 tick 效用竞拍**（2026-08-22 源码级调研）。
  六大 bot 的「战略」全部是：规则/状态机（TooAngel 外交、hivemind 威胁记忆）+
  评分排序的低频决策（TI request 按 score 分配、KasamiBot 房间估值）+ 人工分解的
  Operation 结构（bonzAI）。
- **滞回与多条件门槛是社区共识形态**：TooAngel trapped 检测用三重条件（GCL≥3 +
  仅 1 房 + 5 万 tick 停滞）+ 排除法（排除合法资源约束），防误杀（22 号 §10.6）；
  squad FSM 全员 waiting 才转 attack（承诺式状态转移）。
- **声誉/姿态先例**：TooAngel 声誉外交三级升级（simpleAttack -1500 → squad -6000
  → attack42 -9000）——对外姿态是带门槛与升级链的状态机，不是连续效用。
- TI 的 request 复核间隔 100–200 tick 随机化——战略级决策低频化的直接证据。

## 5. Existing Bot Analysis：TooAngel 三指标的源码级形式化

本次核查 TooAngel 源码（`src/main.js` + `src/brain_nextroom.js`，2026-08-22，
CONFIRMED）：

**平滑层**（main.js，每 tick）——EMA，除数 `statsDivider = D`：

```text
cpuIdle_t   = ((D-1)·cpuIdle_{t-1}   + (limit - used))    / D
cpuUsed_t   = ((D-1)·cpuUsed_{t-1}   + used)              / D
heapFree_t  = ((D-1)·heapFree_{t-1}  + (heapLimit - heapUsed)) / D
memoryFree_t= ((D-1)·memoryFree_{t-1}+ (MEM_LIMIT - memUsed))  / D
```

等效时间常数 ≈ D tick（半衰期 ≈ 0.69·D）。单 tick 毛刺被滤除，指标反映「近期
稳态」。存储在 heap（`global.data.stats`），reset 后重建——正确分层。

**门控层**（brain_nextroom.js `haveEnoughSystemResources()`）——人均化比较：

```text
cpuPerRoom    = cpuUsed / myRooms.length;   if (cpuPerRoom    > cpuIdle)   → 拒绝扩张
heapPerRoom   = heapUsed / myRooms.length;  if (heapPerRoom   > heapFree)  → 拒绝扩张
memoryPerRoom = memoryUsed / myRooms.length;if (memoryPerRoom > memoryFree)→ 拒绝扩张
```

语义：**「新增一间房的人均资源占用，必须还能被当前平滑余量覆盖」**——把扩张
建模为资源预算问题而非机会问题。这是 ADR-008 的直接证据，也是本文 budget 公式化
的母型。

**启示与局限**：TooAngel 只把该门控用于扩张单点决策；本文将其推广为多域预算
（§10.3）。局限：无滞回（指标好转即可再扩张）、无能量域（只管 CPU/heap/memory）。

## 6. Advantages（posture × budget + 声明式 Goal）

1. **零竞拍 CPU**：目标选择退化为「查 posture 允许集 + 预算符号判定」，O(候选数)
   的整数比较。
2. **可解释**：任何时刻帝国的目标集可一句话回答（"peace + CPU Guarded：扩张冻结，
   防御与发展开放"）；PostureDecision 快照即审计记录。
3. **可测试**：posture 转移表 + budget 公式全部是纯函数，可快照回放单测。
4. **防抖动内建**：滞回 + 最低持续期让姿态切换成本显式化。

## 7. Disadvantages

- 表达力上限低于效用系统：非正交目标组合（同时 war + 扩张）需要更丰富的 posture
  语义而非自动权衡（05 号 §7）。
- posture 集合与转移条件是**设计时冻结**的——新战略行为=扩 posture 语义或加
  Agenda 类型（ADR-003 Consequences），不能运行时涌现。
- budget 公式的参数（D、margin、滞回窗口）需要 soak 数据标定（27 号 P11）。

## 8. Failure Modes

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| peace/war 抖动 | 姿态高频切换，军事单位忽孵忽停 | 进入/退出阈值分离（滞回）+ 切换最低持续期 + 同 tick 至多切一档 |
| 预算饿死低优先级 | P3（市场/tuning/遥测）永久无预算 → 帝国僵化 | 饥饿老化：被跳过计数超阈值 → 优先级临时提升（19 号 §10.5；ADR-003 决策链含此条款） |
| posture 卡死 | 威胁早已解除但滞回窗口/条件 bug 导致困在 fortify/war | 转移条件全部有界（超时兜底：任一 posture 有最大持续期，超期强制复评）；停滞检测元机制（22 号 §10.6） |
| 噪声驱动切换 | 单 tick 毛刺（一波攻击/一次市场波动）触发姿态切换 | 输入先过 EMA 平滑 + 持续窗口判定（连续 N tick 满足才立案） |
| 预算公式失真 | 人均化掩盖单房热点（一房拖高全局均值） | 人均门控 + 最差房门控双条件；分位数而非均值（A3 后回填） |
| Goal 层复辟竞拍 | 有人给 Goal 加「权重重算」 | Goal 是声明式常量集合，类型上无 update 路径；评审红线 |

## 9. CPU Implications

- Goal 集合是编译期常量，运行时成本 0。
- posture×budget 纯函数每 tick 一次，输入是摘要级态势快照（O(rooms) 字段读取 +
  常数比较），目标 <0.5 CPU（26 号 §7 固定项）。
- EMA 平滑指标复用看门狗/遥测已采集的量（cpu used、heap、memory 长度），不新增
  采样（19 号 §9：采样次数每 tick 限制在档位点）。
- PostureDecision 只在切换 tick 写 Memory（短记录：posture + 原因 + 快照引用），
  平稳期零写入。

## 10. Recommended Design

### 10.1 Goal 的表达：声明式谓词，不显式竞拍

Goal = 「维持/达到/避免 + 指标 + 阈值 + 优先级类」的声明式谓词，是**编译期常量
集合**，运行时不可变。示例：

```text
P0-生存  maintain: 每自有房 controller 安全 ∧ spawn 可用
P1-稳定  maintain: 每房能量净流 ≥ 0（平滑）∧ 关键角色满编
P2-发展  achieve:  房间 phase 依能力相变点推进（storage→link→terminal…）
P3-增长  achieve:  GCL 槽位利用率 → 1（受 budget 门控）+ 能量 sink 消化富余
```

**「Goal 竞争」的裁决性转译（ADR-003）**：不存在每 tick 竞拍；冲突消解 =
**posture 允许集 ∩ 预算门控 ∩ 优先级序（P0>P1>P2>P3 + 饥饿老化）**。
即：一个 Goal 在某 tick 是否「生效」，等价于三个静态判定的合取——(a) 当前 posture
允许该 Goal 的行为类别；(b) 该 Goal 所属域的 budget 余量为正；(c) 高优先级 Goal
未占用全部预算。新增战略行为 = 扩 posture 语义或加 Agenda 类型，不加竞拍项。

### 10.2 posture 状态机（进入/退出 + 滞回）

| posture | 进入条件（全部满足且持续 T_in） | 退出条件（满足且持续 T_out > T_in） | 允许集（Goal 行为类别） |
| --- | --- | --- | --- |
| `peace` | 默认态 | 威胁/经济红线触发转移 | 扩张、发展、市场、远矿全开；军费仅维持 |
| `fortify` | 威胁预警（intel 置信度≥阈值）或 被打但可守 | 威胁解除（intel TTL 过期且无新接触）持续 T_out | 暂停扩张与远矿新开；防御建设最优先；经济维持 |
| `war` | 持续被打 ∧ 打得起（ADR-009 授权链） | 止损链触发（伤亡超阈/经济红线）或 胜利核验完成 | 进攻授权（仅 war-planner）；经济转入战时配额 |
| `evacuate`（按房） | 房间评估为不可守（防御纵深×储备×援军时效全不达标） | 撤离完成 或 威胁消除 | 该房只保人口与可搬运资产；帝国侧收缩 GCL 槽位 |

滞回铁律（与 19 号看门狗同构）：**进入需持续窗口（连续 N tick 满足），退出窗口
更长，同 tick 至多切一档**；每次切换写 `PostureDecision{posture, reason, snapshotRef}`
进 Memory（26 号 §5 契约）。注意 `evacuate` 按 26 号 §10 的 Open Question 是
「房间级状态还是帝国级姿态」——本文裁决为**房间级评估、帝国级批准**（上报→
战略层确认→作为 Agenda 项下发），不占用全局 posture 槽位。

### 10.3 budget 门控的公式化（TooAngel 母型的多域推广）

对每个资源域 d ∈ {CPU, energy, population, military, construction}：

```text
平滑：    S_d(t) = S_d(t-1) + (x_d(t) - S_d(t-1)) / D_d        # EMA，D_d 按域定
余量：    h_d = margin_d - S_d(consumed)                        # 例：CPU: limit - S(cpuUsed)
开放条件： h_d > open_d  ∧  h_d - 新承诺负载 > floor_d           # 人均化 TooAngel 判定
关闭条件： h_d < close_d （close_d > open_d，滞回带）           # 关闭比开启更难
持续期：  两方向均需连续 N_d tick 满足
```

- **CPU 域**直接继承 TooAngel 人均化判定（§5）：`S(cpuUsed)/rooms > S(cpuIdle)`
  → 冻结新增房间/车道承诺。
- **energy 域**：`S(净流) < 0` 连续 N tick → 冻结 P2/P3 承诺；本土净流为正是
  一切对外援助/扩张的前置（ADR-008）。
- **population 域**：spawn 队列深度 + 孵化能量占用超限 → 收紧非 P0 孵化。
- **military 域**：war 姿态下的 warPressureTicks 机制（ADR-009 止损链）即
  budget 关闭条件的实例化。
- 参数 (D_d, open_d, close_d, N_d) 进 tuning 覆盖层，soak 数据回填（23 号 §10.2
  L2 顾问的合法参数面）。

### 10.4 三层目标映射表（strategic / operational / tactical）

| 层 | 对象 | 载体 | 生命周期（tick） | 生成方式 | 示例 |
| --- | --- | --- | --- | --- | --- |
| strategic（战略） | Goal | posture × budget（纯函数） | 10^3–10^5 | 常量集合 + 允许集判定 | 「维持能量安全」「GCL 槽位用满」 |
| operational（作战） | Objective | Agenda/Operation 项 | 10^3–10^4 | 低频创建 + 复核（07 号） | 「建立 E5N8 远矿车道」「殖民 W7N3」 |
| tactical（战术） | Demand → Task | 需求池 / 租约 | 1–10^2 | 每 tick 确定性推导（08 号） | 「本房运力缺口 +600/tick」→「去 source1 采矿」 |

跨层规则：上层只约束下层（允许集/预算/期限），不生成下层的具体内容；下层只上报
结果（Outcome/指标），不改上层状态。Goal 层无运行时「重算」，Operation 层无每
tick 重建，Task 层无跨层直读 posture 之外的战略状态。

### 10.5 Goal 取消与重规划语义

Goal 是常量集合，**不存在运行时取消**——「取消」发生在 operational 层（Agenda 项），
语义表：

| 终态 | 语义 | 触发 | 后续 |
| --- | --- | --- | --- |
| `completed` | 验收条件达成（结果核验通过） | 复核发现里程碑达成 | 记录 WarOutcome/结果事件（若为战争）；释放预算 |
| `failed` | 期限内未达成 或 执行体全灭 | deadline 到期 / 止损链 | 失败目标进 blacklist 冷却；预算回收 |
| `expired` | 超期未完成但非失败 | deadline + 宽限期 | 降级或重立案（带失败计数） |
| `cancelled` | 上游撤销（posture 切换使允许集关闭 / budget 关闭） | 战略层转移 | 优雅收尾：撤离/冻结，不硬断执行体 |
| `superseded` | 被同目标下更优组合取代 | 重规划 | 旧项标记取代者 id |

**重规划 = 同一 Goal 下更换 Agenda 组合**，不触碰 posture（除非关闭条件满足）。
防线：Agenda 项带最低持续期 minDuration，期限内除 P0 冲突外不可取消（07 号 §10.4）；
同一 Goal→Operation 的重建次数有冷却，防止「failed→立即重建」循环。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 每 tick 效用竞拍（Goal 带权重重算） | CPU + 抖动双杀；TooAngel 三指标证明平滑门控可达成同等裁决（ADR-003 Reasoning；23 号 §11「效用 Agent」条目） |
| 黑盒学习策略（RL/进化出 posture 表） | 无安全 eval 环境；训练事故=帝国损失；且 posture 表是人可审计的自治契约底线（23 号 §10.3） |
| 固定阈值无滞回 | 阈值附近抖振（温控器问题）；社区 squad FSM 的「全员 waiting 才转 attack」就是承诺式转移的反向证据 |
| 无平滑直接比原始值 | 单 tick 毛刺驱动战略切换（一波虫族攻击触发 war） |
| 连续姿态空间（如 aggressiveness ∈ [0,1]） | 不可枚举→不可测试、不可审计；允许集语义消失；社区零先例 |
| Goal 可运行时新增/删除 | 目标选择权弥散（变相 Multi-Agent）；目标集必须是设计时冻结的常量 |

## 12. Open Questions

1. posture 最小完备集：peace/fortify/war 之外，是否需要 `rebuild`（灾后）作为
   独立姿态（当前裁决：不设，灾后=P0 优先级车道 + peace 内处理）——待 A4 场景
   注入验证。
2. 多战区场景：两房同时被不同敌人攻击时 war 的 budget 是否分战区核算。
3. budget 参数 (D_d, open_d, close_d, N_d) 初值：先按 TooAngel 经验值起步
   （CPU 域），其余域 soak 回填。
4. 分位数门控（最差房 vs 均值）的引入时机——A3 多房后用数据裁决。

## 13. Evidence / Sources

| URL / 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://raw.githubusercontent.com/TooAngel/screeps/master/src/main.js（2026-08-22 核查） | 源码 | EMA 平滑公式：`stats.X = ((D-1)·prev + current)/D`，覆盖 cpuIdle/Used、heapFree/Used、memoryFree/Used | CONFIRMED |
| https://raw.githubusercontent.com/TooAngel/screeps/master/src/brain_nextroom.js | 源码 | `haveEnoughSystemResources()`：人均占用 > 平滑余量 → 拒绝扩张（三指标门控的准确形式） | CONFIRMED |
| http://tooangel.github.io/screeps/doc/Design.html | 源码文档 | 声誉三级升级（-1500/-6000/-9000）、trapped 三重条件 + 排除法、GCL 驱动扩张 | CONFIRMED |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source（requests.ts） | 源码 | request 复核 100–200 tick 随机间隔；按 score 排序；abandon 冷却——低频评分制先例 | CONFIRMED |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-003/008/009 | 本套件 | 姿态×预算纯函数、投资式扩张、war 授权与止损 | — |
| [19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md) §10.2/§10.5 | 本套件 | P0–P3 牺牲序、饥饿老化（本文 Goal 优先级序的运行载体） | — |
| screeps-grandmaster-perspective/references/community-lessons.md | 领域经验 | 防御 policy 状态机、滞回共识 | LIKELY |
