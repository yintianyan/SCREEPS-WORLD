# PHASE38 · 长期运行前可靠性总审计（Long-Run Pre-Deployment Reliability Audit）

> 日期：2026-08-26 · 审计对象：工作区当前状态（HEAD=5bb1399 + 未提交 TD-37-3/AI-2 变更）
> 方法：五路并行深审（Expansion 身份链 / DecisionTrace+TD-39 / 时间+跨房 / Spawn+经济+资源增长 / A6 数据链+异常恢复）+
> 主审独立复核（关键论断逐条脚本/源码验证）+ CF-LONG 反事实测试套件（22 用例，全绿）
> 审计纪律：不信任既有报告与测试计数；所有结论以 file:line 级当前代码为准。

## 0. 裁决摘要

| 维度 | 判定 |
|---|---|
| Runtime（kernel/scheduler/spawn/economy 主干） | **GREEN**（14 个故障注入场景 12 GREEN / 2 DOWNGRADE，0 WEDGE，0 崩溃路径） |
| A3 Expansion 执行层 | **GREEN**（状态机全覆盖终止、无双执行、清理先于记录） |
| A3 → A6 数据链路 | **BLOCKED** —— 存在 1 个 P0 + 4 个 P1 级数据真实性缺陷（见 §2） |
| A6 Shadow-Only / 无执行消费者 | **TRUE**（本轮重新 grep 验证，冻结契约完好） |
| 无界内存 | **1 处新确认**：`hysteresisCache`（expansion-planner，模块级 Map 永不删除）；snapshotRegistry 已由未提交修复关闭 |
| TD-39 | **ACCEPTED LOW RISK**（A–F 六问全部 NO，见专项文档） |

### 最终 Verdict 规则适用

任务书规则：P1 Data identity / attribution bug → **BLOCKER**。

本次发现多项 P0/P1 级数据身份/归因缺陷（EXP-1 提前 SUCCESS、EXP-2 reset 重复 Decision、
TMP-1 duration 谎报、A6-R recoveryStats 累计污染、A6-S spawn/logistics 通道系统性误分类）。
它们不导致运行时崩溃或经济死亡（Runtime 层 GREEN），但直接违反第一原则
「宁可 UNRESOLVED/DATA_GAP，不可错误归因」——当前数据链路存在**结构性错误归因**。

## 最终裁决：**BLOCKED（针对 A6 数据链路）/ GREEN_WITH_TECHNICAL_DEBT（针对 Runtime Foundation）**

- **可以开始真实长期运行吗？** Runtime 层面**可以**——14 个异常场景无永久卡死、内存除一处外全部有界、
  bucket/CPU 降级语义正确。把 bot 放上官服跑起来是安全的。
- **可以把 A6 数据当真吗？** **不可以。** 在修复 §2 的 P0/P1 之前，A6 Experience/Attribution/Calibration
  的扩张、恢复、物流、spawn 四个通道的数据是假的或有偏的。冻结 A6 是正确的，且在数据链修好之前**不应解冻**。
- **是否继续扩展 A6？** 否（遵守任务书）。下一步是修 Runtime→A6 的数据真实性，不是加新智能。

## 1. 与任务书状态的核对

| 任务书声称 | 核实结果 |
|---|---|
| Phantom Transporter 已修复 | ✅ 属实（三处消费点 hauler\|\|distributor，残余仅文案） |
| Expansion Outcome decisionId 级可靠关联 | ❌ **部分属实**：关联键机制已建立且匹配逻辑严格，但上游写入端有提前 SUCCESS / 双写 / reset 重建三个漏洞（EXP-1/2/3） |
| snapshotRegistry 泄漏已关闭 | ✅ 属实（evictStaleSnapshots 每 500t 按 ring 引用集驱逐；CF-LONG-10 固化） |
| TD-37-3 已关闭 | ⚠️ 形式关闭但引入 EXP-1/P2-1 回归（:571 强推记 SUCCESS；:175 注释与代码背离依旧） |
| 4882/4882 全绿 | ✅ 本机复测属实；typecheck/build 通过 |
| 唯一已知技术债 TD-39 | ❌ 不完整：hysteresisCache 无界增长、claimer 取消通道失灵、gcTrace count 重计等为漏登记项 |

