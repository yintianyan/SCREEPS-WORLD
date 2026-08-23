# P3_A2_CONTRACT_REVIEW — Phase 3 开工前合同审查

> 日期：2026-08-23。基线：HEAD=8728521（dev，工作树干净）。
> 方法：先读合同、后考古代码；本文只登记「Architecture ↔ 现有实现 ↔ P3 要求」的
> 一致性结论与裁决，不承载设计细节（设计归 REQUEST_POOL_DESIGN / ENERGY_ACCOUNTING_MODEL）。

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| 合同充分性 | **充分**。三指标与请求池均已有冻结定义，无需新造概念或新 ADR 定义指标 |
| 三指标命名 | 已冻结：**净流 net flow / 储备 reserve / 风险缓冲 risk buffer**（ECONOMY_ARCHITECTURE §3）。任务书所述「能量收支三指标」即此，不另立名称 |
| 最大缺口 | ① 无 Economy 系统（`computeEconomy` 未落地）；② 无请求池完整版（租约/TTL/防超卖/空载观测全缺，`src/` 中「请求池」零命中）；③ 储备口径漏 link 能量 |
| 需 ADR 事项 | 无结构性冲突需修订冻结契约；两条口径差异走设计文档裁决（§4 C6/C7） |
| 进入 P3 | **GO**（前置项：P2 死亡螺旋已由 A1 批次收口——e2e-006 11k tick 长稳入库） |

## 1. 任务书文件清单 ↔ 仓库实况映射

任务书开列的 7 份必读合同中 4 份在仓库不存在。按 AGENTS.md「不为已实现功能新增平行
doc」规则，建立如下映射并以此为准，不创建同名替身文档：

| 任务书名称 | 仓库实况 | 效力替代物 |
| --- | --- | --- |
| ARCHITECTURE_FREEZE.md | ✅ 存在（36 蓝图收敛点 + R0–R9 修订） | 直接效力 |
| ENGINEERING_BLUEPRINT.md | ✅ 存在（§5 现状登记直接点名本阶段落点缺口） | 直接效力 |
| IMPLEMENTATION_PHASES.md | ✅ 存在（§2 Phase 3 行＝本阶段任务书） | 直接效力 |
| PHASE_3A_FINAL_REPORT.md | ❌ 不存在 | P2/A1 收口证据散落于：git 8728521 提交、TECH_DEBT_LEDGER「Phase-2/P2 批次登记」A1 证据台账、tests/e2e（a1-bootstrap-tower、rcl1-suite）、PHASE_2_FINAL_REPORT §12 GO 附前置项 |
| M1_VALIDATION_REPORT.md | ❌ 不存在 | 同上；M1 门槛判据＝IMPLEMENTATION_PHASES §3 A1 行（空 Memory 自举无人工指令），证据链已在台账登记 |
| RCL1_ECONOMIC_MODEL.md | ❌ 不存在 | 经济模型唯一合同＝ECONOMY_ARCHITECTURE.md（冻结） |
| RCL1_ECONOMIC_INVARIANTS.md | ❌ 不存在 | 不变量散落于 ECONOMY §2 消费优先序/§3 核算条款/§6 红线 + LOGISTICS §7 红线 |

> 命名差异说明：任务书的「Phase 2 Runtime Foundation / Phase 3A RCL1 经济」对应仓库
> 重执行序号的 P1（运行时基座）/P2（单房生存闭环）；本阶段「P3 产能闭环 → A2 前半」
> 与 IMPLEMENTATION_PHASES §2 Phase 3 行逐字一致，以冻结文件为权威序号。

## 2. 现有实现考古结论（Storage / Economy / Request / Demand / Task）

### 2.1 注册表实况

bootstrap.ts 注册 **24 System + 19 Role**。冻结模块集为 15 个（SYSTEM_BOUNDARIES §1，
R9 上限 15+3）：其中 lab-system / factory-manager / war-planner / power-* /
terminal-manager / expansion-manager 等 10+ 个为旧帝国时期设施在册（重执行前存量），
超出冻结集——属**存量合规债**，非本阶段引入；处置见 §4 C4。

