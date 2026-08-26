# PHASE38 · 异常恢复审计（Failure Recovery Audit）

> 范围：任务书 §十一 14 个故障场景 + §十 S 系列补充
> 判定标准：Detect → Classify → Recover → Replan → Resume；或 DOWNGRADE（降级运行）；或 WEDGE（永久卡死=BLOCKER）

## 注入矩阵

| # | 场景 | 判定 | 恢复路径（file:line） |
|---|---|---|---|
| S1 | spawn 突然消失 | **GREEN** | layout-planner:754-792 P0 `constraint.spawn.01`（anchor 受阻→迁移搜索）+ construction critical 快道 + stale-P0 豁免 spawn-manager:45-52 |
| S2 | creep 全灭 | **GREEN** | demand.ts:292-307 livingHarvesters===0 早退 P0 worker（免 churn 冻结/黑名单）+ 六档降级 retries++ 杀死队列饥饿锁 |
| S3 | 扩张中丢房 | **GREEN** | 各态 ownership 检查→abortExpansion(OUTCOME_LOST)：回收 creeps、Plan CANCELLED、Memory 清除、rhythm/blacklist 更新，Outcome 先于清理 |
| S4 | storage 被毁 | **GREEN (DOWNGRADE)** | distributor 退化 hauler 行为（roles/distributor.ts:75-79）、demand 停孵 distributor、layout 重规划 storage。吞吐下降非卡死 |
| S5 | expansion timeout 强推 | **DOWNGRADE — 语义不健全（P1, EXP-1 组成部分）** | 机制不 wedge；但 :571 以「超时到期」为据记 SUCCESS（integrating 强推要求 netFlow>0+integrated，此处仅 CP3）——膨胀 rhythm 成功率、污染 A6 经验分布 |
| S6 | reservation 丢失 | **GREEN (有抖动)** | agenda-manager:287-292 sweep→BLOCKED→释放→下轮重建；无续期路径致长 op 周期性过期重规划（deadline 2000t） |
| S7 | controller downgrade | **GREEN** | isTargetClaimable 阻止已拥有/敌占目标；中途失守→OUTCOME_LOST。⚠️ 附带发现：Gate 硬失败分支注释 CANCELLED 代码 EXECUTING（:170-176，PLAN-1/P2） |
| S8 | Memory 字段缺失 | **GREEN** | kernel.expansion 缺失→idle 路径；decisionId 缺失→trace 轮询补写；lastOutcome.decisionId 缺失→文档化 fallback（exp-collector:431-433）；tuning v7 迁移删畸形 |
| S9 | Memory 类型损坏 | **DOWNGRADE** | 迁移链幂等自愈已知形态+断点保护（memory.ts:1066-1078）；未知形态在 safeRun 内炸→非关键系统 ≤200t 冷却重试，功能级损失永不全局崩溃。无通用类型校验（登记债） |
| S10/S11 | global reset / 重启 | **GREEN（干净损失，无幻影）** | heap 全丢（ring/processedSets/lastExpansionOutcome 同生共灭）；重启后同 plan 重发 Decision D2 并覆写 Memory.decisionId→后续 Outcome 关联 D2 自洽；旧 Experience 无孤儿。代价=观测失忆+一条假决策（EXP-2 登记为数据质量 BLOCKER，但恢复语义本身正确） |
| S12 | 小时级 tick gap | **GREEN/DOWNGRADE** | TTL 类全部一致过期：reservation sweep、路由/走廊缓存按时间戳失效、TimeSeries gap→INSUFFICIENT_OBSERVATION（诚实）；跨越 gap 的扩张按超时梯子干净 abort 带 Outcome；bucket 回填后全节奏恢复 |
| S13 | 多日 recovery 档 | **DOWNGRADE，不 wedge** | maxPriority(recovery)=1 冻结全部 P3 含 expansion-manager 自身——状态在 Memory 中休眠，超时按 tick-delta 计故短 dip 不 abort、长 dip 干净 abort；p3StarveBypass 正确要求 bucket≥3000（scheduler:137-138）低 bucket 不误启；P0/P1 维持经济呼吸 |
| S14 | 连续 budget skip + safeRun 冷却 | **GREEN** | budget skip 只记 skipReason 不进冷却（kernel:274-290）；冷却仅由异常触发且非关键系统封顶 200t 重试不弃；E2 旁路保留 W37S58 修复 |

## 结论

- **WEDGE 计数 = 0**：14 场景无一产生永久卡死。
- **不可恢复损失 = 观测层 only**：S10/S12/S13 的损失全部是 A6/遥测数据，Runtime 真相源（Memory 结构、
  世界对象、经济账本）完整。
- **语义健全性缺口 1 处**：S5 的强推 SUCCESS（已并入主册 EXP-1 BLOCKER）。
- **值得表扬的恢复设计**：P0 worker 生命线、六档 body 降级的 retries++ 死锁破解、
  segment 就绪门禁防首拍覆盖历史、E1/E2 前馈旁路的 bucket 门控。

## 与 R1 审计的增量

R1 的 12 项注入矩阵全部维持 GREEN/DOWNGRADE 结论；本轮新增 S6/S13/S14 三项深检与 S5 的语义降级新判定。
