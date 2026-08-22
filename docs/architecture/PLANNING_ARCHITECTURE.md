# PLANNING_ARCHITECTURE · 规划架构契约

> 本文件是规划职责分布、AgendaItem 数据契约、防振荡防线与规划 CPU 预算的**冻结契约**；
> 结构性修订必须走 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，
> 不得静默修改。依据：[ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md)
> §4/§6、research/07（核心）、research/06 §10.4、research/08、research/20 §10.1、
> research/30（A2/A3）。

## 1. 裁决合同：不存在 Planner 组件

| 条款 | 内容 |
| --- | --- |
| 裁决 | **本系统不存在任何名为「Planner」的运行时组件**（调和 §4）。任务书暗示的三层 Planner 组件被否决；其职责由三处吸收：① 战略方向＝Policy 纯函数；② 中期承诺＝Agenda 管理器（一个普通 System，注册于组合根，无特殊地位）；③ 即时派工＝各系统的确定性推导（census→spawn intent、供需池→租约）。 |
| 论据 | research/07 四论据：对抗性世界使 10^3 tick 级序列生成即过期（社区六大 bot 零家保存计划序列）；确定性执行已可从缺口推导（序列规划求解的问题不存在）；重解 CPU 高且重规划恰在资源最紧张时触发；承诺（预算/期限/取消条件）可审计而动作序列只有作者能读。社区检索确认无 GOAP/在线规划器 bot（research/07 §4，CONFIRMED 负结果）。 |
| 概念定位 | Screeps 的规划对象是**承诺（commitment）而非序列（sequence）**；「计划」仅存在于 AgendaItem 的里程碑描述中（里程碑＝验收判据，非执行脚本）。research/07 称议程管理器为「唯一 Planner」的表述已被调和 §4 收紧——**运行时无 Planner 之名，亦无 Planner 之实**。 |

## 2. 任务书三层映射表（修订后裁决）

| 任务书层级 | 修订后载体 | 运行频率 | 产出 | 禁止 |
| --- | --- | --- | --- | --- |
| strategic（战略规划） | **Policy 纯函数**（posture×budget，见 [GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md)） | 态势分频求值（快照未刷新则沿用上次决策，红队 A1） | posture 允许集 + 五域预算 | 禁止做成序列规划器；禁止读 Game 全局 |
| operational（作战/运营规划） | **Agenda 管理器**（AgendaItem 生命周期系统） | 低频复核 **50–200 tick 级**（初值带，取 TI request 复核 100–200 tick 随机化先例；**具体分频由实现期按 research/20 §10.1 判据定**：N ≈ 该域变化时间尺度 ÷ 4，扩张评估类 N=100+） | AgendaItem 的创建/复核/取消/验收 + 生命周期内持续声明的 Demand 流 | 禁止生成动作序列；禁止直接指挥 creep；禁止绕过 Demand 直接下 Task；禁止在 Recovery 档新建任何项 |
| tactical（战术规划） | **各系统确定性推导** | 每 tick，查表级（缺口＝派生索引上的整数比较） | Demand/Intent/租约 | **禁序列规划**（GOAP/HTN 求解器/MPC 滚动重解全数否决，research/07 §11）；寻路是全架构唯一序列求解且已局部化限频（maxRooms:1 + 三档限频） |
| scheduled（定时） | **维护性分频钩子** | 固定 cadence | 快照全量刷新、遥测聚合、intel TTL 清扫、迁移/对账 | **仅限维护类**；禁止把发展工作（建造/扩张/孵化）做成 cron 表——发展由态势驱动，不由日历驱动（research/07 §5 第 2 行，评审红线） |

跨层规则（research/06 §10.4）：上层只约束下层（允许集/预算/期限），不生成下层的具体
内容；下层只上报 Outcome/指标，不改上层状态。Task 层除 posture 外不得跨层直读战略状态。
各层生命周期量级天然解耦：strategic 10^3–10^5 tick、operational 10^3–10^4、
tactical 1–10^2——不互相拖累（research/05 §6）。

### 2.1 Agenda 管理器的职责边界（做/不做）

| 做 | 不做 |
| --- | --- |
| 从 posture 允许集 + 预算门控推导候选并创建 AgendaItem | 生成动作序列 |
| 低频复核：预算余量 / 期限 / 取消条件 / 里程碑验收 | 直接指挥 creep |
| 维护状态机 pending→active→done/failed/expired/cancelled/superseded | 绕过 Demand 直接下 Task |
| 结果事件记录（WarOutcome 等） | 在 Recovery 档新建任何项（P2 冻结） |
| 生命周期内持续向需求池声明 Demand | 点名执行者（绑定仲裁唯一在分配服务） |

