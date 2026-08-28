# ARCHITECTURE_VALIDATION · 架构压力测试（场景 A–J）

> Phase 1 §30：架构必须通过十个场景的推演验证才能冻结。每个场景给出：设定 /
> 架构响应链（逐层推演）/ 通过判据 / 薄弱点。依据：冻结层各契约 + research/24/29/30。
> 本文档是冻结前的最后一道验证门，红队（ARCHITECTURE_RED_TEAM.md）在其后执行。

## 0. 验证等级（唯一权威定义 · 全仓引用此处，不得另造术语）

本文档十场景全部处于 **Design-Verified** 级。任何文档、测试报告或发布记录描述
某个能力时必须标注下列等级之一；**禁止用「架构通过」推导「线上已经通过」**：

| 等级 | 含义 | 证据形态 |
| --- | --- | --- |
| **Design-Verified** | 设计推演闭合（本文十场景、红队） | 本文场景链 + 通过判据 |
| **Code-Verified** | 源码实现且测试覆盖 | 单元/集成测试在指定 commit 全绿 |
| **Integration-Verified** | 模拟/集成场景通过（私服 mockup） | tests/integration、tests/e2e 场景记录 + commit |
| **Soak-Verified** | 指定 commit 和数据文件的长期运行证据 | soak artifact（commit + schemaVersion + 文件 + tick 范围绑定） |
| **Release-Ready** | 满足发布门禁（[RELEASE_GATE_AND_ROLLBACK.md](../implementation/RELEASE_GATE_AND_ROLLBACK.md) 全部门禁） | 发布记录模板填写完整 |

当前全仓最高等级：Design-Verified（十场景）+ Code-Verified（单元/集成测试）；
Soak-Verified 项因 schema 版本错位（旧 soak sv=39 vs 当前 sv=42）与 artifact 缺失
整体降级为 **Historical Evidence**，登记见
[CANARY_SOAK_PROCEDURE.md](../implementation/CANARY_SOAK_PROCEDURE.md) §5 与当前
状态快照 [STATUS.md](../STATUS.md)。

## Scenario A · 单房间 RCL1 → RCL8

**设定**：空 Memory、1 spawn 300 能量、零人工指令，发展到 RCL8。
**架构响应链**：bootstrap phase（harvester 直供→静态矿工+container，10 号 phase0）
→ 请求池物流在 storage 建立后接管 → phase 推进锚定相变点（4/5/6/7/8）→ 版本化
蓝图逐段推进 → link 网自动化 → RCL8 后 sink 目标集（GCL farm/temple/power）接管
富余能量（防 A10 停滞误诊）。
**通过判据**：全程无人工 flag/console；模板冲突只标 blocked；能量净流在 phase3
后持续为正；RCL7→8 纯升级期（≥72,900 tick）不发生人口断档。
**薄弱点**：RCL6→7 建造高峰期的 spawn 争抢（车道制缓解）；极端地形的模板适配。

## Scenario B · 2 Room

**设定**：主房 RCL6+，扩张第二房（殖民自举）。
**架构响应链**：扩张=AgendaItem（七因子评分+G1–G5 门控，17 号）→ 先 remote 尽调
后 colonize → 殖民 creep 落地自续命 + 母房 5000 能量输血 + 工地 rampart → 新房
六闭环自举 → 失败降级表（自举超时→降为 remote/放弃）。
**通过判据**：母房净流在输血期不转负（G 门控）；殖民失败在期限内自动降级；两房
report/request 通道无死锁。
**薄弱点**：输血节奏与母房 spawn 车道的争抢（殖民走 P2，灾后恢复 P0 优先）。

## Scenario C · 5 Room

**设定**：5 自有房 + 若干远矿车道，GCL 5。
**架构响应链**：房间注册表+帝国态势快照（分频聚合，红队 A1）→ 跨房调拨走
terminal 网络（阈值制+运费指数核算）→ 远矿车道=母房属地 Operation（帝国立项，
ROI 定价）→ 单房故障域隔离（援助上限+可降级）。
**通过判据**：任一房能量清零模拟不拖垮其余四房；调拨遵守「本土净流为正」；
远矿在 CPU 紧张时按序最先牺牲。
**薄弱点**：调拨与本地预算的边界（战争征调例外策略需显式）。

## Scenario D · 10 Room

**设定**：10 房帝国，混合 phase，2–3 条战争准备线。
**架构响应链**：每房 CPU 预算 B=U−F−C（20 号公式）→ 四档看门狗总量裁决 →
战略层输入分频（态势 N tick 全量+每 tick 增量）→ 交通仲裁按房分桶 → 市场系统
低频缓存 getAllOrders。
**通过判据**：总 CPU 在 limit 内且 p95 不随房数线性恶化（分频+派生索引摊平）；
Memory 体积 O(rooms) 不超预算；无 P3 永久饥饿（老化生效）。
**薄弱点**：每房预算公式的参数（待 A2 后实测校准——SYNTHESIS §5 已列）。

## Scenario E · 20+ Room

