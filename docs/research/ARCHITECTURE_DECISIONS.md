# Architecture Decision Records（架构决策记录）

> 研究套件的裁决核心。每条 ADR 含 Context / Problem / Options / Decision /
> Reasoning / Trade-offs / Consequences。证据链见 [RESEARCH_SOURCES.md](RESEARCH_SOURCES.md)，
> 事实基准见 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)，
> bot 证据见 [02_EXISTING_BOT_ANALYSIS.md](02_EXISTING_BOT_ANALYSIS.md)。
> 决策日：2026-08-22（Phase 0 全量调研完成后）。

---

## ADR-001 帝国-房间两级决策模型（Empire/Room 双层，拒绝全自治房间与全集中帝国）

**Context**：帝国规模从 1 房到几十房演化；决策权分配决定扩展性与稳定性。

**Problem**：谁拥有最终决策权？房间自治到什么程度？

**Options**：(A) 房间全自治各自为政；(B) 帝国全集中逐 creep 指挥；(C) 帝国管战略/跨房资源/军事，房间管本地经济闭环。

**Decision**：**C**。帝国层拥有目标选择权（姿态、扩张、战争、跨房资源调配）；房间层对本地 source 产能、人口、物流、建造、升级、本地防御负责，向上报告需求/产能/风险。帝国下发的是带预算与期限的 Agenda/Operation，不逐 creep 指挥。

**Reasoning**：全部调研对象无一例外采用房间/帝国两级分离（TI Collective/RoomManager、Quorum city/empire 进程、Overmind Colony 层、hivemind room managers/empire、KasamiBot 房间队列/AI 层）——这是最强社区收敛证据（≥6 家）。A 在帝国资源分配上死锁（无仲裁者）；B 的 CPU 与信息带宽不可承受。

**Trade-offs**：两级边界需要持续维护（什么属于帝国 vs 房间）；换来的是故障域隔离（单房故障不拖垮帝国）与 CPU 可扩展。

**Consequences**：跨房供需必须走帝国仲裁通道；房间不得绕过预算消耗共享资源（terminal 调拨、战争资源）。

---

## ADR-002 轻量内核 + 优先级系统管线（拒绝完整 OS 进程模型）

**Context**：Screeps 是否需要 Kernel/Process/PID/Sleep 式操作系统？Quorum 用了，TooAngel/TI/KasamiBot/bonzAI 没用。

**Problem**：调度模型决定 CPU 税、可测性与复杂度。

**Options**：(A) OS 内核（进程、PID、显式 CPU 配额、sleep/唤醒）；(B) 裸主循环按序调用；(C) 轻量内核：固定顺序的系统管线 + 优先级类（P0 生存…P3 增长）+ 错误隔离 + 预算看门狗 + 注册表组合根。

**Decision**：**C**。内核只维护运行秩序（调度、safeRun 错误隔离、Memory 迁移、CPU 看门狗、遥测），不感知业务；系统经唯一组合根注册，固定顺序执行；四档 bucket 看门狗（Healthy/Guarded/Conserve/Recovery）按 `Game.cpu.limit` 比例化，降级立即、恢复滞回。

**Reasoning**：Quorum 是唯一完整 OS 化的知名 bot，2021 年停更且后继无人；战绩最好的进攻型 bot（KasamiBot、TI、TooAngel、bonzAI）全在平铺/轻调度阵营。Overmind 作者本人拒绝「一 flag 一进程」模型。进程抽象的收益（动态并发）在单线程 tick 内不存在，其成本（调度税、状态管理、调试复杂度）却是每 tick 实付。但裸主循环（B）无法提供错误隔离与降级秩序，也被社区教训否定。

**Trade-offs**：放弃动态进程 spawn/sleep 的灵活性；换取确定性执行顺序（可测试、可推理 CPU）与低调度税。低优先级工作的「分频」用 cadence（每 N tick）实现而非 sleep 原语。

**Consequences**：新增系统只改组合根；系统间不得互相 import 运行时（见 ADR-004 边界）；需要饥饿老化机制防 P3 永久饥饿。

---

## ADR-003 战略层 = 姿态 × 预算的确定性纯函数（拒绝每 tick Goal 效用竞拍）

