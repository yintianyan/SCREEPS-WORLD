# RELEASE_GATE_AND_ROLLBACK · 发布门禁与回滚规程

> **冻结日期**: 2026-08-28
> **适用范围**: Screeps World TypeScript 帝国 — 所有从 dev 合并到主分支或部署到线上（私服/MMO）的发布
> **前置契约**: [ARCHITECTURE_FREEZE.md](../architecture/ARCHITECTURE_FREEZE.md) §13/§14, [IMPLEMENTATION_PHASES.md](../architecture/IMPLEMENTATION_PHASES.md) §5, [TEST_ARCHITECTURE.md](../architecture/TEST_ARCHITECTURE.md) §4–§5

---

## 1. 代码门禁

### 1.1 强制命令序列

```bash
# 1. Node 版本检查（必须 v24+）
node --version

# 2. 类型检查（0 error）
npm run typecheck

# 3. 全量单元测试
npm test

# 4. 单元测试子集
npm run test:unit

# 5. 集成测试
npm run test:integration

# 6. 构建
npm run build

# 7. E2E 测试（如果修改了 E2E 或核心路径）
npm run test:e2e
```

### 1.2 通过标准

| 门禁 | 要求 | 失败处置 |
|------|------|---------|
| Node 版本 | v24+ | 不得使用 Node 22 或更低 |
| typecheck | 0 error | 不得使用 `any`/`@ts-ignore` 绕过 |
| npm test | 全绿 | 不得跳过失败测试 |
| test:unit | 全绿 | 不得只重跑失败子集声称全量通过 |
| test:integration | 全绿 | 同上 |
| build | dist/main.js 生成成功 | — |
| E2E | 完整重跑，不得只重跑失败子集 | 失败须修复后完整重跑 |
| skipped/todo | 每个必须显式说明原因 | 不得静默跳过 |
| flaky | 必须单独登记并标注 | 不得重复运行直到通过 |

### 1.3 E2E 完整性规则

- [Decision] 修复 E2E 失败后**必须重新执行完整 E2E 套件**（全部 files + 全部 tests）
- 不得只重跑失败子集后声称"全量通过"
- 必须记录：test files 数、test count、passed、failed、skipped、todo、flaky、duration
- 首次结果和重跑结果都必须记录

---

## 2. Schema 门禁

### 2.1 发布前必须确认

| 检查项 | 要求 | 验证方式 |
|--------|------|---------|
| 当前 schemaVersion | 明确记录值 | `grep schemaVersion src/config/index.ts` |
| migration 数量 | 明确记录数 | 计数 `MIGRATIONS` 数组长度 |
| migration 幂等 | 每个迁移重复执行不产生副作用 | `tests/unit/migration/` 测试覆盖 |
| 坏 Memory 下行为 | 迁移不 throw、不崩溃 | 坏 Memory 故障注入测试 |
| 旧字段下行为 | 迁移正确处理旧字段格式 | 旧版本迁移测试 |
| segment 未就绪时行为 | 迁移链中断、版本停在断点、下 tick 重试 | `ready()` 门禁 + 测试 |
| schema downgrade 行为 | 当前 > 代码时发出 WARNING 但不崩溃 | `memory.ts` 降级处理 |
| global reset 行为 | bootTick 保留，迁移从 Memory.schemaVersion 恢复 | 故障注入测试 |
| soak 数据 schema | 与当前代码一致 | 版本对照表 |
| 旧 schema 数据 | 明确是否需要迁移 | 迁移链覆盖范围验证 |

### 2.2 Schema 版本绑定规则

- [Decision] 每次 release 必须记录：
  - 代码 commit hash
  - `CONFIG.memory.schemaVersion` 值
  - soak 数据文件名及其 `sv` 字段值
  - 如果 soak 数据 `sv` ≠ 代码 `schemaVersion`，必须标注数据来自旧部署
- [Decision] 旧 schema 的 soak 数据**不能**作为当前版本运行正确的独立证据

---

## 3. 基础设施门禁