### 2.2 Demand / Request / Task 现状

| 事实 | 证据 |
| --- | --- |
| 「请求池」在 `src/` 中**零命中**（grep 无结果） | 全仓搜索 |
| 现有分配＝每 tick 重建的瞬时任务池：kind ∈ {fill, haul, build, upgrade}，priority 0–2，maxWorkers，同优先级曼哈顿距离择近 | domain/assignment/service.ts `buildRoomTasks` |
| 跨 tick 连续性仅靠 creep.memory.assignment 租约（leaseUntil + revision 校验），无 TTL 到期回收语义、无心跳、无源侧防超卖 | service.ts `validateAssignmentRules` |
| 紧急抢占为边沿触发 + 20 tick 冷却（TD-018） | systems/assignment-service.ts |
| haul 任务＝每个含能 container 一个（maxWorkers=1）；hauler 永不从 storage 取能（TD-013）；storage→sink 归 distributor | service.ts haul 段注释 |
| Spawn 侧人口计入 spawning 与已提交请求；但**孵化能量排产预留未见独立核算** | spawn-manager.ts collectSpawningSummaries |
| Tower 补给现由 hauler fill 链承担（塔置顶），未入请求池 | targeting.ts L146/L193/L375 |
| 技术债台账 D1 明确排期：「请求池系统侧落点随 P3 请求池完整版一并归位」 | TECH_DEBT_LEDGER P1 批次 D1 |

### 2.3 Economy 现状

| 事实 | 证据 |
| --- | --- |
| `src/systems/economy.ts` **不存在**；`computeEconomy` 未实现 | 文件树 + BLUEPRINT §5 #4 |
| 相位状态机已存在且带双维度迟滞：ColonyPhase {bootstrap, growth, crisis, recovery, steady} → ColonyState {normal, bootstrap, recovery, defense}；drainScore（偿付）+ liquidityScore（流动性）非对称步长防振荡 | domain/economy/phase.ts |
| 总储备口径 = spawn/ext + containers + storage + terminal + **creep 携带**；**漏 link 能量** | systems/room-state.ts §1 段 |
| reserveDelta 仅原始单 tick 差分；**无 EMA 净流、无收入/消费分解、无风险缓冲（断供耐受 tick 数）** | room-state.ts + phase.ts |
| economyPressure 梯度（0–1 clamp）已供建造门禁/P2 缩放消费 | room-state.ts §5.5 |
| storageNearFull / controllerDowngradeRisk / claimSecure 护栏齐备 | room-state.ts §6+ |
| Income/Consumption 计数器不存在（遥测 L1 无能量流目录项） | 实现时核对 config/metrics 目录 |

### 2.4 Storage / RCL4 现状

- storage site 已是建造最高优先之一（priority=1、maxWorkers=2、强制释放非 storage
  builder——RCL4 无 storage 判定已三处接入：assignment/construction/layout）。
- hauler 收集链（container→storage 首选 sink）与 distributor 分发泵（storage→sink）
  已成型，含「泵断供兜底」（无存活 distributor 时跳过囤积）。
- 缺口：storage 水位尚未进入任何**资源可用量核算**（Available/Reserved 分离不存在；
  spawn/demand 只看 energyAvailable 快照字段），即任务书 §7「不能只是更大容器」的要求
  尚未满足——这是 P3 的核心增量而非推倒重来。

## 3. 一致性矩阵（P3 要求 ↔ 合同锚点 ↔ 现状）