**Context**：总任务书 Model A–E（房间自决 / 帝国→房间→creep / 战略→计划→房间 / Goal→Policy→Plan→Operation→Task / 分层 Agent）之争。

**Problem**：「现在最该做什么」如何裁决，且不因 CPU 或抖动失效？

**Options**：(A) 每 tick 对所有 Goal 重算效用竞拍；(B) 分层 Agent 协商；(C) 姿态（posture）状态机 + 预算（budget）门控 + 低频议程（Agenda）。

**Decision**：**C**（即任务书 Model D 的修订版）。战略层是确定性纯函数：输入帝国态势快照（威胁、经济净流、CPU 健康度、扩张机会），输出 posture（peace/fortify/war/evacuate 等）与各域预算。中期承诺（远矿车道、扩张、战争）作为 Agenda/Operation 低频创建与复核，带预算、期限、取消条件。每 tick 的执行由确定性系统从需求缺口推导，不经过 planner。

**Reasoning**：效用竞拍的 CPU 成本与决策抖动被社区实践否定——TooAngel 仅用三个指数平滑指标（cpuIdle/heapFree/memoryFree）门控全部扩张决策，维持十年无人值守；其「trapped 检测→升级策略」证明元规则比竞拍更稳。Model B/E（分层 Agent）无成功先例且 CPU/不确定性爆炸（详见 [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md)）。

**Trade-offs**：姿态切换点需要精心设计滞回（防止 peace/war 抖动）；换来零竞拍 CPU 与完全可解释性。

**Consequences**：「Goal 竞争」转化为「posture 允许集 ∩ 预算门控 ∩ 优先级序」；新增战略行为=扩 posture 语义或加 Agenda 类型，而非加竞拍项。

---

## ADR-004 声明式 RolePolicy + 统一执行引擎（拒绝 creep 自治与散装 FSM）

**Context**：creep 行为组织的两种流派：每角色一个 run() 大函数 vs 声明式策略 + 共享引擎。

**Problem**：18+ 角色如何避免 18 套 FSM、18 个全房扫描器与互相抢目标？

**Decision**：角色=声明式 RolePolicy（gate/acquire/work/hold/onFlee/park/combat 钩子），由统一 role-runner 驱动；共享 FSM 只在背包空/满、任务完成、威胁解除时切状态（防抖动）；目标选择走统一 assignment 服务与缓存 targetId，禁止角色全房 find；移动登记意图、tick 末按房仲裁统一签发。

**Reasoning**：TI 的 roleManagers 命名空间、hivemind 的 role/spawn-role 分离、TooAngel 的 role_* 文件都收敛于「角色薄、引擎厚」；「每种角色一个全房扫描器」是社区明确记录的反模式（重复 Sense、互相争抢）。Overmind 的 init/run 相位分离（先登记意图后统一执行）与之同构。

**Trade-offs**：钩子模型对非常规行为表达力略弱；换来行为一致性、可批量测试、移动仲裁可行。

**Consequences**：新角色=一份 Policy 注册；违反禁令（自建 spawn 请求、全房扫描、直发 move）属于架构违规。

---

## ADR-005 需求驱动的集中 Spawn（唯一写者 + 幂等请求合并）

**Context**：任务书问「Spawn 到底应该听谁的？」候选：Role/Task/Demand/Room/Empire/Spawn Director。

**Problem**：多来源孵化请求必然重复、冲突、超预算。

**Decision**：**唯一写者原则**：只有 Spawn Manager 能调用 `spawnCreep`。需求由人口普查 + replacement horizon + 各系统缺口产生，带稳定 key 幂等合并、优先级车道（P0 灾后恢复最高）、能量比例化 body 缩放、紧急车道（可用能量 ≥200 立即生成最小工作单元）；`spawning` 与已提交请求计入人口；带黑名单冷却与撤销通道。

**Reasoning**：孵化与角色解耦的优先级队列是 ≥6 家收敛证据（KasamiBot 订单+优先级、TI spawning/requests、Quorum spawns 进程、hivemind spawn-role/spawn-manager、bonzAI SpawnGroup、Overmind hatchery 请求-满足）。官方事实支撑紧急车道：房间 spawn+extension 总能量 <300 时每 tick 自回 1 能量（灾后兜底存在，但靠它翻身要 300+ tick）。