> **证据等级说明**（等级定义见
> [ARCHITECTURE_VALIDATION.md](../architecture/ARCHITECTURE_VALIDATION.md) §0）：
> 本节所有基于 soak 数据的 [Fact] 已统一改标 **[Historical Evidence]**——该数据集
> 采集自旧部署（`sv=39`，当前代码 `schemaVersion=42`，见 §2.2 绑定规则：旧 schema
> 的 soak 数据不能作为当前版本运行正确的独立证据），且 artifact 绑定待补登记。
> 将其升级为当前版本 [Fact] 需重新 soak 并按下方模板绑定证据。

**Soak 证据绑定模板（每条 [Fact] 至少绑定）**：

```text
commit: <hash>
schemaVersion: <number>
artifact: <relative path or external record>
room/tick range: <value>
collectedAt: <timestamp>
```

当前历史数据集登记（待补全后才能升级为当前版本证据）：

```text
commit: 待补（旧部署，hash 未随数据留存）
schemaVersion: 39（当前代码 42）
artifact: 待补（原始采集记录未入库）
room/tick range: 私服单房 W7N7，累计 2,340,004 tick
collectedAt: 待补
```

### 3.1 RCL 发展门禁

| 检查项 | 要求 | 当前状态 |
|--------|------|---------|
| RCL1→RCL8 流程有证据 | soak 数据覆盖全 RCL 范围 | [Blocked] 缺 RCL1→RCL5 |
| RCL2 不依赖 RCL3 emergency 自愈 | RCL2 能独立稳定运行 | [Assumption] 代码路径完整 |
| storage 可完成 | RCL4 有 storage 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |
| link 可完成 | RCL5 有 link 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |
| terminal 可完成 | RCL6 有 terminal 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |
| lab 可完成 | RCL6+ 有 lab 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |
| factory 可完成 | RCL7+ 有 factory 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |
| observer 可完成 | RCL8 有 observer 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |
| powerSpawn 可完成 | RCL8 有 powerSpawn 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |
| nuker 可完成 | RCL8 有 nuker 建造证据 | [Historical Evidence] soak(sv=39) 数据有 |

### 3.2 关键路径门禁

| 检查项 | 要求 | 当前状态 |
|--------|------|---------|
| builder 关键路径可达 | build site 从 queued → in_progress → done | [Fact] 代码+测试 |
| hauler 关键路径可达 | fill task 从 assigned → done | [Fact] 代码+测试 |
| harvester 关键路径可达 | harvest→container→hauler→storage | [Historical Evidence] soak(sv=39) 数据 |
| upgrader 关键路径可达 | withdraw→upgrade→controller.progress | [Historical Evidence] soak(sv=39) 数据 |
| wall/rampart 不占未来 footprint | 蓝图模板 structure positions 预标记 | [Fact] 代码审查 |
| 不生成新的无约束 constructed wall | defense-planner 只签发 rampart | [Fact] 代码审查 |
| queue/site/task 有界 | spawnQueue/buildQueue 有上限 | [Fact] 代码+测试 |
| spawnQueue 无永久堆积 | soak 数据 max=7，无持续排队 | [Historical Evidence] soak(sv=39) 数据 |
| buildQueue 无永久堆积 | soak 数据 max=11，无持续堆积 | [Historical Evidence] soak(sv=39) 数据 |
| Memory 无异常增长 | soak 数据 ~10K→~12K | [Historical Evidence] soak(sv=39) 数据 |
| path failure 有限 | stuck=0/1 运动数据存在 | [Historical Evidence] soak(sv=39) 数据 |
| P0/P1 system liveness | expectations E1/E2 监控 | [Fact] 代码+测试 |

---

## 4. 多房门禁

