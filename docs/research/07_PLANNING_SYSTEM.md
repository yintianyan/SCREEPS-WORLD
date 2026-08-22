# 07 · 规划系统：Planner 生成什么、何时规划、如何防振荡

> 研究文档 · 结论等级：**设计裁决**（总任务书 §9「Planner 生成计划还是 Intent」的
> 最终答案）。裁决：**Planner 产出 Intent/Demand 与低频 Agenda（中期承诺），不产出
> 全量可执行计划序列**；每 tick 执行由确定性系统从需求缺口推导。战略层为纯函数
> （ADR-003）；Agent 边界见 [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md)。

## 1. Problem

「规划」（Planning）在 AI 里默认指生成动作序列（经典 STRIPS→GOAP→HTN 谱系）。
把该默认带进 Screeps 是致命的：**世界是对抗且部分可观测的**——敌对玩家、市场
波动、respawn、global reset 都会让计划快照过期。但完全无规划（纯 reactive）同样
不行：殖民、远矿车道、战争波次这类中期工作没有承诺机制就会反复半途而废。本文
裁决：规划分五种，各自归位；Planner 的输出物是什么；规划振荡（replan thrashing）
如何防。

## 2. Research Questions

- reactive / scheduled / strategic / operational / tactical 五种规划各自的定义、
  先例与在 Screeps 的合法位置？
- Planner 应该生成「计划」还是「Intent」？判据是什么？
- 什么力量导致规划振荡？滞回/承诺/最低持续期如何组合成防线？
- AgendaItem 的数据契约长什么样？

## 3. Existing Solutions（规划范式谱系）

| 范式 | 机制 | 已知弱点 |
| --- | --- | --- |
| 经典规划（STRIPS/HTN/GOAP） | 在世界模型上搜索/分解动作序列 | 世界模型过期→计划脆断；重规划成本高；对抗环境无收敛保证 |
| MPC（模型预测控制） | 滚动时域：每步重解有限horizon优化 | 每 tick 重解=CPU 灾难；模型误差放大 |
| BDI 意图机制 | 意图有承诺期，不会被新愿望立刻推翻 | 机制重；「承诺」思想被本文吸收 |
| 反应式（subsumption/BT） | 无内部模型，刺激→响应 | 无中期承诺，重复起步 |
| 分层规划（RTS build-order planning） | 离线算建造序列，在线执行 | Screeps 对抗性强于固定地图 RTS，序列保鲜更短 |

**理论定位**：Screeps 的规划问题不是「求解最优动作序列」（NP 且脆），而是
「在资源预算下维持一组中期承诺」——规划的对象是**承诺（commitment）**而非
**序列（sequence）**。

## 4. Screeps Community Practice

- **全部调研 bot 无一保存全量可执行计划序列**（2026-08-22 源码级调研，CONFIRMED）：
  - bonzAI：Operation–Mission 两级——MiningOperation/RaidOperation/ConquestOperation/
    FortOperation + 约 40 个 Mission 类。这是**手工 HTN**：分解结构写死在代码里，
    运行时只做「按条件实例化 Mission + 管理 Mission 生命周期」，不做序列搜索。
  - The International：request 池每 100–200 tick 复核（本次核查 requests.ts），
    房间认领后自行决定怎么干——帝国层零计划序列。
  - Overmind：Overseer 放 Directive（条件挂载），Overlord 每 tick 决策树给空闲
    creep 派 Task——**反应式 + 条件承诺**，无前瞻序列。
  - TooAngel：纯规则 + 状态机；唯一「计划」是 squad 的 move→attack FSM（全员
    waiting 才转 attack——承诺式转移）。
- **社区检索确认无 GOAP/在线规划器 bot**（2026-08-22 检索，CONFIRMED 负结果）；
  行为树只用于单 creep 行为层（choreographer）。
- 社区「一年级轨迹」（过程树→优先队列+事件流）同样指向「结构换智能」。

## 5. Existing Bot Analysis（五种规划的逐一裁决）

**本文对「规划」的五种切分与逐一裁决**：

