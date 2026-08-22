# RUNTIME_IMPLEMENTATION — Runtime Foundation 实现说明

> Phase 2 核心文档（合并原 14 项清单中的 runtime/scheduler/state/memory/event/
execution/observability/error/persistence 各项）。逐节对照 FREEZE 条款给出：实现位置、
关键机制、与研究的差异登记。

## 1. Runtime / Tick Lifecycle

- 入口 `src/main.ts` → `bootstrap.kernel.run()`；Tick 相位序 = TICK_LIFECYCLE.md 权威序的实现态：
  segments-request → migrations → maintainMemory(含 ttl 钩子) → prune(100t) → telemetry init →
  snapshot 构建 → P0–P3 systems(main) → creeps → post systems(traffic 仲裁) → telemetry emit →
  expectations 自检 → flush skips → segments flush。
- 每相位错误边界独立（K-5 拆分迁移与维护）；预算检查点在系统循环内逐个 canStart。
- **差异登记**：Reflex（塔开火）实现于 P0 tower-defense 系统内而非独立相位——语义等价
 （P0 先于一切发展系统），不构成 FREEZE 偏离。

## 2. System Lifecycle / Scheduler

- ProcessDef=System{name, priority(0-3), interval, phase(main|post), recoveryEligible?, budgetCap?, run}；
  注册即常驻；无 shutdown 语义（Screeps 无进程退出，禁用=熔断冷却）。
- 调度：priority 升序 + interval（CONFIG.cpu.cadenceOverrides 可覆盖）+ systemPhase 哈希错峰【G-A】；
  budget.canStart 逐个门控；isExhausted 即断本相后续。
- 熔断：同 label 连续 3 错→冷却 50+10n(≤200)t，P0 永不冷却；冷却期跳过记 skipReason（可观测）。
- P3 饥饿自愈：期望自检发现 P3 存活违例→前馈旁路窗口（bucket≥3000 时生效）打破自锁。【RT 关联】

## 3. CPU Budget 记账

- CpuBudget：soft/hard=min(Game.cpu.limit,tickLimit)×tier 比例−绝对余量；四档 tier 滞回升降；
  maxPriority per tier；前馈（cpuAvg10/cpuMax10）拒 P2+/P3+，带 p3Escape 旁路。
- 记账三层：per-system / per-room(cpuByHome) / per-role 遥测 + actionProfiling 开关；
  【F1/G-B】新增 systemBudgetEma + budgetCap 局部截断（缺省未启用）。

## 4. State Store 与 Memory Layer

- Memory=持久真相（schema v36 迁移框架：cursor 分 tick、先写后删）；globalCache=volatile 索引
  （reset 可重建，I3 审计项）。
- 【G-G/R2-3】新增 kernel/state-store.ts：六族 monotonic 版本（intel/war/economy/build/layout/expansion），
  持久于 Memory.kernel.stateVersions——Intent 分层指纹数据源（F3 启用，先建后用）。
- 【F1/G-C】CONFIG.memory.ttl 表登记五数据族清理策略（ring/hook 兑现，planned 占位）。

## 5. Event System

- 双轨制：**EventLog**（37 类审计事件→segment2 ring，持久真相，只写）与 
  **EventBus**（【G-F/R2-5】运行时通知环：{topic,consumerId} 游标增量 drain，订阅即从当前起，
  ring 满覆盖=契约内降级）。Event≠State 边界维持：事件是事实记录，状态由 owner 增量维护。

## 6. Execution Boundary

- 执行面收敛于两处：creeps 引擎（角色动作管线，唯一 creep 动作出口）与各唯一写者系统
 （spawn-manager.spawnCreep/construction.createSite/terminal.send）。合规测试固化令牌红线（R6）。
- 架构解释性决定 A（已删除的 EXISTING_CODE_AUDIT §5-A/B）：命令总线式包装被否决，模块级边界即边界。

## 7. Observability / Decision Trace

- 三平面落地：telemetry ring（A）、event-log+segment 黑匣子（B）、empire-collector（C，站外）。
- 【G-H】kernel/decision-trace.ts：六层 traceDecision/getDecisionTrace/traceByKey（heap ring 128/层，
  volatile）。当前无业务调用方——Goal/Intent 系统启用时接线（F2/F3）。
- 【G-I】kernel/log.ts 统一 Logger 门面（级别门+sink 注入）；新代码强制使用。

## 8. Error Recovery

韧性梯度实现映射：safeRun 隔离→熔断冷却→本地 fallback（角色自愈件）→room recovery（ColonyPhase+P0 直拨）→
empire 再分配（互济/抢救/war 收缩）→人工边界。kernel 四类兜底检测器【RT-5】+ expectations 自检。
九类失败走线表见研究 22 号与本目录 ERROR 补充（FAILURE_RECOVERY_ARCHITECTURE 为设计源）。

## 9. Persistence

四层存储落位表见 MEMORY_ARCHITECTURE.md；segment 配额表（≤10 active/100KB）进 CONFIG.memory.segments【F1/G-D】；
TTL 表治理（结构键免疫【RT-11】）。

## 10. 与 FREEZE 的差异总登记

| # | 差异 | 性质 | 处置 |
|---|---|---|---|
| D1 | Reflex 内嵌 P0 而非独立相位 | 语义等价 | 接受，注释登记 |
| D2 | WorldModel=RoomSnapshot（无独立对象） | 解释性决定 A | 接受，演进条件登记 |
| D3 | Execution=模块级边界（非命令总线） | 解释性决定 B | 接受 |
| D4 | EventBus 游标为 heap 态（reset 清零） | 物理约束 | 消费者 reset 后重对齐（契约写明） |