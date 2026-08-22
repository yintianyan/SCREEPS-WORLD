# 08 · Demand / Task / Directive / Goal：四概念模型与数据流契约

> 研究文档 · 结论等级：**设计裁决**。本文定义四个易混概念（Goal/Directive/Demand/
> Task）的精确语义、关联方式、生命周期与幂等/租约/取消语义，并给出对任务书原模型
> 的修正点。是 [26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md) §4 决策流与
> [05_AGENT_ARCHITECTURE.md](05_AGENT_ARCHITECTURE.md) §10.1 数据流的契约层细化；
> 与 ADR-005（spawn）/ADR-006（物流）直接衔接。

## 1. Problem

Screeps 社区代码里「task」「request」「mission」「goal」常被混用：把持久任务列表
叫 Demand、把战略目标叫 Task、把两者直接连起来（Goal 直接派 Task）。后果是接口
腐烂：角色越权发全局请求、重复孵化、任务泄漏无人回收、需求被静默丢弃。本文把这
四个词钉死成四个不同生命周期、不同所有权的契约，并裁决它们如何连接。

## 2. Research Questions

- Goal / Directive / Demand / Task 各自的准确定义、生命周期与 owner？
- 四者如何关联？推荐数据流是什么？任务书原模型错在哪（修正点）？
- 幂等键、租约、超时、取消的语义如何统一？
- 本模型如何与 spawn intent（ADR-005）和物流 request（ADR-006）衔接？

## 3. Existing Solutions（问题域一般解法）

- **牵引式生产（pull-based / 看板）**：下游缺口显式声明（看板卡），上游按卡补货；
  与推式（配额计划）相对。核心收益：需求可见、在制品（WIP）有上限。
- **黑板系统（blackboard architecture）**：多个知识源读写共享黑板解复杂问题——
  本文的需求池是「只写缺口、由消费系统读」的单向退化版黑板。
- **合同网协议（Contract Net Protocol）**：招标-投标-中标-租约。本文取其
  「认领+租约」语义，去掉投标/协商（去协商化论证见 05 号 §11）。
- **幂等消息（idempotency key）**：分布式系统标准实践——同 key 请求重发不产生
  重复副作用；应对 Screeps 的重复 tick / global reset / 部分失败（26 号 §3）。
- skill 参考（empire-architecture.md）：Intent 带来源/目标/预算/idempotency key；
  Outcome 带 accepted/rejected/completed/failed/expired + 错误码 + 成本——本文
  状态机的骨架。

## 4. Screeps Community Practice

- **TI 的请求池（本次源码核查 requests.ts，CONFIRMED）**：`Memory.workRequests/
  combatRequests/haulRequests` 按房间名键控；字段 `responder`（认领房）+
  `abandon`（放弃倒计时冷却）——**帝国尺度的 Demand + 认领租约 + 重入冷却**，
  与本模型同构；复核每 100–200 tick。
- **Overmind 的请求-满足分离**（作者博客核查）：build/init/run 三相位——init 阶段
  所有需求方**只登记请求**（spawn 请求、运输请求），run 阶段 provider 按**优先级
  队列**满足（hatchery 孵最高优先级、storage link 装载）。需求与满足在时间上
  分离，使动作按优先级而非偶然执行序发生。
- **creep-tasks 库**（bencbartlett，社区流行插件）：`creep.task = Tasks.foo(target)`
  形式的 Task 对象 + parent 链（任务完成自动回落父任务）——Task 作为 creep 上的
  一等公民契约的社区标准化。
- **管理员配额式**（KasamiBot/hivemind/TooAngel）：无显式需求池，由 Manager 依据
  统计直接推派——实现简单，但「谁需要、多急」信息不可见（04 号 §5 分歧点）。

## 5. Existing Bot Analysis

- **请求牵引 vs 配额推派**（社区主要分歧）：牵引式把缺口显式化为可审计对象
  （TI/Overmind/bonzAI），配额式把缺口隐藏在 Manager 代码里（TooAngel 等）。本文
  裁决（沿 04 号 §5 混态原则）：**高频流动资源（能量搬运/工地填充/塔补给）走
  Demand 请求池；低频结构性供给（人口结构、矿物储备）走配额**。
- **租约意识的成熟度差异**：TI 的 abandon 冷却、Overmind Task 的自动回池
  （creep 死亡/目标消失任务失效）是「租约+超时回收」的现役证据；配额式 bot 靠
  creep 寿命自然边界兜底（更粗但更简单）。
- **静默丢单是共病**：请求方无回执（provider 拒绝/资源不足时无 outcome）→ 需求方
  永远等——skill 参考明确要求「不能静默丢单」（spawn 忙/能量不足必须返回 outcome）。

