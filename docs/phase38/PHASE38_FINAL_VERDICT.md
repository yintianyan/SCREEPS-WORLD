# PHASE38 · 最终裁决（Final Verdict）

> 日期：2026-08-26 · 审计对象：Runtime Foundation + A3 + A6 Shadow Intelligence（工作区状态）
> 结论适用规则：任务书 §十八

## 裁决：**BLOCKED**（针对「A6 数据链路可信」）/ **GREEN_WITH_TECHNICAL_DEBT**（针对 Runtime Foundation 本体）

依据任务书裁决规则：

| 触发条款 | 事实 |
|---|---|
| P1 Data identity / attribution bug → BLOCKER | 命中 ≥5 项：EXP-1 提前 SUCCESS 被采为终态、EXP-2 reset 重建 Decision、TMP-1 duration 谎报、A6-R recoveryStats 累计污染、A6-SL spawn/logistics 通道 BEFORE/AFTER 错位、**TIMEOUT-SEMANTICS TIMEOUT 不等于 Terminal** |
| P0 Runtime correctness bug | 未命中——执行层状态机/经济/spawn 主干经五路深审+14 场景注入无 correctness 缺陷 |
| P1 Unbounded memory | 未命中新阻断级——hysteresisCache 无界但增速极缓（SHOULD_FIX） |
| P1 Permanent state deadlock | 未命中——14 场景 WEDGE=0 |

两个裁决并不矛盾：**机器可以安全地上线长期运行；它的学习日记目前不能当真。**

## 十五问正式回答

### 1. A3 是否真正可以作为 Runtime Foundation？
**是。** 执行层 GREEN：单槽状态机全覆盖终止路径、无双执行、清理先于记录、五态超时闸完整、
GCL/姿态/预算门禁真实生效。但它当前的**遥测输出**（Outcome 事件流）在修复 EXP 组之前不可作为学习事实源。

### 2. Expansion Operation Identity 是否真正稳定？
运行中稳定，跨生命周期边界不稳定。单槽 + planId 在一次进程 epoch 内提供可靠身份；
global reset 必然重建一条 Decision 并覆写 decisionId。

### 3. decisionId 是否存在生命周期漏洞？
存在，且根因明确：它是**惰性分配的 latest-decision identity**，而非 consume 时一次性铸造的
operation identity。三个漏洞（reset 重建 / fallback 键漂移 / 单槽 Outcome 通道）同根同源。

### 4. TD-39 是否应该继续保留？
**保留，ACCEPTED LOW RISK。** 六问 A-F 全 NO（主册 §7）：trim 后键不可再生、Outcome 不走该通道、
归因靠严格 id 相等即使重复也不串线。500 cap 在每 operation 一决策的真实节奏下不可达。
两条 trim 之外的残差（legacy planId 缺失漂移、reset 重建）已单列 EXP-2 追踪。

### 5. 是否存在新的数据错配？
是。见 §2 BLOCKER 清单与 A6 分册 L2 七通道逐条判定：recovery（终身累计率）、logistics
（硬编码 stable）、spawn（BEFORE 喂 AFTER）三通道系统性失真为本轮新发现。

### 6. 是否存在新的无界内存？
一处：hysteresisCache（expansion-planner.ts:57，模块级 Map 零删除）。增速≈每扩张尝试一条目，
不阻断上线，SHOULD_FIX。其余 25 个普查结构全部有界（STATE_LIFECYCLE 分册表）。
snapshotRegistry 修复经验证有效并已固化（CF-LONG-10）。

### 7. 是否存在长期运行退化？
Runtime 无退化路径：ring/GC/TTL 全部进入稳态循环，E2E 11k tick 与静态论证一致。
退化发生在**数据质量维度**：只要扩张/recovery 持续发生，A6 的 Experience 分布就持续被
伪造 SUCCESS 和错误基线污染——时间越久，未来若解冻 A6，学到的错误越牢固。

### 8. 是否存在跨房间一致性问题？
无代际性错误。快照先行+顺序消费保证主链一致；直读 Game.* 的代际混用限单 tick 资源估算级（P3）。
两项 P2：empire planner 输入无陈旧度守卫（实际 100-300t）、20k 丢房宽限期的残留可见性。

### 9. 是否存在异常恢复漏洞？
无 WEDGE 级漏洞。14 场景：12 GREEN、2 DOWNGRADE（S5 语义、S9 类型损坏功能级损失）。
观测层在 reset/gap 中会失忆（by design），真相源无损。

### 10. A6 数据是否仍然可信？
**否（部分）。** expansion/war 上游写入端缺陷（EXP 组）+ recovery/logistics/spawn 三通道系统性失真 +
defense 通道空转。可信的只有：决策摄取（L1）、confidence 单调性（L5 机制）、边界隔离（L6）。
这正是「Shadow-Only 冻结」的价值所在——坏数据被隔离在观测层，未流入任何执行决策。

### 11. 是否存在 Temporal Leakage？
未来信息泄漏：**无**（预测窗口过滤严格、测量延迟闸正确、事件关联全程 id 优先）。
反向泄漏（过去冒充现在）：**有**（duration 只量末态、累计计数器冒充决策结果、BEFORE/AFTER 错位）。

### 12. 是否存在新的 Decision Authority？
无。六系统零 Game API 变更、五个 cache 零外部消费者、guards 白名单仅用于检测——本轮全库 grep 复验成立。

