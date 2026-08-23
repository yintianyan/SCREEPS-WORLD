# P3_BASELINE — Phase 3 开工前经济基线

> 日期：2026-08-23。基线代码：HEAD=8728521（质量门：typecheck 0 错误、单测 2518/2518 绿）。
> 载体：TestWorld 集成仿真（tests/integration/scenarios/p3-baseline.test.ts，种子 12345 可复现）。
> 数据：docs/phase3/data/p3-baseline-{cold-start,rcl4-storage}.json。

## 1. 口径与诚实声明

| 项 | 口径 |
| --- | --- |
| 收入/消费能量 | TestWorld 物理层实测累计（harvest/upgrade/build 动作实收实付）；spawn 能量按 body 成本表差分实测 |
| 净流 | 总储备（room 全口径）窗口差分——**不是**合同三指标的 EMA 净流（那正是 P3 要建的） |
| CPU / Bucket | mockup 无真实 CPU 计量，**本基线不采集**；真实 CPU 证据以 PHASE_2_FINAL_REPORT §5（常态<12/p99<17@20CPU）与后续官服/e2e 遥测为准 |
| 场景预设 | cold-start＝RCL1 零 creep 双 source 平地；rcl4-storage＝RCL4 标准 storage 预设（storage 20k、双 source container、20 extension、tower、标准六 creep 人口） |
| 运行成本 | 全量 10k×2 ≈ 2.3s（可进 CI）；P3_BASELINE_FULL=1 切换全量档 |

## 2. Cold-start（RCL1 冷启动自举轨迹）

| 窗口 | 净流 | harvest | upgE | buildE | spawnE(只) | 死亡 | 人口均值 | spawn 利用率 | RCL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0–1k | **+543** | 7142 | 504 | 3945 | 2150(9) | 0 | 5.9 | 5.1% | 1→2 |
| 1k–5k | **−569** | 7249 | 1028 | 5890 | 400(2) | 12 | 3.1 | 1.3% | 2 |
| 5k–10k | ±0 | 0 | 0 | 0 | 0(0) | 0 | **0** | 0% | 2 |

轨迹机制（样本逐 250 tick）：

1. t≈25–1025：健康自举。人口升至 10（w1/h2/b5/u2），RCL2 达成，储备峰值 590。
2. t≈1300–2300：第一代 cohort（TTL 1500，与真实引擎一致）同步到期，**替换孵化失败**——同期建造支出把房间抽干到 E30，replacement 无能量可用；人口 11→3。
3. t≈2500–3000：最后 2 只 harvester 到期死亡，人口归零。
4. t≥3025：**永久死锁**——spawn 恒定 E30/300 < 最低 body 成本 200，无 creep 则无采集、无采集则无能量，7000 ticks 零恢复。

## 3. RCL4 Storage（既成经济形态）

| 窗口 | 净流 | harvest | upgE | buildE | spawnE(只) | 死亡 | 人口均值 | spawn 利用率 | 收入速率 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0–1k | −7928（建设期） | 14502 | 36 | 6962 | 7700(16) | 0 | 11.6 | 38.5% | 14.5/tick |
| 1k–5k | **+12332** | 75734 | 17596 | 0 | 20900(28) | 25 | 9.0 | 26.9% | **18.9/tick** |
| 5k–10k | **+886** | 98390 | 912 | 0 | 14500(29) | 28 | 8.7 | 12.5% | **19.7/tick** |

判读：

- 收入端健康且稳定：双 source 实采 ≈19–20 能量/tick 持续 9k ticks（与理论 2×source 上界量级一致）。
- 人口替换 churn 正常：稳态人口 ~9、寿命 1500 ⇒ 期望 9k ticks 孵化 ≈54 只，实测 57 只——died≈spawned 是 TTL 替换而非异常损耗。
- 后期 upgE 骤降（17596→912）是**预设伪影**：preset 把 controller progress 预置为满（200000），upgrader 无处入账；非 AI 缺陷。下轮采集改为 progress 0（B3）。
- 储备持续上行（17k→31k）而升级停滞——「库存很多 ≠ 生产能力强」的任务书 §36 论断在数据上直接成立：flow（净流）与 stock（storage 水位）必须分开度量。

## 4. 基线发现登记

| # | 发现 | 定性 | 处置 |
| --- | --- | --- | --- |
| B1 | **冷启动 10k 不可存活**：cohort 同步到期 + 无替换预留纪律 → 全灭后 E30 死锁 7000 ticks，零自愈 | 与 A1 证据（e2e 真实引擎 mockup 11k 绿）存在**口径分歧**——需裁决是 TestWorld 保真度差异还是真实回归；mockup TTL=1500 已核实与引擎一致，movement/吞吐效率未核实 | **P3 入口调查项**（见 §6）；修复方向与 P3 的 Reservation/预算纪律天然重合 |
| B2 | TestWorld MockSpawn 未实现官方 recycleCreep API（rcl4 世界每 tick TypeError，safeRun 正确隔离但污染错误断言） | 测试基建缺口（已修复：按剩余寿命比例返还能量语义补齐） | ✅ 本批次闭环 |
| B3 | 基线场景 RCL4 preset progress 满值压制 upgrade 观测 | 场景伪影 | 下轮采集改 .rcl(4, 0) |