**设定**：20+ 房、多战区、跨 shard 边缘。
**架构响应链**：战略层分频周期自动拉长（红队 A1）→ 扩张门控（EMA 三指标）拒绝
进一步扩张 → terminal 网络分层（近距调拨/远距走市场）→ power creep 辅助产能
（后期 sink）。跨 shard 默认不启用（P12，A5 后裁决）。
**通过判据**：bucket 不因规模下滑到 Guarded 以下；帝国单点（Policy/SpawnManager）
CPU 为 O(1) 或 O(log) 而非 O(rooms) 每_tick；posture 切换延迟 ≤ 态势分频周期。
**薄弱点**：20+ 房的真实数据缺失（SYNTHESIS §5：A5 soak 验证）。

## Scenario F · 战争

**设定**：宿敌持续入侵 + 多房同时被袭 + 被诱饵挑衅。
**架构响应链**：威胁四级分级（14 号）→ 防御状态机（normal→alert→siege→recovery）
→ war 授权链（持续被打+打得起：预期损失≤战争基金）→ war-planner 唯一进攻者 →
止损链（伤亡阈值收摊/黑名单冷却/经济超标退 fortify，滞回≥波次周期——红队 A3）
→ 多房 safemode 抉择（可保住的房子优先评分，15 号决策表）→ 战后核验只信新鲜
intel（evaluateWarOutcome）。
**通过判据**：战争全程经济不越红线（战争账本）；诱饵不触发授权（「打得起」门控
拒绝）；两房同 siege 时资源仲裁上收帝国无死锁。
**薄弱点**：对抗演化不可静态根除（29 号 R-15，依赖账本复盘闭环）。

## Scenario G · Energy Crisis

**设定**：storage 清零 + source 断供（围城/远矿全失）。
**架构响应链**：能量收支核算（净流转负检测）→ 预算紧缩（P3 停→P2 限流）→
灾后下限保证（官方事实：spawn+extension <300 时每 tick 自回 1；紧急直通 ≥200
能量 [W,C,M]）→ 恢复期分批节流（远矿车道逐条恢复——红队 A2）→ 目标回到净流
为正。
**通过判据**：低能量注入测试在限定 tick 内恢复（28 号 S5）；无二次降级振荡；
spawn 恢复 P0 优先级全程保持。
**薄弱点**：恢复期人口结构（老龄化 creep 的 recycle 时机）。

## Scenario H · Spawn Failure

**设定**：SpawnManager 异常 / 黑名单+能量不足叠加死锁 / spawn 被毁。
**架构响应链**：P0 永不熔断（红队 A5）→ 内核级紧急直通（不依赖 P1+ 系统健康）
→ 幂等 key 防重复孵化 → 撤销通道+recycle 通道清理 → spawn 被毁→建造管理重建
（P0 级 site）+ 母房代孵（多房协调）。
**通过判据**：连续 3 次失败不产生冷却停摆（P0 例外）；队列无永久卡死项
（deadline 过期自动撤销）；被毁 spawn 在重建期内人口由邻房支援。
**薄弱点**：母房代孵的路由与能量核算。

## Scenario I · Logistics Failure

**设定**：hauler 大量阵亡 / link 断链 / terminal 冷却冲突 / 请求池死锁。
**架构响应链**：租约超时自动回收（六态生命周期）→ 断链 fallback 链（container
缓冲→本地直供降级）→ 请求 aging 防饥饿 → 空载率/延迟遥测触发自愈（补 hauler/
重算路由）→ 极端时 phase 降级回 harvester 直供形态。
**通过判据**：断链注入后 N tick 内恢复或降级；无请求永久滞留（年龄告警）；
tower 能量补给在围城期不断供（15 号能量会计）。
**薄弱点**：多请求方争抢同一供给的评分稳定性。

## Scenario J · CPU Overload

**设定**：脚本超限→bucket 下滑→逼近 Recovery。
**架构响应链**：四档看门狗比例化降级（立即生效；CpuTier 枚举仅四档，Emergency
Survival Mode 是 Recovery 档内的紧急再收缩状态而非第五档，见
[RELEASE_GATE_AND_ROLLBACK.md](../implementation/RELEASE_GATE_AND_ROLLBACK.md) §5.2）→
牺牲序：P3（远矿/建造/军事
集结）→P2 限流→P1 保核心经济→P0 永不动（spawn 恢复/防御）→ 恢复走滞回 →
tickLimit 的 500 bucket 透支余量用于 global reset 后首 tick 重建峰值（红队 A11
确认）。
**通过判据**：人工压 bucket 注入触发正确降级序与恢复 MTTR（29 号 R-01 验证）；
死亡循环不发生（降级链在 bucket 耗尽前生效）；pixel 仅 Healthy 档。
**薄弱点**：降级阈值参数需按本账户 limit 校准（合同只约束比例化规则）。

## 总判定

十场景全部在既有契约内闭合：**无场景要求新增架构组件，无场景暴露不可修复的
结构缺陷**。6 个薄弱点全部是参数级（已在 RESEARCH_SYNTHESIS §5 登记验证时点）
或已由红队修订覆盖。**架构通过验证（Design-Verified 级，见 §0），进入红队评审。**
本判定**仅覆盖设计层**：不等于 Code-Verified / Soak-Verified / Release-Ready，
运行时验收状态以 [STATUS.md](../STATUS.md) 与
[RELEASE_GATE_AND_ROLLBACK.md](../implementation/RELEASE_GATE_AND_ROLLBACK.md)
的 Blocked 项登记为准。
