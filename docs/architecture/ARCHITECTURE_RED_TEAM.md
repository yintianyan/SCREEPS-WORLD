# ARCHITECTURE_RED_TEAM · 冻结层红队评审

> Phase 1 §31：完成设计后必须主动证明架构「会失败」。攻击向量（任务书清单）：
> 循环依赖 / 状态冲突 / 优先级反转 / Goal 抖动 / 规划振荡 / 死锁 / CPU 爆炸 /
> Memory 爆炸 / Operation 爆炸 / Manager 爆炸 / Agent 爆炸。
> 规则：**修复必须落在具体契约条款**，「未来可以优化」不是答案。
> 与 Phase 0 红队（research/30，攻击架构结论）互补：本文攻击冻结层的**结构**。

## V1 · 循环依赖（Circular Dependency）

**攻击**：Empire 需要 Intelligence 的威胁评估，Intelligence 需要 Empire 的 posture
决定侦察优先级；Logistics 需要 Economy 的预算，Economy 需要 Logistics 的成本。
冻结层必然成环？
**裁决**：不成立——**信息流与控制流分离**是全层设计原则：Intelligence→Empire 是
数据依赖（只读查询），Empire→Intelligence 是参数依赖（posture 作为下次求值输入，
非同 tick 回调）。DEPENDENCY_GRAPH 的允许表按「上游只读下游数据、下游经公开接口
消费上游决策」单向化；同 tick 内不存在 A 调 B、B 又调 A 的路径（管线固定序保证）。
**防线落点**：DEPENDENCY_GRAPH §静态检查六义务（import 方向 lint）+ TICK_LIFECYCLE
十相位的单向执行序。**残余风险**：domain Service 若被两个 System 共享且互相包裹
纯函数会出现文件级环——lint 规则必须含 domain 内部（V1-fix 登记）。

## V2 · 状态冲突（State Conflict）

**攻击**：两个系统同 tick 写同一状态（如 SpawnManager 合并请求时 Econonomy 改
能量预留；两个远矿车道同 tick 写同一母房人口缺口）。
**裁决**：结构性防御成立——STATE_OWNERSHIP 每状态唯一 Owner；同 tick 写冲突在
管线固定序下不可能发生（写者唯一+序固定）。**发现的真缺口**：跨 tick 的读-改-写
竞态（A tick 读预算、tick 末才写预留，B 同 tick 基于旧预算决策）。
**修复条款**（本评审新增，回写 STATE_OWNERSHIP §6）：**一切预留类写入必须在产生
决策的同一相位完成**（⑥分配相位的 Reservation 写入不推迟到 ⑩写回相位）；跨相位
只读快照。此为「半 tick 一致性」合同，红队 V2-fix。

## V3 · 优先级反转（Priority Inversion）

**攻击**：P2 的建造申请占满 spawn 队列，P0 的灾后恢复排队等待（低优先级持有
高优先级所需的资源）。
**裁决**：部分成立风险——车道制只约束排序，不约束**容量占用**。
**修复条款**（回写 SPAWN §2.2）：P0 车道保留容量合同——每 spawn 队列位置中 P0
预留位不被低车道长期占位（低车道请求在 P0 存在等待时让位或降档重排）；叠加紧急
直通（KERNEL §6）双保险。V3-fix。

## V4 · Goal 抖动（Goal Thrashing）

**攻击**：posture 在 peace/fortify 间高频切换，每次切换作废上一态的预算与队列。
**裁决**：已防——滞回窗口+minDuration（GOAL_POLICY_PLAN §3）；war 退出滞回 ≥
波次周期（research/30 A3）。
**残余缺口**：**budget 抖动**（posture 不变但五域预算高频摆动）不受 posture 滞回
保护。**修复条款**（回写 GOAL_POLICY_PLAN §4）：预算变更同样带 EMA 平滑与变更
死区（变化幅度小于死区不生效）；预算快照随 posture 滞回一起冻结。V4-fix。

## V5 · 规划振荡（Planner Oscillation）

**攻击**：AgendaItem 立项→取消→再立项循环（如远矿车道因短期 CPU 波动反复启停）。
**裁决**：已防三防线（滞回/minDuration/重建冷却——PLANNING §4）。
**残余缺口**：**Agenda 间振荡**（A 取消释放的资源立刻被 B 抢走，A 恢复条件满足
时 B 又不让位）。**修复条款**（回写 PLANNING §5）：取消的 AgendaItem 带资源
回购窗口（释放的预算在冷却期内优先保留给原 Agenda 恢复，非立刻并入公共池）。
V5-fix。

## V6 · 死锁（Deadlock）

**攻击**：两房互相等待对方能量援助（A 净流负等 B 的调拨，B 等 A 的 report）；
请求池循环等待（房 1 的 hauler 等房 2 的供给，房 2 的请求等房 1 的 hauler）。
**裁决**：结构性防御成立——帝国仲裁单点裁决调拨（无对等谈判）；请求池匹配是
中央评分非分布式锁。**残余缺口**：AgendaItem 间的资源互等（殖民等战争基金释放，
战争等殖民产能）。**修复条款**（回写 DECISION_AUTHORITY §3）：Agenda 预算互相
依赖必须显式声明（依赖字段），复核时检测等待环——检测到环即上报自愈（隔离
低优先级项强制降级破环）。V6-fix。

## V7 · CPU 爆炸（CPU Explosion）

