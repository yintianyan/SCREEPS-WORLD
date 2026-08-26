# PHASE38 · Expansion Operation 身份审计（Expansion Identity Audit）

> 范围：任务书 §四 13 问 + decisionId 是 Operation Identity 还是 Latest-Decision Identity 的最终裁决
> 对象：工作区当前代码（含未提交 TD-37-3/AI-2）

## 0. 最终裁决

**decisionId 目前是 Latest-Decision Identity，不是 Operation Identity。**

理由（三条独立证据）：
1. **分配滞后且可重建**：由 collectExpansionDecisions 在 trace 轮询时惰性分配（≤100t 延迟）；global reset 后 heap 去重集清空 → 同一活跃 operation 重发 Decision 并**覆写** Memory.kernel.expansion.decisionId。
2. **上游 Outcome 通道单槽 latest-wins**：lastExpansionOutcome 只存最后一条；同一 operation 可写多条 Outcome（见 Q5），先写的会被后写的覆盖，或被 collector 抢先消费。
3. **fallback 键漂移**：planId 缺失时 dedupKey=`expansion:${target}:${startedAt}`，而 startedAt 每次状态转换被覆写 → 键随操作生命周期变化。

## 1. 十三问逐条回答

| # | 问题 | 回答 | 关键证据 |
|---|---|---|---|
| 1 | 一个 Operation 一个稳定身份？ | 运行中=是（单槽 Memory.kernel.expansion + planId）；跨 reset=否 | expansion-manager.ts:190-199 单槽创建；6 个清理点 :265,:272,:673,:689,:715 全覆盖终态 |
| 2 | decisionId 可被覆写？ | 是。reset 重建路径（EXP-2/P0）+ legacy 无 planId 时每次转换重发 | decision-trace-system.ts:893-1002; expansion-manager startedAt 覆写点 ×9 |
| 3 | decisionId 会丢失？ | 内容不丢（Memory 持久），但**关联语义丢**：旧 Experience 的 id 与覆写后的 Memory.decisionId 永不再相等 → UNRESOLVED | 同上 |
| 4 | 同 plan 多 Decision？ | 正常流否（WAITING_EXECUTION→EXECUTING 同步翻转+终态不可逆）；reset 流/legacy 流=是 | tryConsumePlan:147,:186; updatePlanStatus 终态 :666,:687,:713 |
| 5 | 同 Decision 多 Outcome？ | **是——本次最严重发现（EXP-1/P0）**。claim 成功即记 SUCCESS(:346)；economic_startup 强推再记(:571 新增)；之后 integrating 失败还会记第三条。collector 的 decisionId 匹配分支优先于「进行中」守卫 → 提前 SUCCESS 在测量延迟(2000t)到期后被采为终态，真实终局被丢弃 | :346,:571; experience-collector-system.ts:436-441（主审独立脚本复核：BRANCH 1 HIT） |
| 6 | 全部终止路径有 Outcome？ | 是（11 个 abortExpansion 位点 + 2 个强推位点全覆盖，记录先于清理 :704→:715）——**覆盖率 GREEN，正确性红（提前/重复语义）** | 见分册枚举 |
| 7 | 卡死中间状态？ | 低风险。五态各有超时闸（claimTimeout 6000 / pioneerTimeout 20000 / ×2 / ×3）；claiming 自愈 claimer 丢失幂等 | :330,:361,:456,:565,:679 |
| 8 | 重复执行？ | 否。单槽 + hasOtherExpansion 门禁 + Plan 同步翻 EXECUTING + spawn key 幂等 | :161,:96-117 |
| 9 | Phantom complete？ | 学习层=是（EXP-1 伪造 SUCCESS）；执行层否（真完成需 CP5/integration 证据） | :656-661,:682-686 |
| 10 | Phantom fail？ | 轻度：bootstrap「失去视野」瞬时窗口记 LOST+拉黑（claimer 死亡与 pioneer 到达间隙） | :391-401 |
| 11 | 清理早于记录？ | 否。全部路径 record→clear 顺序正确 ✅ | :704→:715, :661→:673 |
| 12 | reset 后重复采集？ | 经验本体不重复（随 heap 蒸发）；但产生一条**重建的假 Decision** 且 outcome 若在 record 与 poll 间隙(≤100t)发生 reset 则永久丢失该 Outcome | EXP-2; TMP-2 |
| 13 | Experience 错配到其他扩张？ | 主路径防住（decisionId 严格相等，hasDecisionId 短路 fallback）；两个洞：(a) 无 decisionId 的 fallback 按 target+completedTick 匹配——同 target 重扩可继承旧 Outcome；(b) EXP-1 使 N 时代的 Outcome 承载 N+1 语义 | experience-collector-system.ts:431-433 |

## 2. 完整调用链（真实代码路径）

```
expansion-planner (:180-200) Plan WAITING_EXECUTION
  → expansion-manager.tryConsumePlan (:117) Gate/GCL 检查
  → updatePlanStatus EXECUTING (:186) + Memory.kernel.expansion 创建 (:190-199)
  [每 tick] 状态机 advance* （preparing→claiming→claimed→bootstrapping→economic_startup→integrating→completed）
  [并行] decisionTraceSystem(interval 100) collectExpansionDecisions (:888)
      ├─ dedupKey = planId ?? expansion:target:startedAt (:897)
      ├─ 首次 → DecisionRecord + makeDecisionId(tick,++seq) (:972)
      └─ 写 Memory.kernel.expansion.decisionId (:999-1002)
  [终态] recordExpansionOutcome (:720)
      ├─ recordEvent(ExpansionOutcome) (:721)
      ├─ globalCache().lastExpansionOutcome ← {decisionId: expansion.decisionId} (:730-737)
      └─ rhythm ring appendOutcome (:743)
  [并行] experienceCollectorSystem(interval 100)
      ├─ collectPendingDecisions：ring 扫描 → createExperience(OBSERVED)
      ├─ collectPendingOutcomes：isDecisionReadyForOutcome(2000t) 
      │    → buildOutcomeCollectionInput case "expansion" (:413-455)
      │    → decisionIdMatch ? 注入 : (fallback? / in-progress? / 不注入)
      └─ attachOutcome → OPEN → attribution → FINALIZED
```

## 3. BLOCKER 级修复方向（不在本阶段实施，仅登记）

1. **Outcome 通道改事件队列**：recordExpansionOutcome 追加到带 decisionId 的 FIFO（cap 有界）而非单槽；
   collector 消费后删除。一次消灭：提前 SUCCESS 抢占、<100t 覆盖丢失、reset 单槽蒸发三个问题。
2. **终态-only 语义**：仅 completed/abort* 五个真终态允许携带 outcomeCode 进队列；中间里程碑（claim、
   强推）改发非 Outcome 事件（如 MilestoneReached），rhythm ring 是否计入由配置显式声明。
3. **Operation identity 固化**：consume 时即生成 opId（如 `op:${target}:${consumeTick}`）写入 expansion
   状态与 Plan，decisionId 仅作 trace 引用；reset 重建时以 opId 幂等。

## 附录：TD-39 裁决

见主册 §7（A-F 全 NO → ACCEPTED LOW RISK）。trim 相关路径与本册 EXP 组缺陷无交集。
