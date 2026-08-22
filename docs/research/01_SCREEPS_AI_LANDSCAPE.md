# 01 · Screeps AI 生态全景（SCREEPS AI LANDSCAPE）

> 研究文档 · 结论等级：**调研综述**（生态事实 + 社区经验归纳，置信度逐条标注）。
> 逐 bot 深度分析见 [02_EXISTING_BOT_ANALYSIS.md](02_EXISTING_BOT_ANALYSIS.md)；
> 机制事实基准见 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)；
> ML/LLM 生态位详见 [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md)；
> 证据台账见 [RESEARCH_SOURCES.md](RESEARCH_SOURCES.md)。调研执行日：2026-08-22。

## 1. Problem

本套件的全部架构裁决建立在「前人做过什么、什么活着、什么死了」之上。跳过生态
调研的代价有两种：重复发明（重写已被社区验证的模式，如请求池孵化）或重蹈覆辙
（重蹈已被社区证伪的死法，如 OS 内核、全房扫描）。本文回答四个问题：

1. Screeps 的 AI 生态由哪些形态构成（从人工玩家到全自动 bot 的光谱）？
2. 开源 bot 谱系的**活跃度生死表**说明什么（谁死了、谁活着、死因是什么）？
3. ML/LLM 在这个生态里的尝试历史与真实生态位？
4. 社区十年实战沉淀了哪些可量化、可迁移的教训？

最后一个问题对本研究具有「诚实性校准」作用：在宣称「完全自治」之前，必须先知道
生态里自治的真实水平与孤例程度（autonomy-acceptance 方法论）。

## 2. Research Questions

- 自动化光谱：手工 / 半自动 / 全自动的分布与各自的存在证据？
- 开源 bot 活跃度：维护状态（最后推送、发布形态、可审计性）与项目命运的关系？
- 半自动为什么是主流？全自动无人值守需要什么代价？
- ML/LLM 尝试的历史与结局？为什么「智能」生态位全在体外？
- 社区十教训是什么？各自约束架构的哪个部分？
- 本项目「完全自治」目标在生态中的定位与可信度边界？

## 3. Existing Solutions（生态结构：自动化光谱与生态位分段）

Screeps AI 生态按自动化程度与开放程度分五段（2026-08-22 交叉核查）：

| 生态位 | 形态 | 代表与证据 | 置信度 |
| --- | --- | --- | --- |
| 手工玩家（主流） | 人工决策 + 局部脚本；发展遵循社区成熟度阶梯（drop→container→remote→SK） | screepspl.us Maturity Matrix；半自动普遍 | CONFIRMED |
| 半自动脚本 | 代码承担执行，人工承担 flag/console 级决策 | 社区普遍形态；Overmind 同时提供 manual/semiautomatic 模式（README，2026-08-22 抽查复核） | CONFIRMED |
| 全自动开源 bot | 无人工指令运行，源码公开 | TooAngel / Overmind / TI / Quorum / bonzAI / KasamiBot / hivemind（详见 02 号） | CONFIRMED |
| 全自动闭源 bot | 榜单头部大量闭源私有代码 | LoAN bot 分布图可证其存在，源码不可得 | CONFIRMED（存在）/ UNCERTAIN（战力细节） |
| 克隆体（NCP） | 未修改部署的开源 bot | LoAN 地图可见克隆聚集；社区规范反对滥用（见 §4） | CONFIRMED |

**未能证实的名单**（诚实记录）：任务书点名的 Acorn / SIV / Moose 在 MMO 与 seasonal
官方 API 均无可证战绩与源码（RESEARCH_SOURCES.md §E，UNCERTAIN）。公开社区二手
口径（Scribd 聚合索引）公认的六大经典代码库为 tiggabot / The International /
TooAngel / Overmind / bonzAI / Quorum（LIKELY）；本研究以**可验证源码**为准，
选定七个分析对象（02 号），不采信不可复核的传闻名单。

## 4. Screeps Community Practice

### 4.1 半自动是现实主流，全自动是孤例

