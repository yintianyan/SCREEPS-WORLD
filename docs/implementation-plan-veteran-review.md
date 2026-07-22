# 老兵审查实施计划（veteran-deep-review 落地版）

> 上游文档：[veteran-deep-review.md](veteran-deep-review.md)。
> 硬约束遵循 [AGENTS.md](../AGENTS.md)：config 唯一入口、bootstrap 唯一组合根、
> Memory 结构变更升 schemaVersion 并写幂等迁移、角色不做全房 find、
> 合并前 `npm run typecheck && npm test && npm run build` 全绿。
> 范围裁剪：本计划只做 A 批全部 + B 批 B1/B3 + C 批 C1/C2。
> B2 defender、B4 hauler 吞吐模型、B5 停车位、B6 safe mode 增强、C3 市场留待下一轮
> （B2/B4 需要看 A 批上线后的真实数据再定参数）。

## 变更总览

| 编号 | 变更 | 触及文件 | Memory 影响 |
| --- | --- | --- | --- |
| A1 | body 模板增加 RCL4+/RCL6+ 档位（upgrader/builder/hauler） | `src/config/bodies.ts` | 无 |
| A2 | 升级功率改 storage 水位驱动 + RCL8 15/tick 显式限速 | `src/config/index.ts`、`src/domain/spawn/demand.ts` | 无（纯计算） |
| A3 | 塔无战事维修收窄：存在维修 creep 时塔只开火 | `src/systems/tower-defense.ts` | 无 |
| A4 | 替换 buffer 加路程项 | `src/domain/spawn/demand.ts` | 无 |
| A5 | extractor 动态建造任务（RCL6+，矿位上） | `src/domain/layout/task-factory.ts`、`src/systems/layout-planner.ts` | 无（走现有 BuildQueue） |
| B1 | recycleCreep 回收通道（退役角色 + 富余 worker） | `src/systems/spawn-manager.ts`、`src/types/global.d.ts` | CreepMemory 加 `recycle?` |
| B3 | builder 增加防御工事维修分支（取代塔修墙） | `src/creeps/actions.ts`、`src/creeps/builder.ts` | 无 |
| C1 | movement maxRooms 配置化（默认 1，为 remote 预留） | `src/config/index.ts`、`src/creeps/movement.ts` | 无 |
| C2 | room-observer 邻居侦察（出口/房态/SK 分类/可见时资源） | `src/systems/room-observer.ts`、`src/domain/` 新增 `intel.ts` | RoomMemory 加 `intel?` |

Memory 迁移：v4 → v5，幂等，为 `CreepMemory.recycle?` 与 `RoomMemory.intel?` 建档
（可选字段无需回填，迁移仅做结构兜底与版本提升）。

## 详细设计

### A1 body 档位（`src/config/bodies.ts`）

容量基准：RCL2=550 / RCL3=800 / RCL4=1300 / RCL5=1800 / RCL6=2300。

- **upgrader**（站桩，1C 承接，2M 通勤，WORK 拉满）：
  - `[15W,1C,2M]` @1650（RCL5 起可用，RCL8 恰好顶满 15/tick 官方上限）
  - `[8W,1C,2M]` @900（RCL4）
  - `[4W,1C,1M]` @500（RCL2-3）
  - 保留原 350/250/200 兜底档
- **builder**（大运力，MOVE ≥ 非 MOVE/2 保道路满速）：
  - `[8W,4C,6M]` @1300（RCL4）
  - `[4W,2C,3M]` @650（RCL3）
  - 保留原 350/250/200
- **hauler**：
  - 默认（无道路假设）：新增 `[6C,6M]` @600 顶档
  - 道路优化变体（RCL4+，MOVE:CARRY=1:2）：扩为数组 `[16C,8M]`@1200 / `[8C,4M]`@600 / `[4C,2M]`@300，
    `selectBody` 取首个可负担档
- harvester/worker 不动（5W 已匹配 source 再生；link 采矿 0-CARRY 变体留待下轮）。

### A2 升级功率（`src/domain/spawn/demand.ts` + config）

