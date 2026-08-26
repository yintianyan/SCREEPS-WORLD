# PHASE38 · 反事实测试结果（Counterfactual Results）

> 套件：tests/unit/phase38/cf-long-run.test.ts —— **22/22 PASSED**
> 原则：全部调用真实生产函数（domain/intelligence/{experience,outcome}、kernel/ring-buffer、
> globalCache 单槽语义），不复制生产谓词；断言固化的部分是「真实行为」而非「理想行为」。

## 结果矩阵

| CF | 场景 | 结果 | 固化的真实行为 / 发现 |
|---|---|---|---|
| 01 | 正常→恶化（同 id 双 Outcome） | ✅ | SUCCESS 与 LOST 先后采集均成立——**双 Outcome 结构性存在**（EXP-1 佐证） |
| 02 | 异常→恢复 | ✅ | UNRESOLVED 不可逆，恢复需新建 Experience；pushExperience 计数语义验证 |
| 03 | A/B 同 target | ✅ | decisionId 各自匹配互不错配；B 覆盖单槽后 A 的 pending 匹配失败→安全无注入 |
| 04 | A/B 时间交错 | （并入 03/05 场景组） | — |
| 05 | A 完成立即启 B | ✅ | **A 在 <100t 内被覆盖即永久丢失**（collectOutcome 返回 undefined）→ 兜底靠 expireExperience；宁可 UNRESOLVED 底线成立 |
| 06 | timeout 后重用同 target | ✅ | fallback 键含单调 startedAt 不碰撞；TIMEOUT→EXPIRED 映射正确 |
| 07 | decisionId 丢失 | ✅ | 无 decisionId 走 fallback 分支可采；有 decisionId 但不匹配→不注入（防错配守卫存在） |
| 08 | processedExpansionPlanIds trim (TD-39) | ✅ | trim 后重现仅致重复 Decision 且新 id 必异 → 归因不串线（与 TD-39 裁决一致） |
| 09 | global reset | ✅ | heap 三件套（ring/Sets/lastOutcome）同生共灭；Memory.decisionId 幸存被 D2 覆写；旧经验蒸发非孤儿 |
| 10 | snapshot GC | ✅ | evictStaleSnapshots 判定复验：EXPIRED 不再保护 snapshot；无 resolve-by-hash 读径→驱逐安全 |
| 11 | Prediction expiration + grace | ✅ | expansion 测量延迟 2000t：2999 拒 / 3000 收——提前读取不可能 |
| 12 | RingBuffer rollover | ✅ | kernel ring 满 4 写 10 → [6,7,8,9] 有界有序；experience rollover 静默挤掉最老 pending（可观测缺口登记） |
| 13 | 跨房同 tick | ✅ | 单槽每 tick 至多一次写入的假设成立（recordExpansionOutcome 串行于同一 system run） |
| 14 | Spawn demand duplicate | ✅ | key 幂等合并语义固化 |
| 15 | Creep death + demand recovery | ✅ | P0 worker 键族独立约定固化 |
| 16 | CPU starvation | ✅ | 冻结 20k tick 后 gcExperienceBuffer 一次清空 5 条超龄 pending——不无限积压 |
| 17 | Memory partial corruption | ✅ | outcomeCode=99 → UNKNOWN 不崩溃；缺失 → undefined 安全 |
| 18 | abort + retry | ✅ | 两代 Experience 各自归因；code 4(ABORTED)→UNKNOWN（契约缺口再次暴露） |
| 19 | Room loss + recovery | ✅ | OUTCOME_LOST=3 → domain 层 UNKNOWN（**码表契约缺口固化**：0/1/2 之外的 STOLEN/LOST/ABORTED 全部落 UNKNOWN） |
| 20 | 100k tick deterministic replay（结构层） | ✅ | 50 次决策 ring(cap1000) 不溢出、id 全唯一 |

## 过程中修正的测试自身问题（记录以保持诚实）

1. 初版误把 OUTCOME_LOST 断言为 FAILURE——实际生产映射只有 0/1/2，3/4 落 UNKNOWN。
   这不是测试「失败被修好」，而是**发现并固化了码表契约缺口**（已列入 P3 技术债）。
2. 手工构造 ExperienceRingBuffer 缺 capacity 字段导致 pushExperience 除零——改用生产构造函数
   createExperienceRingBuffer。教训与本审计同构：**测试必须消费生产代码而非复刻其形状**。

## 未能在纯函数层覆盖的场景（登记为后续 E2E 缺口）

CF-LONG-03/04/06/18/19/20 的「真 mock-server 全链路版」、以及 expansion-completion E2E（R1 遗留）
仍缺——现有覆盖是 domain 层不变量，不能证明 systems 层接线在长运行中不出错。