**Trade-offs**：集中管理器成为关键路径（需要熔断与降级）；换来零重复孵化、全局能量核算可行。

**Consequences**：body 设计=角色模板 × 可用能量比例化，不是固定 body 表；多 spawn 房间由同一管理器排产。

---

## ADR-006 请求池物流（近似解 + 租约，拒绝全局最优求解）

**Context**：hauling 同时受来源/目标/容量/路径/拥堵/优先级/资源类型/时间影响。

**Problem**：物流是 NP-hard 类问题（Overmind 作者专文论证 hauling 复杂度）；追求最优解不可行。

**Decision**：供需两侧生成请求（haul/work/terminal request），执行者按评分领取并持租约（超时自动回收）；接受可解释的近似解；观测空载率/延迟/断链数持续调参；link 网络（RCL5+）自动化、terminal 帝国均衡作为低频系统独立运行。

**Reasoning**：TI 的 requests.ts（WorkRequest/HaulRequest/TerminalRequest + creep 按请求分配）是请求制经济的现役证据；TooAngel 的预计算路径+顺路投递是近似解的极致形态；Overmind 博客直接论证了最优解不可行。

**Trade-offs**：次优路径浪费部分运力；换来每 tick O(请求+执行者) 的可预算成本。

**Consequences**：物流健康度（空载率/任务年龄）是一等公民指标；断链要有 fallback（本地缓冲 container）。

---

## ADR-007 版本化布局模板 + 约束适配 + 交通热度道路（拒绝逐房算法生成主布局）

**Context**：布局三流派：固定几何模板（KasamiBot 蝴蝶、bunker 系）、逐房算法生成（bonzAI AutoOperation、Quorum 距离变换）、混合。

**Problem**：动态生成布局的工程复杂度、可维护性与防御质量 vs 模板的僵化。

**Decision**：**版本化蓝图模板（stamp 组合）+ 低频局部适配 + 队列化执行**：模板改动必须递增版本并写迁移；核心结构建成后冲突只标 blocked 不自动拆改；道路依据实测交通热度逐段添加，绝不预铺全房；全局与单房 site 上限额；site 创建仅两个写者（自有房 construction manager + 远矿 manager），角色层只写申请标记。

**Reasoning**：固定模板阵营（KasamiBot/TooAngel 道路沿实测路径、Overmind bunker）长期存活且防御可预期；算法生成阵营（bonzAI/Quorum）都停留在实验阶段或停更。模板+适配是复杂度与质量的平衡点，被最多存活 bot 采用。

**Trade-offs**：对极端地形房间适配性弱于算法生成；换取可审计、可迁移、防御结构可预期。

**Consequences**：新房间进场先跑模板适配校验；布局债务用版本迁移消化，不在线上自动重构。

---

## ADR-008 投资决策式扩张 + 资源门控（扩张是投资，不是信仰）

**Context**：过度扩张是社区记录的高频死因。

**Problem**：AI 为什么扩张、何时扩张、何时停止？

**Decision**：扩张候选按多因子评分（source 数/矿物价值/距离/邻接安全/宿敌距离/防守难度），且必须同时通过**资源门控**：CPU 平滑指标健康、本土能量净流为正、跨房运输有余量、失败可撤离。殖民自举走专门车道（殖民 creep 在目标 spawn 落地后自续命）。GCL 是硬上限。

**Reasoning**：TooAngel 用指数平滑 cpuIdle/heapFree/memoryFree 门控 nextroom——预算驱动扩张的十年验证；KasamiBot 的房间估值 + proximityscout 周期刷新是评分制先例；bonzAI 的扩张工人在目标 spawn 自续命是殖民自举先例。

**Trade-offs**：保守门控会错过部分窗口期；换来不因扩张掏空本土（帝国级死因防御）。

**Consequences**：扩张是 Agenda 项（有预算、期限、取消条件）；新殖民地有独立降级路径（自举失败→收缩为 remote mining 或放弃）。

---

## ADR-009 War posture 唯一进攻授权 + 止损链（战争是经济决策）

**Context**：PvP 真正困难的是「什么情况下不应该攻击」。