## 2. BLOCKER 清单（P0/P1，按危害排序）

| # | 级别 | 发现 | 位置 | 一句话 |
|---|---|---|---|---|
| EXP-1 | **P0** | claim 成功即记 `OUTCOME_SUCCESS`（PHASE_CLAIM），economic_startup 强推再记一次；experience-collector 的 decisionId 匹配分支**优先于**「仍在进行中」守卫 → 提前 SUCCESS 在测量延迟到期后被采为终态，真实终局被丢弃 | expansion-manager.ts:346, :571; experience-collector-system.ts:436-441 | 学习模型吃伪造成功（主审独立脚本复核成立） |
| EXP-2 | **P0** | global reset 后 processedExpansionPlanIds（heap）清空而 Memory.kernel.expansion 幸存 → 同一 operation 重发 DecisionRecord 并覆写 decisionId；旧 Experience 随 heap 蒸发（无孤儿，代价=每次重启一条假决策+观测失忆） | decision-trace-system.ts:85,:893-1002 | 每次 deploy 必现 |
| TMP-1 | **P1** | `duration = tick - startedAt` 只量到最后一个状态的时长（startedAt 每次转换被覆盖）→ expansionDuration 系统性谎报（30k tick 扩张可报 <100t） | expansion-manager.ts:724,:734 → experience-collector:441 → attribution.ts:672 | A6 扩张归因基线被腐蚀 |
| A6-R | **P1** | recovery outcome 用**终身累计** succeededCount/failedCount 算成功率 → 每个 recovery 决策都继承帝国历史平均，非本决策结果 | outcome.ts:187-220 ← recovery-lifecycle.ts:756-771 | 系统性假 Outcome（主审复核属实） |
| A6-SL | **P1** | logisticsLevelBefore 硬编码 "stable"（:394）；spawn 通道把决策时 BEFORE 值喂给 AFTER 分类（:401-406）→ 两通道产出幻影 PARTIAL_SUCCESS / 恒 FAILURE | experience-collector-system.ts:394,:401-406 | 七通道中两个系统性误分类 |

## 3. SHOULD_FIX（P2）

- **EXP-4** 配对路径双 recordExpansionOutcome（:394+401、:397+401、:447+450、:458+466、:483+486）→ rhythm ring 失败双计，扭曲暂停调参。
- **SPAWN-1** claimer 请求 home=sponsor 而 cancelRequestsByHome 只按 home=target 过滤 → abort 后 stale claimer 最长 1000t 内孵出打废目标。
- **GC-1** hysteresisCache（expansion-planner.ts:57）无 cap 无 GC——唯一确认的新无界结构（增速慢：每新 plan 一条目）。
- **GC-2** gcTrace 打洞后重算 buf.count 使 getRecentRecords 退化为「最旧优先」直至 ring 回填（查询语义错位，非数据损坏）。
- **PLAN-1** Gate 硬失败分支注释 CANCELLED 代码 EXECUTING（:170-176，即 R1 报告 P2-1 原样保留）→ 计划可被重复 consume 循环。
- **CAL-1** reserveHistory 反推采样时间戳假设严格 100t 节奏（calibration-resolution-system.ts:216-227）；regime 签名对 posture 翻转一票否决全部 in-flight 预测 → 数据损失率∝姿态切换频率（损失非污染）。
- **CONF-1** computeOutcomeConfidence 导入未用 / computeAttributionConfidence 零调用 → L5 单调性成立但绝对置信度靠手选常数。

## 4. TECHNICAL_DEBT（P3）

defense 经验通道结构性死亡（threat 字段从未填充→全部 UNRESOLVED）；spawn.spawning 无 watchdog；
20k 丢房宽限期内 remoteOps/队列残留 + 黑名单跨重获存活；过期判定 `>`/`>=` 分裂；
OUTCOME_LOST/STOLEN(3) 在 domain 层落入 UNKNOWN 的码表契约缺口（CF-LONG 已固化）；
bootstrap「失去视野」瞬时窗口记 LOST+拉黑；preparing 超时用刚刷新的 startedAt。

## 5. 十五问简答（详各分册）

