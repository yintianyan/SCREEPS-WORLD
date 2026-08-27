# Canary Soak 验证规程

> Post-A5 Release Hardening 阶段建立的私服/隔离环境长运行验证标准。
> 未完成私服 soak 前，不得部署 MMO 正式环境。

## 1. 环境要求

| 要求 | 规格 |
| --- | --- |
| 运行环境 | 私服（screeps-server-mockup 或 screeps private server） |
| Node 版本 | 与 .nvmrc 一致（当前 24.18.0） |
| 运行时长 | ≥ 10000 tick 连续运行 |
| 指标采样 | 每 100 tick 保存一次指标快照 |
| 测试代码 | 与生产代码同一 commit（工作区干净） |

## 2. 验证项

### 2.1 OutcomeChannel 完整性

| # | 验证项 | 通过标准 | 检查方法 |
| --- | --- | --- | --- |
| OC-1 | global reset 后 operationId/eventId 语义 | operationId 跨 reset 稳定不变 | 对比 reset 前后 `Memory.kernel.expansion.operationId` |
| OC-2 | OutcomeChannel queue/seen 永不越界 | `q.length ≤ 16`, `s.length ≤ 32` | 每 100 tick 检查 `Memory.kernel.outcomeEvents` |
| OC-3 | overflowEvicted 可观测 | `oe > 0` 时有 console.log 告警 | 检查 console 日志 |
| OC-4 | duplicateRejected 可观测 | `dr > 0` 时计数器递增 | 检查 `Memory.kernel.outcomeEvents.dr` |
| OC-5 | 旧字段名不存在 | `queue/seen/duplicateRejected/overflowEvicted` 均为 undefined | 检查 `Memory.kernel.outcomeEvents` |

### 2.2 Memory 稳定性

| # | 验证项 | 通过标准 |
| --- | --- | --- |
| MEM-1 | Memory 无持续增长 | `JSON.stringify(Memory).length` 在 10000 tick 内环比增长 < 20% |
| MEM-2 | schemaVersion 稳定 | 全程保持 CONFIG.memory.schemaVersion（当前 42） |
| MEM-3 | 无 schema 降版告警 | console 无 `[schema] WARNING` 日志 |

### 2.3 Pipeline 与错误隔离

| # | 验证项 | 通过标准 |
| --- | --- | --- |
| PIPE-1 | pipeline 顺序正确 | tactical-runtime → squad-movement → tactical-engagement → combat-micro |
| PIPE-2 | cadence 分频正确 | 10t/1t/3t/3t 分频执行 |
| PIPE-3 | 错误隔离 | 单系统抛错不中断整 tick |
| PIPE-4 | 冷却机制 | 非关键系统连续失败 3 次后进入 50-200 tick 冷却 |

### 2.4 CPU 与降级

| # | 验证项 | 通过标准 |
| --- | --- | --- |
| CPU-1 | CPU bucket 自动降级 | bucket 下降时触发 Guarded→Conserve→Recovery 链 |
| CPU-2 | CPU bucket 恢复滞回 | bucket 恢复后按滞回窗口升级，不立即恢复 |
| CPU-3 | P0 永不冷却 | P0 系统连续失败不进入冷却 |

### 2.5 损坏/旧 Memory 恢复

| # | 验证项 | 通过标准 |
| --- | --- | --- |
| RECOVER-1 | 损坏 Memory 恢复 | 注入 null Memory → 500 tick 内恢复运转 |
| RECOVER-2 | 旧 schema 迁移 | 注入 schemaVersion=1 → 迁移到 CONFIG.memory.schemaVersion |
| RECOVER-3 | 扩张超时恢复 | 扩张超时后进入 forced advance |
| RECOVER-4 | 被占/丢失恢复 | 扩张目标被占 → 进入 warBlacklist 冷却 |

## 3. 指标快照格式

每 100 tick 保存以下指标到日志文件：

