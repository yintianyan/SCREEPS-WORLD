# 22 · 自愈：故障闭环、有界恢复与熔断

> 研究文档 · 结论等级：**设计裁决**。
> 核心立场：自愈 ≠ try/catch。社区经验明确警告「只增加 try/catch 不等于
> self-healing；必须有诊断、隔离、重试上限和恢复动作」。本文定义完整的
> Monitor→Anomaly→Diagnosis→Recovery→Verification 闭环及其权力边界。
> 关联：[19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md)（熔断/冷却的运行时载体）、
> [21_OBSERVABILITY.md](21_OBSERVABILITY.md)（异常检测的数据面）、
> [18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md)（global reset 恢复）。

## 1. Problem

无人值守帝国每天经历大量「设计时没想到」的状态：creep 死在半路、任务目标消失、
Memory 结构过旧、heap 突然清空、房间被拆、同名 creep 换代。这些不是 bug 而是常态
输入。自愈系统的职责是让帝国在**这些常态故障下连续运行**，并把超出自愈边界的情形
转化为明确的人工接管信号——而不是「自作主张执行不可逆操作」。

## 2. Research Questions

- 自愈闭环各阶段的职责与数据流是什么？
- 恢复动作的授权边界（有界清单 vs 不可越权清单）如何划定？
- 故障域如何分级（creep/房间/帝国）？
- global reset、长期停滞、熔断器三个经典问题的设计答案？

## 3. Existing Solutions（问题分类学）

Screeps 帝国的常态故障可分为四族（综合 bot 源码与社区 issue 考古）：

| 故障族 | 例 | 自愈难度 |
| --- | --- | --- |
| 执行体损失 | creep 老化/被杀/卡死、关键角色全灭 | 低：replacement 生成即可（spawn 队列 P0） |
| 状态腐化 | 孤儿任务、过期租约、Memory 脏字段、heap 丢失 | 中：检测靠对账，修复靠清理/重建 |
| 资源枯竭 | 零能量、bucket 干涸、spawn 忙死锁 | 中：降级策略 + 兜底机制（房间能量 <300 每 tick 自回 1） |
| 环境突变 | 房间失守、远矿被占、敌情过期、市场订单被取消 | 高：需要战略层重规划，非局部动作可解 |

社区既有解法形态：Overmind 的 Task 系统带租约与过期（creep 死亡/目标消失时任务
自动回池）；hivemind 的 player-intel 把「威胁记忆」独立于视野持久化（敌情过期问题
的结构性缓解）；glitchassassin/screeps-cache 专门解决「跨 global reset 的数据分层」。

## 4. Screeps Community Practice

- **try/catch 陷阱共识**：捕获异常只是隔离，不是恢复——没有后续诊断与重试上限的
  catch 会把故障变成慢性泄漏（社区反复强调，见 community-lessons）。
- **卡位自愈惯例**：creep 反复撞墙/房间边缘来回震荡是常见病症（TooAngel issue #157
  即 carry 卡边界案例）；惯例解法是「N tick 位移不变 → 强制重算路径 / 绕行 /
  `move` 原语直接推开」。
- **防御状态机**：`normal → alert → siege → recovery → stabilizing → normal` 式
  policy 状态机（community-lessons），把「被打了怎么办」从散落 if/else 变成带转换
  条件与退出条件的显式模型。
- **global reset 应对**：官方 caching-overview + 论坛讨论确认 reset 由 GC 内存压力
  与代码推送触发、频率不可预测（IVM 下偶见每小时多次）；共识是「heap 必须可从
  Memory + Game 全量重建」。测试侧社区还有强制 reset 的技巧（改 loop 引用名）。

## 5. Existing Bot Analysis

| Bot | 自愈机制 | 评价 |
| --- | --- | --- |
| **TooAngel** | **trapped 检测 + 元策略**：GCL≥3 仅 1 房 + 5 万 tick 无进展 → 判定被囚 → 自动切换升级策略打破僵局（Design.md，2026-08-22 核查 CONFIRMED） | **「长期停滞→战略升级」元机制的孤例**：不修复具体故障，而是检测「修复失败本身」。十年无人值守的存活证明该层有效且必要 |
| **Overmind** | Task 租约与自动失效；directive 条件挂载（条件消失自动卸载行为） | 执行体损失族的标准答案 |
| **hivemind** | player-intel 持久威胁记忆（跨视野跨 reset） | 状态腐化族的「记忆与缓存分离」答案 |
| **Quorum** | QoS + 熔断式调度（performance 模块监控进程） | 熔断器先例（但载体是进程内核，见 19 号文档裁决） |
| **bonzAI** | Guru 观察者类 | 「观察与执行分离」的结构雏形，但无验证闭环 |

**收敛**：成熟 bot 的自愈 = **租约/过期（执行体）+ 对账清理（状态）+ 状态机（环境）+
停滞检测（元层）**，四件缺一不可，且没有任何一家让自愈逻辑做「越权」操作（如自动
改代码、自动拆家重建）。

## 6. Advantages（闭环式自愈的收益）

