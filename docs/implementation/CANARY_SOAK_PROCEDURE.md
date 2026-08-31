# CANARY_SOAK_PROCEDURE · Canary 发布与 Soak 验证规程

> **冻结日期**: 2026-08-28
> **适用范围**: Screeps World TypeScript 帝国 — 所有代码从 dev 到线上 MMO 的渐进发布
> **前置契约**: [RELEASE_GATE_AND_ROLLBACK.md](./RELEASE_GATE_AND_ROLLBACK.md), [TEST_ARCHITECTURE.md](../architecture/TEST_ARCHITECTURE.md) §4–§5

---

## 1. Canary 阶段

### 1.1 阶段流水线

```
build
  → static checks (typecheck + lint)
  → unit/integration tests
  → isolated mockup (E2E)
  → private server single room
  → private server multi room
  → canary room (MMO 单房)
  → small room set (MMO 2-3 房)
  → full deployment (MMO 全量)
```

### 1.2 各阶段定义

| 阶段 | 入口条件 | 运行 tick | 观测指标 | 失败阈值 | 自动降级动作 | 停止发布 | 允许继续 | 回滚目标 | 人工介入边界 |
|------|---------|----------|---------|---------|-------------|---------|---------|---------|-------------|
| build | 代码变更 | — | 无 | build 失败 | — | ✅ | ❌ | 修复代码 | 无 |
| static checks | build 成功 | — | typecheck/lint error | 任何 error | — | ✅ | ❌ | 修复类型/lint | 无 |
| unit/integration | static 通过 | — | test pass/fail/skip | 任何失败 | — | ✅ | ❌ | 修复测试 | 无 |
| isolated mockup | unit/integration 通过 | 10,000+ tick | CPU/Memory/queue/site | E2E 失败 | — | ✅ | ❌ | 修复 E2E | 无 |
| private single | mockup 通过 | 50,000+ tick | 见 §2 | 见 §3 | tier 降级 | ✅(如 §3 触发) | ❌(如 P0 失败) / ✅(如通过) | 修复代码 | tier 持续 recovery |
| private multi | private single 通过 | 50,000+ tick | 见 §2 + 多房 | 见 §3 + 多房异常 | tier 降级 + operation 回滚 | ✅(如 §3 触发) | 同上 | 修复代码 | 同上 + 多房失守 |
| canary room | private multi 通过 | 100,000+ tick | 见 §2 + 线上指标 | 见 §3 + 线上阈值 | tier 降级 + operation 回滚 | ✅ | ❌(如 P0) / ✅ | 代码回滚 | bucket < 3000 持续 |
| small room set | canary room 通过 | 200,000+ tick | 见 §2 + 多房公平 | 见 §3 + 多房异常 | 同上 | ✅ | 同上 | 代码回滚 | 同上 |
| full deployment | small set 通过 | 持续运行 | 全量指标 | 见 §3 | 同上 + 人工灾难接管 | ✅ | — | 代码回滚 | 见 §6.2 |

---

## 2. Canary 观测指标

### 2.1 核心 CPU/资源指标

| 指标 | 健康范围 | 警告阈值 | 严重阈值 | 数据来源 |
|------|---------|---------|---------|---------|
| CPU p50 | < softLimit×0.5 | ≥ softLimit×0.7 | ≥ softLimit | telemetry ring buffer |
| CPU p90 | < softLimit×0.7 | ≥ softLimit×0.8 | ≥ softLimit | 同上 |
| CPU p99 | < hardLimit | ≥ hardLimit×0.9 | ≥ hardLimit | 同上 |
| bucket min | > CONFIG.cpu.tiers.conserve.min | < guarded.min | < recovery.min | Game.cpu.bucket |
| bucket median | > guarded.min | < guarded.min | < conserve.min | 同上 |
| Memory p50 | < 15KB | > 20KB | > 30KB | RawMemory.get().length |
| Memory p90 | < 20KB | > 25KB | > 35KB | 同上 |
| Memory max | < 30KB | > 40KB | > 50KB | 同上 |

### 2.2 Queue/Task 指标

