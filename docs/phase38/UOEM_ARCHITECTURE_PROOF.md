# Phase 38 · Unified Outcome Event Model — Research & Architecture Proof

> 性质：架构研究与证明。**本阶段零生产代码变更**（约束 §一）。
> 方法：先从当前代码重建五问题证据链（不接受既有报告），再提出统一模型，再逐条 trace-through 证明消解，
> 最后以模型层反事实测试（独立 proof 测试，生产不可调用）验证模型语义。

---

## 第一部分 · 五问题重审（真实代码证据链，2026-08-26 工作区状态）

### EXP-1 — Premature SUCCESS / Milestone-as-Outcome

**Q1 全部 Outcome 写入点**（`recordExpansionOutcome` 调用 + `abortExpansion` 内部调用）：

| 位点 | phase | code | 定性 | 写后走向 |
|---|---|---|---|---|
| :346 claiming→claimed | CLAIM | SUCCESS | **MILESTONE**（占领≠完成） | `return` 后状态机继续运行 |
| :394 bootstrap 失明 | PIONEER | LOST | terminal（但见 Q5a） | →abortExpansion 再写一次 |
| :397 bootstrap 被夺 | PIONEER | STOLEN | terminal | →abortExpansion 再写一次 |
| :447 squad 灭 | PIONEER | LOST | terminal | →abortExpansion 再写一次 |
| :458 bootstrap 超时 | PIONEER | TIMEOUT | **MILESTONE-if-forced** | spawn 存在则强推继续；否则 abort 再写 |
| :483 econ_startup 失守 | PIONEER | LOST | terminal | →abortExpansion 再写一次 |
| :571 econ_startup 强推 | PIONEER | **SUCCESS** | **MILESTONE**（仅 CP3 通过即记成功） | 强推到 integrating 继续运行 |
| :661 CP5 完成 | PIONEER | SUCCESS | ✅ TERMINAL（真终态） | state=completed, Memory 清除 |
| :686 integrating 强推完成 | PIONEER | SUCCESS | ✅ TERMINAL（需 netFlow>0+integrated） | 同上 |
| :704 abortExpansion 内部 | 按 state | 参数传入 | terminal（11 个调用位点：:240 ABORTED, :332/:365/:466/:577/:692 TIMEOUT, :356 STOLEN, :377/:401/:450/:486/:588 LOST） | Memory 清除 |

**Q2 code 语义**（expansion-manager.ts:68-72）：SUCCESS=0 / STOLEN=1 / TIMEOUT=2 / LOST=3 / ABORTED=4。
domain 层映射（outcome.ts:337-342）只认 0/1/2，1(STOLEN) 恰好落 FAILURE，而 3/4 → UNKNOWN —— 码表契约缺口。

**Q3/Q4 milestone vs terminal 分类**：如上表。判据 = 写入后 operation 是否继续存在。
`:346`、`:571`、（条件性的）`:458` 是 milestone 却携带 OUTCOME_* 语义写入同一通道——这是 EXP-1 的类型学根源。

**Q5 多次写入路径**：
(a) 配对双写：:394+:704、:397+:704、:447+:704、:458+:704（abort 分支时）、:483+? 无（:486 直接 abort 单写）——同 tick 两次；
(b) 跨 tick 多写：:346 → … → :661（正常流 2 次）；:346 → :571 → :661（3 次）；:571 → :692（2 次，先假 SUCCESS 后真 TIMEOUT）。
**Q5a 附带发现**：:391-401 的「失明」分支把 claimer 死亡与 pioneer 到达之间的瞬时无视野也记为 LOST/STOLEN——可恢复间歇被定罪为终态失败并拉黑目标房。

**Q6 collector 消费条件**（experience-collector-system.ts:199-237）：
`getPendingOutcomes`（lifecycle=OBSERVED）→ `isDecisionReadyForOutcome(tick-decisionTick ≥ MEASUREMENT_DELAYS.expansion=2000)` → `buildOutcomeCollectionInput` case "expansion" → decisionIdMatch 优先 → attachOutcome → OPEN → attribution → FINALIZED。**消费后不再更正**（processedDecisionIds 防重）。

