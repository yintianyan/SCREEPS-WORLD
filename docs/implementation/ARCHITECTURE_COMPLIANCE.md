# ARCHITECTURE_COMPLIANCE — 合规机制与首轮扫描结果

## 1. 自动化守卫（G-J）

实现：`tests/unit/architecture/compliance.test.ts`（零新依赖，fs 扫描 + import 解析 + DFS 找环）。
七条规则全部落地并通过：

| 规则 | 内容 | 结果 |
|---|---|---|
| R1a | domain 不 import systems/creeps | ✅ 0 违规 |
| R1b | domain 对 kernel 仅 type-only 或 global-cache | ✅ 0 违规 |
| R1c | domain 代码行不触 Game./Memory./console. | ✅ **修复 1 处**：constraint-placer 的 console.log 改为 diagnostics 回调（数据上行，layout-planner 以 Logger 记录）|
| R3 | creeps 不 import systems | ✅ 0 违规 |
| R4 | systems→creeps 仅限 movement/support | ✅ 0 违规 |
| R5 | Memory.kernel.strategy 赋值写仅 empire-strategy | ✅ 0 违规（expansion/prospect 为读取守卫）|
| R6 | roles 禁 spawnCreep/createConstructionSite/PathFinder.search/Game.market | ✅ 0 违规 |
| R7 | src 相对导入图无环（type-only 忽略） | ✅ 无环 |

> 首轮扫描即抓到真实违规（constraint-placer console）并完成架构正确方向的修复——
合规门的价值当场兑现。

## 2. 连带纯度修复（R1c 触发的参数反转）

- corridor-roads `getCachedOrComputePath`/`planCorridorRoads` 增必填 `tick` 参数
 （Game.time 由 systems 层注入；domain 不触全局）；RoadPlanContext 增 `tick` 字段，
 layout-planner 传 `ctx.tick`。
- demand.ts 移除 `Memory.rooms[home]` 直读两处：churnFreezeUntil 与 buildQueueBacklog
 改经 RoomDemandContext 注入；spawn-manager 作为写者/读者完成注入（含 backlog 计数修正：
 数据源为 construction-manager 维护的 RoomMemory.buildQueue，按 state==='queued' 过滤）。

## 3. 登记的存量依赖债（不在 Phase 2 治理）

| 发现 | 性质 | 处置建议 |
|---|---|---|
| systems/layout-planner 直接 import 兄弟系统 link-system（dismantle 工具函数族） | DEPENDENCY_GRAPH「兄弟系统禁内部 import」违规 | 抽取 dismantle-plan 到 domain 层或改事件请求；列技术债（29 号关联）|
| kernel→business 三处 import（room-snapshot/pathfinding/threat） | R9 式基础设施例外 | 已在代码注释登记演化条件；维持 |

## 4. 运行方式

`npx vitest run tests/unit/architecture/compliance.test.ts` —— 纳入 PR 门（L1）。