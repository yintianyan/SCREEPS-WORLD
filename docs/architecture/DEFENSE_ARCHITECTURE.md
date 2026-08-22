# DEFENSE_ARCHITECTURE · 防御架构（冻结蓝图）

> 本文件是**防御契约**：房间级防御状态机、威胁四级分级链、围城能量会计、tower
> 合同、safemode 决策表、rampart/墙维护与 invader 响应以此为准。结构性修订必须
> 走 ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，
> 不得静默修改。依据：research/15（核心裁决）、research/03 §6/§8（safemode/nuke/
> 战斗数值——数值以此为准）；模块八项见 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md)
> §1.9；进攻侧合同见 [MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md)。

## 1. 防御状态机合同（房间级五态）

> `normal → alert → siege → recovery → stabilizing`（research/15 §10.2）。
> **与 posture 的关系**：posture（peace/fortify/war/evacuate）是帝国级姿态
> （[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3）；本状态机是
> **房间级属地执行**——防御状态是房间级的，帝国级只读聚合报告，**一房 alert
> 不得惊动全帝国**（research/15 §8/§11）。

| 状态 | 进入事实 | 退出条件（滞回） | 允许动作 | 能量配给语义 |
| --- | --- | --- | --- | --- |
| `normal` | 无可见敌（威胁级 0） | —（升态由敌情事件触发） | 常规经济；零成本威胁巡检（只查威胁缓存时间戳） | 正常预算 |
| `alert` | 威胁级 ≥2（raid 编队入房） | 威胁消失持续 N tick | 塔集火 + defender 补位（P0 车道）+ 非战斗人口冻结 | tower > spawn > repair |
| `siege` | 威胁级 3（敌房外游走 或 敌有效 heal ≥ 塔净伤） | 能量会计转正 **且** 无可见敌（双条件，滞回） | 能量会计接管（§4）；停火蓄能；保命序准备；safemode 进入决策表 | tower > spawn 恢复 > repair > 其他（upgrade≈0） |
| `recovery` | 围城解除 | 六闭环健康——**不是**「敌人走了」（research/15 §10.2） | 重建批处理；损失盘点 | 恢复优先分配 |
| `stabilizing` | recovery 达健康后的复盘期 | 滞回 + 战后核验（[MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md) §8）通过才归 normal | 验证性运行；二次打击预案就位 | 接近正常 |

| 条款 | 内容 |
| --- | --- |
| 警报记录 | 每次状态转移写遥测事件：时间、触发事实、置信度、预计消耗上限、退出条件（research/15 §10.2）。 |
| 防抖 | 本状态机与 posture 双向供给但都带滞回：防御动员不改变 posture，posture 不因单房单次事件切换（research/15 §10.8）。 |
| 上行 | 房间防御状态聚合进帝国态势：持续 siege / 多房 alert → fortify 或 war 的**候选信号**（posture 仍是唯一进攻授权；防御系统永不自行反打出门，research/15 §10.8/§11）。 |
| 下行 | posture 决定防御预算基准：fortify 加固与塔能储备上调；war 边缘房预置 defender；evacuate 防御让位于撤离（research/15 §10.8）。 |
| 禁止 | 反射式防御（见敌即塔+defender 全开）；亡命升级（一房被袭全帝国总动员）（research/15 §11）。 |

## 2. 威胁四级分级链

```text
可见敌 creep → identify（body 解析：attack/ranged/heal/dismantle/claim 计数
  + tough/boost 检测 + 玩家 vs NPC）→ 量级估计（编队 heal 总量、有效 HP、
  补给距离）→ 分级 → 匹配 policy（research/15 §10.1）
```

| 等级 | 判据（例） | 响应要点 |
| --- | --- | --- |
| 0 无威胁 | 无可见敌 | normal：零成本巡检 |
| 1 骚扰 | invader / 单只低价值游猎 | 塔自动处理；远矿房走撤退预案（§7） |
| 2 raid | 小队突入：编队含 attack/dismantle、heal 弱 | alert：塔集火 + defender 补位 + 配给启动 |
| 3 siege | 围城 / 吸塔：敌房外游走或 heal ≥ 塔净伤 | siege：能量会计接管（§4） |
| 4 拆家/占领 | dismantler 群或 claim 动作 | 保命序：关键结构优先 + safemode 候选（claim 是占房语义，优先级最高） |

| 条款 | 内容 |
| --- | --- |
| 评估输入 | body / 数量 / boost / 补给距离；`assessThreat(snapshot)` 为纯函数（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.9）。 |
| 置信度衰减 | 分级置信度随 intel 新鲜度衰减——情报盲区即会计盲区（research/15 §7）；置信度分级接口由 [INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) §1 Knowledge 行承载。 |
| 节奏 | 无威胁房每 tick 近零（威胁缓存时间戳）；敌可见期每 tick 轻量、从威胁缓存取目标不重扫（research/15 §9）。 |

## 3. 能量会计合同（围城胜负判定式）

> 围城是吞吐竞赛，不是击杀竞赛：对手就是来耗能的（Tower Drain 为标准攻方战术，
> research/15 §4，CONFIRMED）。「守住」必须被量化为可计算不等式。

```text
防御可持续时间 T = (tower 可用能量 + storage 水位 × 转化率 + 补给速率 × t) / 塔耗速率
塔耗速率 ≈ 动作塔数 × 10 能量/tick（满频）
敌方成本 ≈ tank 血量损耗 + heal 消耗（其补给受距离惩罚）
守得住 ⟺ T > 敌方可持续威胁时间（PlayerIntel 历史估计） ∧ 补给链不被切断
```

| 条款 | 内容 |
| --- | --- |
| 更新节奏 | 账本每低频 tick 更新，是 siege 态的核心循环——比「塔还打得到人」可靠（research/15 §10.4）。 |
| 守得住 | 继续 alert/siege 配给（T > 敌方可持续时间）。 |
| 守不住 | T 低于阈值 → 保命模式：能量转移（terminal 撤资）、保 spawn/controller、safemode 时机进入决策表（§5）（research/15 §10.4）。 |
| 配给序 | siege 态能量配给优先序：**tower > spawn 恢复 > repair > 其他（upgrade≈0）**（research/15 §10.2）。 |

## 4. tower 合同

| # | 条款 |
| --- | --- |
| 1 | 目标价值排序：**dismantler/attack 对关键结构的即时威胁 > healer > 高 DPS ranged/attack > 残血收割**（先断奶妈，research/15 §10.3）。 |
| 2 | 发前自检三查：目标仍存在、在有效射程（优先 ≤5 格满效区）、本塔能量够一次动作——**三查不过不发**（intent 0.2 CPU 税且失败也收费，research/03 §8；research/15 §10.3）。 |
| 3 | 集火协调：同房多塔同 tick 打同一优先目标（intent 前统一仲裁），避免伤害摊薄被 heal 逐个抵消（research/15 §10.3）。 |
| 4 | 停火条件：敌编队有效 heal ≥ 全塔净伤害（Tower Drain 判定）→ 转停火 / 蓄能 / 退守内圈，**绝不陪烧**——停火同时是 CPU 节约手段（research/15 §4/§9/§10.3）。 |
| 5 | 塔修理（800/次）仅在非战斗期用于 rampart / 关键结构维护批处理，不与塔争 tick 末时间片（research/15 §9/§10.3）。 |

数值锚点：攻击 600 / 治疗 400 / 修理 800、每次 10 能量、≤5 格满效、5→20 格线性
衰减至 25%（research/03 §8——社区「20%」说法错误）。塔动作唯一签发者是 Defense
系统（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.9）。

## 5. safemode 决策表（战略资源预算）

引擎常量（research/03 §6，以此为准）：持续 20,000 tick / 冷却 50,000 tick /
每升 1 级充能 1 次 / 1000 ghodium 可补 / **每 shard 同时只能一房开启** /
`attackController` 与 nuke 落地会取消。

| 条件 | 动作 |
| --- | --- |
| 敌贴关键建筑或 spawn <50% 血量，且威胁级 ≥2（非骚扰） | 允许开（社区自动化触发惯例，research/15 §4） |
| 本 shard 名额已被占用 | 禁开（换保命模式） |
| nuke 已宣布落点本房 | **禁开**——拦截语义：safemode 拦不住已发射的 nuke，落地即取消 safemode 并清充能（research/03 §8）；转 nuke 预案（§6） |
| 骚扰级（invader / 单只） | 禁开（塔足够） |
| 冷却未过 / 能量即将耗干到无法反击 | 记入账本，依赖撤离与战后重建 |

| 条款 | 内容 |
| --- | --- |
| 多房抉择 | 多房同时候选时按**可保住房评分**抉择：房间资产价值（spawn/storage/controller 等级）× 防御可持续时间 T（§3）× 失守可恢复性；未获名额的候选房走保命模式（红队 A11 的多房仲裁在防御侧的落点）。 |
| 记账 | 每次决策（含禁开）记录进战争账本遥测（research/15 §10.5）。 |
| 区域例外 | Novice 区 safemode 无冷却（research/03 §9），决策表按区域属性放宽（research/15 §10.5）。 |

## 6. rampart / 墙维护合同

| 条款 | 内容 |
| --- | --- |
| 厚度目标分级 | 加固目标值按威胁态分级（normal 低档 / alert 上调 / siege 最高档）——方向性裁决，具体数值表 SPECULATION 待故障注入与 soak 校准（research/15 §12.4）。 |
| 完整度巡检 | rampart 衰减 300 hits/100 tick（research/03 §8）；完整度进房间防御闭环低频巡检，断档即修复批处理（research/15 §8）。 |
| min-cut | 防线形态由离线 min-cut 固化进模板，线上只维护不生成（[CONSTRUCTION_ARCHITECTURE.md](CONSTRUCTION_ARCHITECTURE.md) §6；research/15 §10.6）。 |
| 上限 | wall 300M、rampart 按 RCL 30 万→3 亿（research/03 §8）。 |
| nuke 预案 | observer/scout 发现 `Game.nukes` 落点 → 50,000 tick 窗口内：加固落点半径内 rampart 至 1M+、转移 / 加盖内部结构、评估撤离成本（research/15 §10.6）。**safemode 与 nuke 预案永远是两条独立轨道**（nuke 落地即取消 safemode，research/03 §8）。 |

## 7. invader 骚扰响应（远矿属地）

| 条款 | 内容 |
| --- | --- |
| 自有房 | invader（NPC）= 威胁级 1：塔自动清（research/15 §10.7）。 |
| 远矿房 | 触发该远矿车道自动暂停 N tick 后恢复；高频出现则骚扰损失计入远矿 ROI 核算（research/15 §10.7；车道合同见 [EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §7）。 |
| 敌 reserver | 中立缓冲房被敌预约 → source 满容量（3,000）被取消，远矿收益减半（research/15 §10.7；research/03 §6）。 |
| 敌 claimer | 自有房出现 claim 动作 → 威胁级 4 响应（占房语义，优先级最高，research/15 §10.7）。 |
| 骚扰性单杀 | 敌单只杀 worker 按经济损失（非战斗损失）计入 PlayerIntel 威胁记忆；持续骚扰可成为 posture 升格的候选输入（research/15 §10.7）。 |

## 8. 与其他契约的关系

| 契约 | 分工 |
| --- | --- |
| [MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md) | 进攻授权链与止损（防御只上报候选信号，不反打出门）；战后核验是 stabilizing 归 normal 的前置 |
| [INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) | 威胁评估的置信度输入、PlayerIntel、nuke 落点发现 |
| [CONSTRUCTION_ARCHITECTURE.md](CONSTRUCTION_ARCHITECTURE.md) | min-cut 固化、加固批处理、建期 rampart 护工地 |
| [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2.2 | P0 档位：防御应答永不降级；Recovery 档只保塔控与最小 defender 车道（research/15 §9） |