- 社区标准发展路径（Maturity Matrix）假设有人工参与：规划布局、选择扩张时机、
  决定开战。半自动的本质是**用人工判断换掉 self-healing / 授权链的工程成本**。
- 真正的全自动无人值守在生态中是极少数孤例，且都有结构性代价：
  - **TooAngel**：十年无人值守（自称第一个全自动化开源 bot），代价是平铺架构 +
    极简决策（三指标门控），进攻能力弱（社区评「打一次失败就不再纠缠」）。
  - **hivemind**：2026-07 仍活跃（当前最活跃开源大 bot），但**刻意阉割攻击性**
    （不主动攻击玩家房、不处理核弹防御，README 明言防 NCP 泛滥）。
  - **Overmind**：功能最强的开源 bot 之一，但混淆发布核心组件 + 低频维护。
- 推论：全自动 = 把人工判断全部替换为显式机制（授权链、止损链、自愈闭环、停滞
  检测）。这不是「写得更聪明」，而是「把人做的每一类决定都变成代码」——本套件
  04–22 号文档的存在本身就是这个替换成本的度量。

### 4.2 ML/LLM 的生态位：全部在体外

- 2017 年社区 ML 讨论（reddit 5uab0c）定义了「体外反馈学习→回写参数」的形态，
  **无任何长期存活实现**（LIKELY）。
- Overmind-RL：RL 只作体外训练环境，非线上决策（CONFIRMED）。
- 唯一已知 LLM 集成（derek.net.au）：体外大脑 + Memory 通道，纯规划、无运行数据。
- 截至调研日，**没有任何已知长期存活的高水平 bot 在线上决策路径使用 LLM 或在线
  学习**（全部调研对象核查，CONFIRMED）。「智能」全部来自确定性规则 + 统计门控。
- 生态位结论与 [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md) ADR-011
  一致：LLM 合法位置 = 体外研究员 / 低频有界参数顾问。

### 4.3 社区组织与公开文化

- **Quorum**（2021 停更）是第一个「自我管理项目」：GitConsensus 投票合并 PR、CI
  每日自动部署 MMO、内存/segment/钱包全公开 quorum.tedivm.com——证明「代码 +
  运营 + 治理」可全自动化，也证明了这条路的后继乏力。
- **TooAngel** 用 World Driven（机器人审查+自动合并部署）维持十年演进——开源
  bot 中唯一把「发布流程」也自动化的存活案例。
- 公开仪表盘文化：TI 遥测托管 pandascreeps.com、Quorum 全公开、Grafana 栈是
  事实标准（[21_OBSERVABILITY.md](21_OBSERVABILITY.md) §4）。
- **伦理规范**：社区反对未修改部署开源 bot 打真人（NCP 争议）；TI README 要求
  不得用于欺负新人；hivemind 刻意限武；Overmind 作者劝新人自己写 AI 而非直接
  部署（README，2026-08-22 抽查复核）。开源攻击性 bot 的「限武自约束」是生态
  存续的默契，不是技术局限。

## 5. 社区十教训（Community Lessons）

> 本节是 [26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md) §11 引用的锚点。
> 每条附数据点与来源（详表见 RESEARCH_SOURCES.md C 节）。

1. **CPU 是唯一硬稀缺资源，死亡循环是头号死因**。超限切断的 tick 永不回来；
   overnight collapse（reddit 8mowvu）与 bucket 失灵（forum 1405）是社区多起
   CONFIRMED 案例。→ 四档看门狗（[19](19_SCHEDULER_KERNEL.md)/[20](20_CPU_OPTIMIZATION.md) 号）。
2. **移动与 intent 是 CPU 第一大头**。intent ≈0.2 CPU 且失败也收费；纯移动
   ≈0.25 CPU/creep、带寻路 ≈0.5；100 creep 仅移动 ≈20 CPU。优化对象只能是
   「税之上的思考成本」。→ 意图交通仲裁 + 寻路限频（20 号 §10.2）。