新增 `CONFIG.economy.upgrade`：
```ts
upgrade: {
  /** storage 能量 ≥ 此值且 pressure ≤ 0.3 时进入升级冲刺（燃烧库存换 RCL）。 */
  sprintStorage: 50000,
  /** storage 能量 ≥ 此值时维持满编大 body 升级（≈ 收入盈余全部喂 controller）。 */
  sustainedStorage: 10000,
  /** RCL8 官方升级功率上限（energy/tick）。 */
  rcl8MaxWorkParts: 15,
}
```

demand.ts upgrader 段改为按 **WORK 部件数** 思考，再折算成 creep 数：
1. `workPerBody = selectBody("upgrader", energyCapacity).filter(p=>p==="work").length`
2. 目标 WORK 数：
   - 有降级风险 → `maxCount × workPerBody`（保级冲刺，现状语义保留）
   - 无 controller container → `minCount × workPerBody`（自采通勤，现状语义保留）
   - storage ≥ sprintStorage 且 pressure ≤ 0.3 → `2 × workPerBody`（冲刺，烧库存）
   - storage ≥ sustainedStorage → `1 × workPerBody`（大 body 满功率 ≈ 15/tick）
   - 其余 → 现有 pressure 梯度 count 逻辑（低水位行为不变）
3. `targetCount = ceil(targetWork / workPerBody)`，再钳制到 `[minCount, maxCount]`；
4. **RCL8 显式限速**：`rcl >= 8` 时 `targetCount = max(1, floor(15 / workPerBody))`
   （15W body → 1 个，恰好 15/tick；消除"巧合合规"）。

### A3 塔维修收窄（`src/systems/tower-defense.ts`）

- 新增私有判断 `hasRepairCreep(roomName)`：遍历 `Game.creeps`（仅在存在维修目标时执行，低频），
  本房有 builder 或 worker 即为 true。
- 有维修 creep 时：塔**不做** `findCriticalRepair`、**不做** wall/rampart 维护，只保留开火；
  无维修 creep 时保留现有全部维修逻辑（灾后安全网不丢）。
- wall/rampart 的日常维护移交 B3 的 builder 分支。

### A4 替换 buffer 加路程项（`src/domain/spawn/demand.ts`）

- `needsReplacement(ticksToLive, bodyLength, travelTicks = 0)`：
  阈值 = `bodyLength × 3 + replaceBuffer + travelTicks`。
- travelTicks 估算：harvester 带 sourceId 时 = `ceil(spawn→source Chebyshev 距离 × 1.5)`（上限 50）；
  其他角色 0（房内核内通勤短）。距离从 snapshot 现成字段算，纯函数，无新扫描。

### A5 extractor 动态任务（task-factory + layout-planner）

- 新增 `createExtractorTask(snapshot)`：RCL ≥ 6、无 extractor 且无 extractor site 时，
  在 `snapshot.minerals[0]` 矿位上生成任务（extractor 必须建在矿上，矿位天然合法，
  不走 `validateBuildCell` 的 occupied 检查——矿本身就是"占用"）。
  key = `industry.extractor.{mineralId}`，priority 3，phase "rcl6"。
- layout-planner 在 controller link 之后接入，复用现有 existingKeys 去重与 BuildQueue 限流。
- 不需要模板版本号变化（非模板 cell，是动态任务，与 source container 同类）。

### B1 recycle 通道（spawn-manager + CreepMemory）

- `CreepMemory` 新增 `recycle?: boolean`。
- spawn-manager 每 tick 标记退役 creep（保守白名单，**不做**全量配额对账——那是 B 批后续）：
  1. 角色不在 `CONFIG.roles` 中（已废弃角色）；
  2. worker：本房 harvester ≥ minCount 且 worker 数 > 1 时，超出 1 只的 worker
     （保留 1 只作灾后保险，与 demand 的存在性门禁语义一致）。
- 被标记 creep：spawn-manager 找到其 home 最近空闲 spawn，
  range > 1 时用 movement 的 `moveToTarget` 移过去，range ≤ 1 时 `spawn.recycleCreep(creep)`。
- recycle 收益 = 返还残值能量 + 立即释放 CPU/寻路开销。

### B3 builder 防御维修分支（actions.ts + builder.ts）