### 2.2 与其他层的接口

| 方向 | 接口 | 合同 |
| --- | --- | --- |
| 上游 | 读 PostureDecision（允许集）+ 预算余量 | **只读**；快照未刷新则沿用 |
| 下游 | 活跃 Agenda 项向需求池声明 Demand | **单向**，不点名 creep |
| 反馈 | Outcome 聚合喂复核（里程碑验收）与战略指标（战争账本、扩张 ROI） | 验收只信行为证据与新鲜 intel |
| 降级 | Guarded 暂停新建；Conserve/Recovery 冻结复核并按取消条件优雅收缩（远矿最先） | 恢复期分批节流（红队 A2） |

## 3. AgendaItem 数据契约

> 与 research/07 §10.3 一致；持久化进 Memory 的每项为固定小节（预计 <100B），
> O(active agendas)；里程碑证据走遥测 segment，不进 Memory。

```text
AgendaItem {
  id:               稳定幂等键 `${type}:${targetRoom}`（重建冷却的匹配前缀）
  type:             remote | expansion | war | rebuild | evacuatereserve | paramilitary
  budget:           { energy 端点, CPU 参考, population 上限 }   # 承诺的资源边界
  deadline:         tick                                            # 硬期限
  minDuration:      tick                                            # 最低持续期（防振荡，§4）
  cancelConditions: 谓词列表                                        # budget 关闭 / 威胁 / intel 失效…
  milestones:       验收判据列表（行为证据：净流量/任务完成数，非结构存在性）
  status:           pending | active | done | failed | expired | cancelled | superseded
  outcome?:         完成核验摘要（WarOutcome 等，只信新鲜 intel）
  # 属地：母房（执行挂母房人口与物流）；立项权：帝国垄断（远矿/扩张是帝国口径的 ROI 决策，调和 §10.2）
}
```

| 条款 | 内容 |
| --- | --- |
| 必须 | cancelConditions **必含 budget 关闭条件**（防承诺过度僵化）；milestones 必须用行为证据（防验收作弊，research/07 §8）；deadline 与 minDuration 是承诺的对价——**禁止无期限承诺**。 |
| 禁止 | AgendaItem 从不点名 creep（绑定仲裁唯一在分配服务，research/08 §8「Directive 直派 creep」）；已死项不得残留预算（低频复核对账：非 active 项限期清理，两阶段删除）。 |
| 类型集 | 远矿车道 / 扩张殖民 / 战争波次 / 重建 / 准军事（power bank、SK farming——ROI 门控，非 war 授权）。 |

## 4. 防振荡三防线合同

> 防线对象：规划振荡（replan thrashing）——Agenda 反复创建/取消（远矿开了停、停了开）。
> 依据 research/07 §10.4；红队 A3 把参数约束钉死为「由波次周期推导」。

