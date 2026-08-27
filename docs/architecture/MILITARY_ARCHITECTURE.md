# MILITARY_ARCHITECTURE · 军事架构（冻结蓝图）

> 本文件是**进攻契约**：war 授权链、军事概念集、止损链三闸、集结 FSM、准军事
> Operation、nuke 门槛、战后核验与十条「不应攻击」清单以此为准。结构性修订必须
> 走 ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，
> 不得静默修改。依据：research/16（核心裁决）、research/03 §7/§8/§9（boost/nuke/
> power 数值——以此为准）；模块八项见 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md)
> §1.10；防御侧合同见 [DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md)。

## 1. war 授权链合同

```text
PlayerIntel 持续威胁记忆（被打 N tick——事实级，不含推测）
  ∧ 战争经济学核算通过（打得起：预期最大损失 ≤ 战争基金）
  ∧ 目标池非空（fact 级新鲜 + 非黑名单）
  → posture: fortify → war（Policy 唯一授权，滞回，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3）
  → war-planner（唯一进攻执行决策者）创建 War Operation（预算/期限/取消条件）
  → attacker 孵化（唯一路径：war-planner → SpawnManager）
```

| 条款 | 内容 |
| --- | --- |
| 授权唯一 | `war` 姿态是进攻的**唯一**授权来源（持续被打 ∧ 打得起）；**打得起** = 预期最大损失 ≤ 战争基金（从帝国能量盈余计提的专项储备）；基金不足则只 fortify 不 war——哪怕被持续骚扰（research/16 §10.2）。 |
| 执行唯一 | war-planner 是唯一进攻执行决策者；attacker **仅**由它经 Spawn 请求孵化，不存在第二孵化路径（research/16 §10.1；[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1）。 |
| 代码存在 ≠ 战争开始 | 进攻能力在代码中存在不构成战争状态；非 war 姿态下军事人口仅维持 boost SLA 水平，军事人口不会悄悄繁殖吃掉经济（research/16 §6；AGENT.md）。 |
| 基金分账 | war 授权后战争基金预算线被 Policy 划出：基金内军事消耗**不与经济发展竞争**；基金耗尽或经济压力持续超标 → 止损链强制退 fortify——经济底线最终不可被军事击穿（[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) Q2）。 |
| 反击延迟 | 授权链长 → 反击延迟是被接受的代价：fortify 可先行筑防，防御不等战争（research/16 §7）。 |

## 2. 概念合同（授权输入与执行对象）

| 概念 | 合同 |
| --- | --- |
| **Intel** | 战争侧唯一合法输入 = 新鲜 intel：目标选择与战后核验的硬门槛（fact 级 ∧ 观察年龄 < 阈值）由 [INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) §5 承载；情报系统本身不触发战争（research/16 §10.1/§11）。 |
| **Threat** | 授权输入：PlayerIntel 持续威胁记忆经 Defense 上行聚合为 posture 候选信号（[DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) §1 下行/上行条款）；防御系统永不自行反打出门。 |
| **Military Posture** | = posture 的 war/fortify 态（帝国级、Policy 唯一写者、切换带滞回 + minDuration，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3）；军事系统只读消费，不得改写。 |
| **Target（目标）** | 候选 = fact 级 RoomIntel（owner/RCL/塔位/heal 估计）∧ 观察年龄 < 阈值 ∧ 非黑名单；优先序 = 战略价值（宿敌核心产能房 > 其扩张前哨 > 报复性低价值目标——后者原则上不打）× 可行性（RCL 与距离匹配）；失败/unknown 目标进 `warBlacklist` 冷却（TTL 由止损链定；冷却期内同玩家其他目标仍可评估）（research/16 §10.4）。 |
| **Operation（战争波次）** | = AgendaItem（type: war）：**集结—推进—撤退—核验**四阶段；带预算/期限/取消条件/属地（[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §3）；波次成败写战争账本（research/16 §10.5）。 |
| **Squad（编队）** | 标准形态：**quad**（4 只：2 前排 tough/attack + 2 后排 heal，贴身阵型）主力攻坚；**duo**（attack+heal）巡逻 / 反骚扰轻队；对无塔目标用 swarm 廉价版。形态化编队把微操压缩为「队形中心点 + 目标选择」两个决策（research/16 §9/§10.3）；dynamicSquad 全动态编队被否决（research/16 §11）。 |
| **Spawn（军事孵化）** | **仅**经 war-planner → SpawnManager 车道（P0/P1 车道，优先级由 Policy 赋权）；消耗走战争基金预算线（§1 基金分账）；`spawning` 与已提交请求计入人口（research/16 §10.3；[SPAWN_ARCHITECTURE.md](SPAWN_ARCHITECTURE.md)）。 |
| **Boost** | SLA 库存合同：和平期按**预生产水平**维持 T2/T3 库存（peace 预算语义：军费仅维持）；war Operation 创建时检查库存与 lab 产能，**缺口则先补产能再开集结**（不开车，research/16 §10.9-1）；消耗按 30 矿 + 20 能量/part、真实倍率表核算（attack/ranged/heal 2/3/4、tough 减伤 ×0.7/0.5/0.3，research/03 §7）。 |
| **Combat（交战）** | 交战规则：贴身集火、队形中心点决策；伤员轮换（rotate）回 build 相位；伤亡逐波计数进账本；高 tough 对塔房、高 dismantle 对拆迁目标（research/16 §10.3/§10.5）。 |
| **Retreat（撤退）** | 止损链三闸（§3）——不可绕过、不可人工豁免；每波次开拔前已带撤退条件与最大损失（research/16 §10.5）。 |

## 3. 止损链三闸合同（Retreat 展开）

| 闸 | 触发 | 动作 |
| --- | --- | --- |
| 1 伤亡闸 | spawned 伤亡超 `squadSize × casualtyMultiplier` | 本波次强制收摊（research/16 §10.2） |
| 2 目标闸 | 目标失败 / unknown 结果 | 进 `warBlacklist` 冷却；空目标数 = 0 即收摊退 fortify——**这是正确行为，不是故障**（research/16 §8） |
| 3 经济闸 | 经济压力持续超标经 `warPressureTicks` | 强制退 fortify（research/16 §10.2） |

| 条款 | 内容 |
| --- | --- |
| 退出滞回 | war 退出窗口 **≥ 一个完整波次周期**（集结 + 推进 + 战后核验，红队 A3）；minDuration 由波次周期推导，禁止拍脑袋定值（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3 war 行）。 |
| 参数状态 | `casualtyMultiplier` 与 `warPressureTicks` 为 SPECULATION 初值，待首个战争波次实测回填（research/16 §12；[RESEARCH_SYNTHESIS.md](RESEARCH_SYNTHESIS.md) §5）。 |
| 反利用 | 止损过早可被对手低成本骚扰耗掉威慑：止损记录进 PlayerIntel，对手行为画像反哺阈值；黑名单是冷却不是永久放弃（research/16 §7）。 |
| 账本 | 波次账本（spawned/损失）战时每 tick 计数、低频复核；战后归档 segment（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.7）。 |

## 4. 集结 FSM（防添油）

```text
recruit（孵化+boost）→ build（hold 钩子归建待命）→ advance（满编才推进，
路由走 findRoute 两级寻路）→ engage（队形微操：中心点+集火目标）
→ rotate（伤员轮换 / 撤退回 build）
```

| 条款 | 内容 |
| --- | --- |
| 满编才 advance | 全员到齐（waiting 态）才转 advance——**TooAngel 源码先例（CONFIRMED）**：单兵不被派去送死（research/16 §4/§10.5）。 |
| 集结超时 | 孵化卡死 / 卡位 → 解散回收，车道记失败而非硬冲；卡位自愈与 Operation 期限兜底（research/16 §8）。 |
| 有界波次 | 每波次 = 有界任务（预算 / 最大损失 / 撤退条件），成败写战争账本（research/16 §10.5）。 |
| 降级联动 | Recovery 档军事集结**暂停**（编队停安全房待命而非解散）；war 期军事优先级上调但看门狗仍兜底（research/16 §9）。 |

## 5. 准军事 Operation（power bank / SK farming）

| 条款 | 内容 |
| --- | --- |
| 裁决 | SK farming 与 power bank 是**经济性 Operation（走 ROI 门控），不是战争**（不需 war posture），但复用军事编队与集结机制（research/16 §10.6）。 |
| PowerOperation | 发现（observer/巡检，世界结构先验只查 highway）→ 评分（power 量 × 价格 − 编队成本 − 距离/衰减窗口 − 竞争者风险）→ 动态配兵 → 提前备 pickup creeps（掉落衰减）。**目标含敌竞争者时升格为 war 授权问题**（research/16 §10.6）。 |
| power bank 数值 | 500–5,000 power（引擎常量 `POWER_BANK_POWER_MAX=5000`，wiki 10,000 已被裁决否决）、2M hits、50% 反击（research/03 §7/§13；[RESEARCH_SYNTHESIS.md](RESEARCH_SYNTHESIS.md) §4）。 |
| SK 车道 | 常驻 farming Operation（keeper 击杀循环或「关进 lair」，可靠性优先）；+10 creeps / +2–3 CPU 成本计入远矿 / 扩张 ROI（research/16 §10.6；[EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §7 消费）。 |
| 反游猎 | 敌单只杀贫 creep 属防御级 1–2：duo 轻队定点护航走**防御预算**，不升战争（research/16 §10.6；[DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) §7）。 |

## 6. nuke 使用门槛表

> 战略语义：nuke 的独特价值是**取消 safemode**（落地立即取消并清充能冷却，
> research/03 §8）+ 区域拒绝（10M/5M 伤害清除结构群）；它不是战术武器——
> 50,000 tick 飞行 = 对手有整个反应窗口（research/16 §10.7）。

| 门槛 | 内容 |
| --- | --- |
| 授权 | war posture 已授权；nuke 决策属战略层（Policy），**不下放 Operation**（research/16 §8/§10.7）。 |
| 目标 | 高价值僵局：safemode 保下的关键房 / 地面部队无法破防的目标（research/16 §10.7）。 |
| 资源 | 沉没可承受：装填 300k 能量 + 5k ghodium + 100,000 tick 冷却期脆弱性（research/03 §8）。 |
| 计划 | 发射后 50,000 tick 飞行窗口的进驻计划已备案（research/16 §10.7）。 |
| 区域 | Novice 区禁用（禁 nuker，research/03 §9）。 |

数值锚点（research/03 §8）：射程 10 房 / 飞行 50,000 tick / 中心 10M、≥2 格 5M /
冷却 100,000 tick。发射与落点记账进战争账本；防御侧 nuke 预案见
[DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) §6。

## 7. 战后核验合同

| 条款 | 内容 |
| --- | --- |
| 纯函数 | `evaluateWarOutcome`：输入 = 战前预期（账本）+ **新鲜 intel**（战后 scout/observer 复核的 fact 级观察）；输出 = WarOutcome 事件（达成的摧毁 / 占领 / 我方损失 / 对手反应）（research/16 §10.8；[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.10）。 |
| 只信新鲜 intel | 战前情报与传闻一律不算数——「拆毁了」必须有战后新鲜观察证实（防打空误记胜利、防误判止损，research/16 §10.8/§11）。 |
| 事件记录 | WarOutcome 经遥测管线写 segment、滚动窗口保留（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.7）。 |
| 消费 | 战争账本（遥测）、PlayerIntel（对手行为画像更新）、posture（继续 / 升级 / 退出的输入）、止损参数演化（有界调参）（research/16 §10.8）。 |

## 8. 十条「不应攻击」清单（合同化）

> 全部为**硬否决**：任一条命中即本 tick 不得发起进攻（research/16 §10.9）。

1. **打不起**：战争基金不足或 boost SLA 未达标（等产能，不开车）。
2. **情报不新鲜**：目标非 fact 级或超观察年龄阈值（先侦察）。
3. **目标在 warBlacklist 冷却中**（记仇不记性是浪费）。
4. **诱饵嫌疑**：目标战略价值低但示弱明显（PlayerIntel 画像反查）。
5. **补给线过长**：跨房运输余量不支持编队消耗（物流余量门控未过）。
6. **Recovery 档**：CPU 看门狗见底，军事集结暂停（降级链优先）。
7. **防御未成熟**：本土无 fortify 底仓。
8. **占领后守不住**：目标房过不了扩张门控——拆完就走可以，占不住的占领不做（[EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §3）。
9. **纯情绪目标**：无战略收益的报复（泄愤不进账本）。
10. **盟友 / 中立 / 限武对象**：声誉与外交状态排除（现阶段无盟约，列表为空集但机制保留）。

## 9. 与其他契约的关系

| 契约 | 分工 |
| --- | --- |
| [GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3 | war/fortify 姿态合同（进入 / 退出 / 滞回 / 预算语义） |
| [DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) | 威胁上行信号、反游猎走防御预算、nuke 防御预案、stabilizing 核验闭环 |
| [INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) | 目标新鲜度硬门槛、PlayerIntel、战后核验输入 |
| [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.7 | MilitaryState（账本 / 止损计数 / warBlacklist）所有权 |
| [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2.2 | P2 档位：非 war 收摊近零；战时 O(squad)；Recovery 集结暂停 |