**攻击**：50 房帝国每 tick 快照 O(rooms)×对象枚举；Agenda 复核撞上 global reset
重建同 tick 发生；traffic 仲裁 O(n²)。
**裁决**：已防——分频+增量（A1）、reset 惰性重建+500 bucket 透支余量（KERNEL §7）、
按房分桶+网格索引（A8）。research/30 六条成立攻击已在冻结前修复。
**残余缺口**：**遥测本身的爆炸**（指标数量随系统增长线性叠加，L1 计数器每 tick
累加成本）。**修复条款**（回写 CPU_EXECUTION_MODEL §遥测）：指标注册表上限合同
（核心指标固定集+扩展指标必须声明单指标成本与聚合档位；Recovery 档仅保留核心集）。
V7-fix。

## V8 · Memory 爆炸（Memory Explosion）

**攻击**：AgendaItem 累积（历史不清理）；IntelState 无 TTL 执行；CreepState 死
creep 残留。
**裁决**：已防——O(rooms) 公式、TTL 分档、孤儿清理责任（MEMORY §5）、迁移删除
旧字段。**残余缺口**：segment 冷数据的历史无限增长（市场历史/intel 归档无总量
预算）。**修复条款**（回写 MEMORY §4）：segment 总量预算与滚动窗口合同（每域
保留窗口外的数据聚合为摘要后删除；100×100KB 分配表带余量警戒线）。V8-fix。

## V9 · Operation 爆炸（Operation Explosion）

**攻击**：AgendaItem 类型无节制增殖（每加一个功能加一种 Operation），复核成本
与状态空间爆炸。
**裁决**：成立风险——类型集当前五种（远矿/扩张/战争/重建/准军事），无收敛机制。
**修复条款**（回写 PLANNING §3）：AgendaItem 类型集是**冻结枚举**——新增类型
必须走 ADR（ARCHITECTURE_FREEZE §15），且必须证明无法用既有类型+参数表达；
同类型实例数上限（如远矿车道 ≤6，research/17 先例）。V9-fix。

## V10 · Manager 爆炸（Manager Explosion）

**攻击**：实现期每遇到新问题就新建 Manager（XXXManager 泛滥），违背 SYSTEM_
BOUNDARIES 的 15 模块合同。
**裁决**：结构性防御成立——命名规约五后缀+删除判据（SYSTEM_BOUNDARIES §2）。
**残余缺口**：System 数量增殖（绕开 Manager 名字但同样碎片化）。
**修复条款**（回写 SYSTEM_BOUNDARIES §2）：System 注册表数量上限合同（15+3 硬
上限；新 System 需 ADR 证明既有系统无法承载其职责且不违反单一职责下限）。
V10-fix。

## V11 · Agent 爆炸（Agent Explosion）

**攻击**：未来开发者把 RolePolicy、Agenda、甚至 hauler 叫做 Agent，概念污染回潮。
**裁决**：已防——Agent 判据+命名禁令（AGENT_ARCHITECTURE）+「Agent 不是运行时
设施」合同。无残余缺口；本向量判定为已闭合（防御条款已具体到 lint 与 review
清单层级）。

## 修复汇总表（全部为具体契约条款，无「未来优化」）

| 向量 | 裁决 | 修复落点 | 性质 |
| --- | --- | --- | --- |
| V1 循环依赖 | 不成立（单向化设计） | DEPENDENCY_GRAPH 静态检查扩展到 domain 内部 | 防线补强 |
| V2 状态冲突 | 部分成立（跨相位竞态） | STATE_OWNERSHIP §6 半 tick 一致性合同 | **新增条款** |
| V3 优先级反转 | 部分成立（容量占用） | SPAWN §2.2 P0 保留容量合同 | **新增条款** |
| V4 Goal 抖动 | budget 抖动缺口 | GOAL_POLICY_PLAN §4 预算死区+快照冻结 | **新增条款** |
| V5 规划振荡 | Agenda 间振荡缺口 | PLANNING §5 资源回购窗口 | **新增条款** |
| V6 死锁 | Agenda 资源互等缺口 | DECISION_AUTHORITY §3 依赖环检测破环 | **新增条款** |
| V7 CPU 爆炸 | 遥测自身爆炸缺口 | CPU_EXECUTION_MODEL 指标注册表上限 | **新增条款** |
| V8 Memory 爆炸 | segment 历史无限增长 | MEMORY §4 总量预算+滚动窗口 | **新增条款** |
| V9 Operation 爆炸 | 成立风险 | PLANNING §3 类型集冻结枚举+实例上限 | **新增条款** |
| V10 Manager 爆炸 | System 增殖缺口 | SYSTEM_BOUNDARIES §2 注册表上限 15+3 | **新增条款** |
| V11 Agent 爆炸 | 不成立（已闭合） | — | 防线确认 |

## 结论

11 向量攻击：2 个不成立（结构性防御已闭合）、9 个部分成立/成立风险——**全部
转化为具体合同条款修复**（V2–V10 的 fix 条款须回写对应契约文档，登记为
ARCHITECTURE_FREEZE §15 修订记录 R1–R9）。冻结层结构在修复后**允许进入冻结**。
元教训与 Phase 0 红队一致且更锐利：**自治系统的每类资源（CPU/Memory/状态/类型/
模块/概念）都必须有显式上限与收敛机制，否则「爆炸」只是时间问题。**