**Q7 measurement delay 与状态机关系**：delay=2000t ≪ 状态机典型时长（claimTimeout 6000t，pioneerTimeout 20000-60000t）。
⇒ claim SUCCESS（若在决策后 ~2000t 内发生）几乎必然在真实终局之前到达测量窗口——不是边缘情况，是**主路径**。

**Q8 latest-wins**：是。`globalCache().lastExpansionOutcome` 单槽，每次 recordExpansionOutcome 整体覆盖（:730-737）。

**Q9 第一个 SUCCESS 被误当最终 SUCCESS？** 确认成立，主路径复现：
```
T0     collectExpansionDecisions → D-{T0}-{n}, Experience(OBSERVED)
T0+~2k claim 成功 :346 → lastExpansionOutcome={SUCCESS, decisionId}
T0+2000 collector 到期 → decisionIdMatch 命中 → Experience=FINALIZED/SUCCESS
T0+30k 真实终局 TIMEOUT :692 → 写入单槽，无人再消费
净效果：学习层记录「扩张成功」，现实是「扩张超时回收」
```

### EXP-2 — Reset Identity Rebuild

幸存矩阵：

| 数据 | 位置 | global reset 后 |
|---|---|---|
| processedExpansionPlanIds | heap Set (decision-trace-system.ts:64,85) | ❌ 清空 |
| DecisionTrace ring + Experience ring + lastExpansionOutcome | heap | ❌ 清空 |
| Memory.kernel.expansion（含 decisionId） | Memory | ✅ 幸存 |

reset 后首个 trace 轮询：dedupKey 未命中 → 重发 DecisionRecord D2 → **覆写** `Memory.kernel.expansion.decisionId`（:999-1002）→ 后续 Outcome 关联 D2 自洽。旧 D1 的 Experience 随 heap 蒸发（非孤儿）。
净效果：每次 deploy 一条幻影决策 + 观测失忆；无错配（这是与 EXP-1 的本质区别：损失+重复，不是错误归因）。
fallback 键漂移亚型：legacy Memory 无 planId 时 dedupKey=`expansion:${target}:${startedAt}`，startedAt 有 9 个覆写点（:194,:218,:233,:325,:345,:429,:462,:559,:573）→ 每次 transition 可再造一条 Decision。

### TMP-1 — Duration 谎报

- startedAt 写点 ×9（上表）；**每态超时闸读点 ×5**（:330,:361,:456,:565,:679）依赖「转换即重置」——该字段对闸是正确的；
- duration 读点 ×3：eventLog(:724)、lastExpansionOutcome.duration(:734)、in-progress 推导(exp-collector:447)；
- 下游消费：experience-collector:441 → attribution.ts:672-681 metric "expansionDuration"。
结论：同一字段承担两种时间语义（per-state 计时器 vs lifecycle 时长），后者系统性只量到最后一个状态的时长。**字段复用是根因，不是某个调用点的 bug。**

### A6-R — recoveryStats 累计污染

- computeRecoveryStats（recovery-lifecycle.ts:776-809）从追踪表聚合**终身累计** succeededCount/failedCount；
- collector 直接喂给 outcome（exp-collector:371-374）；collectRecoveryOutcome（outcome.ts:187-220）算 successRate=succeeded/(succeeded+failed) 并分类；
- ⇒ 每个 recovery 决策的 Outcome = 帝国历史平均，与本决策无关。且无 delta 基线字段存在于 RecoveryStats 接口（:758-769）——修复需要新数据，不是改分类阈值。

### A6-SL — logistics/spawn 通道 BEFORE/AFTER 错位