1. **故障→信号→动作→验证**全链路可观测：每次自愈都是一个可审计事件（写入遥测，
   支撑 [21_OBSERVABILITY.md](21_OBSERVABILITY.md) 的 MTTR/自愈成功率指标）。
2. **有界授权**杜绝「修复动作比故障更致命」（经典事故：自愈逻辑误判后疯狂拆建、
   循环 spawn 拖垮经济）。
3. **分级故障域**让恢复动作作用在最小范围内，避免局部故障触发帝国级重排。

## 7. Disadvantages

- 验证阶段（Verification）需要额外观测与等待窗口，自愈延迟变长——对快速恶化故障
  （围城）必须允许跳过验证直接升级。
- 元层停滞检测（5 万 tick 级窗口）本身无法测试短期效果，只能靠 soak。
- 每个恢复动作都要定义「成功判据」，前期设计成本高。

## 8. Failure Modes（自愈系统自身的故障）

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| 修复风暴（自愈动作互相触发） | 清理→重分配→再清理循环 | 恢复动作带冷却与每 tick 配额；同类恢复动作单位窗口限量 |
| 误诊（把正常当异常） | 好端端的任务被反复取消重建 | 异常判定基于持续窗口（连续 N tick）而非单 tick 毛刺 |
| 自愈越权（自动拆建筑/撤防御/改 Memory schema） | 不可逆损失 | 不可越权清单（§10.3）硬边界 |
| 熔断后无人唤醒 | 系统永久冷却 | 冷却有限时长（50–200 tick）+ P0 永不冷却；冷却到期必须复评而非默认关闭 |
| 验证死等 | 恢复完成但系统停在「验证中」 | 验证带超时；超时按「未确认恢复」升级处理 |
| 孤儿检测误删活状态 | 任务被删但 creep 还在执行 | 删除类动作一律先标 `deprecated` 观察 N tick 再物理删（两阶段） |
| 停滞检测阈值错杀 | 正常慢发展被判定 trapped | 元策略切换必须同时满足多条件（TooAngel 用 GCL≥3 + 仅 1 房 + 5 万 tick 三重条件）且切换本身写遥测 |

## 9. CPU Implications

- 自愈监测全部**寄生在已有遥测与对账上**（任务年龄、熔断计数、人口普查本来就采），
  不为自愈单独扫描——额外预算目标 <1% limit。
- 对账频率分档：creep 级每 tick（顺带）、任务级每 N tick、房间级每 100 tick、
  帝国级每 1000 tick。
- 清理/重建动作走低频维护钩子（与 [18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md)
  §10.4 共用通道），大动作分 tick 执行。

## 10. Recommended Design

### 10.1 闭环五阶段

```text
Monitor（监测）：寄生遥测 + 对账（预期态 vs 实际态）
  ↓
Anomaly（异常）：持续窗口判定（连续 N tick 越界才立案，单 tick 毛刺忽略）
  ↓
Diagnosis（诊断）：按故障域与签名分类，查处置表得到候选恢复动作
  ↓
Recovery（恢复）：有界动作执行（带冷却、配额、两阶段删除）
  ↓
Verification（验证）：成功判据 + 超时；未确认 → 升级下一故障域重试；顶层失败 → TAKEOVER 信号
```

诊断不是推理引擎：是「签名 → 处置表」的查表（签名 = 错误码 + 故障域 + 频次窗口）。
未登记签名的异常走默认安全动作（冷却 + 记录 + 告警），绝不走「猜测性修复」。

### 10.2 故障域分级（恢复的作用域）

| 域 | 作用范围 | 典型恢复动作 | 升级条件 |
| --- | --- | --- | --- |
| **creep 级** | 单个 creep | 卡位重算路径、弃任务回池、park 让路、标记 recycle | 同房间同类故障 ≥3 例 → 房间级 |
| **房间级** | 单房间 | 重算房间任务分配、重建房间缓存、暂停该房 P2、重启房间 FSM | 影响跨房链路（远矿供给/战争支援）或持续 M tick 未恢复 → 帝国级 |
| **帝国级** | 全局 | 看门狗降档、冻结扩张、熔断 pixel、全局缓存重建、重启战略层纯函数（从 Memory 重建 posture） | 触及不可越权清单 → TAKEOVER |

### 10.3 有界动作清单与不可越权清单

**有界（允许自愈做的全部）**：

1. 清理孤儿状态（死 creep 残留、无主任务、过期租约）——两阶段删除；
2. 重建缓存（heap 全量重建、CostMatrix 失效重算）；
3. 重分配任务（回池、换执行者、降优先级）；
4. 降级策略（切换看门狗档位、暂停 P2/P3、冻结扩张）；
5. 生成 replacement（向 spawn 队列提交 P0 请求）；
6. 隔离坏任务/坏目标（标记 blacklist 冷却，不再分配）。

**不可越权（自愈永远不做）**：

1. 修改自身代码 / 绕过发布流程（见 [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md)）；
2. 修改 Memory schema 或跳过迁移规范直接改结构；
3. 拆除/重建永久建筑、取消已建成核心结构（建造域有独立仲裁，不归自愈管）；
4. 发动或扩大战争（进攻授权只在 war-planner 止损链内）；
5. 清空 storage/terminal 等战略储备；
6. 无上限重试任何昂贵操作（一切重试有配额与冷却）。

