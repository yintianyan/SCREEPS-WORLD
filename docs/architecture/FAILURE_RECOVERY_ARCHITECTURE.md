# FAILURE_RECOVERY_ARCHITECTURE · 失败恢复架构（冻结蓝图）

> 本文件是**失败检测与恢复契约**：六步恢复链、故障域分级与五大类映射、九类具体
> 故障的处置合同、级联断闸与自愈系统自身的失败防线以此为准。结构性修订必须走
> ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15。依据：
> research/22（闭环 / 故障域三级 / 有界六动作六禁令 / 熔断）、research/24（34 条
> E/P/X/M/A 失败模式与级联路径）、research/21 §10.4（TAKEOVER 触发清单）、
> research/30（红队 A2/A5/A6/A10）；与 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md)
> §4–§7、[ARCHITECTURE_VALIDATION.md](ARCHITECTURE_VALIDATION.md) Scenario G–J
> 场景对齐，注入矩阵归 [TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §6。

## 1. 六步恢复链合同

research/22 §10.1 的五阶段（Monitor→Anomaly→Diagnosis→Recovery→Verification）
在冻结层细化为**六步合同**：Detect 吸收 Monitor＋Anomaly 的检测语义，Escalate 把
「顶层失败→TAKEOVER」从 Verification 中独立成步——细化关系而非矛盾（同构于
[TICK_LIFECYCLE.md](TICK_LIFECYCLE.md) §3 的八步→十相位）。执行载体是
Self-Healing（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.15，P1，分档对账）。

| 步 | 合同（必须） | 禁止 | 依据 |
| --- | --- | --- | --- |
| ① Detect 检测 | 仅三种合法信号源：遥测阈值（L1/L2 平滑值）、错误签名（safeRun 捕获）、心跳丢失（creep 心跳 / 租约 TTL+heartbeat）；外加对账差（预期态 vs 实际态）。**立案判据＝持续窗口**（连续 N tick 越界），单 tick 毛刺忽略 | 自愈系统独立扫描帝国找问题（重复 Sense 反模式） | research/22 §10.1/§11 |
| ② Classify 定级 | 双轴：故障域三级（creep→房间→帝国，升级条件见 §1.1）×五大类（E 经济 / P 规划 / X 执行 / M 帝国 / A 架构，research/24 §8 全表） | 单个 creep 故障直接触发帝国级重排 | research/22 §10.2；research/24 §3 |
| ③ Diagnose 诊断 | **签名查表**：签名＝错误码＋故障域＋频次窗口 → 处置表（dispatch table，只读数据）。未登记签名走**默认安全动作**（冷却＋记录＋告警） | 推理引擎；对未登记签名做任何「猜测性修复」 | research/22 §10.1/§11 |
| ④ Recover 恢复 | 仅限有界六动作（§1.2），全部带冷却、每 tick 配额；删除类动作两阶段（标记 `deprecated` 观察 N tick→物理删除）；动作一律经对应 owner 公开接口执行 | 绕过 owner 直改状态；无上限重试 | research/22 §10.3；[RUNTIME_API_DESIGN.md](RUNTIME_API_DESIGN.md) §6 |
| ⑤ Verify 核验 | 对照**预期状态**核对成功判据；核验带超时，超时＝「未确认恢复」按升级处理；合理停滞白名单见表 §1.3 | 无判据的「发射后不管」；对白名单状态触发恢复动作 | research/22 §10.1；红队 A10 |
| ⑥ Escalate 升级 | 升级路径：creep 级→房间级→帝国级→TAKEOVER 人工接管信号；TAKEOVER 触发清单与 research/21 §10.4 逐条一致（§1.4）。人工只保留发布与灾难接管两条边界（AGENT.md） | 自愈系统做出任何六禁令动作后代偿掩盖 | research/22 §10.2；research/21 §10.4 |

### 1.1 故障域分级与升级条件

| 域 | 作用范围 | 典型恢复动作 | 升级条件 |
| --- | --- | --- | --- |
| creep 级 | 单个 creep | 卡位重算路径、弃任务回池、park 让位、标记 recycle | 同房间同类故障 ≥3 例 → 房间级 |
| 房间级 | 单房间 | 重算房间任务分配、重建房间缓存、暂停该房 P2、重启房间 FSM | 影响跨房链路（远矿供给 / 战争支援）或持续 M tick 未恢复 → 帝国级（M 与围城时间尺度耦合，初值走 soak 标定，research/22 §12.2） |
| 帝国级 | 全局 | 看门狗降档、冻结扩张、熔断 pixel、全局缓存惰性重建、从 Memory 重建 posture | 触及六禁令或以下 TAKEOVER 清单 → 人工接管 |

### 1.2 有界六动作与六禁令（越权即 TAKEOVER）

| # | 有界动作（允许的全部） | # | 不可越权（永远不做） |
| --- | --- | --- | --- |
| 1 | 清理孤儿状态（死 creep 残留、无主任务、过期租约；两阶段删除） | 1 | 修改自身代码 / 绕过发布流程 |
| 2 | 重建缓存（heap 全量重建、CostMatrix 失效重算；惰性、预算内） | 2 | 修改 Memory schema 或绕过迁移器改结构 |
| 3 | 重分配任务（回池、换执行者、降优先级） | 3 | 拆除 / 重建永久建筑、取消已建成核心结构（建造域独立仲裁，冲突只标 `blocked`） |
| 4 | 降级策略（切换看门狗档位、暂停 P2/P3、冻结扩张） | 4 | 发动或扩大战争（进攻授权只在 war-planner 止损链内） |
| 5 | 生成 replacement（向 SpawnManager 提交 P0 请求，不绕过队列） | 5 | 清空 storage/terminal 等战略储备 |
| 6 | 隔离坏任务 / 坏目标（标记 blacklist 冷却，不再分配） | 6 | 无上限重试任何昂贵操作（一切重试有配额与冷却） |

### 1.3 合理停滞白名单（Verify 步免误诊清单，红队 A10）

| 白名单状态 | 依据 |
| --- | --- |
| RCL8＋GCL 满＋市场饱和的「指标停滞」＝合法后期稳态，命中预期即通过；能量消化交给显式 sink 目标集 | 红队 A10；[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §4 |
| 孵化潮期间的 hauler 空载率短峰 ≠ 物流故障 | [LOGISTICS_ARCHITECTURE.md](LOGISTICS_ARCHITECTURE.md) §4 防误诊 |
| war 波次 build 相位 attacker 归建待命（hold）＝预期停滞 | [MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md) |
| 迁移期间新旧字段并存（先写新验证后删旧的中间态） | [MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) §3 |
| AgendaItem minDuration 承诺期内「无进展」复核只记录不动作 | [PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §4 防线 2 |

### 1.4 TAKEOVER 触发清单（与 research/21 §10.4 逐条一致）

Recovery 档持续超阈值（KERNEL §5）；关键房间 controller 进入降级（downgrade）倒计时且防御持续失败；Memory 迁移反复失败；战争止损链失效（spawned 超限仍不收摊）；同一异常每 tick 复发且冷却无效。TAKEOVER 输出为 P0 伴生，不因降级静默（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.14）。

## 2. 九类具体故障处置合同

任务书 §27 清单的逐条合同。MTTR（Mean Time To Recovery，平均恢复时间）目标全部是
**初值**（SPECULATION 级），由注入实验（[TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md)
§6）与 A5 soak 标定（research/21 §12.4：官服只能测检测延迟，完整 MTTR 在私服测）。

| # | 故障（类别 / 风险） | 检测指标 | 处置合同 | MTTR 目标（初值） | 失败告警 |
| --- | --- | --- | --- | --- | --- |
| 1 | Stuck creep 卡位（X1 / R-06） | N tick 位移不变（卡位计数，CreepState） | 强制重算路径（触发寻路重算）→ 绕行 / 推开 → 仍卡则弃任务回池＋park 让位；同房同类 ≥3 例升房间级 | ≤3–10 tick | 卡位计数持续超阈 → WARN |
| 2 | Dead task 死任务（X 族租约泄漏） | 租约 TTL 到期 / 持有者心跳丢失 | 自动回池重挂（六态 expired）；孤儿任务两阶段删除；回执请求方（不静默丢单） | ≤TTL（到期当 tick 回收） | 任务年龄分布持续超阈 → WARN（饥饿信号） |
| 3 | Spawn starvation 孵化饥饿（X3 / R-07） | 队列深度、P0 车道延迟、孵化饥饿计数、人口断档 | 内核级紧急直通（≥200 能量 `[WORK,CARRY,MOVE]`，KERNEL §6，P0 永不熔断）；body 降档出单；黑名单冷却到期复评（SP-2 审查）；deadline 过期自动撤销 | 灾后直通＝下一 tick；常规恢复 ≤ 孵化时长＋到位路程 | 直通触发即记越权原因进遥测；spawn 持续忙 → WARN |
| 4 | Logistics deadlock 物流死锁（X5 / R-02 前兆） | 断链数、空载率、请求年龄分位数 | fallback 四级链 L1–L4（只降不跳、恢复滞回，[LOGISTICS_ARCHITECTURE.md](LOGISTICS_ARCHITECTURE.md) §3）；请求 aging 强制提级（仅 P2/P3，Recovery 档不生效）；租约回收重挂 | 每级步进 ≤ 数十 tick；低能量注入限定 tick 内恢复净流为正（S4） | 高优请求年龄超阈 → WARN；围城期 tower 补给断供 → WARN 立即 |
| 5 | Planning loop 规划振荡（P1/P3 / R-04） | posture 切换频率遥测、Agenda 创建-取消频率 | 防振荡三防线：滞回 / minDuration（由承诺对象自然周期推导：war ≥ 一个波次周期）/ 重建冷却＋恢复分批节流（红队 A2/A3），全文引用 [PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §4 | minDuration 承诺期内零切换；确诊振荡 → ≤1 个复核窗内参数面复评 | 切换频率超阈 → WARN；调参震荡走 R-18 护栏 |
| 6 | CPU overload（E1 / R-01，头号死因） | bucket 连续下滑、看门狗档位分布、超预算计数 | 降级牺牲序 P3→P2→P1→P0 永不动（KERNEL §2.2；[CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md) §2 档位×频带矩阵）；降级立即、恢复滞回；Recovery 最小生存集（P0＋能量自给）；能量 <300 每 tick 自回 1 为数学兜底 | 降级＝当 tick 立即；恢复走滞回 N tick；E1 完整 MTTR 由 S8 注入标定 | 习惯性贴 tickLimit 运行 → WARN；Recovery 持续超阈 → TAKEOVER |
| 7 | Memory corruption（A1/A5 / R-10） | schemaVersion 不匹配、Memory 体积环比增长、迁移失败计数 | 迁移回退语义：旧版代码遇更高版本只读、不写、输出告警；迁移中断下 tick 从 Memory 游标续跑；heap 全部从 Memory＋Game 惰性重建；**禁止**把 heap 抢救进 Memory（[MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) §3–§4） | 迁移重试＝下一 tick；global reset 首 tick 预算内惰性重建 | 体积环比超阈 → WARN；迁移反复失败 → TAKEOVER |
| 8 | Room failure 房间失效（E2/E4 / R-02/R-08 级联） | 净流转负、spawn idle、威胁分级持续 siege、controller downgrade 剩余计时 | phase 降级评估（仅失守 / 失效重置语境——[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.2「只升不降」与 [LOGISTICS_ARCHITECTURE.md](LOGISTICS_ARCHITECTURE.md) §3 L4 在失效场景统一）；帝国接管资源：援助预算＝f(支援方净流) 上限（断 M1 雪崩）、异常房停止抽离优先注入；恢复期分批节流（红队 A2） | 房间级对账 100 tick 级；围城恢复走 stabilizing 相位 | downgrade 倒计时且防御持续失败 → TAKEOVER |
| 9 | Operation failure 行动失败（P4/M6 / R-16） | AgendaItem 终态复核（里程碑＝行为证据） | 失败降级表自动执行、无人工重议（[EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §5：claim 反占→取消回候选池扣安全分；spawn 未落地→降级 remote 或放弃；bootstrap 净流负超止损→撤离保 GCL；Guarded 以下→冻结车道）；同目标冷却期内禁止重建 | 期限内自动降级（deadline＋宽限期） | 自举超时 → WARN＋失败计数；降级 / 放弃事件进遥测 |

## 3. 级联断闸合同（research/24 §10.1 的架构化）

```text
X1 卡位 / X5 物流断链 ──未检测──→ E2 能量饥饿 ──补 creep 风暴──→ E1 CPU 死亡循环 ──→ 帝国死亡
M1 援助雪崩：E4 围城 ──援助无上限──→ 多房连环贫血（E3 变体）
A1 Memory 膨胀 ──税增──→ E1；A3 写者越权 ──→ X6 重复提交 ──→ E5/E2
```

| 断闸点 | 断哪条链 | 执行载体 | 依据 |
| --- | --- | --- | --- |
| ① 卡位自愈 | X1→E2 | Execution Runtime 卡位信号＋本契约 §2-1 | research/24 §10.1 |
| ② 能量核算先行 | E2→E1 | Economy 三指标（A2 门槛前置——经济核算先于一切发展决策） | [ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §3；research/29 R-02 |
| ③ 援助预算上限 | M1 雪崩 | Empire 调拨门控（援助预算＝f(支援方净流)；被援房独立降级） | [ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §1.2 |
| ④ 存储准入审查 | A1→E1 | 三级存储准入＋低频清理钩子＋体积遥测 | [MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) §1/§6 |
| ⑤ 幂等键 | X6→E5/E2 | 唯一写者＋幂等 key＋成交核验三件套 | [DATA_FLOW.md](DATA_FLOW.md) §4（红队 A12） |
| ⑥ 降级链 | E1→帝国死亡 | 四档看门狗＋P0 永不动＋能量自回兜底 | KERNEL §3；research/29 R-01 |

不可逆失败（controller 丢失、nuke 命中、respawn）没有恢复层——只有预防层与
TAKEOVER 信号（research/24 §10.2）。

## 4. 自愈系统自身的失败防线（research/22 §8 合同化）

| 自愈失败模式 | 症状 | 防线（必须） |
| --- | --- | --- |
| 修复风暴 | 清理→重分配→再清理循环 | 恢复动作带冷却与每 tick 配额；同类动作单位窗口限量 |
| 误诊 | 正常任务被反复取消重建 | 异常判定基于持续窗口（连续 N tick），非单 tick 毛刺 |
| 自愈越权 | 自动拆建 / 撤防御 / 改 schema | §1.2 六禁令硬边界，触及即 TAKEOVER |
| 熔断后无人唤醒 | 系统永久冷却 | 冷却有限时长 50–200 tick＋到期必须复评；P0 永不冷却（KERNEL §4） |
| 验证死等 | 停在「验证中」 | 验证带超时；超时按未确认恢复升级 |
| 孤儿误删活状态 | 任务被删但 creep 还在执行 | 删除类动作一律两阶段 |
| 停滞阈值错杀 | 正常慢发展被判 trapped | 多条件与门（TooAngel 三重条件式）＋§1.3 白名单＋切换写遥测 |

红队元结论（A2/A3/A10）：**自愈与自适应机制本身是振荡源**——任何自动切换都带
承诺期（minDuration）与预期状态核对（research/30 §4）。

## 5. 对账分档与 CPU 预算

| 条款 | 内容 |
| --- | --- |
| 分档对账 | creep 级每 tick（顺带）/ 任务级每 N tick / 房间级每 100 tick / 帝国级每 1000 tick（research/22 §9） |
| 预算 | 自愈总预算 <1% limit；监测全部寄生既有遥测与对账，禁止独立扫描（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.15） |
| 清理通道 | 孤儿清理走低频维护钩子（每 100 tick，两阶段删除），经注册表进内核——R9 例外与「3 钩子即 registry 化」触发器适用（KERNEL §8） |
| 停滞检测元机制 | 帝国级最慢层：多条件与门（GCL 解锁＞实际房数＋增长低于地板＋持续 ≥5 万 tick）→ 处置是**策略升级**而非修复，依次换扩张判据 / 放宽选房 / 主动升 GCL，每次切换写遥测可回退（research/22 §10.6） |

## 6. 一致性声明

本文件与 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.15（Self-Healing 八项）、
[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §4–§7（熔断 / 直通 / 崩溃恢复）、
[MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) §3（迁移回退）、
[LOGISTICS_ARCHITECTURE.md](LOGISTICS_ARCHITECTURE.md) §3–§5（fallback / aging）、
[SPAWN_ARCHITECTURE.md](SPAWN_ARCHITECTURE.md) §4–§5（治理通道 / 失败语义）、
[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §4（防振荡）、
[EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §5（降级表）、
[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §4（sink 白名单）、
[TEST_ARCHITECTURE.md](TEST_ARCHITECTURE.md) §6（S 矩阵）同一时刻必须一致；任何
一处修订必须同步其余各处并走 ADR。