| # | 防线 | 合同 |
| --- | --- | --- |
| 1 | **滞回（hysteresis）** | Agenda 的创建与取消条件分离：创建要 budget 开启条件持续 N tick；取消要关闭条件持续 M tick；M、N 与 [GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4 预算公式**共用参数面**，不得两套阈值。 |
| 2 | **承诺（minDuration）** | 项激活后 minDuration 内不可取消（唯一例外：P0 冲突——生存永远赢）；期限内复核**只记录不动作**。**minDuration 必须由承诺对象的自然周期推导**：战争波次项 ≥ 一个完整波次周期（集结+推进+战后核验，红队 A3）；远矿车道 ≥ 车道自举周期；殖民 ≥ 自举五阶段的关键路径时长。禁止拍脑袋定值；具体数值待首次实测（research/06 §12 待验证项，A4 期回填）。 |
| 3 | **重建冷却（re-entry cooldown）** | 同目标（同幂等键前缀）的 failed/cancelled 项，冷却期内不得重建（TI abandon 计数先例；warBlacklist 是永久级，重建冷却是可恢复级——两档并存）。远矿恢复必须**分批节流**（每 N tick 恢复一条车道或按 CPU 余量逐条解锁，红队 A2：防恢复风暴二次降级）。 |

补充防线：**取消成本显式化**——复核决策只看未来边际，沉没成本记录进遥测但不参与判定
（防「投多了不忍心撤」的反向僵化）。红队元结论（A2/A3/A10）：自愈与自适应机制本身
是振荡源，故任何自动切换都带承诺期与预期状态核对。

### 4.1 规划失败模式表（复核器必须内置的防线）

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| 规划振荡（replan thrashing） | Agenda 反复创建/取消（远矿开了停、停了开） | §4 三防线全文 |
| 计划过期失效 | 承诺基于过期 intel（目标房已被占） | 复核只信新鲜 intel（TTL/置信度）；取消条件显式列 intel 失效（stale/inferred 禁当 fact） |
| 承诺不足（短视） | 无中期承诺→殖民地永远建不完 | **AgendaItem 是 P2 发展工作的唯一通道**：跨 10^3 tick 的工作必须立项，禁止用每 tick 规则硬扛 |
| 承诺过度（僵化） | 预算枯竭仍不肯撤 | cancelConditions 必含 budget 关闭条件；deadline 强制到期 |
| 每 tick 重规划复发 | 有人往推导层加「前瞻」 | §6 禁止清单；寻路是唯一序列求解例外且已限频 |
| cron 化发展工作 | 把建造/扩张写成固定时间表 | scheduled 仅限维护类（§2 表末行） |
| Agenda 项泄漏 | 已死项（目标消失/房失守）残留预算 | 低频复核对账：非 active 项限期清理（两阶段删除） |
| 里程碑验收作弊 | 复核读到虚假完成（车道「建成」但 hauler 从未跑通） | 验收条件用行为证据（净流量、任务完成数），不用结构存在性 |

## 5. 规划 CPU 预算合同

| 条款 | 内容 |
| --- | --- |
| 低频复核 | Agenda 复核成本分摊到每 tick **<0.05 CPU**（research/07 §9）；**单次复核设成本上限**，超限则按项分片延后到下一复核窗（复核本身可分 tick，不挤占执行预算）。 |
| 每 tick 推导 | 查表级：缺口＝派生索引上的整数比较；无搜索；排序不超过 O(活跃请求)。 |
| 预算硬禁止 | 每 tick PathFinder 级搜索进入规划路径；任何「规划器缓存全图」形态（Memory 税）。 |
| 看门狗联动 | 四档看门狗（Healthy/Guarded/Conserve/Recovery，见 [CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md)）下 Agenda 管理器的分级行为：**Healthy**＝正常分频复核；**Guarded**＝暂停新建、复核降频；**Conserve**＝冻结新建与常规复核，仅评估取消条件并优雅收缩（远矿最先）；**Recovery**＝同 Conserve 且收缩优先级最高——每 tick 推导的 P0 部分照常运行（规划系统天然配合看门狗，research/07 §6.4/§10.5）。 |
| Memory 写入 | AgendaItem 存 Memory（O(active agendas) 固定小节）；PostureDecision 仅切换 tick 写；复核决策记录走遥测管线低频聚合进 segment。 |

## 6. 禁止清单（负结果引用）

以下形态已被研究层以负结果否决（research/07 §11），**进入实现即违规**：

| # | 禁止形态 | 否决依据 |
| --- | --- | --- |
| 1 | 每 tick 效用竞拍（对所有候选重算效用分取最高） | CPU + 决策抖动双杀；TooAngel 平滑门控达成同等裁决（research/06 §11；ADR-003） |
| 2 | 在线学习（RL/进化在线更新策略或 posture 表） | 无安全 eval 环境，训练事故＝帝国损失；posture 表是人可审计的自治契约底线（research/06 §11） |
| 3 | GOAP/HTN/STRIPS 式运行时序列求解器 | 对抗世界序列脆断 + 重规划 CPU + 社区零先例（research/07 §4 负结果）；bonzAI 证明手工分解已够 |
| 4 | 未验证目标搜索（前瞻式「试探索目标可行性」的每 tick 重解） | 在最付不起 CPU 的时刻形成紧张→重规划→更紧张的正反馈（research/07 §11 MPC 条）；寻路是唯一序列求解例外且已限频 |
| 5 | cron 式发展时间表 | 发展由态势驱动；RCL 相变点依赖实测而非固定 tick（research/07 §11） |
| 6 | Agenda 永久承诺（无 deadline/cancelConditions） | 僵化 + 预算泄漏（research/07 §11） |
