# 19 · 调度器与内核：Screeps 需要 OS 式 Kernel 吗

> 研究文档 · 结论等级：**设计裁决**（本文是全套架构中「运行时形态」的裁决依据）。
> 结论先行：**轻量内核**——固定顺序调度 + 错误隔离 + Memory 迁移 + CPU 看门狗；
> 明确否决完整 process/PID/sleep/抢占式内核。CPU 机制以
> [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §3 为准。

## 1. Problem

Screeps 主循环天然是单线程确定性 tick，但「帝国有 30 个系统、200 个 creep、10 个房间」
之后立刻面对 OS 式问题：谁先执行？错了怎么办？CPU 不够时砍谁？低优先级会不会永远
饿死？社区分成两个阵营：OS 内核派（Quorum：kernel/scheduler/process/qos）与平铺主循
环派（The International / KasamiBot / TooAngel / bonzAI：一个大 loop 按固定顺序调用
各 Manager）。本文用战绩与源码证据裁决哪条路正确，以及正确到什么程度。

## 2. Research Questions

- Screeps 的调度问题与传统 OS 调度有何本质差异？
- 显式进程内核（Quorum/hivemind）与平铺循环（TI 等）各自的战绩与代价？
- 需要哪些调度语义（优先级/节奏/预算/熔断/防饿死/紧急车道）？
- 哪些 OS 概念在 Screeps 里是纯税？

## 3. Existing Solutions（问题域分析）

Screeps 调度与传统 OS 的差异（机制推导）：

| 维度 | 传统 OS | Screeps | 推论 |
| --- | --- | --- | --- |
| 并发 | 抢占式多进程 | 单线程顺序执行，无中断 | 抢占机制无用武之地 |
| 配额 | CPU 时间片 | 每 tick `Game.cpu.limit` + bucket（上限 10,000，单 tick 最多透支 500） | 预算单位是「本 tick 留多少」，不是时间片 |
| 进程数 | 千级动态 | 数十系统级 + creep 级 | 注册表足够，无需 PID 命名空间 |
| 崩溃语义 | 进程隔离 | 一个异常逃逸 = 整 tick 报废（所有 creep 停摆） | **错误隔离是最刚需的「内核」职能** |
| 状态 | 虚拟内存 | 三级存储（见 [18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md)） | 迁移是启动路径的一部分 |
| 实时性 | 软实时 | 硬逐 tick（错过 = creep 不动） | 紧急车道必须显式建模 |

因此 Screeps 需要的「内核」职能收敛为四个：**调度顺序、错误隔离、资源看门狗、
状态迁移**。缺任何一个都会死；多出来的都是税。

## 4. Screeps Community Practice

- **Quorum**（tedivm 共建，JS，163★）：唯一完整 OS 内核式实现——kernel/scheduler/
  process/performance 分层，QoS 分级调度 programs（city/empire/meta），配套 sos_lib
  （vram/segment/profiler/stormtracker）。它同时是**第一个自我管理项目**：GitConsensus
  投票合并 PR、CI 每日自动部署、内存/segment/钱包全公开（quorum.tedivm.com）。
  ——本次核查 GitHub 仓库 README 与 Reddit 发布帖，CONFIRMED。
  关键事实：**2021 年停止更新**。生前 GCL 达 45 亿控制点级（远超多数 bot）。
- **hivemind**（Mirroar，TS，2026-07 仍活跃）：process/dispatcher 协作式调度，进程可
  休眠按需唤醒；证明「进程抽象 + 长期维护」可以共存，但它的进程是轻量协作体而非
  OS 内核（无抢占、无独立地址空间）。
- **平铺阵营**：The International（GCL 18.2 亿）、TooAngel（十年无人值守）、
  KasamiBot、bonzAI 均为主循环 + Manager 固定顺序调用，无进程抽象。
- 社区教程（screeps-es6-starter 等）普遍从「一个大 loop」起步；官方示例亦然。

## 5. Existing Bot Analysis（裁决性对比）

| 阵营 | 代表 | 战绩 | 复杂度信号 | 裁决含义 |
| --- | --- | --- | --- | --- |
| OS 内核 | Quorum | GCL 45 亿（顶级） | 内核分层 + sos_lib 全家桶；**停更于 2021** | 证明上限存在，也证明维护成本高——内核本身不产生游戏价值，玩家动力衰减后整套 OS 成弃子 |
| 轻量进程 | hivemind | 活跃维护中 | process/dispatcher，刻意限武 | 协作式进程的最小可行形态；复杂度可控 |
| 平铺 | TI（18.2 亿）、TooAngel（十年存活）、KasamiBot | **战绩最好的进攻型 bot 多在平铺阵营** | 无调度框架，直接 Manager 顺序调用 | 战绩与调度复杂度不相关甚至负相关 |

**裁决**：进程内核不是战绩的必要条件（平铺阵营更高），也不是充分条件（Quorum 停更）。
但 Quorum/hivemind 证明的**语义**（cadence/budget/qos/熔断）是对的——错的只是实现
载体。把这些语义压进「固定顺序注册表 + 看门狗」，即得**轻量内核**：语义收益全收，
结构税全免。

## 6. Advantages（轻量内核）

1. **错误隔离**：`safeRun` 包裹每个系统与 creep，单点异常不中断整 tick——这是平铺
   阵营靠自觉 try/catch 难以保证的纪律，内核化后成为默认。
2. **预算裁决**：看门狗按 `Game.cpu.limit` 比例化软硬上限，是「预算驱动自治」的
   执行机构（扩张/收缩的系统级开关，见 [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md)）。
3. **组合根**：System 注册表让「新增系统不改内核」成立，边界清晰可测试。
4. **确定性可回归**：固定顺序 = 同输入同行为，场景注入测试可复现。

## 7. Disadvantages（诚实代价）

- 固定顺序牺牲动态性：不能像真 OS 那样按运行负载重排——只能靠「系统内部自降频」
  补偿（见 §10.4）。
- 注册表是约定而非类型强制：注册顺序即同优先级执行顺序，写 bootstrap 的人必须理解
  顺序依赖（例如 spawn-manager 必须晚于人口普查）。
- 看门狗引入滞回状态机，测试面增加（四档 × 升降档路径）。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 异常逃逸出 loop | 整 tick 报废，持续则帝国停摆 | safeRun 全覆盖 + 循环体最外层兜底 catch |
| 连续失败的系统每 tick 重试 | 浪费 CPU 且刷屏 | 非关键系统连续失败 3 次进 50–200 tick 冷却（P0 永不冷却）+ 相同错误 25 tick 限流 |
| bucket 干涸 | 后续 tick 被迫深度降级 | 四档看门狗提前降档（软上限触发 Guarded 而非等硬上限） |
| 低优先级系统永远排不上 | 建造/扩张长期饥饿，帝国僵化 | 饥饿老化：跳过次数超阈值 → 优先级临时提升一档（见 §10.5） |
| 降档后卡在低档不恢复 | 长期低能运行 | 恢复滞回：必须在健康档稳定 N tick 才逐档回升 |
| 注册顺序被随手调整 | 隐性数据依赖断裂（读到上 tick 的旧状态） | bootstrap 为唯一组合根 + 顺序注释 + 集成测试锁定执行序 |
| 内核感知业务 | 内核膨胀回 Quorum 老路 | 内核只维护运行秩序，不 import 业务模块（钩子超 3 个必须 registry 化） |

## 9. CPU Implications

- 调度器自身开销必须近零：注册表是启动期构建的静态数组，tick 内只是遍历调用；
  禁止每 tick 重建闭包/排序。
- 看门狗采样 `Game.cpu.getUsed()` 的次数每 tick 限制在档位点（2–4 次），采样本身
  不是免费 API。
- 冷却/熔断状态存 Memory（小枚举 + 计数），不存 heap（防 reset 后冷却失效反复撞墙）。
- 详细的预算分配模型与三档工作节奏见 [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md)。

## 10. Recommended Design

### 10.1 内核职能（全部，且仅此四项）

```text
Kernel = {
  1. 调度：System 注册表固定顺序执行（P0→P3，同优先级按注册序）
  2. 隔离：safeRun(system)——错误捕获、限流记录、连续失败冷却
  3. 预算：四档看门狗（Healthy/Guarded/Conserve/Recovery）
  4. 状态：Memory 版本迁移 + 低频维护钩子注册表
}
```

内核不感知任何角色、经济策略或房间语义。新增业务 = 注册新 System，不改内核。

### 10.2 优先级语义（P0–P3 = 降级牺牲序）

| 档 | 语义 | 典型系统 | 降级时行为 |
| --- | --- | --- | --- |
| P0 生存 | 缺它帝国立刻死 | 错误隔离本身、spawn（灾后恢复）、基础采集/物流、防御应答 | **永不跳过、永不冷却** |
| P1 稳定 | 缺它帝国慢性失血 | 人口普查、任务分配、tower 补给、维修 | Conserve 档降频（每 2–5 tick） |
| P2 发展 | 缺它帝国停滞 | 建造、远矿、扩张评估、布局 | Guarded 档即降频，Conserve 档暂停 |
| P3 增长 | 锦上添花 | 市场、tuning、遥测聚合、pixel 决策 | Guarded 档即暂停 |

P 序是「降级牺牲序」而非「重要度排名」——P0 的量永远最小，预算大头在 P1。

### 10.3 四档看门狗

| 档 | 进入条件（示例比例，运行时按 limit 比例化） | 行为 |
| --- | --- | --- |
| Healthy | bucket 充裕 + 每 tick 用量 < 软上限 | 全系统全频运行 |
| Guarded | bucket 下降越过软线 或 用量连续超软上限 | P3 暂停、P2 降频、寻路限频收紧一档 |
| Conserve | bucket 逼近硬线 | 只保 P0 + P1 降频 + 移动复用缓存路径 |
| Recovery | bucket 触底 / 前一 tick 超时被切断 | 最小生存集（P0 + 能量自给）+ 停一切中长程工作 |

铁律：**降级立即生效（本 tick 内可裁剪），恢复需滞回（健康档稳定 N tick 才升一档）**。
所有阈值 = `Game.cpu.limit × 系数`，禁止写死账户数字。

### 10.4 节奏（cadence）：不是所有系统每 tick 跑

每个 System 声明节奏，判据见 [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md) §3：
- **每 tick**：防御应答、spawn 队列消化、交通仲裁（tick 末统一签发移动）；
- **每 N tick**：人口普查（N=1–3）、建造规划（N=10–50）、扩张评估（N=100+）、
  遥测聚合（N=10–100）；
- **事件触发**：结构损毁→维修任务、controller 升级→布局推进、敌情→防御状态机。

### 10.5 防饿死与紧急车道

- 饥饿老化：被跳过计数随 tick 增长；超阈值后该系统获得一次「必跑」标记（在当前
  预算允许的最高档内执行）。适用于 P2/P3——防止「永远在降级、永远不发展」的僵死。
- 紧急车道：预定义的防御应答与灾后 spawn 恢复路径可以越过 P2/P3 预算直接执行
  （TooAngel 式「保命优先于一切」），但必须记录越权原因进遥测（见
  [21_OBSERVABILITY.md](21_OBSERVABILITY.md)）。

### 10.6 与其他子系统的接口

- 内核产出「本 tick 预算档位」给所有系统（只读）；
- 系统通过 safeRun 的返回/记录暴露错误签名给 self-healing（见
  [22_SELF_HEALING.md](22_SELF_HEALING.md)）；
- 内核不直接调 `spawnCreep`/`createConstructionSite`——写权留在对应唯一 Manager。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| **完整 OS 内核**（process/PID/sleep/消息传递/QoS 动态调度，Quorum 式） | (1) 抢占在单线程 tick 里不存在，进程抽象纯属结构税；(2) 每个系统走调度器分发的 CPU 开销（上下文对象、队列操作）在 Screeps 尺度不可忽略；(3) Quorum 停更证明维护成本压垮热情；(4) 平铺阵营战绩更好 |
| 每 tick 效用竞拍式调度（系统报价购买 CPU） | 决策抖动 + 拍卖本身 CPU 成本；TooAngel 用三个平滑指标达到同等资源裁决（见 [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md)） |
| 完全平铺、无隔离无看门狗（裸 TI 式） | 单异常毁整 tick 的风险在自治契约下不可接受；Quorum 证明的语义（cadence/budget/熔断）必须以某种形式存在 |
| 动态优先级（每 tick 重算系统优先级） | 破坏确定性可测试性；固定牺牲序 + 饥饿老化已覆盖需求 |
| 内核直接挂业务钩子（如 pruneDeadCreepCache 直连） | 已知技术债形态：钩子超 3 个必须 registry 化，防止内核感知业务 |

## 12. Open Questions

1. 恢复滞回的 N 值与各档阈值系数需要 soak 数据标定（开局按保守值，tuning 引擎
   上线后自适应）——依赖 [21_OBSERVABILITY.md](21_OBSERVABILITY.md) 的遥测。
2. 饥饿老化的「必跑」标记在 Recovery 档是否也应生效？当前裁决：不生效（保命优先），
   但要监控 Recovery 档持续时间，超阈值升级为人工接管信号。
3. 多房间规模进一步扩大（GCL 10+）时，固定顺序注册表是否需要按房间分片调度？
   平铺阵营在这个规模仍然存活（TI 18.2 亿），暂无分片必要，但保持开放。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://github.com/ScreepsQuorum/screeps-quorum + https://www.reddit.com/r/screeps/comments/710p9n/quorum_a_screeps_social_experiment_in_bot/ + https://www.gitconsensus.com/ | 源码/社区 | OS 内核式调度 + 自我管理（GitConsensus 投票合并）+ 2021 停更（2026-08-22 核查） | CONFIRMED |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source | 源码 | 平铺 Manager 主循环、GCL 18.2 亿、migration.ts | CONFIRMED |
| https://github.com/TooAngel/screeps + http://tooangel.github.io/screeps/doc/Design.html | 源码/文档 | 平铺 brain_*/role_* 结构十年无人值守（2026-08-22 核查 Design 页） | CONFIRMED |
| https://github.com/Mirroar/hivemind | 源码 | process/dispatcher 协作调度、2026-07 活跃 | CONFIRMED |
| [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §3 | 本套件事实基准 | limit/bucket/tickLimit/pixel 机制 | CONFIRMED |
| screeps-grandmaster-perspective/references/empire-architecture.md（Scheduler 约束节） | 领域经验 | 「不要为 OS 感先实现复杂 Kernel；先实现可测的 budget/cadence/priority/恢复」 | LIKELY（专家经验，与本文证据一致） |
