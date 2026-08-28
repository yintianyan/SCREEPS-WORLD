# CPU_EXECUTION_MODEL · CPU 执行模型（冻结蓝图）

> 本文件是 **CPU 执行契约**：六档执行节奏、看门狗与节奏联动、每房预算公式、
> intent 税、寻路预算、pixel 政策与 global reset 后首 tick 透支余量以此为准。
> 结构性修订必须走 ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15，
> 不得静默修改。依据：research/20（核心）、research/19 §9–10、research/03 §3、
> research/21 §9、红队 A1/A5/A8。与 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md)
> 的分工：内核管「谁在何时跑」（P0–P3 牺牲序与看门狗），本文管「跑多勤、花多少」
> （频带与预算）；与 [TICK_LIFECYCLE.md](TICK_LIFECYCLE.md) 的分工：本文定义节奏与
> 预算的静态合同，相位序见彼文。

## 1. 六档执行节奏合同

research/20 §10.1 的三档判据（每 tick / 每 N tick / 事件触发）在本冻结层细化为
**六档频带**：判据轴不变（变化时间尺度与不可逆性），仅把「每 N tick」按 N 的
数量级切成高频 / 中频 / 低频三带，并显式收录 Emergency 通道。

**节奏判据（唯一裁决轴，N ≈ 变化时间尺度 ÷ 4，采样定理式裕量）**：
仅当「晚 N tick 执行无不可逆损失」成立时，才允许离开 Every Tick 档；任何成员
的 N 值偏离 `尺度÷4` 时必须在其模块八项登记中写明理由（research/20 §10.1）。

| 频带 | 判据（变化时间尺度） | 成员系统（合同成员集） | 实现形态 |
| --- | --- | --- | --- |
| **Every Tick**（每 tick） | 决策窗口 = 1 tick（晚了即不可逆损失），或成本近零 | 感知增量（RoomSnapshot 每房每 tick 一次）、P0 执行链（RolePolicy 非移动动作）、交通仲裁（tick 末按房）、spawn 队列消化、防御状态机步进与塔应答、租约 TTL 检查（顺带）、L1 计数器累加 | 每 tick 直跑 |
| **High Frequency**（高频，每 2–10 tick） | 尺度 ~10–40 tick；晚了有可逆损失 | 人口 census（N=1–3）、威胁分级评估、Economy 增量核算（错峰低段）、遥测 L2 采样（N=1–10，research/21 §10.1）、请求池 aging 复核 | `(Game.time + hash) % N === 0` 错峰散列 |
| **Medium Frequency**（中频，每 20–100 tick） | 尺度 ~80–400 tick | RoomState 全量归一化、Economy 全量核算、Agenda 复核（域特化初值带 50–200，[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §2）、terminal 均衡、建造规划（N=10–50，本带低段） | 同上；单次执行设成本上限，超限分片顺延 |
| **Low Frequency**（低频，每 200–1000+ tick） | 尺度 ≥10³ tick，或属维护 / 档案类 | 战略态势全量（EmpireSituation 全量轮）、扩张评估（100+）、布局适配、intel TTL 清扫、遥测 L3 持久化、自愈房间级（100）/ 帝国级（1000）对账、Memory 维护钩子（100 tick，KERNEL §8） | 同上；允许按 cursor 跨 tick 分片 |
| **Event Driven**（事件驱动＝**分频触发器**） | 工作只与离散事件相关，与时间无关 | 水位越阈→本 tick 顺便复核均衡、结构损毁→维修任务、controller 升级→布局推进、敌情→防御状态机、观察命中→intel 写入 | **内联 cadence 判断**（调和 §6：系统在自身执行相位里检查触发条件）；**禁止** EventBus 中枢与订阅 / 发布形态——事件只影响「做多少 / 是否立项」，永远不影响「谁在何时运行」 |
| **Emergency**（紧急通道） | 灾后 / 防御窗口，迟滞即人口断档 | 内核级紧急直通（≥200 能量立即 `[WORK,CARRY,MOVE]`，KERNEL §6）；降级链激活（进入 Recovery 档） | 零延迟旁越一切频带；**仅此两条合法路径**，每次触发记越权原因进遥测（红队 A5） |

频带合同条款：

1. 每个系统的频带与 N 值**必须**登记在 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md)
   §1 的 Tick Frequency 行；未登记频带的系统默认 Every Tick 并接受预算审查。
2. 错峰偏移 = 房间 / 系统 hash，**禁止**全部成员共用偏移 0（防「第 0 tick 齐跑」
   脉冲，research/20 §10.1）。
