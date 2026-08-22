# 24 · 失败模式全景（FAILURE MODES）

> 研究文档 · 结论等级：**设计裁决**（社区死亡案例 + bot 考古 + 本套件防线映射）。
> 风险概率/影响评级见 [29_RISK_REGISTER.md](29_RISK_REGISTER.md)（本文按**失败
> 机理**组织，29 号按**风险条目**组织，互为视图）；生态级项目死亡见
> [01_SCREEPS_AI_LANDSCAPE.md](01_SCREEPS_AI_LANDSCAPE.md) §8；bot 级弱点见
> [02_EXISTING_BOT_ANALYSIS.md](02_EXISTING_BOT_ANALYSIS.md) §8。核查日：2026-08-22。

## 1. Problem

自治帝国没有人工兜底，**失败模式就是设计需求**。社区十年的帝国尸体给出了一份
免费的失败清单：overnight collapse（CPU 死亡循环）、围城耗能破防、扩张掏空
本土、respawn 爬不起来。本文把这些死法整理成**五大类失败模式**（Economic /
Planning / Execution / Empire / Architecture），每类给出：具体失败模式、真实
案例、机理、本架构的对应防线——并回答实施路线图（27 号）的总原则：

> **为什么「缺环时新增功能会加速失败」**：每个新功能都是新的状态源与消费方；
> 感知→决策→执行→反馈闭环存在缺口时，新功能产生的状态变化无人核验、无人回滚，
> 其副作用在缺口处累积。功能越多，缺口处的熵增越快。这就是 ADR-012 验收制要求
> 「每 Phase 交付完整闭环」的机理依据。

## 2. Research Questions

- 帝国失败如何分类？五大类各自的时间尺度与可逆性？
- 每类的真实社区案例与机理是什么？
- 架构类失败（循环依赖/写者越权/状态不一致/Memory 爆炸）如何在结构上防？
- 失败之间的级联路径（小失败如何放大成帝国死亡）？
- 防线映射的完整性如何检验（场景注入矩阵）？

## 3. Existing Solutions（失败分类学与案例库）

自治系统的失败分类学（综合分布式系统与游戏 AI 运维经验）：

| 维度 | 分类 | 说明 |
| --- | --- | --- |
| 时间尺度 | 瞬时（tick 级）/ 慢性（万 tick 级）/ 灾变（不可逆） | 决定检测手段：对账 / 趋势遥测 / 预防性结构约束 |
| 可逆性 | 可自愈 / 需降级 / 不可逆（controller 丢失、核弹命中） | 不可逆失败的唯一解是**事前防线** |
| 作用域 | creep / 房间 / 帝国 | 与 22 号 §10.2 故障域分级一一对应 |
| 层次 | 经济 / 规划 / 执行 / 帝国 / 架构 | 本文组织轴 |

社区死亡案例库（RESEARCH_SOURCES.md C 节，全部 CONFIRMED 除非标注）：CPU
overnight collapse（reddit 8mowvu）、bucket 失灵求助（forum 1405）、围城耗能
（reddit 55aapi）、safemode 自动化约束（reddit 662flg）、会话间全灭（reddit
10wohds，2023）、respawn 爬不起来（多帖归纳，LIKELY）、MemHack 演进史（wiki）。

## 4. Screeps Community Practice

- **CPU 死亡循环是公认头号死因**：超限→吸干 bucket→停机→creep 全灭→更难恢复。
  社区反复出现「睡前还好好的，早上帝国没了」叙事（8mowvu 原帖即典型）。
- **围城是头号破防手段**：攻击方不进攻，在房外游走让 tower 空烧——防御死于
  能量会计失败，不是战斗失败（55aapi；tanjera 战术库 Tower Drain 条目）。
- **市场摩擦损耗**：5% 挂单税（取消失不退）+指数运费+抢单近者得——市场自动化
  的失败是慢性失血不是爆仓。
- **迁移与 reset 是工程期灾难点**：schema 变更把旧状态变脏数据、global reset 后
  全量重建撞预算（forum 2185 强制 reset 测试法）。
- **共识**：try/catch 不等于 self-healing；失败必须有诊断、隔离、重试上限与
  恢复动作（community-lessons，与 22 号一致）。

## 5. Existing Bot Analysis（bot 失败考古）