3. **Memory 体积即每 tick 税**。parse/stringify 随主串线性；MemHack 演进史证明
   社区为这条税挣扎了整代。→ 三级存储瘦 Memory（[18](18_MEMORY_ARCHITECTURE.md) 号）。
4. **远矿收益递减**：本地矿 ~70% 采集效率、remote 40–50%、remote 房 ~1 CPU
   （reddit 8181nc 等多帖）。扩张与远矿是投资决策不是信仰。→ ADR-008。
5. **能量链是命脉，围城耗能是头号破防手段**（reddit 55aapi，CONFIRMED）：攻击方
   在房外耗干 tower+storage 再推进；RCL8 约 3 周、RCL7→8 单级 1093.5 万能量——
   发展是能量投资序列。→ 能量会计（[10](10_ROOM_DEVELOPMENT.md)/[15](15_DEFENSE_SYSTEM.md) 号）。
6. **冷启动/重开是独立能力**：respawn 保留 GCL，但「代码只会运营不会拓荒」是
   重开失败主因（社区多帖归纳，LIKELY）。→ 殖民自举车道（[17](17_EXPANSION_SYSTEM.md) 号）。
7. **半自动是主流、全自动是孤例**（§4.1）：宣称自治必须按 A0–A5 分级验收，
   不得用「存在一个自动模块」冒充帝国自治（autonomy-acceptance）。→ ADR-012。
8. **市场是低频补池不是利润中心**：5% 挂单税（取消失不退）、运费指数公式、
   抢单近者得、10 deal/tick。市场策略必须按这些摩擦设计。→ [12](12_LOGISTICS_SYSTEM.md) 号。
9. **后期能量过剩是常态**：RCL8 升级上限 15 WORK 后 controller 吃不满产能，
   社区走向 GCL farm / temple / power 链消化富余（forum 298，CONFIRMED）。
   → energy sink 规划（27 号 Phase 10）。
10. **确定性优于学习**：所有长期存活 bot 的「智能」= 确定性规则 + 统计门控
    （TooAngel 三指标十年、Overmind 决策树+请求队列）；ML/LLM 无线上先例。
    → ADR-003 / ADR-011。

## 6. Advantages（站在生态上的红利）

1. **六大可考古源码**：全部主要架构流派（分层 OO / 平铺 / 静态类 / OS 内核 /
   Operation–Mission / Manager）都有可读源码与真实战绩（02 号）。
2. **数值层已钉死**：官方文档 + 引擎常量双源核查（03 号），社区流传错误有现成
   裁决清单（boost 倍率、tower 衰减、订单上限等 10 项）。
3. **工具链成熟**：profiler / Grafana / 私服 / CI 自动部署（Quorum 先例）全部
   有现成方案，不需要自研观测设施（21/28 号）。
4. **失败案例库丰富**：社区把最贵的教训（死亡循环、围城、扩张掏空）用真实帝国
   的尸体写成了文档——本套件的风险登记（29 号）大部分有社区实证。
5. **诚实分级文化**：bonzAI 把愿景与覆盖率分开陈述被社区视为标杆——自治宣称
   的验收方法（A0–A5）有直接可效仿的生态先例。

## 7. Disadvantages（生态的阴暗面）

1. **停更是常态**：七个调研对象中五个已死或低频（Quorum 2021、bonzAI 2017、
   KasamiBot 2018 停更、Overmind 低频、TI 主分支更新慢）——开源 bot 的平均
   寿命远短于游戏本身，「抄架构」必须区分「活体特征」与「遗骸特征」。
2. **单人项目风险**：除 Quorum/TI 外全部是单人项目；架构决策高度绑定个人趣味
   （Overmind 的星际争霸主题、TooAngel 的猴子补丁），不可直接迁移。
3. **可审计性受损**：Overmind 以混淆形态发布核心组件（obfuscated 构建+校验和）；
   KasamiBot 仅压缩分发、仓库只存文档——两者都抬高复核成本。