| 指标 | 健康范围 | 警告阈值 | 严重阈值 | 数据来源 |
|------|---------|---------|---------|---------|
| spawnQueue max | < 5 | > 10 | > 20 | RoomMemory.spawnQueue.length |
| spawnQueue oldest | < 500 tick | > 1000 tick | > 2000 tick (E3 触发) | queue[0].createdAt |
| buildQueue max | < 10 | > 15 | > 25 | RoomMemory.buildQueue.length |
| buildQueue oldest | < 1000 tick | > 2000 tick | > 5000 tick | queue[0].createdAt |
| task completion rate | > 95% | < 90% | < 80% | 采样统计 |
| spawn completion rate | > 95% | < 90% | < 80% | 采样统计 |
| path success rate | > 90% | < 80% | < 70% | stuck 计数 / 总移动 |
| stuck rate | < 5% | > 10% | > 20% | stuckTicks > 0 的 creep 占比 |

### 2.3 发展指标

| 指标 | 健康范围 | 警告阈值 | 严重阈值 | 数据来源 |
|------|---------|---------|---------|---------|
| RCL progress | 持续增长 | 1000 tick 无进展 | 5000 tick 无进展 (E5 触发) | controller.progress |
| site progress | 持续进展 | 500 tick 无进展 | 2000 tick 无进展 (E7 触发) | site.progress |
| builder productivity | > 0.5 work/tick | < 0.3 | < 0.1 | 采样统计 |
| hauler productivity | > 0.5 fill/tick | < 0.3 | < 0.1 | 采样统计 |
| recovery duration | < 200 tick | > 500 tick | > 1000 tick (E9 触发) | colonyState 振荡 |
| error rate | < 0.1% | > 1% | > 5% | errorCounts / total |
| alert rate | < 1/tick | > 5/tick | > 10/tick | ALERT 频率 |

### 2.4 系统健康指标

| 指标 | 健康范围 | 警告阈值 | 严重阈值 | 数据来源 |
|------|---------|---------|---------|---------|
| P0/P1 liveness | 每 tick 运行 | > 100 tick 未运行 | > 500 tick 未运行 | systemLastRun |
| room survival | 所有自有房存活 | 任何自有房 controller.downgrade < 1000 | 任何自有房失守 | controller.level |
| wall/rampart topology | 无新增 constructed wall | 新增 constructed wall | 多处新增 | structure 计数 |
| future footprint conflict | 无冲突 | 1 处冲突 | 多处冲突 | layoutBlocked 计数 |
| remote operation success | > 90% active | < 70% active | < 50% active | remoteOps 状态 |
| expansion operation success | claim→bootstrap 成功 | bootstrap 超时 | claim 失败/回滚 | expansion 状态 |
| expectation violation rate | 0/tick | < 0.01/tick | > 0.1/tick | expectations.violations |

---

## 3. Canary 停止条件

### 3.1 硬性停止（立即停止发布，必须回滚）

| 条件 | 阈值 | 检测方式 |
|------|------|---------|
| P0 系统连续未运行 | > 500 tick | systemLastRun["spawn-manager"] age |
| P1 系统连续未运行 | > 1000 tick | systemLastRun age |
| RCL 长时间不增长 | > 10,000 tick 无 RCL 变化 | controller.level 对比 |
| Memory 增长斜率异常 | 环比增长 > 50% 且持续 5000 tick | RawMemory 体积趋势 |
| CPU p99 超阈值 | p99 ≥ hardLimit 持续 100 tick | ring buffer |
| bucket 持续下降 | 连续 500 tick 下降且 < 2000 | Game.cpu.bucket |
| path failure 持续增加 | stuck rate > 20% 持续 500 tick | stuck 计数 |
| builder 无路 | buildQueue oldest > 5000 tick 且 builder=0 | queue + creep 计数 |
| harvester/hauler 缺口 | harvester=0 或 hauler=0 持续 500 tick | creep 角色计数 |
| recovery 持续过久 | colonyState=recovery 持续 > 2000 tick | colonyState 持续时间 |
| 新增 constructed wall | 任何新增 constructed wall site | structure 计数对比 |
| 未来 footprint 冲突 | layoutBlocked 新增冲突 | layoutBlocked 计数对比 |
| 多房一房异常扩散 | 一房 recovery 导致其他房也 recovery | 多房 colonyState 同时 recovery |
| schema migration 失败 | 迁移 throw 或 Memory 损坏 | safeRun 错误日志 |
| telemetry 停止更新 | E1 触发（statsLastSample age > 500） | expectations E1 |