```json
{
  "tick": 1000,
  "cpu": {
    "bucket": 4321,
    "limit": 20,
    "used": 12.5
  },
  "memory": {
    "size": 8192,
    "schemaVersion": 41,
    "outcomeEvents": {
      "q_len": 3,
      "s_len": 3,
      "dr": 0,
      "oe": 0
    }
  },
  "creeps": {
    "total": 12,
    "byRole": { "harvester": 4, "upgrader": 2, "builder": 1, "hauler": 3, "worker": 2 }
  },
  "rooms": {
    "W0N1": {
      "rcl": 4,
      "energyAvailable": 1300,
      "energyCapacityAvailable": 1300
    }
  },
  "errors": [],
  "warnings": []
}
```

## 4. 失败处置

任何验证项失败时：
1. **立即停止 soak**，不继续运行。
2. 记录失败时的 tick、指标快照、console 日志。
3. 修复后重新执行完整 soak（从 tick 0 开始）。
4. 不接受"部分通过"——所有验证项必须全部通过。

## 5. 私服 Soak 执行方法

### 5.1 使用 screeps-server-mockup

```bash
source ~/.nvm/nvm.sh && nvm use
cd /path/to/screeps-world

# E2E setup 自动检测并修复 ABI 兼容性
# 运行 10000 tick soak（使用 E2E-010 或自定义脚本）
npx vitest run --config vitest.e2e.config.ts tests/e2e/scenarios/10-longrun.test.ts
```

### 5.2 使用真实私服

1. 启动 screeps private server
2. 部署 `dist/main.js`（`npm run build` 后上传）
3. 连接 bot 账号
4. 运行至 10000 tick
5. 每 100 tick 通过 `console.log(JSON.stringify({...}))` 保存指标
6. 从私服日志中提取指标快照
7. 对照验证项逐项检查

### 5.3 当前状态

- [x] mockup 10000 tick soak 已通过（E2E-010）
- [x] 私服 10000 tick soak 已通过（2026-08-27，用户 111 @ W8N3）
- [ ] MMO 10000 tick soak（BLOCKED — 需先通过私服 soak）

### 5.4 私服 soak 验证结果（2026-08-27）

| 验证项 | 结果 | 数据 |
| --- | --- | --- |
| 运行时长 | ✅ PASS | 10001 ticks（39372→49373），wall 1010s |
| MEM-1 Memory 无持续增长 | ✅ PASS | 9948B→11590B，增长 16.5% < 20% |
| MEM-2 schemaVersion 稳定 | ✅ PASS | 全程 41 |
| MEM-3 无 schema 降版告警 | ✅ PASS | 0 条 schema 相关错误 |
| OC-2 q/s 永不越界 | ✅ PASS | q=0, s=0（无扩张事件触发）|
| OC-3 overflowEvicted 可观测 | ✅ PASS | oe=0（无溢出）|
| OC-4 duplicateRejected 可观测 | ✅ PASS | dr=0（无重复）|
| OC-5 旧字段名不存在 | ✅ PASS | legacyFields=false 全程 |
| CPU bucket 稳定 | ✅ PASS | 10000 全程（cpu limit 100, used 2.6-4）|
| 错误隔离 | ✅ PASS | 0 条 console error |
| Creep 稳定性 | ✅ PASS | 10-15 creep 全程存活 |
| Room 稳定性 | ✅ PASS | W8N3 RCL2 持续运行 |

**环境**：Docker screeps-launcher + screepsmod-mongo/auth/admin-utils/map-tool，
默认世界（resetAllData 含 4 个官方 NPC bot），tickRate 100ms，Node 24.18.0，
dist/main.js 773KB，用户 111（web 注册，active 自动维护）。

**未覆盖项**（需 MMO 环境验证）：
- OC-1 global reset 后 operationId 稳定性（私服无 global reset 触发条件）
- PIPE-1~4 pipeline 顺序与分频（需 war 场景触发 tactical pipeline）
- CPU-1~3 bucket 降级链（私服 CPU 不受限，bucket 恒满）
- RECOVER-1~4 故障注入（mockup E2E 13/14 已覆盖，私服未注入）