| 检查项 | 要求 | 当前状态 |
|--------|------|---------|
| home room | 至少 1 个自有房有完整闭环 | [Fact] W7N7 |
| remote room | 至少 1 个远矿 active→paused→abandoned | [Fact] W5N7/W5N9 |
| expansion room | 至少 1 个第二房 Claim→Bootstrap | [Blocked] 私服单房 |
| 多房 spawn 竞争 | home P0 优先、remote P2 后 | [Blocked] 无多房 |
| 多房 site quota | 全局+per-room 双控 | [Blocked] 无多房 |
| 多房 energy 互济 | terminal 互济保留 reserve | [Blocked] 无多房 |
| 多房 CPU | per-room 预算 | [Blocked] 无多房 |
| 多房 queue | 隔离不跨房 | [Blocked] 无多房 |
| 多房 assignment | 隔离 | [Blocked] 无多房 |
| 多房 request pool | 隔离 | [Blocked] 无多房 |
| 多房 global reset | 独立恢复 | [Blocked] 无多房 |
| 一房异常不拖垮其他房 | 故障隔离 | [Blocked] 无多房 |

---

## 5. 自动降级层级

### 5.1 四档 CpuTier 降级体系（与代码一致）

自动降级**只有四档**，与 `src/kernel/contracts.ts` 的 `CpuTier` 枚举
（`healthy / guarded / conserve / recovery`）和 `CONFIG.cpu.tiers` 阈值一一对应；
本文档与 [KERNEL_ARCHITECTURE.md](../architecture/KERNEL_ARCHITECTURE.md) §3、
[CPU_EXECUTION_MODEL.md](../architecture/CPU_EXECUTION_MODEL.md) §2 使用同一套术语，
不存在第五个 `CpuTier`（Emergency Survival Mode 见 §5.2，它不是 CpuTier）。

| 层级 | CpuTier | 触发条件 | 允许系统 | 禁止系统 | 保留角色 | 建设 | 远矿 | 扩张 | 战争 | terminal | market | path 重算 | telemetry | 预算上限 | 退出条件 | 滞回条件 |
|------|---------|---------|---------|---------|---------|------|------|------|------|----------|--------|----------|----------|---------|---------|---------|
| L0 | Healthy | bucket ≥ CONFIG.cpu.tiers.healthy.min | 全部 | 无 | 全部 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | softLimit×1.0 | — | — |
| L1 | Guarded | bucket < CONFIG.cpu.tiers.guarded.min | P0-P2 | P3 | 全部 | ✅ | ✅ | ✅(受限) | ✅ | ✅(受限) | ✅(受限) | ✅ | ✅ | softLimit×0.8 | bucket 恢复 ≥ healthy.min + hysteresis，持续 recoveryTicks | 持续 recoveryTicks 个 tick |
| L2 | Conserve | bucket < CONFIG.cpu.tiers.conserve.min | P0-P1 | P2+ | 生存+物流 | ✅(critical only) | ❌ | ❌ | ❌ | ❌ | ❌ | 限频 | 核心集 | softLimit×0.6 | bucket ≥ guarded.min + hysteresis | 持续 recoveryTicks |
| L3 | Recovery | bucket < CONFIG.cpu.tiers.recovery.min | P0 | P1+ | 生存 only | ❌ | ❌ | ❌ | ❌(war 旁路) | ❌ | ❌ | 限频 | 核心集 | hardLimit | bucket ≥ conserve.min + hysteresis | 持续 recoveryTicks |

### 5.2 Emergency Survival Mode（Recovery 档下的紧急安全状态——非第五档 CpuTier）

| 条款 | 内容 |
|------|------|
| 定性 | **不是** `CpuTier` 枚举成员；`CpuTier` 保持四档（§5.1）。本状态是 Recovery 档内的**进一步紧急旁路 / 安全状态**：进入时 CpuTier 仍为 `recovery`，只是允许集进一步收缩到最小生存链 |
| 触发条件 | bucket < 100，或 CPU 连续多 tick 触顶被 hardLimit 切断 |
| 允许动作 | 仅 spawn（P0 车道 / 内核紧急直通）+ harvester 最小采集；其余系统、远矿、扩张、战争、terminal、market、path 重算、非核心遥测全部让位 |
| 退出条件 | bucket ≥ 500 即自动退出回到 Recovery 档常规语义（保命态不做恢复滞回；Recovery→Guarded 的逐档滞回照常） |
| Memory 状态 | 进入 / 退出各记一次遥测事件；**不新增 Memory schema 字段、不改变 CpuTier 持久化语义**（档位状态仍归四档看门狗的 Recovery 语义） |
| 与 Recovery 的关系 | Recovery 是四档 CpuTier 的最低档；Emergency Survival 是 Recovery **之上**的再收缩层——包含关系，不是并列档位 |
| 与人工灾难接管的边界 | 本状态持续超过接管阈值（bucket < 100 持续 500+ tick，§6.1）即升级为人工灾难接管信号；本状态是自动行为的下限，接管是人工动作 |
| 实现状态 | **[Status: 设计态，未实现]** 当前代码（`CONFIG.cpu.tiers`、`scheduler.bucketToTier`）仅实现四档 CpuTier。实现前不得把「自动进入 Emergency Survival」描述为已发布能力；若实现涉及内核行为变化，须走 [ARCHITECTURE_FREEZE.md](../architecture/ARCHITECTURE_FREEZE.md) §15 登记 |

