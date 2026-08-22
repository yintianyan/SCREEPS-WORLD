# TEST_SIMULATION_HARNESS — 测试与仿真基础设施说明

## 1. 层级与载体（现状）

| 层 | 载体 | Phase 2 增量 |
|---|---|---|
| L1 Unit | vitest tests/unit（217 文件） | ➕ config-tables 契约测试、➕ runtime-infra（EventBus/StateStore/Trace/Logger 10 用例）、➕ architecture compliance（7 规则）、➕ spawn demand/churn 注入式修正（21 用例） |
| L2 Integration | tests/integration 场景 | 复用；新增 purity 修复后全绿 |
| L3 Scenario(E2E) | screeps-server-mockup，9 场景 | smoke/disaster/rcl-upgrade/storage/tower/reset/**long-stability(11k ticks)**/energy-crisis/multi-room |
| L4 Stress | long-stability 参数化 | 11000 ticks 内置（>1000 要求）；分段 2000-tick 断言：无 JS 错误/bucket≥1000/Memory<500KB/无死亡螺旋/任务饥饿检测 |
| L5 Failure Injection | 分散于 safe-run/kernel/disaster 测试 + 新增注入式修正 | 八类覆盖映射见下 |

## 2. Simulation 原则（用户 §27 不作弊）

AI 只经 `loop()` 与 mockup 交互；测试断言读 server 真实房间状态（rooms/creeps/resources），
禁止调用 AI 内部方法改 State。mockup 每 tick ~50–100ms → 11k ticks ≈ 6–16 分钟（实测本环境 ~6.3 分钟）。

## 3. Failure Injection 覆盖映射（八类）

| 类 | 注入点 | 验证测试 |
|---|---|---|
| System Exception | safeRun 抛错路径 | safe-run.test.ts + kernel.test.ts 错误隔离组 |
| Invalid State | 迁移中断/坏 schema | memory 迁移测试族 + disaster-recovery e2e |
| Memory Corruption | JSON 异常/超限 | segment-store 往返 + ttl 清扫（框架） |
| CPU Exhaustion | bucket 拉低注入 | scheduler tier/前馈拒绝测试 + watchdog 组 |
| Missing Object | 快照缺房/对象消失 | snapshot 可选字段消费测试族 |
| Dead Creep | 死亡事件+memory 清理 | creep-death-event + maintainMemory 组 |
| Invalid Command | ERR_* 动作返回 | role action 错误分支测试族 |
| Event Handler Error | EventBus 消费者异常 | （新）drain 为纯拉取无回调——异常面天然消除；登记设计性消除 |

## 4. 待办（Phase 2 收尾内完成）

- [x] 11k ticks 后台运行（结果采集见 PHASE_2_COMPLIANCE_REPORT）
- [ ] 100/1000 ticks 快速档参数化脚本（ENV 开关，复用同场景）
- [ ] 故障注入矩阵的 CI 化聚合报告