## 6. Advantages（四概念分离 + 池化消费）

1. **所有权清晰**：每个对象类型有唯一 owner（§10.1 表），跨 owner 写入即违例——
   防接口腐烂。
2. **生命周期解耦**：10^5 tick 的 Goal 不因 10 tick 的 Task 失败而动摇；Task 失败
   只是 Demand 重新声明。
3. **幂等可重放**：所有跨系统边界传递（intent/request/task）带稳定 key——重复
   tick / reset 后不产生重复对象（26 号 §3 唯一写者模型的数据面）。
4. **可审计**：需求池快照即「帝国现在缺什么」的即时答案；满足率/超时率是遥测
   一等指标（21 号）。

## 7. Disadvantages

- 四套状态机（每概念一个）比单一 Task 列表复杂——小规模（单房 A1/A2）时 Demand
  层显得过度设计，但其语义在 A3 多房时才回本。
- 池化消费引入「撮合延迟」：从 Demand 声明到 Task 绑定至少一个调度相位——对
  防御应答等紧急路径必须有旁路（紧急车道直发，19 号 §10.5）。
- key 设计错误（含时变字段）会导致幂等失效、重复孵化——key 规范必须评审。

## 8. Failure Modes

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| **需求风暴** | 每 tick 海量微小 Demand（每 creep 每资源一个）| 聚合粒度强制在「房间×资源×用途」级；需求池上限+老化丢弃 |
| **重复满足（无幂等键）** | 同一缺口生成两个 spawn/两笔调拨 | 稳定 key 规范（§10.4）；下游唯一写者二次合并（ADR-005） |
| **租约泄漏** | 执行者死亡但 Task 永占目标（别人的任务永远排不进） | 租约 TTL + heartbeat；到期自动回池（Overmind 自动失效先例） |
| **静默丢单** | provider 资源不足/忙碌时请求消失无回执 | 一切 Intent/Request 必须有 outcome（accepted/rejected/expired）——拒绝也要落遥测 |
| **优先级反转** | 低优长期占用执行者，高优新需求排队 | 优先级序 P0>P1>P2>P3 + 抢占规则（高优可回收低优未完成租约，带成本记录）+ 饥饿老化（19 号 §10.5） |
| **Demand 持久化腐化** | 把 Demand 当持久对象写 Memory，越积越多 | Demand 是每 tick 派生的瞬时信号，**不落 Memory**（修正点 2，§10.3） |
| **Directive 直派 creep** | Agenda 越权点名执行者，分配服务被架空 | Agenda 只声明 Demand 与验收条件；绑定仲裁唯一在分配服务（26 号 §6） |
| **Goal-Task 直连** | 战略目标直接生成具体任务（跨层直连） | 层级规则：上层只约束下层（05 号 §10.4 映射表的跨层规则） |

## 9. CPU Implications

- **Demand 零持久化**：每 tick 在 heap 上重推导（缺口=派生索引上的整数比较），
  tick 末丢弃——Memory 体积与需求数量解耦（ADR-010）。
- 聚合后需求池规模 = O(rooms × 资源类型 × 用途)，30 房量级 <10^2 项——评分排序
  成本可忽略。
- 租约/幂等 key 的持久部分（任务绑定、黑名单冷却）是 O(活跃任务) 小节，写 Memory。
- spawn intent 合并在提交时（稳定 key 去重），不在 tick 末全队列重算（ADR-005）。

## 10. Recommended Design

### 10.1 四概念定义（一次性钉死）

| 概念 | 定义 | 例 | 生命周期 | 载体/owner | 数量级 |
| --- | --- | --- | --- | --- | --- |
| **Goal（战略目标）** | 帝国追求的终态谓词，声明式常量 | 「提高能量收入」（→ P2 发展类 Goal「能量净流为正且储备达标」） | 10^3–10^5 tick | posture×budget 纯函数（战略层） | ~5–10 个（P0–P3 分类） |
| **Directive（指令/议程项）** | 中期承诺：做什么、预算多少、何时验收 | 「建立 E5N8 远矿车道」 | 10^3–10^4 tick | AgendaItem（议程管理，07 号 §10.3） | O(活跃议程)，~1–10 个 |
| **Demand（需求）** | 每 tick 的缺口声明（量+优先级+期限） | 「本房运力缺口 +600 能量/tick」「spawn 队列缺 1 个 reserver」 | 1–10 tick（瞬时） | 需求池（运行时，各需求方声明，对应系统消费） | O(10–10^2)/tick |
| **Task（任务）** | 执行者绑定的动作契约（租约+幂等键） | 「creep X 去 E5N8 source1 采矿，租约 500 tick」 | 10–10^2 tick | 分配服务绑定 → creep memory（targetId/lease） | O(creeps) |

