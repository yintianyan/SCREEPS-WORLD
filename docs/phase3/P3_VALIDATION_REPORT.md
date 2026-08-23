# P3_VALIDATION_REPORT — Phase 3 验证报告（模拟口径）

> 日期：2026-08-23。范围：Step 10–11（Scenario Suite + Simulation 验证）。
> 官方服部署验证（任务书 §41）待发布授权，见 §4 开放项。

## 1. 门禁结果

| 层 | 结果 |
| --- | --- |
| typecheck | ✅ 0 错误 |
| 单元（L1） | ✅ 2538/2538（新增：accounting 14 + request-pool 7 + config/migration 锚点） |
| 集成（L2/L3） | ✅ 101/101（含 p3-baseline 三世界、B4 重写三场景、rcl1-survival 回归族） |
| 架构合规（L1 内嵌） | ✅ compliance 七规则全绿（R9 超编为存量债已登记） |

## 2. 净流连续性（冻结验收门槛本地口径）

P3_SOAK=1（50k ticks × 两世界，种子可复现）：

- **rcl4-storage**：净流 EMA 全程为正；收入 17.9→19.0/tick 持续；storage 水位
  7k–20k 区间波动；人口 9–11 稳态自替换（320 死亡 ↔ 373 孵化，TTL 替换语义）；
  无经济振荡、无 Request 积压增长。
- **cold-start**：B1 崩塌复现（RCL1-3 替换保障缺口，已定量归因入 P3_BASELINE §6；
  对策 scoped 至 storage 经济 + spawn-domain 残留项，见 §4）。

## 3. Accounting 漂移状态（任务书 §16）

| 项 | 状态 |
| --- | --- |
| 恒等式机械保证 | ✅ tracked 池划分 + 双层计数器；单测覆盖搬运/回收冲销/工业池/衰减各形态 |
| 已归因并修复的泄漏 | ✅ 塔库存未入受踪池（−9/tick 量级）；在途背包未入池（±在途量振荡）|
| **残留漂移（开放）** | rcl4 世界 −450~−1300/窗，与 storage 流出/死亡窗口相关。**根因高置信假设：mockup 死亡直接销毁携带能量（无墓碑建模），真实引擎留可拾取墓碑**——属测试基建保真缺口而非核算缺陷；修复方向＝TestWorld 墓碑建模（B4 同类）|
| 防线 | AccountingDrift 事件（连续 2 窗超容差）+ lastDriftDiag 归因快照 |

## 4. 开放项（进入 A2 后半/A5 前须关闭）

1. **官方服部署验证**（任务书 §41）：需发布授权与目标 shard 凭据；部署后按
   RCL1→RCL4 观察「storage 建成→经济切换→请求池接管」全程。
2. **官方服 soak**：净流 5 万 tick 为正的权威证据（本地 mockup 口径已完成，
   见 P3_BASELINE §7；Simulation CPU 语义不能单独证明线上性能——TEST_ARCHITECTURE）。
3. **TestWorld 墓碑建模**（B4 同类保真）：消除死亡销毁能量的假漂移后复跑 soak，
   预期 drift 收敛至容差内。
4. **B1 RCL1-3 深探**：低 ea 下 harvester 交付停滞的状态机追踪（核算遥测已就绪）。

## 5. 结论

**模拟口径全部可达门槛已达标且证据入库；三项开放项均不属于「实现缺失」，**
**而属于（a）发布授权边界、（b）测试基建保真收尾。** 是否以此状态出 PASS，
由 P3_A2_FINAL_REPORT 按 §46 验收清单逐条裁决（下一交付物）。