| # | 种类 | 定义 | 社区先例 | 裁决 |
| --- | --- | --- | --- | --- |
| 1 | **reactive（反应式）** | 无内部计划，每 tick 从当前状态直接推导动作 | Overmind 决策树、TooAngel 规则、所有 bot 的 creep 层 | **保留**——作为每 tick 执行推导的主体形态（从 Demand 缺口推导 Intent/Task） |
| 2 | **scheduled（定时）** | 按固定时间表触发的工作 | 分频维护钩子、遥测聚合 | **仅用于分频维护**（迁移/对账/采样），不是「规划」——禁止把发展工作做成 cron 表 |
| 3 | **strategic（战略规划）** | 选择目标与资源分配 | posture×budget（ADR-003） | **保留但定义为纯函数**：输入态势快照→输出 posture+budget，不是序列规划器（详见 [06_GOAL_AND_POLICY_SYSTEM.md](06_GOAL_AND_POLICY_SYSTEM.md)） |
| 4 | **operational（作战/运营规划）** | 中期承诺的创建与维持 | bonzAI Operation、TI request、Overmind Directive、27 号远矿车道 | **保留为低频 Agenda——本文核心裁决**：这是唯一名为「Planner」的组件，产出承诺而非序列 |
| 5 | **tactical（战术规划）** | 为个体/小队生成动作序列 | GOAP/HTN/寻路 | **不做序列规划**：tactical=确定性策略（RolePolicy 钩子+评分函数）；寻路是全架构唯一的序列求解，且局部化（maxRooms:1 + 限频，03 号 §5） |

**「Planner 生成计划还是 Intent」的裁决（总任务书 §9）**：

> **Intent/Demand 为主。** Planner（=议程管理器）产出的是：(a) 带预算/期限/取消
> 条件的 Agenda 项（中期承诺）；(b) 承诺在生命周期内持续声明的 Demand（缺口信号）。
> 「计划」仅存在于 Agenda 项的里程碑描述中（milestones 是验收判据，不是执行脚本）。

四条论据：
1. **对抗性世界**：敌对玩家与市场使任何 10^3 tick 级序列在生成时即开始过期；
   社区六大 bot 零家保存计划序列（§4）。
2. **确定性执行已可推导**：需要什么 = f(缺口)，缺口每 tick 可算（08 号）——序列
   规划求解的问题在本架构里不存在。
3. **CPU 与振荡**：序列规划每次重解成本高，而重规划触发恰恰在资源紧张时（最付
   不起的时候）。
4. **可审计性**：承诺（预算/期限/取消条件）是人可读可审计的；动作序列只有作者
   能读。

## 6. Advantages（低频 Agenda + 每 tick 推导的混合）

1. **承诺稳定**：远矿车道/殖民/战争波次一旦立项，有预算与期限保护，不会被下一
   tick 的噪声推翻——解决「重复半途而废」。
2. **执行新鲜**：每 tick 的实际动作由当前缺口推导，永远基于最新世界状态——
   解决「计划脆断」。
3. **成本两极化**：低频规划（每 10^2–10^3 tick）+ 高频廉价推导（查表级），没有
   中间地带的「每 tick 中等成本规划」。
4. **降级友好**：Recovery 档直接冻结 Agenda 复润与新建（P2/P3），每 tick 推导的
   P0 部分照常运行——规划系统天然配合看门狗（19 号 §10.2）。

## 7. Disadvantages

- 「里程碑≠脚本」要求执行系统自己找路径：某些本质上顺序敏感的工作（lab 反应链
  配平、成组 boost 前置）需要在 Agenda 项内保留**有界的内部顺序表**——这是规划
  谱系里的妥协点，必须显式声明（P10 高级经济）。
- 混合形态的心智负担：开发者要判断「这个逻辑属于承诺层还是推导层」——放错层的
  症状是「该稳定的抖、该新鲜的老」。
- 承诺机制牺牲最优性：市场窗口期（短暂低价）可能因 Agenda 冷却错过——接受，
  市场本身有独立的低频决策通道（26 号 §6）。