- 新增 `repairFortifications()` 动作：选血量最低且低于 `getWallTargetHits(rcl)` 的 wall/rampart。
- 门禁（全部满足才进入 predicate）：
  - budget tier 非 recovery/conserve；
  - 存在 storage 且 storage 能量 ≥ `CONFIG.economy.upgrade.sustainedStorage`（真盈余才修墙）；
  - 无 P0 威胁（`threatCreeps.length === 0`——入侵期间修墙是白送能量，塔在打）。
- 插入 builder work 链位置：`repairCritical()` 之后、`upgradeControllerGated()` 之前
  （关键结构 > 墙 > 升级）。
-  tower 端配合：A3 中塔修墙逻辑在 hasRepairCreep 时停用，维修权完整移交 builder。

### C1 maxRooms 配置化（movement.ts）

- `CONFIG.movement = { localMaxRooms: 1 }`；`moveToTarget` 与 `computeAndCachePath` 改为读配置。
- 语义不变（默认 1），但 remote 角色未来可在调用层传 route/waypoint 时不改内核。

### C2 邻居侦察（room-observer + domain/intel.ts）

无侦察 creep 的当下，先落地**零视野成本**的情报：
- 新增纯函数 `src/domain/intel.ts`：
  - `classifyRoomByName(name)`：坐标 mod 10 == 0 → `highway`；双坐标 mod 10 ∈ [4,6] 且非 5,5 → `sk`（source keeper 房）；双坐标 mod 10 == 5 → `center`；其余 `normal`。
  - `scanNeighborIntel(home, exits, visibleRoom?)`：产出每个出口邻房的情报记录。
- `RoomMemory.intel?: Record<string, RoomIntel>`：
  ```ts
  interface RoomIntel {
    kind: "normal" | "sk" | "center" | "highway";
    status: string;            // Game.map.getRoomStatus(...).status（"normal"/"closed"/"novice"/"respawn"）
    sources?: number;          // 有视野时记录
    mineral?: string;          // 有视野时记录矿物类型
    owner?: string;            // 有视野且有主时记录
    lastSeen: number;          // 最近更新 tick
  }
  ```
- room-observer（P3，interval 5）每房每 50 tick（tick % 50 === 0）刷新一次：
  `describeExits` + `getRoomStatus` 必刷；`Game.rooms[neighbor]` 有视野时补资源字段。
- 这是 M7 选址（远矿/扩张）的数据源；当下零决策消费，纯积累。

## 测试计划

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/bodies.test.ts`（扩） | 新档位成本与容量匹配；hauler 道路变体按容量选档；200 兜底档不变 |
| `tests/spawn-demand.test.ts`（新） | storage 水位三档（冲刺/维持/低水位）→ upgrader 目标数；RCL8 封顶 15 WORK；替换 buffer 含路程项 |
| `tests/tower-defense`（在 integration 或新单测） | 有 builder 时塔不维修；无 builder 时保留维修安全网 |
| `tests/layout.test.ts`（扩） | RCL6 生成 extractor 任务；已有 extractor/site 不重复生成；RCL5 不生成 |
| `tests/recycle.test.ts`（新） | 废弃角色/富余 worker 被标记；邻近 spawn 时调用 recycleCreep；保留 1 只 worker |
| `tests/role-builder.test.ts`（扩） | 盈余门禁不满足不修墙；满足时修最低血量 rampart；threat 存在不修墙 |
| `tests/intel.test.ts`（新） | 房名分类（SK/center/highway/normal）；无视野时 intel 仅含 kind/status |

## 里程碑与顺序

1. M-A：A1 + A2 + A4（同一经济主题，一起改一起测）
2. M-B：A3 + B3（维修权移交，一起改避免双修窗口）
3. M-C：A5 + C1 + C2（独立小项）
4. M-D：B1（recycle，含 schema v5 迁移）
5. M-E：全量质量门槛 + plan.md 同步 + 报告勾选

## 风险与降级

- 大 body 孵化等待变长：demand 的 P0/bootstrap/recovery 降级路径不变，危机时仍出小 body；
- storage 水位驱动依赖 storage 存在：无 storage 走原有梯度逻辑，行为完全不变；
- recycle 白名单保守：不碰 quota 对账，不会误回收仍有需求的角色；
- 塔维修收窄保留"无维修 creep"安全网，灾后场景不退化；
- intel 只写短字段（每邻房 ≤6 个标量），Memory 体积有界。