4. **证据年代久**：关键战例多在 2016–2018（围城 55aapi、矿工体型 864qy3）；
   数值类证据有引擎常量兜底，行为类证据（战术、社区规范）可能已漂移。
5. **知识流失**：社区 wiki 抓取超时频发（Caching 页本次即超时）、聚合索引依赖
   二手档案（Scribd）；生态记忆正在退化，本研究有意把关键结论内化进套件。

## 8. Failure Modes（生态级失败：项目如何死亡）

| 死亡模式 | 案例 | 机理 | 对本项目的启示 |
| --- | --- | --- | --- |
| 维护者热情衰减 → 架构税压垮兴趣 | Quorum（2021 停更，生前 GCL 45 亿级） | 内核本身不产生游戏价值；OS 化前置投资在动力衰减时整层报废 | ADR-002：轻量内核，语义全收、结构税全免 |
| 愿景超前于实现 → 停更后机制过时 | bonzAI（2017 停更，机制旧 9 年） | 全自动扩张愿景停留在 AutoOperation 选址 | 自治按验收门槛渐进交付（ADR-012） |
| 分发形态损害传承 | KasamiBot（压缩分发，源码不可读） | 文档极详尽但代码考古不可行 | 源码可审计是研究/协作前提 |
| 行为可摸透 → 战略上被利用 | Overmind（Reddit 评 "definitely exploitable"，cm5o0w）；TooAngel（打一次失败就不再纠缠，8pbrfv） | 确定性策略的对抗性弱点 | 战争账本+黑名单+止损链（ADR-009）；接受「可预测」但控制「可利用」的代价 |
| 克隆滥用 → 社区反弹 | NCP 争议（hivemind/TI 自约束） | 未修改部署的攻击性 bot 破坏生态 | 若开源，默认形态应限武或附带使用伦理条款 |
| 知识载体消亡 | wiki 超时、Scribd 二手索引 | 社区记忆无 institutional backing | 本套件自建证据台账（RESEARCH_SOURCES.md） |

## 9. CPU Implications（生态数据点的预算侧汇总）

| 数据点 | 数值 | 来源 | 置信度 | 用途 |
| --- | --- | --- | --- | --- |
| 普通玩家每房 CPU | 3–5 CPU/房 | forum 2381 等多帖 | CONFIRMED | 26 号 §7 房间线性项上界参照 |
| 优化后每房 CPU | 10 CPU 跑 1–2 房 | 论坛求助帖归纳 | LIKELY | 优化空间量级 |
| 远矿房 CPU | ~1 CPU/房 | 社区数据点 | CONFIRMED | 远矿 ROI 定价（27 号 P5） |
| 纯移动 creep | ≈0.25 CPU/creep（带寻路 ≈0.5） | reddit 6pg2q6 实测 | LIKELY | intent 税地板（20 号 §3） |
| intent 失败成本 | ≈0.2 CPU，失败也收费 | wiki/CPU | CONFIRMED | 发前自查（20 号 §4） |
| 采集效率 | 本地 ~70%、remote 40–50% | reddit 8181nc | CONFIRMED | 远矿经济模型 |
| RCL8 周期 | 约 3 周（挂机时间尺度） | reddit 6dz3xn | CONFIRMED | soak/里程碑时间尺度 |
| 后期能量链 | 15 WORK 升级上限 → GCL farm → temple | forum 298 | CONFIRMED | energy sink 规划 |

## 10. 对我们架构的启示（Recommended Design 等价节）

1. **自治宣称按 A0–A5 分级**：生态证明「全自动」是孤例且代价高昂，任何自治
   能力必须场景矩阵+指标验收（ADR-012；bonzAI 诚实分级先例）。
2. **确定性内核 + 统计门控**：十年存活者全部如此；学习系统只进体外（ADR-003/011）。
3. **CPU/存储预算先行**：教训 1–3 决定了看门狗、瘦 Memory、意图仲裁不是优化项
   而是生存项（19/18/20 号）。
4. **半自动机制必须显式替换**：生态用人工兜底的每个决策点（扩张时机、开战授权、
   布局迁移、safemode 时机）在全自动架构中都要有对应机制（Agenda/授权链/版本化
   模板/决策表）。