- logistics（exp-collector:393-398）：`logisticsLevelBefore = "stable"` 字面量硬编码；after 用当前 g.logisticsHealth.level → 降级期决策获幻影 PARTIAL_SUCCESS(stable→stable) 或被误判恶化。
- spawn（:401-406）：三个值全部取自 `exp.context.metrics`——由 extractMetricsFromEvidence(:297-323) 在**决策采集时刻**（≤100t after decision）从 evidence 冻结；collectSpawnOutcome（outcome.ts:294-323）把它们当 AFTER 判据：`queueDrained = spawnQueueLength===0`、`p0Cleared = spawnP0Count===0`。⇒ 决策时队列非空 → 恒 FAILURE，与后续世界无关；决策时空队列 → 恒 SUCCESS。**BEFORE/AFTER 两端点根本不存在，只有单时刻值。**

### 五问题的公共结构（建模需求的提炼）

| 问题 | 缺陷类型 |
|---|---|
| EXP-1 | 通道无「事件性质」维度：milestone 与 terminal 共用一个槽和一个词表 |
| EXP-2 | 身份在 heap/Memory 两界存活不一致 + 键可漂移 |
| TMP-1 | 时间字段一符两义 |
| A6-R | 度量缺 BEFORE/AFTER 端点定义（拿总量当增量） |
| A6-SL | 同上（拿单时刻快照当变化量） |

⇒ 统一模型必须一次性提供四种正交保证：**事件性质（kind）、身份稳定性（identity）、时间端点（interval）、度量配对（paired observation）**。

---

## 第二部分 · Unified Outcome Event Model（UOEM）

### 2.1 定义：什么是一个 Outcome Event

> **Outcome Event 是一个 Operation 从「决策时刻」到「终态判定时刻」的封闭区间上，由唯一权威写者在终态判定时刻发出的、携带完整区间描述的不可变事实记录。**

由此导出四条公理：

- **A1 Terminality**：每个 Operation 至多一个 Outcome Event（终态唯一）。中间里程碑不是 Outcome Event，是 Milestone Event——不同类型，不同通道，永不混用。
- **A2 Identity**：Event 携带的 operationId 在 Operation 创建时一次性铸造，全生命周期不变，且**同时持久化于 heap 与 Memory 两界**（或声明单界权威并接受另一界的丢失语义）。
- **A3 Interval**：Event 必须携带 `{openedAt, closedAt}` 区间端点；duration = closedAt - openedAt 由**打开时刻**计算，与任何 per-state 计时器字段无关。
- **A4 Paired Observation**：任何基于状态比较的分类（before/after）必须在**决策时刻冻结 before 观测**、在**终态判定时刻冻结 after 观测**，二者作为 Event 载荷的一部分一起发出。禁止 collector 事后自行取"当前值"补齐任一端。

### 2.2 类型契约（伪 TypeScript，仅架构文档，不进 src/）

```ts
/** 事件性质 —— EXP-1 的直接解 */
type OutcomeEventKind = "OUTCOME";          // 仅终态
type MilestoneEventKind = "MILESTONE";      // 中间成就（claim/force-advance/checkpoint）

interface BaseOperationEvent {
  readonly eventId: string;          // E-{tick}-{seq}，发送序号，仅日志用途
  readonly operationId: OpId;        // A2：创建时铸造，两界持久
  readonly kind: "OUTCOME" | "MILESTONE";
  readonly emittedAt: number;        // 发出 tick（世界时刻）
}

interface OutcomeEventV1 extends BaseOperationEvent {
  readonly kind: "OUTCOME";
  readonly result: OperationResult;  // 词表按 operation 类型分域，禁止跨域复用
  readonly interval: {               // A3
    readonly openedAt: number;       // consume/decision 时刻，铸造后不变
    readonly closedAt: number;       // 终态判定时刻
  };
  readonly terminalState: string;    // 到达终态前的最后状态机状态（审计用）
  readonly forcedAdvance: boolean;   // 是否经历超时强推（EXP-1 :571 类路径的显式标记）
  readonly observation?: PairedObservation; // A4：可选的比较型载荷
}

type OperationResult =
  | { domain: "expansion"; code:
      | "COMPLETED"                 // CP5 真通过
      | "COMPLETED_FORCED"          // 强推完成（integrating :686 类，有 netFlow+integration 证据）
      | "TIMED_OUT" | "LOST" | "STOLEN" | "ABANDONED" }
  | { domain: "recovery"; code: "RECOVERED" | "ESCALATED" | "EXPIRED";
      delta: { succeededSinceOpen: number; failedSinceOpen: number } }   // A4: delta 非累计
  | { domain: "logistics" | "spawn";
      before: SnapshotValue; after: SnapshotValue }                      // A4: 双端点强制
  ;

interface MilestoneEventV1 extends BaseOperationEvent {
  readonly kind: "MILESTONE";
  readonly milestone: string;        // "CLAIMED" | "ECONOMIC_LOOP_ACTIVE" | ...
  readonly at: number;
}
// Milestone 永远不进入 outcome 队列；A6 若要消费里程碑，走独立的 metrics 流。
```