### 3.2 软性停止（暂停推进，但不回滚）

| 条件 | 阈值 | 检测方式 |
|------|------|---------|
| queue 超过上限 | spawnQueue > 10 或 buildQueue > 15 | queue length |
| task oldest age 超阈值 | > 2000 tick | queue[0].createdAt |
| CPU p90 超阈值 | p90 ≥ softLimit×0.8 持续 200 tick | ring buffer |
| bucket 在 guarded 档 | bucket < guarded.min 持续 500 tick | Game.cpu.bucket |
| error rate 上升 | > 1% 持续 500 tick | errorCounts |
| alert rate 上升 | > 5/tick 持续 500 tick | ALERT 频率 |
| expectation violation 频发 | > 0.01/tick | expectations |
| remote operation 成功率下降 | < 70% active | remoteOps |

### 3.3 停止决策矩阵

| 触发类型 | 动作 | 需要人工 |
|---------|------|---------|
| 任何硬性停止 | 立即停止发布 + 回滚到上一个通过阶段 | 是 |
| 多个软性停止同时触发 | 暂停推进 + 分析 | 是 |
| 单个软性停止 | 记录 + 继续观察 | 否 |
| 无停止条件 | 继续推进到下一阶段 | 否 |

---

## 4. Canary 数据采集要求

### 4.1 采集频率

| 数据类型 | 频率 | 存储位置 | 保留期 |
|---------|------|---------|--------|
| CPU/bucket | 每 tick | ring buffer (heap) | 300 tick |
| room energy/spawn | 每 5 tick | telemetry segment | 200 采样 |
| creep/economy | 每 10 tick | telemetry segment | 200 采样 |
| empire/dashboard | 每 25 tick | telemetry segment | 200 采样 |
| 事件 | 事件驱动 | event ring | 500 事件 |
| timeseries | 每 10 tick | RawMemory segment 4 | 滚动窗口 |

### 4.2 数据版本绑定

每次 canary 运行必须记录：
- 代码 commit hash
- schemaVersion
- soak 数据文件名
- 私服 room 名
- 私服 tick 范围
- 私服 reset 次数
- 人工介入事件

---

## 5. 私服 Soak 要求

> **证据等级说明**：等级定义见
> [ARCHITECTURE_VALIDATION.md](../architecture/ARCHITECTURE_VALIDATION.md) §0。
> 下表 [Historical Evidence] 项来自旧部署数据集（`sv=39` ≠ 当前 `schemaVersion=43`，
> artifact 绑定待补）——按 [RELEASE_GATE_AND_ROLLBACK.md](./RELEASE_GATE_AND_ROLLBACK.md)
> §2.2，旧 schema soak 数据**不能**作为当前版本运行正确的独立证据，仅作历史参考。
> 每条升级为当前版本 [Fact] 前必须按 RELEASE_GATE §3 的绑定模板登记
> commit / schemaVersion / artifact / room-tick / collectedAt。

### 5.1 单房私服 Soak