## 5. 任务书核心问题的回答

> **当前 Room 是「活着」，还是已经具备「稳定生产能力」？**

分形态回答：

- **RCL4+ storage 形态：已具备稳定生产能力**——收入 19+/tick 连续为正、净流两窗口为正、人口自替换平衡、无振荡迹象（该形态下 Survival 与 Production 重合）。
- **冷启动/低容量形态（RCL1–2）：只是「活着」，且活不长**——首代 cohort 同步到期即崩，全灭后无任何自愈路径（E<200 死锁）。当前系统的生存性建立在「不发生同步减员」的运气上，而非经济纪律上。

这正是任务书 §5「Survival ≠ Production」的实证：**储备水位（曾达 590 / 31k）掩盖了零替换保障的脆弱性**。P3 的 Reservation（spawn 排产预留）、风险缓冲（断供耐受 tick 数）、Request Pool（需求不静默丢失）正是对症药。

## 6. B1 定量归因（P3 核算遥测上线后回测，2026-08-23）

Accounting 系统接入后重跑同种子冷启动，崩塌窗口的三指标轨迹（economy 瘦快照采样）：

| tick | 净流 EMA | 估计收入 | 效率系数 | 人口 | ea |
| --- | --- | --- | --- | --- | --- |
| 100–500 | +2.68→+0.37 | 12.9→8.6 | 64→43% | 2→6 | ≤150 |
| 750–1000 | −0.21→+0.71 | 8.7→9.7 | 43→49% | 9→10 | 132→300 |
| 1250–1500 | **−0.02→−1.45** | 10.1→10.4 | 51→52% | 11→11→9 | 300→30 |
| 1750–2500 | ≈0 | 9.5→2.0 | 48→10% | 9→2 | 30 |
| ≥3250 | 0 | →0 | →0 | **0** | 30 |

归因结论：净流在 **t≈1250–1500 转负**（首代替换潮 × buildE 5890 的 P2 支出叠加），
此后收入端随人口死亡级联塌缩（ei 9.5→2.0），无任何机制在 ea=30 死锁前介入。
风险缓冲（rb）在本场景恒为 0——RCL1-3 无合同储备池，三指标的风险预警天然失明，
这验证了「风险预留仅 scoped 到 storage 经济」的 Step7 设计，同时暴露残留缺口：
**低容量房的替换保障需要 spendable 口径的前馈预留**（spawn-domain，Step 10/11
与 B4 重写一并处理，见 TECH_DEBT_LEDGER P3 批次）。

## 7. 50k Soak 结果（P3_SOAK=1，2026-08-23 追加）

| 世界 | 窗口 | 净流 | 收入速率 | 人口 | 备注 |
| --- | --- | --- | --- | --- | --- |
| rcl4-storage | 1k–25k | **+8100** | 17.9/tick | ~9.5 | 替换 churn 正常 |
| rcl4-storage | 25k–50k | −9361* | 18.9/tick | ~11.1 | *粗口径差值（未含 repair/refund 计数），econ.nf 全程为正 |
| cold-start | 全程 | — | — | 0 | B1 崩塌复现（已登记） |

- rcl4 @50k：收入 17.9–19.0/tick 持续、净流 EMA 全程为正（econ.nf 轨迹）、storage 水位
  在 7k–20k 区间波动、无振荡崩塌——**storage 经济形态的产能闭环在 50k 尺度稳定**。
- B3 修正生效：progress 从 0 起，upgrade 观测恢复（66.9k 能量入 controller）。
- cold-start B1 复现如前——RCL1-3 替换保障缺口为已登记残留项。

## 8. 给 P3 设计的硬输入

1. **风险缓冲必须能拦住 B1**：reserve ÷ (P0+P1 消耗速率) 在 t≈1000 时应给出「替换潮来临前储备不足」的预警并冻结 P2 支出（buildE 5890 的建造热忱正是抽干元凶）。
2. **spawn 排产预留**：replacement horizon 内的必孵成本要从可用量中扣除，杜绝「有账面储备、无孵化现金」。
3. **cohort 去同步**属 spawn-domain 参数（出生 TTL 抖动/错峰），在 REQUEST_POOL_DESIGN 中作为 Request 生成侧约束登记，不在 P3 强扩。
4. Accounting 恒等式验证将以本次实测计数器为对照基准（Start+Income−Consumption±Transfers=End）。
5. B1 的 TestWorld↔e2e 口径裁决：若 P3 实现后 TestWorld 冷启动仍不可存活而 e2e 绿，则升级为保真度缺陷专项（movement/吞吐校准），不得用 mockup 单独宣称验收。