1. **A3 可作 Runtime Foundation？** 执行层可以（GREEN）；其**遥测输出**在修复 §2 前不可作学习事实源。
2. **Operation Identity 稳定？** 运行中稳定（单槽+planId）；跨 reset 不稳定（EXP-2）。
3. **decisionId 生命周期漏洞？** 有：它是 latest-decision identity 而非 operation identity（EXP-1/2、fallback 键漂移）。
4. **TD-39 保留？** 保留，ACCEPTED LOW RISK（A-F 全 NO）。
5. **新的数据错配？** 有（§2 全部）。
6. **新的无界内存？** hysteresisCache（GC-1）；其余普查全有界。
7. **长期运行退化？** Runtime 无退化路径；A6 数据质量随时间被 §2 缺陷持续污染。
8. **跨房一致性问题？** 快照代际混用限单 tick 且影响小；empire planner 输入无陈旧度守卫（P2，实际 100-300t）。
9. **异常恢复漏洞？** 14 场景 0 WEDGE；S5/S9/S13 DOWNGRADE 但可恢复。
10. **A6 数据仍可信？** expansion/recovery/logistics/spawn 四通道不可信；war/economic 低偏；defense 空。
11. **Temporal Leakage？** Prediction→Resolution 无未来泄漏（窗口过滤严格）；泄漏方向相反——**过去被冒充现在**（A6-SL/A6-R）。
12. **新 Decision Authority？** 无（L6 grep 复验，shadow-only 完好）。
13. **继续冻结 A6？** 是，且修复 §2 前不得解冻。
14. **开始真实长期运行？** Runtime 可以；建议携带「A6 数据不可信」标注上线。
15. **下一阶段最重要的问题？** 把 Outcome 写入端改为**事件队列 + 终态-only 语义**（消灭单槽覆盖、提前 SUCCESS、reset 重建），这是全部 §2 缺陷的共同根。

## 6. 分册索引

1. PHASE38_STATE_LIFECYCLE_AUDIT.md — 全结构 Owner/Writer/Reader/Cap/GC 表
2. PHASE38_TEMPORAL_INTEGRITY_AUDIT.md — 时间一致性 + 跨房间一致
3. PHASE38_EXPANSION_IDENTITY_AUDIT.md — §四 13 问逐条 + decisionId 裁决
4. PHASE38_RESOURCE_GROWTH_AUDIT.md — 资源增长四观察点 + 结构表
5. PHASE38_FAILURE_RECOVERY_AUDIT.md — S1-S14 注入矩阵
6. PHASE38_A6_DATA_INTEGRITY_AUDIT.md — A6 数据契约矩阵 L1-L6
7. PHASE38_COUNTERFACTUAL_RESULTS.md — CF-LONG-01~20 结果
8. TD-39 裁决并入本册 §7 与 EXPANSION_IDENTITY 分册附录

## 7. TD-39 特别裁决块（按 §十四 规则）

```
A. trim 后重复 Decision?      NO —— planId={room}@{discoveredAt} 不可再生；
                              终态 Plan 不会回到 WAITING_EXECUTION；fallback 键含单调 tick 不碰撞
B. 重复 Outcome?              NO —— Outcome 由状态机终态转换驱动，与本 Set 无关
C. 错误 Attribution?          NO —— 匹配是 decisionId 严格相等；即使重复 Decision 其 id 必异，
                              断的是覆盖不是串线
D. Calibration 污染?          NO —— 无 Outcome 的重复记录不构成带标签样本
E. Phantom Experience?        NO —— Set 门禁的是 Decision 创建，非 Experience
F. Experience UNRESOLVED?     NO —— resolution 依赖 Memory.decisionId 链，trim 不触碰

结论：A-E=NO 且 F=NO → 连 ACCEPTED_LOW_RISK 条款都未触发 → TD-39 = ACCEPTED (LOW RISK)
附注：真正需要警惕的是 trim 之外的两条残差（legacy Memory 无 planId 时 fallback 键漂移；
global reset 重建），均已列入 EXP-2/分册，与 FIFO trim 无关。
```

*审计过程未修改任何生产代码；新增文件仅 tests/unit/phase38/cf-long-run.test.ts 与本目录文档。*