| Bot | 结构性失败 | 归类 | 教训 |
| --- | --- | --- | --- |
| TooAngel | Memory 存整条路径（每 tick 线性税）；carry 卡房界（issue #157）；「打一次失败永不纠缠」 | Architecture（债）/ Execution / Planning（刚性） | 债能活十年≠债该复制；卡位需元机制；止损≠永久放弃 |
| Overmind | "definitely exploitable"（社区评）；混淆发布损害审计 | Planning（可预测）/ Empire（对抗利用） | 确定性策略必须管理「可预测性代价」 |
| TI | 战斗代码自评 dysfunctional | Execution（军事） | 进攻是最贵的活动，授权链优先于微操 |
| Quorum | OS 内核维护税→2021 项目死 | Architecture | 架构税最终由项目生命支付 |
| bonzAI | 愿景与覆盖率断层 | Planning | 自治宣称必须分级验收 |
| KasamiBot | 压缩分发→知识不可传承 | Empire（组织级） | 传承也是帝国失败面 |

## 6. Advantages（失败显式化的收益）

1. **防线可审计**：每条失败模式有命名、机理、案例、防线——评审时逐条对照，
   而非「感觉挺稳」。
2. **测试有靶**：场景注入矩阵（28 号）直接从本文生成触发输入。
3. **级联可断**：明确小失败→大失败的放大路径后，可以在级联节点设闸（如援助
   预算上限断「单房拖垮帝国」）。
4. **优先级排序**：不可逆/高概率组合（R-01/R-08/R-16）优先获得工程投入。

## 7. Disadvantages（失败台账的局限）

- 台账是静态的，对抗性失败（R-15 宿敌针对性打法）靠事后复盘闭环而非穷举。
- 概率/影响评级是 SPECULATION（29 号 §4 声明），需 soak 回填。
- 失败模式间存在组合态（围城+市场封锁+情报过期叠加），台账只能覆盖单因与已知
  级联，未知组合靠自愈闭环兜底。

## 8. Failure Modes（五大类总表）

> 「防线」列引用本套件文档与 29 号风险 ID；详细机理与案例见 §10 逐类展开。

### 8.1 经济失败（Economic）——最快致死

| 模式 | 机理 | 真实案例 | 风险 | 防线 |
| --- | --- | --- | --- | --- |
| E1 CPU 死亡循环 | 超限→bucket 吸干→停机→creep 全灭 | reddit 8mowvu、forum 1405 | R-01 | 四档看门狗+降级链+能量 <300 自回兜底（19 号 §10.3） |
| E2 能量饥饿 | 物流断链→spawn 停摆→人口崩塌 | 10wohds 类全灭叙事 | R-02 | 能量收支核算先行（A2 门槛）+container 缓冲 fallback |
| E3 过度扩张掏空本土 | 殖民期双房纯消耗+输血过量 | 社区高频死因（多帖） | R-03 | 投资式门控+「本土净流为正」（ADR-008） |
| E4 围城耗能破防 | tower 空烧干 storage 后被推进 | reddit 55aapi | R-08 | siege 姿态能量配给+min-cut+safemode 决策表（15 号） |
| E5 市场慢性失血 | 重复订单/运费倒挂/税费磨损 | wiki/Market 摩擦条目 | R-17 | 唯一写者+幂等键+套利净利核算（12 号） |
| E6 后期能量过剩 | RCL8 后产能无处去，浪费在过度防御/冗余人口 | forum 298 | —（机会成本） | energy sink 规划（27 号 P10） |

### 8.2 规划失败（Planning）——慢性方向错误

| 模式 | 机理 | 真实案例 | 风险 | 防线 |
| --- | --- | --- | --- | --- |
| P1 姿态抖动 | peace/war 快速振荡，经济反复重构 | —（设计期风险） | R-04 | 滞回+切换遥测（ADR-003） |
| P2 议程饥饿 | 低优先级 Agenda 永不执行，帝国僵化 | — | R-05 | 饥饿老化（19 号 §10.5） |
| P3 规划振荡 | 取消条件过敏→反复立项取消 | replan thrashing（07 号） | — | 最低持续期+承诺语义（07 号 §10） |
| P4 冷启动失败 | 代码只会运营不会拓荒，respawn 后爬不起来 | respawn 失败共性（LIKELY） | R-16 | 殖民自举车道+空 Memory 自举验收（A1） |
| P5 调参震荡 | 演化闭环参数来回改 | — | R-18 | 调参护栏（窗口+canary+回滚） |
| P6 策略刚性 | 固定策略被对手摸透 | TooAngel「不纠缠」、Overmind exploitable | R-15 | 战争账本复盘+黑名单冷却可再试探（ADR-009） |

### 8.3 执行失败（Execution）——tick 级浪费与局部瘫痪