### 10.2 四者如何关联（推荐数据流）

```text
Goal（常量集合）
  │  约束（posture 允许集 × budget 门控，06 号）——Goal 不下达具体工作
  ▼
Policy（posture × budget，每 tick 可查）
  │  授权 + 配额
  ▼
Directive / Agenda（低频创建与复核，07 号）────────────┐
  │  生命周期内持续声明（供给侧承诺产生的需求）          │
  ▼                                                  │
Demand 池（每 tick 重推导）◄── 房间稳态缺口（人口普查/   │
  │   能量收支/工地进度，08 号 §10.5）──────────────────┘
  │  由对应确定性系统消费，转化为：
  ├─→ SpawnIntent（人口缺口）──→ Spawn Manager（唯一写者，ADR-005）
  ├─→ LogisticsRequest（搬运缺口）──→ 物流系统（评分认领+租约，ADR-006）
  ├─→ Construction申请（建造缺口）──→ 建造/远矿管理（两写者制）
  └─→ Task（目标-执行者绑定）──→ RolePolicy 执行 ──→ Creep Action
  ▼
Outcome（accepted/rejected/completed/failed/expired）
  │  聚合反馈：里程碑验收（复核 Directive）→ 战略指标修正（复核 Goal 允许集）
  └────────────────────────────────────────────► 回到顶部
```

### 10.3 对任务书原模型的修正点

| # | 原模型表述 | 问题 | 修正 |
| --- | --- | --- | --- |
| 1 | 线性链「Goal→Policy→Demand→Agenda→Task」 | 易读成单管道：先有需求、再有议程 | 实为**环**：Policy 授权开 Agenda；**Agenda 与房间稳态共同生成 Demand**；Demand→Intent/Task→Outcome→复核 Agenda 与 Policy。链上「Demand 在 Agenda 前」仅对「触发立项的 Demand」（如扩张申请）成立 |
| 2 | Demand 隐含为持久任务列表 | Memory 腐化 + 需求过期无语义 | **Demand 是每 tick 派生的瞬时信号**，不落 Memory；持久性由下游（intent key/租约）承担 |
| 3 | Directive 可指挥执行 | 越权架空分配服务 | Directive 只声明预算/期限/验收条件 + 持续声明 Demand；**从不点名 creep** |
| 4 | Goal 与 Task 可能直连（目标直接变任务） | 跨层直连，战略抖动传导到执行 | Goal 只约束允许集；中间必须经过 Policy→(Agenda|稳态)→Demand 的完整路径；唯一例外是 P0 紧急车道（防御应答，记录越权原因） |
| 5 | 「Plan」作为独立层 | 序列脆断（07 号 §5） | Plan 层取消，其职能拆分为：低频承诺（Agenda）+ 每 tick 推导（Demand 消费系统） |

### 10.4 幂等键 / 租约 / 超时 / 取消语义

**幂等键规范**（稳定 key：由「角色×位置×用途×槽位」组成，**不含时变字段**）：

```text
SpawnIntent.key      = `${role}:${room}:${purpose}:${slotIndex}`     # ADR-005
LogisticsRequest.key = `${fromRoom}:${toRoom}:${resource}`           # 合并键
Construction.key     = `${room}:${structureType}:${posKey}`          # 写者侧二次去重
Task.leaseId         = `${demandKey}:${assignTick}`                  # 绑定实例
AgendaItem.id        = `${type}:${targetRoom}`                       # 重建冷却的匹配前缀
```

**统一生命周期状态机**（Intent/Request/Task 通用）：

| 状态 | 语义 | 转移 |
| --- | --- | --- |
| `pending` | 已声明未满足 | → `assigned` / `expired` / `cancelled` |
| `assigned` | 已绑定执行者（租约生效，带 TTL+heartbeat） | → `completed` / `failed` / `revoked`（TTL 到期或高优抢占） |
| `completed` | 结果核验通过 | → Outcome 落遥测 |
| `failed` | 执行者报告不可行 | → 回池重新声明 / 目标进 blacklist 冷却 / 升级上报 |
| `expired` | deadline 已过仍未满足 | → 取消 + 计数（TI abandon 语义；超时率是健康度指标） |
| `cancelled` | 上游撤销（Demand 消失/posture 关闭允许集） | → 释放资源；执行中的给宽限期优雅停止 |

**取消的层级语义**：Goal 不可运行时取消（06 号 §10.5）；Directive 取消=优雅收尾
（撤离/冻结，不硬断执行体）；Demand 取消=下一 tick 自然消失（瞬时性）；Task 取消
=租约回收（执行者进入 acquire 重新求职）。**任何一层取消不向上触发连锁取消**——
上层在自己的复核周期里发现下层的 Outcome 变化。