### 2.3 权威队列与所有权（替代单槽）

```ts
interface OutcomeChannel {
  /** 每 operationId 至多一条 OUTCOME（A1 由写入方幂等保证：已存在则拒绝+告警）。 */
  enqueue(ev: OutcomeEventV1): "ACCEPTED" | "DUPLICATE_REJECTED";
  /** collector 消费即出队（peek+ack 两步，防消费中途 reset 丢失）。 */
  drain(batch: number): OutcomeEventV1[];
  /** 容量上界 + 最老丢弃计数器（溢出必须可观测，而非静默）。 */
  readonly capacity: number;
  overflowedCount(): number;
}
```

- 存储位置：**Memory.kernel.outcomeEvents（有界 FIFO，cap 建议 32）**——选择 Memory 而非 heap，
  正面解决 EXP-2 的两界不一致：reset 不再蒸发待消费 Outcome；deploy 后 collector 依然能消费。
  代价是极小的 Memory 占用（32×~100B≈3KB 上界）。
- 双写防护：enqueue 以 operationId 为唯一键做幂等（DUPLICATE_REJECTED 计数入遥测）——
  同时吸收现有配对双写路径（:394+:704 等）而不需要改动它们的调用顺序。

### 2.4 Operation Identity 铸造（EXP-2 的直接解）

```
consume 时刻（tryConsumePlan 内，同步于状态槽创建）：
  opId = `op:{target}:{consumeTick}`
  写入三处（原子于同一 tick）：
    1. Memory.kernel.expansion.operationId
    2. Plan 对象（plan.operationId）
    3. 首条 MilestoneEvent("OPERATION_OPENED", {operationId, openedAt})
decisionId 保留现状职责：仅作 DecisionTrace 层内部引用。
Experience.decision 关联键改为 operationId；decisionId 降级为辅助索引。
```

- consumeTick 单调 ⇒ opId 天然唯一且不可再生；reset 后 Memory 侧幸存 ⇒ 重启不重建身份。
- fallback 场景（legacy Memory 无 operationId）：collector 明确产出 DATA_GAP（宁缺勿错），不做 target 近似匹配。

### 2.5 时序图（正常流 / 强推流 / reset 流）

