# PHASE_2_COMPLIANCE_REPORT — Architecture Freeze 合规复核

> 逐条对照 ARCHITECTURE_FREEZE 十二节；证据=代码路径+测试名。日期：2026-08-22。

| FREEZE 条款 | 实现证据 | 状态 | 违规 |
|---|---|---|---|
| §1 核心概念（17 概念） | contracts.ts System/CreepRole/Budget/TickContext/RoomSnapshot；domain 各纯函数模块；kernel/state-store、event-bus、decision-trace、log | ✅ | 无 |
| §2 系统边界与命名法 | bootstrap 唯一组合根（25 系统/18 角色注册）；命名法对新模块生效；存量映射表见 BLUEPRINT | ✅ | 无 |
| §3 状态所有权 | STATE_OWNERSHIP 表逐族核对：唯一写者成立；本次新增注入通道（churnFreezeUntil/buildQueueBacklog 经 RoomDemandContext）消除 domain 对 Memory 直读两处 | ✅（含修复 2 处）| 已修 |
| §4 决策权 | DECISION_AUTHORITY 矩阵未变；strategy 写者唯一性由合规测试 R5 固化 | ✅ | 无 |
| §5 数据流 | DATA_FLOW 四流不变量保持；EventLog 单一 append 入口 | ✅ | 无 |
| §6 Tick 生命周期 | kernel.run() 相位序与 TICK_LIFECYCLE 同构（Reflex 内嵌 P0=D1 登记差异）| ✅ | D1 登记 |
| §7 依赖规则 | compliance R1a/R1b/R3/R4/R7 全绿；kernel→business 三处=R9 式登记例外 | ✅ | 例外已登记 |
| §8 CPU 规则 | 五桶记账视图+四档调度；budgetCap 机制落地（缺省关）；前馈+P3 旁路维持 | ✅ | 无 |
| §9 Memory 规则 | 四层落位；CONFIG.memory.ttl/segments 配额表进真相源【F1】；TTL 结构键免疫【RT-11】 | ✅ | CONTAINER_DECAY 常量补抓仍开放 |
| §10 Agent 规则 | L0–L3 归类终表；无 Agent Runtime；命名法禁令入合规体系 | ✅ | 无 |
| §11 LLM 边界 | 无在线 LLM 组件；阶梯协议文档化 | ✅ | 无 |
| §12 测试策略 | 八类矩阵映射完成；failure 防线回归纪律执行（本轮 spawn 域 3 处修正即按纪律改测）| ✅ | 阈值定标开放 |

## 新增违规发现与处置（本轮）

| 发现 | 级别 | 处置 |
|---|---|---|
| domain/layout/corridor-roads.ts 读 Game.time（缓存戳） | 中 | 参数反转修复（tick 由 systems 注入）✅ |
| domain/spawn/demand.ts 直读 Memory.rooms[home] 两处（churnFreeze/buildQueue） | 高 | RoomDemandContext 注入反转 ✅（spawn-manager 为合法写读者）|
| domain/layout/constraint-placer.ts console.log | 低 | diagnostics 回调 + layout-planner Logger.warn ✅ |
| systems/layout-planner import 兄弟系统 link-system | 中 | **存量债登记**（抽取 dismantle 到 domain 或事件化），不在本阶段动 |

## 长跑验证（E2E-006，11000 ticks）

- 干净树(HEAD)与工作树**双双复现**段2(2001–4000)全灭死亡螺旋 → 既有业务层缺陷，非本阶段引入；
- 全程 **JS 错误=0**（TypeError/ReferenceError 计数）；Runtime 基础设施在 11k ticks 内稳定；
- 结论：Runtime Foundation 达标；死亡螺旋列为 **Phase 3 入口前置根因项**（其正是 RCL1 核心经济范畴）。