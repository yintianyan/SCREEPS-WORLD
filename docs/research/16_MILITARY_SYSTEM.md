# 16 · 军事系统（Military System）

> 研究文档 · 结论等级：**设计裁决**（社区战例 + bot 对照 + ADR-009 展开）。
> 战斗/boost/nuke 数值以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)
> §7/§8 为基准；授权与止损契约见
> [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-009；防御侧配合见
> [15_DEFENSE_SYSTEM.md](15_DEFENSE_SYSTEM.md)。核查日：2026-08-22。

## 1. Problem

进攻是 Screeps 里最贵的活动：完整编队 creep（单只数千能量）、boost 前置
（30 矿物+20 能量/part，03 §7）、跨房补给、失败即全损（尸体仅回收成本
×0.2）。自治军事系统的核心风险**不是打不赢，而是在不该打的时候开打、在
该停的时候停不下来**——帝国死于战争经济失控多于死于战斗本身（ADR-009 语境；
社区 overnight collapse 案例）。因此本文的研究核心是一份可执行的
「**什么情况下不应该攻击**」清单，进攻决策链（为什么打/打不打得起/何时止损
的战争经济学）与执行形态（编队/集结/微操/准军事行动/nuke）都从属于它。

## 2. Research Questions

1. 进攻授权链如何构造，才能使「战争永远是经济上可承受的选择」？
2. 战争经济学账本：开战前算什么、打到一半算什么、何时收摊？
3. 编队形态与 boost 前置的收敛解是什么？集结如何防止添油？
4. 目标选择对情报新鲜度的硬要求？
5. power bank / SK 房这类准军事 Operation（paramilitary）的授权与经济性？
6. nuke 的战略语义（取消 safemode）与使用门槛？
7. 战后核验为什么必须只信新鲜 intel？

## 3. Existing Solutions（方法论参照）

ADR-009 已裁决：`war` 姿态是进攻的唯一授权来源（进入条件：持续被打+打得起）；
war-planner 是唯一进攻执行决策者（attacker 仅由它孵化）；止损链不可绕过
（伤亡超 squadSize×伤亡系数收摊/失败目标进 warBlacklist 冷却/经济压力持续
超标经 warPressureTicks 退 fortify）；波次集结（build 相位 hold 待命、满编才
advance）；战后核验只信新鲜 intel。strategy-playbook PvP 节补充执行纪律：
敌人 body 只是局部信息，还要估其补给链、经济净流、可持续时间；进攻任务必须
有目标、补给、撤退、最大损失与 after-action 反馈；没有这些就只能侦察或备战。

## 4. Screeps Community Practice

- **quad/duo 小队 + boost 前置是社区收敛形态**：4 creep 编队（前排 tough/
  attack+后排 heal，贴身集火使敌塔与单体承伤最优）与 2 creep 轻队是主流；
  高强度对抗默认 T2/T3 boost（attack/ranged/heal 2/3/4、tough 减伤
  ×0.7/0.5/0.3，03 §7）——裸编队打 boosted 防御是送能量。
- **集结纪律**：TooAngel squad move→attack FSM 要求**全员 waiting 才转
  attack**（源码确认，CONFIRMED）——防止添油（单只送死）。
- **冲突升级有门槛的先例**：TooAngel 声誉外交三级（simpleAttack 声望
  ≤−1500 → squad（siege+3heal）−6000 → attack42 −9000）；攻击 10 次后
  player.level+1 解锁更重档；目标选取 range 7 内 RCL 匹配的自有房。但
  Reddit 实战评价指出其「打一次失败就不再纠缠」——**行为可被摸透**，是对
  确定性策略的对抗性警告。
- **拆家语义**：dismantle 50/part 且不产能量（03 §8）——拆家攻防是纯消耗
  战，wreckerteam 类行动必须核算敌方重建成本 vs 我方消耗（KasamiBot 只在
  判定 boost 足够时才攻 owned 房的先例）。
- **Power bank**：highway 房刷新（世界结构先验，03 §9），含 500–5,000
  power（引擎常量 POWER_BANK_POWER_MAX=5000，2026-08-22 复核；screepspl.us
  Power 页写 500–10,000 与引擎冲突，按 03 §13 风格以引擎为准）、2M hits、
  50% 反击；击破后 power 掉落衰减，需提前备 pickup creeps；数学上划算
  （reddit 6nuyx3，CONFIRMED）。
- **SK farming**：每 SK 房约 +10 creeps、+2–3 CPU，能量净收益为正且附赠
  矿物（SK 房 3 矿×3000 级别储备）；战术「把 keeper 关进 lair」或反复击杀，
  玩家优先可靠性（forum 327/1566，CONFIRMED）。
- **nuke 语义**：飞行 50,000 tick、中心 10M 伤害、装填 300k 能量+5k ghodium、
  冷却 100,000 tick；**落地立即取消 safemode**（03 §8）——这是 nuke 的
  战略价值核心（破最后的保险），也因此是高门槛武器。

## 5. Existing Bot Analysis

| Bot | 军事组织 | 关键机制 | 局限/教训 |
| --- | --- | --- | --- |
| Overmind | 军事即 directive | offense 四形态：autoSiege/controllerAttack/pairDestroy/swarmDestroy | 进攻形态显式分化（打不同目标类型用不同编队）值得抄 |
| TooAngel | 声誉驱动 | 三级升级+attack level 记忆+squad 集结 FSM+atkeeper 系（SK farming） | 失败即弃→可被摸透（Reddit 评价） |
| The International | antifa 家族 | quad/duo/dynamicSquad + *Ops 微操文件；remoteCoreAttacker/remoteDismantler | README 自评战斗 dysfunctional 但防御强——微操复杂度是税 |
| bonzAI | Operation/Mission 化 | RaidOperation/ConquestOperation/FortOperation/QuadOperation + RaidMission/PowerMission；Guru 观察者 | Operation 生命周期（预算/期限）是可迁移骨架 |
| KasamiBot | 经济化战争 | harasser 游猎杀贫；boosted wreckerteam 只在 boost 足够时攻 owned 房；power bank 按站位动态配兵（bankrobber/bankhealer/bankranger） | 军事决策全部前置经济核算 |
| Quorum | 防御为主 | conflict.js/fortify，进攻有限 | 防御优先路线的实证 |
| hivemind | 刻意限武 | 不主动攻击、不防核（防 NCP 泛滥的伦理立场） | 限武是合法终态选择，但与本项目自治目标不符 |

**共性收敛**：进攻=Operation/Mission 化（有生命周期与止损）；quad/duo+boost
前置；军事人口与经济人口分离。**分歧**：开源进攻性（KasamiBot/TI/bonzAI/
Overmind 全功能 vs hivemind/TooAngel 限武——社区伦理驱动）。

## 6. Advantages（授权链 + Operation 化的优势）

1. **战争永远是经济决策**：开战要过「打得起」核算，打到一半有止损线，
   战后有账本——不存在「意外滑入战争」的路径（R-15 诱饵防御）。
2. **Operation 化可复盘**：每次行动有目标、预算、期限、取消条件、结果
   核验（bonzAI/Overmind 双先例），战争账本直接喂遥测与 PlayerIntel。
3. **集结 FSM 防添油**：满编才 advance，单兵不被派去送死（TooAngel 源码
   先例）。
4. **授权链单一**：attacker 仅由 war-planner 孵化——「代码存在≠战争开始」，
   军事人口不会悄悄繁殖吃掉经济。

## 7. Disadvantages（代价）

- 授权链长→反击延迟：被打了还要过「持续被打 N tick+经济核算」才升 war。
  补偿：fortify posture 可以先行（预警性筑防），防御（15 号文档）不等战争。
- 止损过早可能被利用：对手若知道「磨一磨你就会退」，可用低成本骚扰耗掉
  我方威慑（TooAngel 教训）。缓解：止损记录进 PlayerIntel，对手行为画像
  反哺阈值；黑名单是冷却不是永久放弃。
- 微操（*Ops 文件式）是工程重税：TI 的 dysfunctional 自评是复杂度警示。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 诱饵战（敌故意示弱引战） | 空耗 boost/编队 | 只打有战略价值目标；warBlacklist；战后核验记账（ADR-009 链） |
| 添油（编队未满即推进） | 逐个送死 | build 相位 hold 集结，满编才 advance；超时解散而非硬冲 |
| 打过期情报目标 | 打空/撞换防 | 目标新鲜度硬门槛：fact 级 + 观察年龄 < 阈值（14 号文档置信度 API） |
| 战争经济失控 | R-03/R-08 级联 | warPressureTicks：经济压力持续超标→强制退 fortify |
| boost 前置缺失（裸编队冲锋） | 全损无战果 | boost SLA：开战前库存与 lab 产能检查不过则不开车 |
| squad 卡死（waiting 永不满足/卡地形） | 车道死锁 | 集结超时解散回收；卡位自愈（R-06 同源）；Operation 期限兜底 |
| 黑名单死锁（全目标进冷却） | war 态空转 | 空目标数 > 0 即收摊退 fortify——这本身是正确行为，不是故障 |
| 占领后守不住 | 反被拖入消耗 | 占领候选必须过扩张门控（ADR-008）——军事胜利≠殖民许可 |
| nuke 误用 | 300k 能量+5k ghodium 沉没、100k 冷却空窗 | §10.7 门槛表；nuke 决策=战略层，不下放 Operation |

## 9. CPU Implications

- 军事微操是每 tick 每 creep 的动作成本（TI *Ops 文件群的复杂度即代价）
  ——用**形态化编队压缩决策数**：quad 内部相对站位固定，微操退化为
  「队形中心点 + 目标选择」两个决策，而非 4 只 creep 各自寻路攻击。
- war 期军事系统优先级上调（P1），但看门狗仍然兜底：**Recovery 档军事集结
  暂停**（26 号文档 §7 降级链）——bucket 见底时编队停在安全房待命而非解散。
- 战后核验（evaluateWarOutcome）是纯函数 + 一次性 scout 复核，低频无税。
- 战争账本写入走低频遥测车道（21 号文档预算），不进热路径。

## 10. Recommended Design

### 10.1 授权链（为什么打）

```text
PlayerIntel 持续威胁记忆（被打 N tick，15 号文档上行信号）
  + 战争经济学核算（打得起，§10.2）
  + 目标池非空（新鲜 fact 级 + 非黑名单，§10.4）
  → posture: fortify → war（滞回；strategy 层纯函数，ADR-003）
  → war-planner 创建 War Operation（预算/期限/取消条件）
  → attacker 编队孵化（唯一孵化路径）
```

「持续被打」取 PlayerIntel 事实（哪房被谁打多久），不含推测；「打得起」是
下节账本的输出。

### 10.2 战争经济学（打不打得起 / 何时止损）

开战前核算（全部为账本字段）：

- 成本项：编队造价 × 预期损失率、boost 消耗（30 矿+20 能量/part）、
  补给运力占用、机会成本（该能量投发展/GCL 的收益）。
- 收益项：目标价值（拆毁敌产能/占领候选房/消除宿敌威胁——占领收益须再过
  ADR-008 门控）、威慑与安全边际。
- 止损线：`最大伤亡 = squadSize × casualtyMultiplier`（超线即收摊）；
  `warPressureTicks`：经济压力指标连续超标 tick 数（超线退 fortify）；
  时间线：Operation deadline 到期未达里程碑即收摊。

**「打得起」= 预期最大损失 ≤ 战争基金（可承受损失上限，从帝国能量盈余
计提的专项储备）**。基金不足则只 fortify 不 war——哪怕被持续骚扰（骚扰由
防御系统与 harasser 对策处理，见 §10.6）。

### 10.3 编队与 boost 前置

- 标准形态：**quad**（4 只：2 前排 tough/attack + 2 后排 heal，贴身阵型）
  为主力攻坚；**duo**（attack+heal）为巡逻/反骚扰轻队；对无塔目标用
  swarm（Overmind swarmDestroy 形态的廉价版）。
- boost SLA：war Operation 创建时检查 T2/T3 库存与 lab 产能，缺口则先补
  产能再开集结（KasamiBot「只在 boost 足够时攻 owned 房」先例）；boost
  消耗按 03 §7 真实倍率表核算（heal 2/3/4、tough 减伤 ×0.7/0.5/0.3）。
- 军事 body 由 war-planner 按目标类型选型（对塔房高 tough、对拆迁目标高
  dismantle），经 Spawn Manager P0/P1 车道孵化（11 号文档唯一写者）。

### 10.4 目标选择（情报新鲜度硬门槛）

- 候选 = fact 级 RoomIntel（owner/RCL/塔位/heal 估计）且观察年龄 < 阈值
  （超龄先派 scout 两段式核实——14 号文档规则）。
- 优先序：战略价值（宿敌核心产能房 > 其扩张前哨 > 报复性低价值目标——
  后者原则上不打）× 可行性（RCL 与距离匹配，TooAngel range+RCL 匹配先例）。
- 黑名单：失败/unknown 结果目标进 warBlacklist 冷却（TTL 由止损链定义）；
  冷却期内该玩家其他目标仍可评估（避免单目标锁死全战争）。

### 10.5 波次集结 FSM（防添油）

```text
recruit（孵化+boost）→ build（hold 钩子归建待命，ADR-004 引擎的 hold
语义）→ advance（满编才推进，路由走 findRoute 两级寻路）→ engage（队形
微操：中心点+集火目标）→ rotate（伤员轮换/撤退回 build）
```

- 全员到齐（waiting 态）才转 advance——TooAngel 源码先例。
- 集结超时（孵化卡死/卡位）→ 解散回收，车道记失败而非硬冲。
- 每波次是一次有界任务（预算/最大损失/撤退条件——skill 参考的安全边界），
  波次成败写战争账本。

### 10.6 准军事 Operation（power bank / SK / 反游猎）

裁决：**SK farming 与 power bank 是经济性 Operation（走 ROI 门控），不是
战争（不需 war posture），但复用军事编队与集结机制**：

- **PowerOperation**：发现（observer/巡检，世界结构先验只查 highway）→
  评分（power 量×价格 − 编队成本 − 距离/衰减窗口 − 竞争者风险）→ 动态
  配兵（KasamiBot bankrobber/bankhealer/bankranger 按站位先例）→ 提前备
  pickup creeps（掉落衰减）。目标含敌竞争者时升格为 war 授权问题。
- **SK 车道**：常驻 farming Operation（keeper 击杀循环或「关进 lair」战术，
  可靠性优先）；+10 creeps/+2–3 CPU 的成本计入远矿/扩张 ROI（17 号文档
  消费）。
- **反游猎（harasser 对策）**：敌单只杀贫 creep 属防御等级 1–2（15 号
  文档）；duo 轻队定点护航走防御预算，不升战争。

### 10.7 nuke 的战略语义与门槛

- 语义：nuke 的独特价值是**取消 safemode**（03 §8）+ 区域拒绝（10M/5M
  伤害清除结构群）；它不是战术武器（50k tick 飞行=对手有整个反应窗口）。
- 门槛表（全部满足才发射）：war posture 已授权；目标为高价值僵局（safemode
  保下的关键房/无法用地面部队破防）；资源沉没可承受（300k 能量+5k ghodium
  +100k 冷却期脆弱性）；发射后 50k tick 计划已备案（我方何时进驻）。
- 决策属战略层（不随 Operation 下放）；发射与落点记账进战争账本；对
  Novice 区禁用（禁 nuker，03 §9）。
- 防御侧 nuke 预案见 15 号文档 §10.6。

### 10.8 战后核验（evaluateWarOutcome）

- 纯函数：输入 = 战前预期（账本）+ **新鲜 intel**（战后 scout/observer 复核
  的 fact 级观察），输出 = WarOutcome 事件（达成的摧毁/占领/我方损失/
  对手反应）。
- **只信新鲜 intel**：战前情报与传闻一律不算数——「拆毁了」必须有战后新鲜
  观察证实（防止打空误记胜利、或误判止损）。
- 输出消费：战争账本（遥测）、PlayerIntel（对手行为画像更新）、posture
  （继续/升级/退出的输入）、止损参数演化（有界调参，ADR-003 演化闭环）。

### 10.9 「什么情况下不应该攻击」清单（研究核心结论）

1. 打不起：战争基金不足或 boost SLA 未达标（等产能，不开车）。
2. 情报不新鲜：目标非 fact 级或超观察年龄阈值（先侦察）。
3. 目标在 warBlacklist 冷却中（记仇不记性是浪费）。
4. 诱饵嫌疑：目标战略价值低但示弱明显（PlayerIntel 画像反查）。
5. 补给线过长：跨房运输余量不支持编队消耗（12 号文档余量门控未过）。
6. Recovery 档：CPU 看门狗见底，军事集结暂停（降级链优先）。
7. 防御未成熟：本土无 fortify 底仓（27 号文档 P8→P9 顺序的运行时表达）。
8. 占领后守不住：目标房过不了扩张门控（ADR-008）——拆完就走可以，
   占不住的占领不做。
9. 纯情绪目标：无战略收益的报复（泄愤不进账本）。
10. 盟友/中立/限武对象：声誉与外交状态排除（现阶段无盟约，列表为空集
    但机制保留）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 常驻军队自动巡逻反击 | 军费失控+边界遭遇战不可控；军事人口仅 war/准军事 Operation 授权 |
| 以牙还牙式自动报复 | 被诱饵利用；TooAngel 三级门槛先例的方向是升级有成本而非即时反射 |
| 全自动全面战争（占领一切可占） | 成本失控；占领必须过扩张门控（ADR-008） |
| LLM 战术指挥/微操 | ADR-011 边界；确定性要求 |
| 无损核验（信战前情报记账胜利） | 打空/误判无法发现；只信新鲜 intel（ADR-009） |
| 复杂 dynamicSquad 全动态编队 | TI dysfunctional 自评的复杂度税；形态化 quad/duo 压缩决策数 |

## 12. Open Questions

1. casualtyMultiplier 与 warPressureTicks 初值（SPECULATION，需战争演练
   数据；演化闭环有界调参）。
2. 对手适应性建模深度：TooAngel「被摸透」问题是否需要多形态随机化
   （autoSiege/pairDestroy 式形态池）——推迟到首个宿敌周期复盘。
3. 盟友协议（simpleAllies 先例）对联合作战的影响，推迟到 A4 后。
4. nuke 后 50k tick 进驻计划的具体形态（地面波次协同）需沙盘推演。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| Bot 调研摘要 2026-08-22（Overmind 四进攻 directive/TooAngel 三级声誉+全员 waiting FSM+atkeeper/TI antifa+*Ops 自评/bonzAI Operation+Mission+Guru/KasamiBot 游猎+boosted wreckerteam+动态配兵/hivemind 限武） | 源码 | Operation 化+quad/duo+boost 前置收敛；开源进攻性分歧 | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/6nuyx3/（power bank 划算）+ https://wiki.screepspl.us/Power/ | 社区 | power bank 数学上划算；掉落衰减需 pickup | CONFIRMED |
| 引擎常量 POWER_BANK_POWER_MAX=5000（github.com/screeps/common） vs wiki 500–10,000 | 官方/社区 | 以引擎为准（03 §13 裁决风格） | CONFIRMED（冲突已裁决） |
| SK farming 经济性（screeps forum 327/1566） | 社区 | +10 creeps/+2–3 CPU 净收益为正；keeper 关 lair/反复击杀 | CONFIRMED |
| TooAngel 实战评价（Reddit：一次失败即不再纠缠） | 社区 | 确定性军事策略可被摸透 | LIKELY |
| 03_SCREEPS_GAME_CONSTRAINTS.md §7/§8/§9 | 官方事实 | boost 倍率/尸体 0.2 回收/nuke 语义与成本/highway 结构 | CONFIRMED |
| skill 参考 strategy-playbook（PvP）+ pvp-and-intelligence（自动军事安全边界） | 方法论 | 有界任务五要素与进攻前置检查 | 设计输入 |