```
正常流
 T0    tryConsumePlan ──铸 opId──┐
      ├ Memory.expansion{opId, openedAt:T0}
      ├ Milestone(OPERATION_OPENED)
      └ DecisionTrace(decisionId 引用 opId)
 T1    claim 成功 → Milestone(CLAIMED)            [不产生 Outcome]
 T2    CP5 通过 → enqueue(OutcomeEvent{
         operationId, result: COMPLETED,
         interval:{openedAt:T0, closedAt:T2},     ← duration 真实
       }) ; Memory.expansion = undefined
 T3    collector.drain() → attach → attribute     [唯一一次消费]

强推流
 T0'   open(opId)
 T1'   econ_startup 超时 & cp3 → Milestone(FORCED_ADVANCE, forcedAdvance 标志置位于状态槽)
 T2'   integrating 超时无证据 → enqueue({result: TIMED_OUT, forcedAdvance: true})
       ——无论中途强推几次，OUTCOME 只有一个，且如实报 TIMED_OUT

reset 流
 T0''  open(opId)（Memory 持久化）
 ...   global reset：heap 全灭，Memory.expansion{opId} 与 outcomeEvents FIFO 幸存
 Tn''  重启后 trace 重发 Decision（引用同一 opId，幂等键未变）
 Tm''  终局 → enqueue({opId, ...}) → collector 消费
       ——Experience 与 Outcome 仍以 opId 相遇；代价仅是决策侧观测断档（诚实 DATA_GAP）
```

### 2.6 数据流图（A6 应该消费什么）

```
                    ┌────────────────────────────────────────────┐
 Expansion State ──►│ Producer(expansion-manager)                │
                    │  终态→ OutcomeEvent(kind=OUTCOME, 唯一)     │──────┐
                    │  里程碑→ MilestoneEvent(kind=MILESTONE)     │──┐   │
                    └────────────────────────────────────────────┘  │   │
                                                                    ▼   ▼
                                        Memory.kernel.{milestoneLog, outcomeEvents}
                                                                    │   │
                                             （drain/订阅，消费即出队）│   │
                                                                    ▼   ▼
                                    ┌───────────────────────────────────┐
                                    │ experience-collector              │
                                    │  只认 kind==="OUTCOME"            │
                                    │  关联键 = operationId             │
                                    │  duration = interval 两端点差      │
                                    │  分类用 ev.observation 双端点       │
                                    └───────────────────────────────────┘
                                                    │
                                                    ▼
                                       Experience → Attribution → Calibration
                                       （DecisionTrace 保持只读观测角色不变）
```

### 2.7 明确排除项（哪些永远不能当 Outcome）

1. 状态机中间转换（claimed/bootstrapping/economic_startup 进入事件）——Milestone；
2. 超时触发的强推进（:571 类）——Milestone + 状态槽 forcedAdvance 标志；
3. checkpoint 通过（CP2-CP4）——Milestone；
4. 累计统计量、单时刻快照——不是事件，是 gauge；gauge 只有被配对成区间后才可参与分类；
5. 「失明」类瞬时可逆观察——连 Milestone 都不算，属 telemetry 抖动（现 :391-401 行为在模型下非法）。

---

## 第三部分 · 五问题 × 模型消解证明（trace-through）

### EXP-1 消解证明

- :346/:458/:571 三处在新模型下**编译期不可能**调用 enqueue（它们持有的是 Milestone 语义，
  函数签名按 kind 分离）；forcedAdvance 作为 OutcomeEvent 字段保留强推历史。
- 单槽消失 → 不存在第一个 SUCCESS 占位问题；enqueue 幂等（A1）使 :394+:704 型配对双写第二次被拒并可观测。
- collector 匹配条件收紧为 `ev.kind==="OUTCOME" && ev.operationId === exp.operationId`——
  即使 producer 出错多发，channel 层 DUPLICATE_REJECTED 已拦截。
- 测量延迟与状态机的关系重新定义：2000t delay 不再决定「读到哪个假终态」，
  因为通道里**只有真终态**；延迟到期时若无 Event → pending 继续（诚实等待），maxDelay 后 UNRESOLVED。 ∎

### EXP-2 消解证明

- opId 在 Memory 两界一致存活；reset 后 trace 重发的是 DecisionRecord（其 operationId 引用不变），
  Experience 侧 processedDecisionIds 虽清空，但 Experience 本体也已随 heap 蒸发——重建的 Experience
  以同一 opId 等待同一 Outcome，最终相遇。
