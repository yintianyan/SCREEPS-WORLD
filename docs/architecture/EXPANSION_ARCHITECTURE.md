# EXPANSION_ARCHITECTURE · 扩张架构（冻结蓝图）

> 本文件是**扩张与远矿契约**：投资决策模型、七因子评分、G1–G5 资源门控、
> 「先 remote 尽调后 colonize」决策序、殖民自举车道、失败降级、远矿 Operation
> 属地与 GCL 节奏以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，不得静默修改。
> 依据：research/17（核心裁决）、research/03 §6/§7/§9（GCL/claim/运费数值——以此
> 为准）；模块八项见 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.11；
> 调和 §1/§10.2（两级决策 / 远矿归属）。

## 1. 扩张 = 投资决策合同

> 自治框架没有人工兜底：扩张必须先算值不值、再算养不养得起、最后定义失败怎么
> 退（research/17 §1）。**立项权在 Empire**：Expansion 模块只做评估与建议，
> **禁止**自行 claim / 立项（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.11；
> [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1）。

### 1.1 四类动机（必须显式声明收益类型，杜绝「为扩而扩」）

| 动机 | 收益度量 | 反例（不构成动机） |
| --- | --- | --- |
| 资源产能 | 新房净能量流 + 矿物种类的帝国缺口矩阵填补 | 单纯房数 +1 |
| GCL 复利 | 更多房 → 更多 upgrade 能力 → 更快 GCL → 更多房位 | GCL 空转积压 |
| 战略位置 | 封锁走廊 / 包围宿敌 / 建立缓冲带（配合防御纵深） | 纯声望性「地图好看」 |
| 避险分散 | 单点故障（单房被 nuke/围城）的帝国韧性 | — |

（research/17 §10.1）动机写入 colonize AgendaItem 字段，作为验收语义的一部分。

### 1.2 七因子评分公式

```text
score = w1·sourceValue      // 2/3 source；SK 房 4,000×2 源潜力（research/03 §7）
      + w2·mineralValue     // 密度 × 帝国矿种缺口权重
      + w3·distanceScore    // 距最近自有房跳数；terminal 指数运费（research/03 §7）
      + w4·neighborSafety   // 周边 2 房半径 owner 分布：中立/盟/宿敌
      − w5·rivalProximity   // 宿敌活动房距离（PlayerIntel 派生）
      + w6·defensibility    // 出口数、地形 min-cut 成本、可预置 tower 位
      + w7·layoutFitness    // 模板适配校验结果（[CONSTRUCTION_ARCHITECTURE.md](CONSTRUCTION_ARCHITECTURE.md) §5）
```

| 条款 | 内容 |
| --- | --- |
| 合成 | 归一化到 [0,1] 后线性加权；权重 w1–w7 为 SPECULATION 初值，soak 校准（research/17 §12）。 |
| 硬否决项 | 不计分直接淘汰：known 宿敌 owned/reserved 房、被我方 nuke 污染过的房、无 fact 级房间归属情报的房（先侦察）（research/17 §10.2）。 |
| 评分输入新鲜度 | fact/stale 级；未知按最保守计（research/17 §8；[INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) §5）。 |
| Novice 窗口 | 区域属性而非评分因子：Novice 区可放宽**安全类**门控（G4），G1/G2（CPU 与净流）不放宽——规则红利替代不了资源现实（research/17 §10.7）。 |
| 并发 | 同一时刻**至多一条** colonize 车道（多候选排队；并行两条推迟到 A5 数据，research/17 §8/§12）。 |

## 2. G1–G5 资源门控合同

> 全部通过才允许开车道；任一失败即等待，**无人工覆盖路径**（research/17 §10.3）。

| 门 | 判据 | 依据 |
| --- | --- | --- |
| G1 资源指标 | `expSmooth(cpuIdle) > τ1 ∧ expSmooth(heapFree) > τ2 ∧ expSmooth(memoryFree) > τ3` | TooAngel 三指标十年无人值守母型；与 [GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4 共用参数面 |
| G2 本土净流 | 帝国（不含新候选）能量净流连续 T tick > 0 | 不掏空本土（R-03 防线） |
| G3 运输余量 | 跨房 hauler 容量 × 频率余量 > 殖民输血需求（含建期 rampart/道路建材与 5,000 spawn 能量的运输计划） | strategy-playbook 四条件门账本化 |
| G4 可撤离 | 候选房撤离成本（terminal/creep 转移）预估 < 止损线，且母房→候选资产暴露敞口有界（Novice 区可放宽） | research/17 §10.3/§10.7 |
| G5 预算预演 | 扩张后帝国 CPU 预测仍高于 Guarded 阈值（新房 3–5 CPU/房口径预演） | research/17 §9 |

| 条款 | 内容 |
| --- | --- |
| 禁止 | 无平滑直接比原始值；单房热点被均值掩盖（人均与最差房双条件，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4）。 |
| 降级联动 | Recovery 档冻结新殖民车道（P2 冻结）；fortify posture 暂停扩张与远矿**新开**，既有车道进入收缩评估（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3）。 |

## 3. 「先 remote 尽调后 colonize」决策序合同

```text
巡检发现候选 → 开 remote 车道（reserve + 采集）
  → 实测数千 tick：净收益 / 敌袭频率 / 路权 / invader 密度
  → GCL 可用 ∧ 门控全绿 ∧ 评分超阈值
  → 升级为 colonize 车道（同一房平滑过渡，hauler 队伍复用）
```

| 条款 | 内容 |
| --- | --- |
| 语义 | remote 是**便宜的期权**（成本 creep 级、可随时撤退）；colonize 是**重的承诺**（5,000 能量 + 数万 tick 工期）——决策序保证重承诺永远建立在实测数据上（research/17 §10.4）。 |
| 反向降级 | colonize 失败降级回 remote（§5），远矿数据继续积累等待下次窗口（research/17 §10.4）。 |
| 禁止 | 先 colonize 后尽调（跳过 remote 期权）——重承诺建立在未实测的估值上（research/17 §11）。 |

## 4. 殖民自举车道合同（五阶段）

| 阶段 | 合同 |
| --- | --- |
| ① claim | claim creep（1 CLAIM + MOVE，≈650 能量；CLAIM part 600 能量、寿命 600 tick，research/03 §6/§10）出发，房内威胁复查（PlayerIntel 威胁记忆）（research/17 §10.5）。 |
| ② 输血 | 母房专项能量租约：5,000 spawn 建造 + 建材 + 存量缓冲；**建期 rampart 保护工地**（工地可被敌意 creep 踩毁，research/13 §4；research/17 §4）。 |
| ③ 自续命 | 殖民工人从母房步行到达、以本地 source 自持孵化过渡（bonzAI 扩张工人先例——省母房孵化带宽）（research/17 §10.5）。 |
| ④ 六闭环自举 | spawn 落地 → 房间进 bootstrap phase 自举序列 → 六闭环健康（能量/人口/物流/建造/升级/防御，[EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1 Room）。 |
| ⑤ 并网 | 移交房间层自治、车道关闭记账；此后房间经 Report（净流/缺口/风险）/ Request（援助/授权）与帝国双向，接受 Directive-channel 下发（AgendaItem/调拨令/预算）（research/17 §10.5；[EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1）。 |

| 条款 | 内容 |
| --- | --- |
| 立项形态 | 自举车道 = colonize AgendaItem（预算 / 期限 / 取消条件写死，**不许运行时重议**——沉没成本陷阱防线，research/17 §7/§10.5）。 |
| minDuration | 殖民项 ≥ 自举五阶段关键路径时长（[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §4 防线 2）。 |
| 里程碑验收 | 用行为证据（净流量 / 任务完成数），不用结构存在性（[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §3）。 |

## 5. 失败降级表（写死在 Agenda，自动执行）

| 触发 | 动作 |
| --- | --- |
| claim 被反占 / 超时 | 车道取消；目标房回候选池并扣安全分 |
| spawn 未在期限内落地（输血断供 / 被拆） | 降级为 remote 车道（复用已有实测数据），或放弃 |
| bootstrap 期净流持续为负超止损线 | 撤离：terminal / creep 资产回收，放弃房位（**GCL 保留**，research/03 §9） |
| 帝国进入 Guarded 以下 | 冻结车道（保存量不追增量），恢复后重开 |

（research/17 §10.5）撤销路径自动化、无人工重议；降级与放弃记失败计数，同目标
冷却期内禁止重建（[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §4 防线 3）。

## 6. GCL 节奏合同

| 条款 | 内容 |
| --- | --- |
| 公式 | GCL 升级 ≈ 1e6 × L^2.4 控制点（指数增长）；GCL 永不丢失（research/03 §9）。 |
| 批判性采纳 | 社区「GCL 一到就 claim」是有人工兜底前提下的经验；自治框架裁决 **GCL 是必要非充分条件**——必须叠加上述评分与门控（research/17 §4）。 |
| 联动规则 | 候选池存在评分合格房 ∧ 门控预测将绿 → 才上调 GCL farm 的能量优先级（peak 房 sink 分配）；否则 GCL 投资让位军事储备 / 生产链——避免「刷出房位却无资源可扩」的积压（research/17 §10.6）。 |
| Respawn | GCL 保留（官方）；重生优先重占原有房位而非探索新域（房位即资产，research/17 §10.6）。 |

## 7. 远矿合同（Operation 属地）

| 条款 | 内容 |
| --- | --- |
| 归属 | 远矿 = **Operation（AgendaItem），属地 = 母房**（执行挂母房人口与物流），**立项权 = 帝国**（ROI 与 CPU 定价是帝国口径）；远矿房**不是**房间层单元、不进房间注册（调和 §10.2；research/17 §5）。 |
| ROI 定价 | 必须含 CPU 账：~1 CPU/房 数据点为玩家个案（SPECULATION），以自身远矿车道遥测（净收益 vs CPU）校准（[RESEARCH_SYNTHESIS.md](RESEARCH_SYNTHESIS.md) §2/§5）。 |
| 尽调义务 | 远矿车道同时承担 §3 的殖民尽调（收益实测 / 威胁频率 / 路权）。 |
| 上限与节流 | 并发车道数由 G1 门控与预算导出；**恢复必须分批节流**（每 N tick 恢复一条或按 CPU 余量逐条解锁——红队 A2：防恢复风暴二次降级，[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §4 防线 3）。 |
| 威胁联动 | 敌袭自动暂停 N tick 恢复（invader 响应见 [DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) §7）；fortify 下既有车道进入收缩评估（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3）。 |
| site 写者 | 远矿房 site 由 RemoteMiningManager 唯一签发，配额让路自有房 emergency（[CONSTRUCTION_ARCHITECTURE.md](CONSTRUCTION_ARCHITECTURE.md) §3）。 |

## 8. 三层关系总图（Empire → Room → Operation）

```text
Empire 战略层（Policy 纯函数 + Agenda 管理器）
  │ 立项授权：AgendaItem（remote / expansion，预算+期限+取消条件+属地=母房）
  ▼
Room（母房属地：车道执行挂本地人口 / 物流 / 建造六闭环）
  ▲ Report（净流 / 缺口 / 风险）／Request（援助 / 授权）── 并网后双向
  │
Operation 执行态（远矿车道 / 殖民自举：Demand→Task→Outcome）
  └─ 结果核验 → Agenda 低频复核 → 终态归档遥测 → 反哺 Intel / Policy
```

帝国垄断扩张 / 远矿立项 / GCL / 跨房调拨；房间持有本地执行闭环；Operation 承载
中期承诺——三层各自不越界（调和 §1；[ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md)）。

## 9. 与其他契约的关系

| 契约 | 分工 |
| --- | --- |
| [INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) | 尽调评分输入、宿敌距离因子、未知按最保守计 |
| [CONSTRUCTION_ARCHITECTURE.md](CONSTRUCTION_ARCHITECTURE.md) | layoutFitness、殖民建期 rampart、远矿 site 配额 |
| [MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md) §8 清单第 8 条 | 占领候选必须过本蓝图门控（军事胜利 ≠ 殖民许可） |
| [GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4 | G1 三指标与五域预算共用参数面；posture 允许集 |
| [PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §3/§4 | AgendaItem 数据契约与防振荡三防线 |