| P3 要求 | 合同锚点 | 现状 | 差距动作（P3 内） |
| --- | --- | --- | --- |
| 三指标核算 | ECONOMY §3；SYSTEM_BOUNDARIES §1.5；STATE_OWNERSHIP §3.6 | 无 Economy 系统；仅原始 delta | 新建 `src/systems/economy.ts` + domain 纯函数；EMA 窗口 + 分频错峰；Memory 瘦快照 |
| Income 口径 | ECONOMY §2.1-1（产能×效率系数，禁名义产能直入） | 无 | 双层模型：L1 实测计数器（对账真相）+ 效率系数估计（门控入账），实测校准系数（§4 C7） |
| Consumption 五类分解 | ECONOMY §2.1-3、§2.2 优先序 | 无 | spawn/build/upgrade/tower/repair 实测计数；资源移动不计消费 |
| Net Flow 独立核算 | ECONOMY §3（≠库存水位） | 无 | Income−Consumption EMA，房级口径 |
| Accounting 对账恒等式 | 任务书 §14（Start+Income−Consumption±Transfers=End） | 无 | L1 计数器 + 窗口对账 + 漂移告警；ENERGY_ACCOUNTING_MODEL 落档 |
| 请求池完整版 | LOGISTICS §1–§2、§5；SYSTEM_BOUNDARIES §1.6（Public API: submitRequest/claimLease；请求池瞬时不持久化） | 每 tick 重建 haul/fill 任务，无 TTL/心跳/防超卖/空载观测 | 按 §4 C3 语义补齐：五源供给登记、请求五字段、租约（TTL+心跳+并发上限 1）、源侧扣租约防超卖、aging 提级、expired 回执 |
| Dedup/Aggregation | 任务书 §23–24；EMPIRE_SYSTEM_MODEL（Demand 每 tick 重导出） | 天然去重（确定性 key 每 tick 再生成） | 保持瞬时语义；聚合由池内合并承担，不建持久队列 |
| Reservation | ECONOMY §2.1-7（三类显式预留从预算扣除）；FREEZE R1（预留类写入必须在⑥分配相位同相完成） | spawn 排产预留缺失；tower 围城储备缺失 | 最小实现①spawn 排产预留 + 请求租约预留；②tower 围城储备挂 siege 态；③战争基金不在单房 P3 范围 |
| RCL4 Storage 切换 | ECONOMY §2.1-4（三容器分层水位）；LOGISTICS §2.1-9 | 结构优先级/收集/分发已备；无水位区间制与可用量核算 | 水位阈值区间进 CONFIG；ResourceAccount 可用量=水位−租约预留 |
| Storage-aware Spawn | 任务书 §31；ECONOMY §2.3 预算公式 | spawn 只看快照 energyAvailable | 经 EconomyState API 取可用量与净流，不直读 storage 内部 |
| tower 补给并入物流 | IMPLEMENTATION_PHASES P3 交付物 | hauler fill 链直补 | tower 补弹改为请求池一等请求（P0） |
| 断链 fallback | LOGISTICS §3 四级只降不跳 | 部分（container 兜底/泵断供兜底散落） | 请求池收缩（L2）随空载率/延迟指标落地；L4 挂 ColonyPhase 已有 crisis 通道 |
| 物流三指标 | LOGISTICS §4（空载率/延迟/断链数） | 无 | 随请求池一并产出，低频聚合进遥测 segment |
| 经济状态机 | 任务书 §33「以现有架构为准」 | ColonyPhase 五态已冻结于实现 | **不新增状态枚举**；生产态判定由三指标派生回答 |

## 4. 冲突与裁决记录