### 13. 是否应该继续冻结 A6？
**是，且加码**：修复主册 §2 BLOCKER 清单之前，A6 不仅应保持冻结，其数据还应被标注
「训练用途禁止」。当前冻结契约完好，无需修改任何 A6.1–A6.6 代码即可完成上游修复
（全部缺陷在 expansion-manager / experience-collector 的写入与匹配层）。

### 14. 是否应该开始真实长期运行？
**Runtime 层面：应该。** 这是本审计最重要的正面结论：14 个故障场景无一永久卡死、内存除一项慢速
增长外全部有界、bucket/CPU 降级语义经过线上事故背书、经济三条死亡螺旋防线实证存在。
建议携带以下标注上线：(a) TD-39 ACCEPTED；(b) hysteresisCache 待修；(c) A6 数据不可信；
(d) claimer 幽灵请求与 RCL8 能量 bleed 两项已知损耗。真实官服数据反过来会加速 §2 缺陷的复现与验证。

### 15. 下一阶段最重要的问题是什么？
**把 Outcome 写入端从「单槽 latest-wins + 中间里程碑混入」重构为「带 decisionId 的有界事件队列 +
终态-only 语义」。** 这一个根修同时消灭：提前 SUCCESS 抢占（EXP-1）、<100t 覆盖丢失（EXP-3）、
reset 单槽蒸发（EXP-2 的一半）、双写重复计数（EXP-4）。次优先：recovery delta 基线与
logistics/spawn 双快照（A6-R/A6-SL），以及 operation identity 在 consume 时一次性铸造。

## 补充：TIMEOUT-SEMANTICS 审计裁决

### 新增 BLOCKER：TIMEOUT-SEMANTICS

Phase 37 代码审查发现的三处 timeout 强推路径终态语义不一致问题，经专项审计确认
为 **ARCHITECTURE_BLOCKED** 级别，详见 [PHASE38_TIMEOUT_SEMANTICS_AUDIT.md](PHASE38_TIMEOUT_SEMANTICS_AUDIT.md)。

核心发现：

1. `OUTCOME_TIMEOUT` 不一定代表 Terminal Failure——在 `advanceBootstrapping` :458 中
   它是 **TIMEOUT AS TRANSITION**（Operation 继续运行到 `economic_startup`）。
2. 存在 `TIMEOUT → later SUCCESS` 路径（P5→P7→P8）。
3. 存在 `SUCCESS → later FAILURE` 路径（P7→A11/A12）。
4. 存在多个 `SUCCESS` 写入（P1+P7+P8 = 3 次，只有 P8 是 terminal）。
5. 四条 Invariant（I11-I14）中 I11/I12/I13 均不满足。

UOEM 模型的消解路径：
- P1 (:346)、P5 (:458)、P7 (:571) 改为 `MilestoneEvent`，不进入 outcome 通道
- P8/P9 保持 `OutcomeEvent`（唯一终态写入）
- `forcedAdvance` 标志传播：经历过任何 `FORCED_ADVANCE` milestone 的 Operation，
  其 terminal outcome 的 `forcedAdvance = true`
- rhythm ring 消费者不再把 milestone 计入 consecutiveFailures

反事实测试 T1-T5（12 用例）已通过，证明 UOEM 模型在类型与所有权层面正确表达了
TIMEOUT 的三态语义。

### 最终证明清单

Phase 38 的最终裁决现在必须同时证明以下六项全部能被 UOEM 正确表达：

| # | 问题 | 证据文档 | 消解机制 | 测试 |
|---|---|---|---|---|
| EXP-1 | Premature SUCCESS / Milestone-as-Outcome | UOEM §第一部分 | kind 分离 | uoem-proof.test.ts |
| EXP-2 | Reset Identity Rebuild | UOEM §第一部分 | opId 铸造 | uoem-proof.test.ts |
| TMP-1 | Duration 谎报 | UOEM §第一部分 | interval 端点 | uoem-proof.test.ts |
| A6-R | recoveryStats 累计污染 | UOEM §第一部分 | paired delta | uoem-proof.test.ts |
| A6-SL | BEFORE/AFTER 错位 | UOEM §第一部分 | paired observation | uoem-proof.test.ts |
| **TIMEOUT-SEMANTICS** | **TIMEOUT 不等于 Terminal** | **TIMEOUT_SEMANTICS_AUDIT.md** | **Milestone vs Outcome 分离 + forcedAdvance 传播** | **timeout-semantics.test.ts** |

**在以上六项全部被证明之前，不得进入 Implementation。**

---

## 附：审计完整性声明

- 五路深审 agent 的两处分歧由主审裁决：
  (a) 「reset 产生孤儿 UNRESOLVED」不成立——heap 三件套同生共灭，代价是假决策+失忆（Agent 5 版本正确）；
  (b) 「in-progress 守卫防住提前采集」不成立——decisionIdMatch 分支先于该守卫，
      主审以独立脚本复现 BRANCH 1 HIT（Agent 1 版本正确）。
- 审计期间未修改任何生产代码；新增产物：
  - tests/unit/phase38/cf-long-run.test.ts（22 用例全绿）
  - tests/unit/phase38/uoem-proof.test.ts（12 用例全绿）
  - tests/unit/phase38/timeout-semantics.test.ts（12 用例全绿）
  - docs/phase38/ 十一份文档（含 TIMEOUT_SEMANTICS_AUDIT.md）