**Problem**：如何防止军事系统自主升级冲突、拖垮经济？

**Decision**：`war` 姿态是进攻的唯一授权来源（进入条件：持续被打 + 打得起）；war-planner 是唯一进攻执行决策者（attacker 仅由它孵化）；止损链不可绕过：伤亡超阈收摊、失败目标进黑名单冷却、经济压力持续超标退 fortify；波次集结（build 相位 hold 待命、满编才 advance）；战后核验只信新鲜 intel。

**Reasoning**：社区 PvP 教训（见 [16_MILITARY_SYSTEM.md](16_MILITARY_SYSTEM.md)）表明帝国死于战争经济失控多于死于战斗本身；TooAngel 声誉系统的三级升级 + 攻击次数解锁是「冲突升级有门槛」的同族设计；hivemind 干脆限武以防不可控。

**Trade-offs**：授权链长导致反击延迟（用预警性 fortify posture 补偿）；换来战争永远是经济上可承受的选择。

**Consequences**：军事单位不得自行选择进攻目标；战争账本（成本/收益/止损记录）是必备遥测。

---

## ADR-010 三级存储 Memory 架构（瘦 Memory / 可丢 heap / 冷 segment）

**Context**：Memory parse/stringify 每 tick 计入 CPU；体积即税。

**Decision**：Memory 只存 ID、枚举、少量数字与短 key（schema 版本化 + 幂等迁移：先写新字段验证后删旧、大迁移按 cursor 分 tick）；heap 存可重建缓存（TTL/失效条件，容忍任意时刻 global reset）；RawMemory segment 存冷数据（intel、市场历史、遥测），低频读写。

**Reasoning**：官方事实：Memory 序列化计入 CPU、global 随时重置、segment 100×100KB 异步激活。TooAngel「Memory 存路径」是其技术债；Quorum 的 vram 虚拟内存缓存、Overmind 的 build/refresh heap 缓存都收敛于同一分层。

**Trade-offs**：三级分层增加心智负担；换来每 tick 固定税可控、冷数据不占热路径。

**Consequences**：新增 Memory 字段必须同步更新类型与迁移；禁止在 Memory 写路径/历史/运行时索引。

---

## ADR-011 LLM 与 Agent Runtime 边界（体外研究员，无 Agent Runtime）

**Decision**：LLM/外部控制平面不得进入 tick 执行路径（物理上运行时也无出站网络）；「Agent」判据=运行时目标选择权，全架构仅战略层是受限 Agent（且为确定性纯函数）；不建设 Agent Runtime；LLM 合法位置=体外开发研究员 / 低频有界参数顾问（白名单+护栏+canary）/ 灾难接管辅助。

**Reasoning**：完整论证与证据见 [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md)。社区零先例 + 物理否决 + 可靠性三重裁决。

---

## ADR-012 验收制路线图（A0–A5 门槛，拒绝「能运行」式 MVP）

**Decision**：实施路线按可验证门槛推进：A0 可构建可启动可观测 → A1 单房生存闭环（空 Memory 自举）→ A2 稳定产能闭环 → A3 多房自治 → A4 威胁下运营 → A5 长期不退化（soak）。每级有场景矩阵、指标阈值与退出条件；MVP=A1+A2（自治能力验证，非功能清单）。

**Reasoning**：「MVP=能运行」无法验证自治；验收制来自自治契约方法论（详见 [27_IMPLEMENTATION_ROADMAP.md](27_IMPLEMENTATION_ROADMAP.md)）。bonzAI 把愿景与实际覆盖率诚实分离的先例支持这种分级陈述。

---

## 决策依赖图

```text
ADR-002 轻量内核 ──┬─→ ADR-004 RolePolicy 引擎 ─→ ADR-005 集中 Spawn
                  ├─→ ADR-010 三级存储
                  └─→ ADR-006 请求池物流
ADR-001 帝国/房间两级 ─→ ADR-003 姿态×预算战略层 ─→ ADR-008 投资式扩张
                                            └─→ ADR-009 War 授权与止损
ADR-007 版本化布局（相对独立，服务 ADR-001 房间层）
ADR-011 LLM 边界（约束所有层的引入决策）
ADR-012 验收制（约束交付节奏）
```