| 维度 | 要求 | 当前状态 |
|------|------|---------|
| 运行 tick | 50,000+ | [Historical Evidence] 2,340,004 tick（sv=39 数据集）；✅ **当前版本 200,000 tick 达标**（E2E-016 深度档 @ sv=43，2026-08-31：RCL1→4 稳定（RCL4 持续 40k+ tick）、0 JS 错误、Memory ≤ 11KB、全程存活、criticalViolations=0、TD-001 弃目标黑名单修复后 RCL4 稳定期 pathFailure 基本消除；绑定：schemaVersion=43 / ticks=200000 / W0N1 / collectedAt 见场景输出） |
| RCL 覆盖 | RCL1→RCL8 | ◐ **自举轨铸件进行中**（R19 合同 §5：t0→RCL8 无注入长跑，分阶段 census 对照 layout 契约——完成后为本版本动态/历史结论唯一合法来源）。既有预置段（RCL6→7 + RCL7 持续 ~2.5M tick，0 JS 错误、Memory ≤ 18KB）按 R19 §3 降级为**运行时稳定性证据**（速率结论作废——素房 1W upgrader 不代表 RCL7 经济）。**RCL7→8 官方进度 = 10,935,000**（docs.screeps.com；勘误 2026-08-30——此前误记 3.6M 实为 RCL6→7 值，表错位一级；连带此前「剩 600k tick」估算作废）。铸件若未在 3M tick 内达成 RCL8，按 census 曲线登记真实速率与剩余量 |
| tier 切换 | healthy→guarded→conserve→recovery | ✅ sv=43 四档全链实测（E2E-015，2026-08-29：四档 probe + 滞回爬升回 healthy、0 JS 错误、全程存活） |
| hostile/恢复 | 敌袭→恢复 | ✅ sv=43 当前版本证据（E2E-025，2026-08-30：6 波敌袭注入 → 每波间隙 colonyState 回 normal + 编队存活恢复 10/10 采样、0 JS 错误、Memory 有界；sv=39 的 685 快照仍为 Historical Evidence） |
| global reset | 多次 reset 恢复 | ✅ 当前版本证据：E2E-005 global reset 注入场景 @ sv43 全绿（2026-08-29 全套件）；多次 reset 编排继续项 |
| schema 一致 | soak sv = 代码 sv | ✅ E2E-016 soak sv=43 = 代码 sv=43（2026-08-29）；sv=39 历史数据集仍为 Historical Evidence |

### 5.2 多房私服 Soak

| 维度 | 要求 | 当前状态 |
|------|------|---------|
| 自有房数 | ≥ 2 | ✅ 双自有房并行 5,000 tick @ sv=43（E2E-017，2026-08-29：主房 RCL6 + 殖民房 RCL4 各自 spawn/建造/运转） |
| 第二房 Claim→Bootstrap | 完整验证 | ◐ 全链场景已建（E2E-020 @ sv=43：GCL 预置 2/观察器邻房 intel/planner 发现 4 候选/Budget 门已通）；**Readiness 经济门（netFlow/health）在 mockup 需 >15k tick 成熟期**——G1–G5 门控的设计行为（Scenario B），自然放行长窗验证为继续项 |
| 多房 spawn 竞争 | 验证公平性 | ✅ 双房各自 spawn 并行孵化无互抢（E2E-017 暖机 byHome=W0N1:4/W0N2:5） |
| 多房 site quota | 验证不冲突 | ✅ 极限注入实测（E2E-026 @ sv=43：双房各预置 20 queued 任务 over-quota → 全局实际 site 数峰值 = 7 = maxGlobalSites 恰好封顶、无越限、0 JS 错误） |
| 多房 energy 互济 | terminal 互济 | ◐ 决策权语义已锁定（E2E-019 @ sv=43：Plan 活跃时 self-aid 压制——A4.4 决策权回归测试）；Plan 驱动的 terminal 调拨证据需 planner 输入构造（继续项） |
| 一房异常不扩散 | 故障注入 | ✅ 殖民房编队全灭注入：母房不受影响（6 只稳定）、殖民房灾后恢复孵化闭环（E2E-017 recovered=true） |

### 5.3 低 CPU 私服 Soak