### C1 任务书文件缺失 → 映射裁决（无需 ADR）
见 §1。四份缺失文件的**意图**全部被冻结契约覆盖；按 AGENTS 规则 3 不建平行文档。
本阶段产出的 docs/phase3/* 是实施记录层（允许），不复制合同内容。

### C2 生产状态枚举 → 不新增（遵循任务书自身约束）
ColonyPhase 即现有经济状态机；STARVING/SURVIVING/STABLE/PRODUCTIVE/SATURATED 的
判定问题改由三指标数值回答并在指标文档给出映射表。若后续出现真实消费者需要离散
生产态，再走 ADR。

### C3 任务书 Request 生命周期 ↔ 冻结 Demand 瞬时语义（设计层调和，无需 ADR）
冻结语义：Demand 每 tick 重导出不持久化（STATE_OWNERSHIP §1.4）；Task 六态
offered→claimed→succeeded/failed/expired/cancelled。任务书 §21 生命周期的映射：
Created/Validated/Queued/Prioritized＝tick 内池重建与排序；Allocated/Dispatched＝
租约认领（跨 tick 由执行者 assignment + 心跳承载）；Fulfilled/Expired/Cancelled/
Failed＝六态终局。**不引入第五种概念、不建持久请求表**（任务书 §17 自身禁令）。
dedup＝确定性 key（如 `haul:<room>:<containerId>`）重建幂等；expiry＝TTL 字段 +
producer 停止再生成；refresh＝下一 tick 重导出自然刷新数量。

### C4 R9 System 上限 vs 现状 24 在册（存量债登记，不阻塞）
economy.ts 与请求池系统侧文件是冻结 15 模块的**既定落点**（BLUEPRINT §2 表 1.5/1.6 行），
不属于 R9 所指「新 System」。当前超编部分为重执行前存量，登记 TECH_DEBT_LEDGER，
治理窗口在后续 Phase 收敛，P3 不扩不减（范围纪律）。

### C5 请求池系统侧命名与 assignment 归位（D1 一并执行）
蓝图落点写法为「src/systems/（请求池 / link-system / terminal-manager）」。
裁决：新建 `src/systems/logistics.ts` 作为模块 1.6 的 P0 请求池载体
（link-system / terminal-manager 为其既有兄弟落点）；assignment-service 的迁移
（D1）随本批次一并归位：纯函数留/进 domain/assignment，System 侧薄壳保留驱动。
最终结构在 REQUEST_POOL_DESIGN.md 定稿。

### C6 储备口径差异（设计文档裁决，无需 ADR）
现状总储备（含 spawn/ext/creep 携带）服务相位机，**保留**；合同三指标的「储备」=
storage+link+terminal 折算水位（Reservation 扣除基数），另列计算并补上 link 漏项。
两个量各司其职，命名在 ENERGY_ACCOUNTING_MODEL 区分（roomReserve vs contractReserve）。

### C7 Income 双层口径（设计文档裁决，无需 ADR）
合同 Income 入账＝产能×效率系数（估计值，禁名义直入，系数按实测校准）；任务书 §14
对账恒等式需要**实测**流。裁决双层：L1 实测计数器（harvest 实收/transfer 实发/
各类实耗）是对账与漂移检测的唯一真相；效率系数估计值仅供 G 门控/预算（EMA 后），
其校准义务正好由实测净流履行——两处合同条款由此闭合，不改合同。

## 5. 验收门槛与本阶段测试映射

| 冻结验收门槛（IMPLEMENTATION_PHASES P3 行） | 本阶段落实 |
| --- | --- |
| 净流连续 5 万 tick 为正 | 本地 mockup 后台 soak 50k＋ 10k 档 CI 可复跑证据 |
| hauler 空载率 ＜ 阈值 | 物流三指标随请求池实现，阈值进 CONFIG.tuning 待 soak 校准 |
| 低能量注入限定 tick 内恢复（S4/S5） | 复用/扩展 tests/e2e 07-energy-crisis 与 rcl1-suite 注入族 |
| 任务书附加：10k ticks 无 Accounting 漂移 | ENERGY_ACCOUNTING_MODEL 对账断言进 long-stability 场景 |

场景编号沿用现有体系（rcl1-suite T 系列 / e2e 00–08 / S1–S11 注入矩阵），
P3-001…P3-012 映射表在 P3_FAILURE_SCENARIOS.md 登记，不另造平行编号。

## 6. P3 执行边界（重申）

- 只动：`src/systems/economy.ts`（新）、`src/systems/logistics.ts`（新）、
  `src/domain/economy/`、`src/domain/assignment/`、动作层 L1 计数埋点、
  CONFIG（economy/logistics/metrics 表）、room-state 储备口径修正、相关测试。
- 不动：remote/war/market/lab/factory/expansion 等存量系统行为；Kernel；布局模板。
- Memory 变更走 schemaVersion 迁移（当前 v36 → v37，类型/默认值/迁移三件套同步）。