- 唯一残余：reset 前 heap 里未 FINALIZE 的 Experience 丢失（观测失忆，登记为已知代价，非错误归因）。∎

### TMP-1 消解证明

- openedAt 在铸造后不可变（接口 readonly + 单写点），duration=closedAt-openedAt 数学上等于真实生命周期；
  per-state 计时器继续用 startedAt（改名建议 stateEnteredAt，语义自文档化），两者不再共占一个词。∎

### A6-R 消解证明

- recovery 域的 OutcomeEvent.result.delta.{succeeded,failed}SinceOpen 由 producer 在终态判定时刻
  从追踪表做 **open 时快照差分**——collector 不再接触累计量；分类函数输入天然是增量。∎

### A6-SL 消解证明

- logistics/spawn 域的 Observation{before,after} 双端点都由 producer 冻结进事件
  （before 取自决策时刻已有的 context.metrics，after 取自终态判定时刻）；
  collectXxxOutcome 的输入契约从「单值」变为「Pair」，类型层面杜绝单值冒充变化量。
  现有 exp.context.metrics 的冻结逻辑（extractMetricsFromEvidence）恰好就是正确的 before 来源——只需搬运，不需发明。∎

### 交叉影响核查（模型不引入新问题）

- **性能**：FIFO cap 32 + 每 operation 一次 enqueue ≈ 每 20k-60k tick 一次写，CPU 可忽略；Memory ≤3KB。
- **rhythm/blacklist 等现有消费者**：recordExpansionOutcome 的事件日志与 rhythm 更新职责保持原位
  （producer 内部），只是「向 A6 的暴露面」换成 channel——Runtime 行为零变更满足本阶段约束。
- **war/economic/defense 三通道**：同构迁移路径存在（war 单槽 warPlanCache 同样 latest-wins），
  列入后续阶段，不在本次证明范围。

---

## 第四部分 · Observed but intentionally not fixed during Architecture Phase

以下修复点已识别且改动很小，但按本阶段约束**全部不动**，留待 Implementation Phase：

1. :346/:571/:458 三处 milestone 误用 OUTCOME_* （EXP-1 核心 + TIMEOUT-SEMANTICS）：
   - :346 claim success → Milestone("CLAIMED")
   - :458 bootstrapping timeout+spawn → Milestone("FORCED_ADVANCE")，当前误记 OUTCOME_TIMEOUT
   - :571 econ_startup timeout+cp3 → Milestone("FORCED_ADVANCE")，当前误记 OUTCOME_SUCCESS
   详见 [PHASE38_TIMEOUT_SEMANTICS_AUDIT.md](PHASE38_TIMEOUT_SEMANTICS_AUDIT.md)；
2. :170-176 Gate 硬失败注释 CANCELLED 代码 EXECUTING（PLAN-1/R1-P2-1）；
3. :391-401 失明窗口记 LOST+拉黑（EXP-1 附带）；
4. outcome.ts 码表 3/4→UNKNOWN 契约缺口；
5. hysteresisCache 无界（GC-1）；
6. claimer 幽灵请求取消通道（SPAWN-F1）；
7. recoveryStats/logistics/spawn 三通道输入缺陷（A6-R/A6-SL）；
8. gcTrace count 重计致查询序错位（GC-2）。

---

## 结论

UOEM 用四个正交保证（Terminality/Identity/Interval/PairedObservation）+ 一个权威通道（幂等、
两界持久、容量可观测）在**类型与所有权层面**使五类缺陷要么无法表达、要么自动转化为诚实的
DATA_GAP/UNRESOLVED。第三部分的逐条 trace-through 表明无需依赖任何运行时巧合：正确性来自结构，
不来自纪律。模型已具备进入 Implementation 的条件；实施顺序建议：
①channel+opId（EXP-1/2 根修）→ ②interval 字段（TMP-1）→ ③recovery delta（A6-R）→
④observation pair（A6-SL）→ ⑤war/economic 通道同构迁移。