### 5.3 降级规则

- **降级立即生效**：bucket 低时必须马上限流，不等滞回
- **升级需滞回**：bucket 超过上一档阈值 + recoveryHysteresis，持续 recoveryTicks 个 tick
- **自愿放血宽限**：generatePixel 后 recovery 地板抬到 conserve（pixel 清零 bucket 只损失突发容量）
- **P0 永不冻结**：spawn-manager、room-snapshot、room-state 等关键系统始终运行
- **recoveryEligible 豁免**：关键基建缺失时 construction-manager/layout-planner 获得 P1 等效优先级
- **战争紧急旁路**：combat 角色在 war 姿态或本房有真实威胁时继续运行

---

## 6. 自动回滚触发条件

### 6.1 回滚分类

| 类型 | 触发条件 | 动作 | 范围 | 人工介入 |
|------|---------|------|------|---------|
| 代码回滚 | release gate 失败 / canary 停止条件触发 | `git revert` 或 `git checkout <tag>` | 全量 | 需确认 |
| 配置回滚 | 参数校准导致退化 | 恢复 CONFIG 覆盖层旧值 | 参数级 | 不需要（自动） |
| Memory migration 回滚 | 迁移后 Memory 损坏 | schema downgrade WARNING + 人工修复 | Memory 级 | 必须 |
| operation 回滚 | 远矿/扩张/战争 operation 失败 | abortExpansion / abandonOperation / warBlacklist | operation 级 | 不需要（自动） |
| 房间级降级 | 单房 colonyState=recovery | 冻结 P2+，保 P0/P1 | 单房 | 不需要（自动） |
| empire 级降级 | bucket 持续低位 | tier 降级（healthy→guarded→conserve→recovery） | 全帝国 | 不需要（自动） |
| 人工灾难接管 | bucket < 100 持续 500+ tick / 多房同时失守 / 全体 creep 全灭 | 停止自动发布，人工介入 | 全量 | 必须 |

### 6.2 回滚规则

- [Decision] 不得把"重新部署 bot"当作正式回滚方案
- [Decision] Memory migration 不可自动回滚（schema 降级只发 WARNING，不自动修复）
- [Decision] operation 回滚是自动的（abortExpansion → blacklist + reclaim）
- [Decision] 房间级降级是自动的（colonyState 门禁冻结 P2+）
- [Decision] empire 级降级是自动的（tier 滞回降级）
- [Decision] 人工灾难接管需要明确的人工确认，不得自动触发

---

## 7. 发布记录模板

每次发布必须记录：

```
## Release: <version/tag>
- Date: <YYYY-MM-DD>
- Commit: <hash>
- Schema Version: <N>
- Node Version: <v24.x>
- Typecheck: 0 errors
- Unit Tests: <N> files, <M> tests, all passed
- Integration Tests: <N> files, <M> tests, all passed
- E2E Tests: <N> files, <M> tests, <P> passed, <F> failed (完整重跑)
- Build: dist/main.js created in <T>s
- Soak Data: <filename>, sv=<N>, ticks=<range>, rooms=<N>
- Private Server: <room>, <tick range>, <reset count>
- Human Intervention: <none/list>
- Canary Stage: <stage>
- Rollback Plan: <plan>
- Known Issues: <list>
- Blocked Items: <list>
```