### 10.5 与 spawn intent 和物流 request 的衔接

- **Spawn 衔接（ADR-005）**：人口 Demand = `需求 − 有效供给`，其中有效供给 =
  在役能力 + spawning 中 + **已提交 intent**（防重复计数——ti 的「spawn 忙时丢单」
  教训要求 intent 计入人口）。Demand 经 `effective_supply = live + in-flight spawn +
  recoverable` 公式（skill 参考 Spawn as Control System）折算为 SpawnIntent，进
  Spawn Manager 幂等合并。P0 灾后恢复车道可越过普通 Demand 直接提交（≥200 能量
  立即 `[WORK,CARRY,MOVE]`）。
- **物流衔接（ADR-006）**：供需两侧（container 满/storage 缺/tower 阈值/工地需求）
  生成 LogisticsRequest；hauler 按评分认领持租约；**空载率/任务年龄/断链数**是
  物流 Demand 健康度一等指标；断链 fallback 走本地 container 缓冲。link 网络
  （RCL5+）与 terminal 均衡是独立低频通道，不进 creep 物流池（04 号 §10.2 配额）。
- **帝国尺度同构**：跨房 work/haul/combat 支援沿用同一语义（TI responder/abandon
  为先例）——认领房=租约持有者，abandon=expired 计数冷却。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 中央分配器逐 creep 派单（Model B 残余） | 帝国层带宽/CPU 爆炸；本地信息丢失（04 号 §5） |
| creep 自选任务无仲裁 | 争抢目标、重复劳动（社区「每角色一个全房扫描器」反模式，ADR-004 Reasoning） |
| 纯事件驱动（无需求池） | 事件（结构完工/敌袭）触发动作，但稳态缺口（长期运力不足）无事件可挂——需求池覆盖稳态，事件只做增量修正 |
| Demand 持久化进 Memory | 腐化+税（ADR-010）；瞬时性是本模型的核心修正 |
| Goal 效用分驱动 Demand 优先级 | 复辟每 tick 竞拍（ADR-003）；优先级来自 P 类+饥饿老化 |
| 合同网完整协商（投标/反提案） | 协商成本与不确定性（05 号 §11）；只保留认领+租约 |
| 一次性任务快照（无 outcome 回执） | 静默丢单（§8）；一切请求必有回执 |

## 12. Open Questions

1. Demand 聚合粒度的「用途」枚举完备性：初版（mining/hauling/building/defending/
   claiming/boosting…）随角色集扩展——需要与 RolePolicy 注册表同步冻结。
2. 高优抢占低优租约的成本模型：抢占免费会导致翻转战争（互相抢）；初版裁决=仅
   P0 可抢占且带冷却，待 A4 注入测试。
3. 多房需求池是全局一个还是按房分池：初版按房分池+帝国只看聚合摘要（04 号契约），
   A3 验证。
4. Outcome 的标准化 schema（错误码族）需与 [21_OBSERVABILITY.md](21_OBSERVABILITY.md)
   遥测格式、[28_TESTING_STRATEGY.md](28_TESTING_STRATEGY.md) 场景注入共同冻结。

## 13. Evidence / Sources

| URL / 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source（`src/international/requests.ts`，2026-08-22 拉取核查） | 源码 | work/combat/haul 三请求池；responder 认领、abandon 冷却、100–200 tick 复核、score 排序——帝国级 Demand+租约+重入冷却的现役实现 | CONFIRMED |
| https://bencbartlett.com/blog/screeps-1-overlord-overload/（2026-08-22 核查） | 作者博客 | init/run 请求-满足分离：init 只登记请求、run 按优先级队列满足——需求与满足在时间上分离 | CONFIRMED |
| https://github.com/bencbartlett/creep-tasks | 源码（库） | `creep.task = Tasks.foo(target)` + parent 链——Task 作为 creep 契约的社区标准 | CONFIRMED |
| Web 检索（2026-08-22）："screeps tasks system bot github" | 检索 | 任务系统主流形态=任务队列+角色管理器（TI releases/defenceManager 等）；OS 式消息队列仅 choreographer 一家 | CONFIRMED |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-003/005/006 | 本套件 | 纯函数战略、唯一写者 spawn、请求池物流 | — |
| [07_PLANNING_SYSTEM.md](07_PLANNING_SYSTEM.md) §10.3 · [06_GOAL_AND_POLICY_SYSTEM.md](06_GOAL_AND_POLICY_SYSTEM.md) §10.5 | 本套件 | AgendaItem 契约与终态语义（本文与其共用状态机） | — |
| screeps-grandmaster-perspective/references/empire-architecture.md（核心数据契约节） | 领域经验 | Intent/Outcome 契约与「不能静默丢单」（本文 §10.4 骨架来源） | LIKELY |