| 维度 | 要求 | 当前状态 |
|------|------|---------|
| CPU 限制 | 模拟 MMO 20 CPU | ✅ sv=43 引擎记账实测（E2E-015，2026-08-29：mockup driver 按每 tick `cpuAvailable += cpu − used` 记账实证；cpu=2 压限 + 逐档注入步进） |
| tier 切换 | 验证四档降级 | ✅ 四档全链 + 滞回爬升（E2E-015 probe 时间线：healthy 8000/8165 → conserve 2500/2698 → recovery 800/989/200/496 → 爬升 guarded 6000 → healthy 10000，0 JS 错误，全程存活） |
| bucket 消耗 | 验证不枯竭 | ✅ 逼近枯竭实测（recovery 档 bucket 200–496 区间运行 600t 无枯竭死亡；skip-ticks 语义由 driver `cpuAvailable<0` 保护，未触发） |
| P3 饥饿旁路 | E2 触发 | ✅ 整环集成实测（p3-bypass-loop @ sv=43，2026-08-29）：前馈硬拒→P3 停摆→E2 检出置旁路→P3 复活→前馈窗口回落→违例清除旁路撤销，五段闭环全绿；修复 E5 rclStale 永久误报（FREEZE R16）后闭环可收敛 |

---

## 6. 人工介入边界

> **与 AGENT.md 的关系**：AGENT.md 规定人工只保留「发布」与「灾难接管」两条边界；
> 本节是这两条边界在发布/soak 场景下的展开。拆墙、核心建筑拆改等破坏性动作
> **只能发生在灾难接管状态**，不属于常规发布流程；正常运营中核心建筑拆改与
> 自动布局的冲突保持 `blocked`，不自动拆改（CONSTRUCTION 契约），除非显式进入
> 灾难授权流程。每个动作必须登记：审批人、范围、审计记录、恢复方式、退出条件。

### 6.1 常规发布流程内允许的人工介入（不需进入灾难接管状态）

| 场景 | 动作 | 审批人 | 审计记录 | 恢复方式 | 退出条件 |
|------|------|--------|---------|---------|---------|
| canary 硬性停止 | 确认回滚 | 发布负责人 | 发布记录 + 回滚 commit | `git revert` / checkout 上个 tag | 回滚完成即退出 |
| 私服 reset 授权 | 明确授权后 reset | 发布负责人 | reset 时间 + 原因 | 惰性重建（KERNEL §7.1） | reset 完成 |
| 参数校准 | tuning 覆盖层修改 | 发布负责人 | 参数 diff + 生效版本 | 恢复 CONFIG 覆盖层旧值（RELEASE_GATE §6.1 配置回滚，自动） | 新参数经 soak 观察窗口 |
| 私服操作 | 启停私服、收集数据 | 运维执行人 | 采集记录（§4.2 绑定） | 重启私服 | 任务完成 |

### 6.2 灾难接管状态专属动作（必须先显式进入灾难授权流程）

| 场景 | 动作 | 审批人 | 审计记录 | 恢复方式 | 退出条件 |
|------|------|--------|---------|---------|---------|
| 线上 constructed wall 拆除 | 明确授权后拆除 | 人工接管者（业主级） | 拆除对象 + tick + 原因 + 授权记录 | 布局重建流程 | 接管状态解除 |
| 线上核心建筑拆改 | 明确授权后拆改 | 人工接管者（业主级） | 拆改对象 + tick + 原因 + 授权记录 | 按布局蓝图重建 | 接管状态解除 |
| 人工灾难接管 | 停止自动发布、人工指挥 | 人工接管者 | 接管开始/结束时间 + 处置清单 | 退出后走恢复 phase 重判 | 帝国回到可控稳态 |

> 触发阈值见 [RELEASE_GATE_AND_ROLLBACK.md](./RELEASE_GATE_AND_ROLLBACK.md) §6.1
> （bucket < 100 持续 500+ tick / 多房同时失守 / 全体 creep 全灭）。
> 灾难接管期间 bot 的自动行为让位于人工指挥；接管结束前不得把人工处置结果
> 当作自治能力证据。

### 6.3 禁止的人工介入（任何状态下都不允许）

- ❌ 通过 flag/console 指挥 bot 运行（灾难接管状态除外，且必须审计记录）
- ❌ 手动 spawn creep
- ❌ 手动创建 construction site（除授权拆改流程外）
- ❌ 手动修改 Memory（除 migration 修复外）
- ❌ 通过 LLM/外部 API 指挥 tick 决策（[LLM_BOUNDARY](../architecture/LLM_BOUNDARY.md)）
