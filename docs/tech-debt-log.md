# 技术债清单

> 来源：线上遥测诊断（tick ~81,796,500–81,797,400）
> 最后更新：2026-07-26

## P0 — 立即修

### TD-001: Builder 全压 Storage site，Extension 无人建造
- **文件**: `src/domain/assignment/service.ts`, `src/systems/assignment-service.ts`
- **现象**: 3 个 builder 全部分配到 storage site（10,000 progress），extension site（200 progress）无人建造
- **根因**: `releaseNonStorageBuilderAssignments` 每 tick 强制释放所有非 storage builder assignment；storage maxWorkers=3 吸纳全部 builder
- **影响**: energyCapacityAvailable 卡在 300，builder body 只能 [1W,1C,2M]，建造效率极低
- **状态**: ✅ 已修复（storage maxWorkers=2 + 保留 extension builder）

### TD-002: P2 Spawn 降级缺失（已修复）
- **文件**: `src/systems/spawn-manager.ts`
- **现象**: P2 请求在 colonyState 振荡时无法降级 body → 人口死锁
- **修复**: 双条件降级（waitTicks >= 10× spawnTime AND economyPressure > 0.5）
- **状态**: ✅ 已修复（725/725 测试通过）

## P1 — 本周修

### TD-003: colonyState 振荡（recovery↔normal 219 次/500 事件）
- **文件**: `src/domain/economy/phase.ts`
- **现象**: drainScore 在阈值边界抖动导致 colonyState 频繁切换
- **影响**: P2 creep 间歇性跳过、assignment 抖动
- **状态**: 待修

### TD-004: 事件检测不追踪 Storage 被毁
- **文件**: `src/systems/telemetry-collector.ts`
- **现象**: StructureDestroyed 事件只检测 spawn/tower/container，不检测 storage
- **影响**: Storage 被摧毁时无事件记录，诊断困难
- **状态**: 待修

### TD-005: Remote 人口畸重 + Remote Creep 通勤死锁（已修复）
- **文件**: `src/creeps/engine/role-runner.ts`, `src/systems/remote-mining-manager.ts`
- **现象**: 6 remoteHarvester + 4 remoteHauler 全部卡在 home room W37S58，mode=idle，从未到达 remoteTarget W38S58
- **根因**: `role-runner.ts` 第 107 行 `ensureHome` 返回 false 时强制 `mode="idle"`，但 `ensureHome` 对 idle 模式的 remote creep 导航回 home → 振荡死循环（acquire→导航→idle→回 home→acquire→...）
- **影响**: 10 只 remote creep 占 25% 人口，全浪费 CPU 发呆；远矿能量收益为 0
- **修复**: 
  1. `role-runner.ts`: remote creep（有 `remoteTarget`）通勤中不切 idle，保持原 mode
  2. `remote-mining-manager.ts`: 新增 `recycleExcessRemoteCreeps` 回收超过配置上限的远矿 creep
- **状态**: ✅ 已修复（725/725 测试通过）

## P1 — 本周修（剩余）

## P2 — 计划修

### TD-006: Builder body 在低 energyCapacity 下退化为 [1W,1C,2M]
- **文件**: `src/config/bodies.ts`
- **现象**: energyCapacityAvailable=300 时 builder 只有 1 WORK，建造速率 5 progress/tick
- **关联**: TD-001 的下游效应——extension 建成后容量提升，body 自动升级
- **状态**: 随 TD-001 解决