### 10.4 global reset 恢复（专项设计）

- **前提**：生存链路只依赖 Memory + Game 对象（[18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md)），
  reset 后第一 tick 帝国可运行（慢）——这是设计不变量，不是优化目标。
- 恢复动作：reset 检测（heap 哨兵变量消失）→ 惰性重建（消费者先读先建，见
  [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md) §10.3）→ 遥测记
  `globalResetCount` 与重建耗时。
- 绝不做的：把 heap 状态「抢救」进 Memory（那是把缓存升级成持久层，违反分层）。

### 10.5 熔断器设计（与 19 号内核共用实现）

- 触发：同一签名连续失败 3 次 → 冷却 50–200 tick（按 P 级定时长；P0 永不冷却，
  只降频重试）。
- 冷却期内：该系统跳过执行、错误限流记录（相同错误每 25 tick 记一次防刷屏）。
- 冷却到期：必须复评（再跑一次并观察），禁止「到期默认恢复」掩盖间歇故障。
- 熔断事件与恢复结果全部进遥测（[21_OBSERVABILITY.md](21_OBSERVABILITY.md)
  自愈域指标）。

### 10.6 停滞检测元机制（TooAngel 式）

- 检测（帝国级，最慢层）：多维条件与门——如「GCL 已解锁更多房间数 + 实际房间数
  长期低于解锁值 + 净能量/控制点增长低于地板 + 持续 ≥5 万 tick」。
- 处置不是修复而是**策略升级**：依次尝试「换扩张判据 → 放宽选房条件 → 主动升级
  GCL 策略」；每次切换写遥测并可回退。
- 定位：它是「自愈失效检测器」——当低层闭环全部正常但帝国长期不增长时，唯一能
  打破僵局的层。窗口与阈值取保守值（TooAngel 三重条件式设计），宁可慢不可误杀。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 万能 try/catch + 默认继续 | 社区公认反模式：隔离≠恢复，故障慢性化 |
| 猜测性修复（未登记签名也试着修） | 误诊风险无界；查表 + 默认安全动作（冷却+告警）是可审计下界 |
| 自愈可拆建筑「腾地方」 | 不可逆 + 与建造域仲裁冲突；布局冲突只标 blocked 是既定裁决 |
| 每 tick 全量对账 | CPU 不可承受；分档对账 + 事件触发已覆盖（§9） |
| 把 heap 状态持久化进 Memory 以「抗 reset」 | 违反存储分层（18 号文档）；reset 恢复的正确答案是重建不是备份 |
| 自愈系统独立扫描帝国找问题 | 重复 Sense（反模式警报）；监测寄生在既有遥测/普查上 |

## 12. Open Questions

1. 处置表的初始覆盖度：先覆盖 autonomy-acceptance 场景矩阵的注入场景（global reset、
   schema 旧版、低 bucket、关键角色全灭、房间失守等），未覆盖签名靠默认安全动作
   过渡——需 soak 数据排优先级。
2. 房间级→帝国级的升级阈值 M：与战争/围城时间尺度耦合（downgrade 计时 2 万–20 万
   tick 是硬上限参考），需要场景注入实验标定。
3. 停滞检测的「增长地板」定义：控制点/能量/GCL 利用率哪个作主指标？TooAngel 未
   公开全部细节，需自行 soak 调参。
4. 自愈动作的验证判据自动生成（而非每个手写）——远期方向，当前手写判据够用。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| http://tooangel.github.io/screeps/doc/Design.html | 源码文档 | trapped 场景检测（被囚判定）+ 停滞→策略升级元机制（2026-08-22 核查） | CONFIRMED |
| https://github.com/TooAngel/screeps/issues/157 | issue | carry 房间边缘卡位案例（卡位自愈的现实需求） | CONFIRMED |
| https://docs.screeps.com/contributed/caching-overview.html + https://screeps.com/forum/topic/2185/force-a-global-reset + https://screeps.com/forum/topic/2163/ivm-heap-usage-game-objects/51 | 官方+论坛 | global reset 由 GC/推送触发、频率不可预测（IVM 下可每小时多次）；可强制 reset 用于测试（2026-08-22 核查） | CONFIRMED |
| https://github.com/glitchassassin/screeps-cache | 源码 | 跨 reset 数据分层的社区专项方案 | CONFIRMED |
| https://github.com/Mirroar/hivemind | 源码 | player-intel 持久威胁记忆 | CONFIRMED |
| screeps-grandmaster-perspective/references/community-lessons.md | 领域经验 | 「try/catch≠self-healing」共识、防御状态机、异常一等公民 | LIKELY（专家经验，与 bot 证据一致） |
| screeps-grandmaster-perspective/references/empire-architecture.md | 领域经验 | 有界恢复动作清单与安全行为清单（本文 §10.3/§10.4 骨架来源） | LIKELY |
| [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §6 | 本套件事实基准 | downgrade 计时/能量兜底等恢复相关机制 | CONFIRMED |