## 8. Failure Modes

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| **规划振荡（replan thrashing）** | Agenda 反复创建/取消（远矿开了停、停了开） | 三重防线（§10.4）：滞回 + 承诺（minDuration）+ 重建冷却 |
| 计划过期失效 | 承诺基于过期 intel（目标房已被占） | 复核只信新鲜 intel（TTL/置信度）；取消条件里显式列 intel 失效 |
| 承诺不足（短视） | 无中期承诺→殖民地永远建不完 | Agenda 是 P2 发展工作的**唯一**通道：跨 10^3 tick 的工作必须立项，禁止用每 tick 规则硬扛 |
| 承诺过度（僵化） | 预算已枯竭仍不肯撤 | cancelConditions 必含 budget 关闭条件（06 号 §10.3）；deadline 强制到期 |
| 每 tick 重规划复发 | 有人往推导层加「前瞻」 | 战术层禁止序列规划（§5 表第 5 行）；寻路是唯一例外且已限频 |
| cron 化发展工作 | 把建造/扩张写成固定时间表 | scheduled 仅限维护类（§5 第 2 行）；评审红线 |
| Agenda 项泄漏 | 已死项（目标消失/房失守）残留预算 | 低频复核对账：状态非 active 的项限期清理（22 号 §10.3 两阶段删除） |
| 里程碑验收作弊 | 复核读到虚假完成（如矿车道「建成」但 hauler 从未跑通） | 验收条件用**行为证据**（净流量、任务完成数），不用结构存在性 |

## 9. CPU Implications

- 规划成本集中在低频：Agenda 复润每 10^2–10^3 tick、扩张评估每 10^2+ tick、
  TI request 复核 100–200 tick 先例——分摊到每 tick <0.05 CPU。
- 每 tick 推导是查表级：缺口= 派生索引上的整数比较（26 号 §3 第 5 步），无搜索、
  无排序超过 O(活跃请求)。
- Agenda 项存 Memory（O(active agendas)，26 号 §7）：每项固定小节（类型/预算/
  期限/状态/里程碑枚举），预计 <100B；里程碑证据走遥测 segment。
- **禁止**：每 tick PathFinder 级搜索进入规划路径；任何「规划器缓存全图」的形态
  （Memory 税，03 号 §4）。

## 10. Recommended Design

### 10.1 规划职责的最终分布（一张图）

```text
strategic   → 纯函数（posture×budget）     每 tick，查表级      [06 号]
operational → Agenda/Operation 管理        低频（10^2–10^3）    [本文，唯一 Planner]
tactical    → 确定性系统从缺口推导 Demand   每 tick，查表级      [08 号]
reactive    → （=tactical 的执行面）       每 tick              [08 号]
scheduled   → 分频维护钩子                 固定 cadence         [19 号 §10.4]
（寻路：唯一序列求解，局部化+限频，不属规划层）
```

### 10.2 Planner（议程管理器）的职责边界

**做**：创建 Agenda 项（从 posture 允许集+预算门控推导候选）、低频复核（预算余量/
期限/取消条件/里程碑验收）、状态机（pending→active→completed/failed/expired/
cancelled/superseded，06 号 §10.5）、结果事件记录。

**不做**：生成动作序列；直接指挥 creep；绕过 Demand 直接下 Task；在 Recovery 档
新建任何项（P2 冻结）。

### 10.3 AgendaItem 数据契约（26 号 §5 的展开）

```text
AgendaItem {
  id: 稳定幂等键（type:target 房间）
  type: remote | expansion | war | rebuild | evacuatereserve…
  budget: { energy 端点, CPU 参考, population 上限 }   # 承诺的资源边界
  deadline: tick                                        # 硬期限
  minDuration: tick                                     # 最低持续期（防振荡）
  cancelConditions: 谓词列表                            # budget 关闭/威胁/intel 失效…
  milestones: 验收判据列表（行为证据，非结构存在性）
  status: pending | active | done | failed | expired | cancelled | superseded
  outcome?: 完成核验摘要（WarOutcome 等）
}
```

### 10.4 防规划振荡的三重防线

1. **滞回（hysteresis）**：Agenda 的创建与取消条件分离——创建要 budget 开启条件
   持续 N tick；取消要关闭条件持续 M tick（M、N 与 06 号 §10.3 公式共用参数面）。
2. **承诺（commitment / minDuration）**：项激活后 minDuration 内不可取消（除非
   P0 冲突——生存永远赢）；期限内复核只记录不动作。TooAngel squad「全员 waiting
   才转 attack」是同族思想：转移门槛提高换取稳定性。