| 模式 | 机理 | 真实案例 | 风险 | 防线 |
| --- | --- | --- | --- | --- |
| X1 creep 卡死/震荡 | 反复撞墙、房界来回（0.2 CPU/intent 白费） | TooAngel issue #157 | R-06 | N tick 位移不变→强制重算/绕行（22 号 §4） |
| X2 无效 intent 刷税 | 满血治疗、对墙 move 等成功但无意义动作 | wiki/CPU | R-06 | 发前自查前置条件（20 号 §4） |
| X3 spawn 队列死锁 | 黑名单+能量不足叠加，P0 也孵不出 | — | R-07 | 紧急车道（≥200 能量 [WORK,CARRY,MOVE]）+撤销通道（11 号） |
| X4 关键角色全灭 | 老化同步/战损→供应链断顶 | — | R-02 级联 | replacement horizon+P0 恢复车道（ADR-005） |
| X5 物流断链 | 供体有货无人取/消费者缺货无人送 | — | R-02 前兆 | 断链遥测+container 缓冲+租约超时回收（12 号） |
| X6 重复提交 | 重复 tick/reset 后 double-spawn/重复建 site | — | R-12/R-17 | 幂等键贯穿 intent/request/task（08 号） |

### 8.4 帝国失败（Empire）——多房协调层的放大器

| 模式 | 机理 | 风险 | 防线（04 号 §8 全表） |
| --- | --- | --- | --- |
| M1 援助雪崩 | 一房被围→抽邻居支援→连环贫血 | R-03/R-08 级联 | 援助预算=f(支援方净流)；被援房独立降级 |
| M2 资源分配死锁 | 循环等待能量/矿物 | — | 全局优先级序+调拨期限+高优 Demand 超时报警 |
| M3 帝国单点 | 战略层 bug 全帝国同错 | R-04 | 纯函数单测+posture 遥测+Recovery 限制作用面 |
| M4 影子通道 | 房间绕过仲裁直连 terminal/市场 | R-12 同族 | 唯一写者+房间无 terminal 直写权 |
| M5 报告腐化 | 房间谎报/漏报需求产能 | — | 低频抽查对账+满足率/账实差遥测 |
| M6 殖民地孤儿 | 母房失守/通道被断 | R-16 级联 | 殖民自续命+失败降级 remote/放弃 |
| M7 safemode 误用 | 每 shard 一房占用错误+拦不住 nuke | R-09 | 决策表+冷却+nuke 语义（15 号） |
| M8 情报过期决策 | 过期 intel 触发高成本行动 | — | TTL+置信度门控「过期情报不得触发行动」（14 号） |

### 8.5 架构失败（Architecture）——代码自身的腐化

| 模式 | 机理 | 风险 | 防线 |
| --- | --- | --- | --- |
| A1 Memory 爆炸 | 体积=每 tick 线性税，孤儿条目累积 | R-10 | 三级存储准入+清理钩子+体积遥测（18 号） |
| A2 global reset 重建风暴 | reset 后首 tick 全量重建超时→降级→更慢恶性循环 | R-11 | 惰性重建+重建预算预留（20 号 §10.3） |
| A3 写者越权 | 角色层直发 spawn/site/市场，绕过唯一写者 | R-12 | 静态依赖审查+运行时断言+架构测试锁定（28 号） |
| A4 循环依赖/耦合回潮 | 系统间运行时 import，边界腐烂 | R-13 | 唯一组合根+依赖图审查+ADR-002 纪律 |
| A5 状态不一致 | 新旧字段并存时读写错位、部分失败残留 | — | 迁移规范「先写新验证后删旧」（18 号 §10.3） |
| A6 自愈越权 | 修复动作比故障更致命（疯狂拆建/循环 spawn） | — | 有界/不可越权双清单（22 号 §10.3） |
| A7 内核业务渗透 | 内核挂业务钩子膨胀回 Quorum 老路 | R-13 同族 | 钩子 ≥3 个必须 registry 化（AGENTS 级纪律） |
| A8 概念污染 | Manager 冠名 Agent、伪自治宣称 | — | Agent 判据+命名纪律（23 号 §10.1） |

## 9. CPU Implications

- 失败的 CPU 侧表征就是三大预算红线：bucket 连续下滑（E1 预警）、Memory 体积
  环比增长（A1 预警）、无效 intent 计数（X1/X2 预警）——全部已在 21 号遥测
  最小集内，不需要专门检测面。
- 防线自身的 CPU 纪律：看门狗采样限点（19 号 §9）、对账分频（22 号 §9）、
  断言只在 debug/CI 构建启用全量（28 号）。