3. 频带升降级由看门狗档位裁决（§2），系统自身不得因「觉得自己重要」私自提频；
   提频唯一合法通道是饥饿老化「必跑」标记（KERNEL §5）。

## 2. 四档看门狗与节奏联动

看门狗档位定义、进入条件与升降档铁律（降级立即、恢复滞回、阈值按
`Game.cpu.limit` 比例化）归 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §3；
本节冻结**档位 × 频带**的允许节奏矩阵：

| 看门狗档 | Every Tick | 高频 | 中频 | 低频 | 事件触发器 | 紧急通道 |
| --- | --- | --- | --- | --- | --- | --- |
| **Healthy** | 全部 | 全部 | 全部 | 全部 | 全部域 | 常备 |
| **Guarded** | P0 全保 + P1 全频 | 降频一档（砍高频项：遥测采样、Economy 低段） | P2 降频、**暂停一切新建类**（Agenda 立项、扩张评估） | **全停**（P3 停） | 仅生存 / 稳定域触发器 | 常备 |
| **Conserve** | 仅 P0 | 仅生存类（census 降频至 2–5） | **停** | **停** | 仅生存域 | 常备 |
| **Recovery** | 仅 P0 + 能量自给 | **停** | **停** | **停** | **停** | **唯一内容**；饥饿老化不生效，持续超阈升级 TAKEOVER（KERNEL §5） |

> 术语注记：本矩阵的看门狗档 = `CpuTier` 四档枚举（`healthy/guarded/conserve/recovery`，
> 阈值唯一真相源 `CONFIG.cpu.tiers`）。Emergency Survival Mode 是 Recovery 档内的
> 紧急再收缩安全状态，**不是第五档 CpuTier**，不在本矩阵内占行；定义见
> [RELEASE_GATE_AND_ROLLBACK.md](../implementation/RELEASE_GATE_AND_ROLLBACK.md) §5.2。

联动合同条款：

1. 「砍高频 / 砍中频」指该频带成员整体跳过或降档运行，**不是**延期重算——
   P0 语义成员（KERNEL §2.2）在任何档位都不离开 Every Tick 档。