3. **重建冷却（re-entry cooldown）**：同目标（同幂等键前缀）的 failed/cancelled
   项，冷却期内不得重建（TI abandon 计数、warBlacklist 是先例——但 blacklist 是
   永久级，重建冷却是可恢复级）。

补充防线：取消成本显式化——复核决策只看未来边际（沉没成本记录进遥测但不参与
判定），防止「投多了不忍心撤」的反向僵化。

### 10.5 与其他层的接口

- 上游：读 PostureDecision（允许集）+ budget 余量（06 号）——只读。
- 下游：活跃 Agenda 项向需求池声明 Demand（08 号 §10.2）——单向，不点名 creep。
- 反馈：Outcome 聚合喂复核（里程碑验收）与战略指标（战争账本、扩张 ROI）。
- 降级：Guarded 档暂停新建；Conserve/Recovery 冻结复核并按取消条件优雅收缩
  （远矿最先，27 号 Phase 5 验收）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 全量序列规划器（GOAP/HTN 求解器） | 对抗世界序列脆断；重规划 CPU；社区零先例（§4 负结果）； bonzAI 证明手工分解已够 |
| 每 tick 重规划（MPC 式滚动） | 在最付不起 CPU 的时刻（紧张→重规划→更紧张）形成正反馈死循环 |
| 纯 reactive 无承诺 | 殖民/远矿/战争波次等 10^3–10^4 tick 工作无法完成；社区「重复半途而废」教训 |
| cron 式发展时间表 | 发展由态势驱动不由日历驱动；RCL 相变点依赖实测而非固定 tick（03 号 §6） |
| Planner 直接派 Task 到 creep | 越权：绑定仲裁在分配服务（26 号 §6）；也剥夺了执行侧的缺口新鲜度 |
| Agenda 永久承诺（无期限） | 僵化+预算泄漏；deadline 与 cancelConditions 是承诺的对价 |
| LLM 在线生成计划 | 物理不可达 + 不可预算（23 号 §11 第一条） |

## 12. Open Questions

1. lab 反应链/factory 商品链的「有界内部顺序表」如何塞进 AgendaItem（扩展字段 or
   专用子类型）——P10 裁决。
2. Agenda 复核的随机化间隔（TI 用 randomIntRange 防多房同步复核尖峰）是否引入
   本架构——倾向是，待遥测验证。
3. 里程碑验收的「行为证据」采样窗口长度：太短噪声、太长延迟关闭——需 soak 标定。
4. 多战争波次并行时的 Agenda 间资源仲裁粒度（全局 military budget vs 按战区分账）。

## 13. Evidence / Sources

| URL / 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://github.com/bonzaiferroni/bonzAI | 源码 | Operation–Mission 两级（手工 HTN）：分解写死、运行时只管生命周期；AutoOperation 自动选建家点位 | CONFIRMED |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source（requests.ts，2026-08-22 核查） | 源码 | request 复核 `randomIntRange(100,200)` tick；认领/放弃（responder/abandon）生命周期 | CONFIRMED |
| https://bencbartlett.com/blog/screeps-1-overlord-overload/ | 作者博客 | Directive=条件挂载点（非计划）；Overlord 每 tick 决策树派 Task（反应式） | CONFIRMED |
| Web 检索（2026-08-22）："screeps GOAP planner bot" | 检索 | 无 GOAP/在线规划器 bot；BT 仅限行为层 | CONFIRMED（负结果） |
| http://tooangel.github.io/screeps/doc/Design.html | 源码文档 | squad move→attack FSM 全员 waiting 才转移（承诺式转移先例） | CONFIRMED |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-003/008/009/012 | 本套件 | 纯函数战略、Agenda 式扩张/战争、验收制 | — |
| [06_GOAL_AND_POLICY_SYSTEM.md](06_GOAL_AND_POLICY_SYSTEM.md) §10.5 | 本套件 | Agenda 终态语义（与本文 §10.3 契约共用） | — |
| screeps-grandmaster-perspective/references/empire-architecture.md | 领域经验 | Plan/Mission 带 owner/租约/重试上限/取消条件/依赖（AgendaItem 契约的骨架来源） | LIKELY |