- 降级链本身是最大的 CPU 防线：Recovery 档把每 tick 成本压回「P0+能量自给」，
  数学上保证死亡循环可逃逸（能量 <300 自回 1/tick 官方兜底）。

## 10. Recommended Design（逐类防线与治理机制）

### 10.1 级联路径与断闸点

```text
X1/X5（执行层小失败）──未检测──→ E2 能量饥饿 ──→ E1 CPU 循环（补creep风暴）──→ 帝国死亡
M1 援助雪崩：R-08 围城 ──援助无上限──→ 多房连环（E3 变体）
A1 Memory 膨胀 ──税增──→ E1；A3 写者越权 ──→ X6 重复 ──→ E5/E2
断闸点：①卡位自愈（断 X 链）②能量核算（断 E 链）③援助预算（断 M1）
④准入审查（断 A1）⑤幂等键（断 X6）
```

### 10.2 防线三层结构（预防→检测→恢复）

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 预防（结构约束） | 唯一写者、瘦 Memory 准入、静态依赖审查、授权链 | A 类全部、M4、E3/E4 的决策面 |
| 检测（遥测+对账） | 21 号最小集指标+22 号分档对账+威胁发现延迟 | E1/E2 早期、M5、A1 |
| 恢复（有界自愈） | 22 号五阶段闭环+看门狗降级+紧急车道 | X 类全部、E1/E2 中期、P4 |

不可逆失败（controller 丢失、nuke 命中、respawn）没有恢复层——只有预防层与
TAKEOVER 信号（21 号 §10.4）。

### 10.3 治理机制（防台账腐化）

1. 每条防线必须绑定一个可注入的场景（28 号矩阵）——无测试的防线视为不存在。
2. 新失败模式入库流程：事故（或注入）→ 归类五层 → 登记 R-ID → 绑防线 →
   进场景矩阵。
3. 红队评审（30 号）每轮对照本表攻击「防线本身失败」的情形（如看门狗自己
   报错、自愈检测器误诊）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 只靠 try/catch + 继续 | 社区公认反模式：隔离≠恢复，故障慢性化（22 号 §11） |
| 穷举式防御（为每种失败写专用代码） | 组合态爆炸；分层防线+默认安全动作是可行下界 |
| 失败后自动重启一切（重启大法） | 不可逆损失（拆建/弃房）+违反自愈越权清单 |
| 把失败处理集中到一个「应急系统」 | 单点+重复 Sense；恢复动作归各故障域 owner（22 号 §10.2） |
| 用人工接管兜底一切 | 违反自治契约；人工只保留发布与灾难接管两条边界 |

## 12. Open Questions

1. E1 的降级链在真实官服（tick 2.5–5.5s 波动）下的恢复 MTTR 需 A5 soak 标定。
2. M2 死锁检测的立案阈值（高优 Demand 未满足时长）与 22 号 §12.2 联动未定。
3. 对抗性失败（P6/R-15）的「再试探」节奏：黑名单冷却到期后是否自动降档重试，
   需战争账本数据裁决。
4. 场景矩阵覆盖度只能证明「已知失败已防」，未知失败的第一道网是遥测异常检测
   ——其误报率需实测校准。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://www.reddit.com/r/screeps/comments/8mowvu/ + https://screeps.com/forum/topic/1405/ | 社区 | CPU 死亡循环案例（E1） | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/55aapi/（+ tanjera Tower Drain 战术条目） | 社区 | 围城耗能破防（E4） | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/10wohds/ + respawn 多帖 | 社区 | 会话间全灭/重开失败（P4） | CONFIRMED / LIKELY |
| https://github.com/TooAngel/screeps/issues/157 | issue | 房界卡位（X1） | CONFIRMED |
| https://screeps.com/forum/topic/2185/ + topic/2163/ | 论坛 | 强制 reset 测试法、IVM reset 频率（A2） | CONFIRMED |
| https://wiki.screepspl.us/CPU/ + /Market/ + /MemHack/ | wiki | 无效 intent、市场摩擦、Memory 膨胀史（X2/E5/A1） | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/cm5o0w/ + 8pbrfv | 社区 | exploitable、永不纠缠（P6） | CONFIRMED |
| screeps-grandmaster-perspective/references/community-lessons.md | 领域经验 | try/catch≠self-healing、异常一等公民 | LIKELY |
| [29_RISK_REGISTER.md](29_RISK_REGISTER.md) + [22_SELF_HEALING.md](22_SELF_HEALING.md) + [04_EMPIRE_ARCHITECTURE.md](04_EMPIRE_ARCHITECTURE.md) §8 | 本套件 | 风险视图/自愈闭环/帝国级失败全表 | — |