2. Guarded 档起寻路限频收紧一档（§5）；Conserve 档移动只复用缓存路径。
3. 本矩阵与 [PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §5 看门狗联动行、
   [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) 各模块 CPU Profile 行同一时刻必须一致。

## 3. 每房 CPU 预算公式合同

```text
L  = Game.cpu.limit                     # 比例化基准，禁止写死账户数字（KERNEL §3.1）
U  = L × f(bucketRatio)                 # 目标稳态用量；f 按看门狗档取值（Healthy≈0.8、Guarded≈0.6…）
F  = 瘦 Memory 税 + 内核调度税 + 遥测采集税   # 固定开销，量级目标 L 的 5–10%
C  = creep 数 × 0.2                     # intent 税地板（§4），近似不可优化
B  = U − F − C                          # 可分配预算
B 按 P1:P2:P3 ≈ 60:30:10 切分；房间份额按房均复杂度权重：
w_room    = 1 + 远矿数×0.5 + 军事任务×1.5 + 新房(<RCL4)×0.5
roomBudget = B × w_room / Σw
```

**推演表**（公式演示，非承诺值；`f=0.8`、`F=0.1L`、creep 密度 8/房）：

| 规模 | L 示例 | U | C（intent 地板） | B | 房均 B（w=1） | 判读 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 房 | 80 | 64 | 80×0.2=16 | 64−8−16=40 | 4.0 | 富余充足，扩张门控开启方向 |
| 20 房 | 80 | 64 | 160×0.2=32 | 64−8−32=24 | 1.2 | 贴近 Guarded 软线，需压 creep 密度 |
| 20 房（优化：6/房） | 80 | 64 | 120×0.2=24 | 64−8−24=32 | 1.6 | 静态矿工 + link 网的收益显现 |
| 50 房 | 120 | 96 | 400×0.2=80 | 96−12−80=4 | 0.08 | 8/房密度下不可活——必须压至 ~4/房（静态矿工 + link 减 hauler）并关闭扩张门控 |

社区数据点锚定：普通实现 3–5 CPU/房；优化实现下每 10 CPU 富余约可新开 1–2 房
车道（research/20 §5 收敛；research/17 ROI 定价）。

**参数校准声明（合同的一部分）**：`f` 档位系数、`w_room` 权重、`F` 目标占比全部是
**初值**，归 `CONFIG`（单一真相源）管理，由 tuning 引擎按 soak 遥测回填
（research/20 §12；[RESEARCH_SYNTHESIS.md](RESEARCH_SYNTHESIS.md) §5「首个多房 soak
回填」项）。合同冻结的是**公式结构与比例化纪律**，不是这些数字。

## 4. intent 税合同

| 条款 | 内容 |
| --- | --- |
| 事实 | 每个动作类方法（move/attack/harvest/build/repair/…）固定 ≈0.2 CPU，**失败也收费**（research/20 §3，CONFIRMED）。creep 数 × 0.2 是不可优化地板——优化对象只能是税之上的思考成本（寻路 / 扫描 / 决策重算）。 |
| 自检义务 | 一切写动作签发前**必须**自检前置条件：目标在视野内存活、背包有空位 / 有货、目标未满 HP、路径未失效。对墙 move、满血治疗、满 HP 修复均属「白交税」违规。 |
| tower 重复修理禁令 | tower 决策表**禁止**对满 HP 结构重复签发 repair、对满血 creep 签发 heal；同一目标同 tick 去重由 Defense 塔决策表保证（[DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) §4）。 |
| 结构性去重 | 移动 intent 由交通仲裁统一签发（天然去重）；同类动作的多来源签发只允许出现在对应唯一写者内部。 |
| 观测 | noop-intent 比例进 L1 计数器 → L2 聚合（遥测），作为「OK 但无效」税的常驻指标（research/20 §4）。 |

## 5. 寻路预算合同

**三档限频**（PathFinder.search 调用频率的唯一裁决表，research/20 §10.2）：

| 档 | 触发条件 | 行为 |
| --- | --- | --- |
| 全频 | 距目标 >5 格或跨房任务 | 正常 search，本地强制 `maxRooms: 1` |
| 限频 | 距目标 ≤5 格 | 每 N tick 至多一次 search，间隔回放缓存路径（heap，带 created 时间戳） |
| 复用 | 路径未失效（结构版本未变、无卡位） | 只 move 不 search |

配套合同：

1. **两级模式**：跨房移动 = `Game.map.findRoute` 房间级路由（结果缓存 heap）+ 房内
   PathFinder；**禁止**跨房单次 PathFinder（maxRooms 16 的 ops 浪费，research/20 §11）。
2. **CostMatrix 缓存**：按房间缓存；TTL 写在 get 侧——无视野房间 Infinity，恢复视野
   后缩短；结构版本变化立即失效不等 TTL（research/20 §10.3）。
3. **卡位检测**触发强制重算并与 stuck-recovery 自愈联动（research/22）。
4. Guarded 档限频收紧一档（§2）；Conserve 档只复用不搜索。
5. `reusePath` 调大（10–50）允许，但必须配合卡位检测（社区已知副作用，research/20 §4）。

## 6. pixel 政策合同

| 条款 | 内容 |
| --- | --- |
| 唯一策略 | **仅** Healthy 档且 bucket 满额（10,000）时，tick 末空闲自动 `generatePixel()`（research/20 §10.5）。 |
| 熔断条件 | 任何非 Healthy 档、任何 war / 恢复姿态 → **禁止**生成。 |
| 语义 | bucket 是防御与灾后恢复的战略储备，**不是**「不用白不用」的余量；Guarded 及以下一切消费型系统让位于桶回升。 |

## 7. global reset 后首 tick 的 500 bucket 透支余量合同

机制事实：bucket 上限 10,000，单 tick 最多透支 500（tickLimit 相应抬高），
`tickLimit` 永不低于 limit（research/03 §3；research/20 §3）。

| 条款 | 内容 |
| --- | --- |
| 唯一用途 | 该 500 透支余量**仅当**以下两种情形才允许消费：① global reset 后首 tick 的惰性重建峰值（KERNEL §7.1）；② P0 生存执行的当 tick 超支（如灾后直通 + 防御应答同 tick 叠加）。 |
| 禁止 | 用透支余量运行 P1+ 常规工作；把「习惯性贴 tickLimit 运行」当常态（那是看门狗失守的症状，必须触发 WARN）。 |
| 重建纪律 | reset 后首 tick 预留固定重建预算额度，超额度部分按使用顺序惰性顺延（消费者先读先建）；**禁止** tick 1 全量重建风暴（research/20 §10.3；[MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) §4）。 |
| 观测义务 | 每次 reset 记 `globalResetCount` 与重建耗时进遥测（research/18 §12）。 |

## 8. 一致性声明

本文件与 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2–§3（P 序与看门狗）、
[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1 各模块 CPU Profile / Tick Frequency 行、
[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §5（看门狗联动）、
[ARCHITECTURE_VALIDATION.md](ARCHITECTURE_VALIDATION.md) Scenario D/E/J 同一时刻必须
一致；任何一处修订必须同步其余各处并走 ADR。