5. **死亡模式表驱动设计**：本文 §8 与 [24_FAILURE_MODES.md](24_FAILURE_MODES.md)、
   [29_RISK_REGISTER.md](29_RISK_REGISTER.md) 构成三层防线视图。
6. **若开源，预埋伦理与限武默认**：war 授权链（ADR-009）客观上就是限武结构——
   「代码存在≠战争开始」与社区 NCP 规范天然一致。
7. **不赌社区传闻数字**：一切数值以引擎常量为准（03 号 §13 裁决清单）；行为类
   社区结论标 LIKELY 并留给 soak 验证。

## 11. Alternatives Rejected（定位选项否决）

| 定位方案 | 否决理由 |
| --- | --- |
| Fork 现有 bot（TooAngel/Overmind/TI）起步 | 全部带结构性债务（猴子补丁/7 层 OO/自认意大利面）；fork 继承的复杂度超过重写；AGPL/MIT 混杂的合规与 NCP 观感问题 |
| 闭源从零、不参考生态 | 放弃六大流派免费试错结果；重复发明与重蹈覆辙双风险 |
| 以 ML/LLM 先进性为目标 | 生态零先例 + 物理否决（无出站网络）+ CPU 不可预算（ADR-011） |
| 复刻 KasamiBot 式「大而全攻击性」 | 攻击性最强但压缩分发不可审计、单人项目 2018 终止；其军事组织可借鉴、其形态不可继承 |
| 多 shard 起步 | 单 shard 生存闭环（A1–A2）尚未验证时引入跨 shard 复杂度违反验收制（27 号 P12 推迟） |

## 12. Open Questions

1. 闭源头部 bot 的战力格局无源码可证——本研究对「生态上限」的认知被开源样本
   截断，PvP 设计（15/16 号）需在 A4 实测中重新评估。
2. 2016–2018 行为类证据（战术惯例、社区规范）在 2026 的有效性——数值有引擎
   兜底，行为需 A4 阶段实测。
3. NCP 伦理边界的演化：若本项目开源且具备强攻击性，默认限武条款是否足够。
4. 未证实名单（Acorn/SIV/Moose）是否为 Discord 圈内名——超出公开互联网可证
   范围，永久搁置（RESEARCH_SOURCES.md §E）。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://github.com/Mirroar/hivemind（2026-08-22 抽查复核） | 源码/README | 刻意限武（不主动攻击、不处理核弹）防 NCP；npm 包 screeps-bot-hivemind；仓库含 mock 目录（测试设施，28 号采用） | CONFIRMED |
| https://github.com/bencbartlett/Overmind（2026-08-22 抽查复核） | 源码/README | 617★/157 fork/605 commits、v0.5.2、MIT；默认全自动但提供 manual/semiautomatic 模式；作者劝新人自写；含混淆发布组件 | CONFIRMED |
| https://wiki.screepspl.us/Maturity_Matrix/ | wiki | 成熟阶梯 + 半自动普遍 | CONFIRMED |
| https://www.leagueofautomatednations.com/map/shard0/bots | LoAN | 克隆体分布（NCP 生态存在性） | CONFIRMED |
| RESEARCH_SOURCES.md C 节全部 Reddit/论坛帖（8mowvu、55aapi、8181nc、6pg2q6、cm5o0w、8pbrfv、5uab0c、forum 1405/2381/298 等） | 社区 | §5 十教训与 §9 数据点 | CONFIRMED（逐条见台账） |
| https://www.derek.net.au/logs/ + https://github.com/bencbartlett/Overmind-RL | 日志/源码 | LLM/ML 生态位全在体外 | CONFIRMED |
| Scribd 聚合索引（六大经典名单） | 二手 | tiggabot/TI/TooAngel/Overmind/bonzAI/Quorum | LIKELY |
| Acorn / SIV / Moose 排查 | 官方 API | 无战绩/源码证据 | UNCERTAIN |
