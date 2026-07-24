# Creep 行为约束文档

> 适用范围：Screeps: World 官服 / 20 CPU 配额 / 单房至多房演进  
> 与 `plan.md` §5（Creep 行为约束与紧急发展）和 `src/creeps/` 实现对齐  
> 版本：v1 — 对应 `compact-core-v2` 模板和当前角色实现

---

## 目录

1. [全局硬约束](#1-全局硬约束所有-rcl-阶段通用)
2. [角色优先级与调度门禁](#2-角色优先级与调度门禁)
3. [RCL1 — 生存启动期](#3-rcl1--生存启动期)
4. [RCL2 — 吞吐建立期](#4-rcl2--吞吐建立期)
5. [RCL3 — 防御雏形期](#5-rcl3--防御雏形期)
6. [RCL4 — 稳态成形期](#6-rcl4--稳态成形期)
7. [RCL5 — 链接与扩张准备期](#7-rcl5--链接与扩张准备期)
8. [RCL6 — 采矿与_terminal_期](#8-rcl6--采矿与-terminal-期)
9. [RCL7 — 双 spawn 与三塔期](#9-rcl7--双-spawn-与三塔期)
10. [RCL8 — 满级运行期](#10-rcl8--满级运行期)
11. [各角色详细行为约束](#11-各角色详细行为约束)
12. [跨角色交互约束](#12-跨角色交互约束)
13. [返回码处理规范](#13-返回码处理规范)
14. [状态转移矩阵](#14-状态转移矩阵)
15. [边缘场景全集](#15-边缘场景全集)

---

## 1. 全局硬约束（所有 RCL 阶段通用）

### 1.1 状态机约束

| 约束 ID | 约束内容 | 违反后果 |
|---------|---------|---------|
| G-SM-01 | 每个角色是明确有限状态机，仅使用 `acquire / work / idle / flee` 四态 | 状态不可预测，无法调试 |
| G-SM-02 | 状态切换仅在以下时机发生：背包空↔满翻转、任务完成/失效、威胁出现/消失、CPU 降级触发 | 每 tick 抖动，CPU 浪费 |
| G-SM-03 | 只有阈值跨越时写 `memory.mode`，不能每 tick 写相同状态 | Memory 写入开销累积 |
| G-SM-04 | `idle` 是合法状态 — 无任务时进入 idle 或定义的回退行为，不进行无界搜索 | CPU 爆炸 |
| G-SM-05 | `flee` 期间释放普通 assignment，仅移动到安全位置，不执行任何经济动作（例外：hauler 到达 spawn 安全区后允许执行防御圈内 tower/spawn 充能，见 P0-2 修复） | creep 被击杀 |
| G-SM-06 | 所有角色先经过统一 guard 链：`ensureHome → shouldFlee → updateMode → getAssignment` | 行为不一致 |

### 1.2 Memory 约束

| 约束 ID | 约束内容 | 违反后果 |
|---------|---------|---------|
| G-MEM-01 | CreepMemory 只存：`role`、`home`、`mode`、`targetId`、`assignment`、`sourceId`、`lastPos`、`stuckTicks`、`spawnIndex` | Memory 膨胀 |
| G-MEM-02 | 禁止在 Memory 中保存：path 字符串、Room 对象、Task 完整副本、搜索结果、坐标数组 | 超出 Memory 限制 |
| G-MEM-03 | `assignment` 只存 ID、少量 ID 引用、版本号和 lease 到期时间，不存任务详情对象 | Memory 膨胀 |
| G-MEM-04 | 所有 creep 必须有 `home` 字段；无 home 的 creep 设置当前房间为 home 后继续 | 跨房盲走 |
| G-MEM-05 | `targetId` 失效时必须清空字段并进入安全待命或重新分配 | 死循环引用失效对象 |
| G-MEM-06 | `lastPos` 使用 packed 格式（`x * 50 + y`），不存 `{x, y}` 对象 | 节省序列化开销 |
| G-MEM-07 | `stuckTicks` 在位置变化时归零；`ERR_TIRED` 不递增也不归零卡位计数 | 误判卡位或漏判卡位 |

### 1.3 移动约束

| 约束 ID | 约束内容 | 违反后果 |
|---------|---------|---------|
| G-MV-01 | 角色只在主动作返回 `ERR_NOT_IN_RANGE` 时调用 `moveToTarget`，不在一个 tick 反复选目标和重算 | CPU 浪费 |
| G-MV-02 | 本地任务默认 `maxRooms: 1`；跨房移动使用 `moveTowardRoom` 走出口 | 跨房寻路 CPU 爆炸 |
| G-MV-03 | `reusePath` 默认 5；卡位超过 `stuckThreshold`（2 tick）后关闭 `ignoreCreeps` 绕行 | 每 tick 重算路径 |
| G-MV-04 | 卡位超过 `stuckThreshold + repathLimit`（4 tick）后清除目标并进入 `idle` | 永久卡死 |
| G-MV-05 | 移动后仅在 `result === OK || result === ERR_TIRED` 时记录交通热度 | 丢失交通数据 |
| G-MV-06 | `ERR_TIRED` 是正常疲劳机制，不触发卡位计数，不重寻路 | 误判疲劳为卡位 |
| G-MV-07 | 角色禁止直接调用 `PathFinder.search`；只有 movement service 或低频 planner 可调用 | CPU 突刺 |
| G-MV-08 | `global` 路径缓存可随 global reset 丢失，必须可惰性重建到原生 `moveTo` | global reset 后无法移动 |
| G-MV-09 | `ensureHome` 只有在 creep 实际在 home 房间内时返回 `true`，避免 `maxRooms:1` 永远无法到达 | 跨房目标导致死循环 |

### 1.4 能量约束

| 约束 ID | 约束内容 | 违反后果 |
|---------|---------|---------|
| G-EN-01 | 每 tick 最多一个主资源动作（harvest/transfer/withdraw/build/upgrade/repair），加一次必要移动 | CPU 超 CPU |
| G-EN-02 | 先操作（harvest/transfer/build…），遇到 `ERR_NOT_IN_RANGE` 再移动，成功后尽早 `return` | 先移动后操作浪费 tick |
| G-EN-03 | `upgrader` 遵守 `upgradeEnergyFloor`：RCL1-3 基于 `energyAvailable`（extension 能量，300 能量）；RCL4+ 有 storage 后基于 `storage.store.getUsedCapacity(RESOURCE_ENERGY)`（`upgradeEnergyFloorStorage`，默认 1000）；低于下限时 idle | 与孵化填充竞争 |
| G-EN-04 | `upgrader` 紧急例外：`ticksToDowngrade < controllerDowngradeThreshold`（10000）时强制升级 | 控制器降级 |
| G-EN-05 | `builder` 无建造目标时的回退链严格按序：填 spawn/extension → 关键维修 → 升级 → idle | 能量浪费或竞争 |
| G-EN-06 | 角色禁止全房 `find`、全局扫描、创建 Spawn 请求、重新规划建筑 | CPU 爆炸 |
| G-EN-07 | `hauler` 无 WORK 部件，禁止尝试 `harvest`（会返回 `ERR_NO_BODYPART` 并卡住） | 卡死 |
| G-EN-08 | `hauler` 无 container 可取时回退到 `storage`（RCL4+）；`storage` 也空时进入 idle 等待 harvester 填充 container | hauler 卡在空 container 旁 |

### 1.5 CPU / 预算约束

| 约束 ID | 约束内容 | 违反后果 |
|---------|---------|---------|
| G-CPU-01 | 每个系统和每个 creep 执行前都检查 `budget.canStart(priority)` | 超硬上限被杀 |
| G-CPU-02 | 执行后检查 `budget.isExhausted()`；硬熔断只停止尚未开始的工作 | 漏检导致超限 |
| G-CPU-03 | `recovery/bootstrap` 状态下只允许 P0/P1 角色（worker/harvester/hauler）运行；P2+（upgrader/builder）跳过 | 发展角色抢占生存能源 |
| G-CPU-04 | `defense` 状态下所有角色先检查 `shouldFlee`；非战斗角色进入 flee | creep 被击杀 |
| G-CPU-05 | 角色按 `(role.priority ASC, ticksToLive ASC)` 排序执行，P0 先于 P2 | P2 执行后 P0 无预算 |
| G-CPU-06 | `conserve` tier 下 builder 只执行 priority 0/1 的已存在 site；`recovery` tier 下 builder 释放普通 task lease | 低 bucket 留下过期 assignment |

### 1.6 防御 / 逃跑约束

| 约束 ID | 约束内容 | 违反后果 |
|---------|---------|---------|
| G-DF-01 | `shouldFlee` 条件：`snapshot.hostileCreeps.length > 0` 且角色非战斗单位 | creep 被击杀 |
| G-DF-02 | `flee` 策略分三级：1) spawn 比最近敌人更近时走向 spawn（塔防范围内）；2) spawn 不可达时，计算敌人所在方向的相反方向出口，走向该出口（避免冲向敌人）；3) 无安全出口时走向任意最远出口 | 冲向敌人 |
| G-DF-03 | 已在 home 但 spawn 不安全时：优先走向敌人相反方向出口；无出口时至少向 spawn 移动（比站着好），距 spawn ≤3 时停留 | 站着被杀 |
| G-DF-04 | `flee` 期间使用 `ignoreCreeps: false` 以绕过阻挡的 creep | 被友方 creep 堵死 |
| G-DF-05 | 无 Tower 且有敌人时激活 safe mode（条件：`controller.my && !safeMode && !safeModeCooldown && safeModeAvailable > 0`） | 被攻破 |
| G-DF-06 | Tower 优先级：攻击敌人 > 紧急维修关键结构（<50% 血量）> wall/rampart 维护（最低优先级，仅无敌人时） | Tower 能量浪费在非紧急维修 |
| G-DF-07 | Tower 能量 <50 时不执行维修（保留攻击能量）；能量 =0 时跳过 |
| G-DF-08 | Tower 维护 wall/rampart 的目标血量按 RCL 分级：RCL3-4: 100K / RCL5-6: 1M / RCL7-8: 10M；超过目标血量后跳过，不浪费能量 |
| G-DF-09 | flee 出口选择：以敌人位置为圆心，按 `Game.map.describeExits` 获取所有可用出口方向，选择与敌人方向夹角最大的出口（即敌人反向出口）；若所有出口都同向则选最远出口 |

### 1.7 数据访问约束

| 约束 ID | 约束内容 | 违反后果 |
|---------|---------|---------|
| G-DA-01 | `RoomSnapshot` 每房每 tick 建一次（`room-snapshot.ts`）；角色复用快照索引 | 重复 `find` 调用 |
| G-DA-02 | 角色禁止调用 `room.find()`；只从 `snapshot` 读取 `sources`、`containers`、`fillTargets`、`hostileCreeps` 等 | CPU 重复扫描 |
| G-DA-03 | 角色使用 `Game.getObjectById()` 获取缓存的 target/source，不每 tick `findClosestByRange` | CPU 浪费 |
| G-DA-04 | `getFillTarget` 例外：使用 `creep.pos.findClosestByRange(snapshot.fillTargets)`，因快照已预过滤 | — |
| G-DA-05 | `global` 只存可丢失、可重建的索引与路径缓存；任务唯一状态不能只放 `global` | global reset 后状态丢失 |
| G-DA-06 | 角色禁止调用 `createConstructionSite` 或 `spawnCreep` | 绕过系统级限流 |

---

## 2. 角色优先级与调度门禁

### 2.1 优先级体系

| 优先级 | 角色 | Recovery/Bootstrap 行为 | 常态边界 |
|--------|------|------------------------|---------|
| P0 | worker | 必须运行 — 直接采集并填 spawn | 仅恢复保险，harvester 建立后停止孵化 |
| P1 | harvester | 必须运行 — 固定 source 采集并运送 | 保证 source 覆盖和 spawn/extension 供能 |
| P1 | hauler | 有预算运行 — 从 container/storage 取能量运送 | container 就绪后才孵化；无 container 时不孵化 |
| P2 | upgrader | 跳过（降级风险除外） | 遵守 `upgradeEnergyFloor`，不与孵化竞争 |
| P2 | builder | 跳过 — 释放 task lease | 仅能量盈余时存在；无 site 时执行回退链 |
| P3 | scout/reserver/remote | 停止 | 有明确任务、TTL、撤退条件才运行 |
| P4 | 实验性/可视化角色 | 停止 | 不能影响生存预算 |

### 2.2 CPU tier 调度门禁

| CPU Tier | bucket | 允许优先级 | 角色影响 |
|----------|--------|-----------|---------|
| healthy | ≥7000 | P0–P3，P4 仅剩余预算 | 全角色正常运行 |
| guarded | 3000–6999 | P0–P3，后台频率减半 | layout-planner 间隔增大 |
| conserve | 1000–2999 | P0–P2，限制升级/建造 | builder 只执行 P0/P1 site；upgrader 限额 |
| recovery | <1000 | P0–P1，必要移动 | builder/upgrader 停工；layout-planner 不运行 |

### 2.3 ColonyState 门禁

| ColonyState | 触发条件 | 角色影响 |
|-------------|---------|---------|
| bootstrap | 无 creep 或无 harvester 且无正在孵化的 harvester | 仅 P0/P1 运行；P0 worker 立即孵化 |
| recovery | CPU recovery tier 或 harvester 数为 0 | 仅 P0/P1 运行；builder 释放 task |
| defense | 任意自有房间有 hostileCreeps | 所有角色先 flee 检查；safe mode 考虑 |
| normal | 以上条件均不满足 | 全角色正常运行 |

---

## 3. RCL1 — 生存启动期

### 3.1 场景描述

- **能量容量**：300（1 spawn）
- **可用结构**：1 spawn，无 extension、无 container、无 tower、无 storage
- **核心挑战**：从零建立能量闭环；spawn 能量耗尽后依赖被动回能（1 能量/tick），约 200 tick 可恢复至孵化阈值，但期间经济完全停滞
- **解锁能力**：`[WORK, CARRY, MOVE]` body（200 能量）

### 3.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 最高人数 | 说明 |
|------|----------|------|---------|---------|------|
| worker | `[WORK, CARRY, MOVE]` | 200 | 0（按需） | 2 | 混合角色，采集+运送一体 |
| harvester | `[WORK, CARRY, MOVE]`（降级） | 200 | 2 | 4 | 无 extension 时只能用最小 body |

> **关键约束**：RCL1 没有任何能量缓冲（无 extension、无 container），spawn 能量是唯一蓄水池。spawn 被动回能速度为 1 能量/tick，即使能量归零，约 200 tick（约 3.3 分钟）即可积累到 200 能量孵化 worker。**真正的不可自救**仅在代码停止运行以致无法发起孵化请求时发生。因此，只要代码持续运行，RCL1 始终可通过 worker 恢复。

### 3.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R1-01 | 无 creep 存活时，P0 worker 请求最高优先级；spawn 积累到 200 能量立即孵化 `[WORK, CARRY, MOVE]` |
| R1-02 | worker 直接从 source 采集并运送到 spawn，不经过 container（无 container） |
| R1-03 | harvester 在无 extension 时直接填 spawn；有能量剩余时升级控制器作为回退 |
| R1-04 | 所有结构满时 harvester 回退到升级控制器（`snapshot.controller.my` 检查） |
| R1-05 | source 暂时耗尽（`ERR_NOT_ENOUGH_RESOURCES`）时进入 idle 等待 regen，不扫全房找替代 source |
| R1-06 | builder 在 RCL1 不孵化（无建造 site 价值，且无 extension 时 builder 抢能源） |
| R1-07 | upgrader 在 RCL1 不孵化（`colonyState === "bootstrap"` 时 P2 跳过） |
| R1-08 | hauler 在 RCL1 不孵化（无 container/storage，hauler 无 WORK 无法自采） |

### 3.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R1-B-01 | RCL1 不创建任何 construction site（`developmentGate` 在 bootstrap 时返回 false） |
| R1-B-02 | 布局规划器在 RCL1 不运行（`colonyState` 为 bootstrap 时跳过） |
| R1-B-03 | 优先升级到 RCL2 以解锁 extension 和 container |

### 3.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| 全员死亡 + spawn 有 200 能量 | P0 worker 立即孵化，恢复采能闭环 |
| 全员死亡 + spawn 无 200 能量 | 系统继续运行，等待 spawn 被动回能（1 能量/tick）；每 tick 检查 `energyAvailable >= 200`，达到后立即孵化 P0 worker；此期间不创建无效请求消耗 CPU；恢复时间约 200 tick（约 3.3 分钟） |
| 全员死亡 + spawn 正在孵化低优先级 creep | 不取消当前孵化；记录最晚恢复时间；孵化完成后立即补 P0 |
| source regen 期间所有 source 耗尽 | 所有 harvester/worker 进入 idle 等待；不跨房找 source |
| 敌对 creep 出现 | worker/harvester 进入 flee；无 Tower 时考虑 safe mode |
| global reset | Memory 保留 assignment/sourceId；global 交通数据清零后惰性重建 |

---

## 4. RCL2 — 吞吐建立期

### 4.1 场景描述

- **能量容量**：500（1 spawn + 5 extensions）
- **解锁结构**：5 extensions、source container（`CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][2] = 5`）
- **核心挑战**：扩展能量容量以支持更大 body；建立 container 开始采运分离
- **body 升级**：harvester 可用 `[WORK, WORK, CARRY, MOVE, MOVE]`（350 能量）

### 4.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 说明 |
|------|----------|------|---------|------|
| worker | `[WORK, CARRY, MOVE]` | 200 | 按需 | 恢复保险 |
| harvester | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2 | 5 extension 后可用 |
| hauler | `[CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]` | 300 | 2 | container 就绪后孵化 |
| upgrader | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1 | normal 状态下孵化 |
| builder | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1 | 有 site 时孵化 |

> **body 降级策略**：当 `energyAvailable`（当前可用能量）不足时，P0/P1 角色按以下优先级降级，确保始终能孵化最小 body：
> - harvester: `350 → 250 → 200`（`[W,W,C,M,M]` → `[W,C,M,M]` → `[W,C,M]`）
> - hauler: `300 → 200`（`[C,C,C,M,M,M]` → `[C,C,C,C,M,M]`（道路优化）或 `[C,C,M,M]`）
> - P2 角色（upgrader/builder）在 `energyAvailable < 300` 时不孵化，不参与降级竞争

### 4.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R2-01 | harvester 使用 `assignment.sourceId` 绑定固定 source，不每 tick `findClosestByPath` |
| R2-02 | harvester 在 container 就绪前直接填 spawn/extension；container 就绪后优先填 container |
| R2-03 | harvester 所有结构满时回退链：填 container → 升级控制器 → idle |
| R2-04 | hauler 仅在 `hasLogistics`（有 container 或 storage）时孵化；无 container 时不孵化 hauler |
| R2-05 | hauler 从 `findRichestContainer` 取能量，运送到 `getFillTarget`（spawn/extension） |
| R2-06 | hauler 无 container 可取时回退到 storage（RCL4+ 才有）；storage 也空时 idle |
| R2-07 | upgrader 优先从 container 取能量（让 harvester 专注采集）；无 container 时回退到直接采集 |
| R2-08 | upgrader 遵守 `upgradeEnergyFloor`（300）；低于 300 时 idle |
| R2-09 | builder 从 `assignment.targetId` 获取建造目标；无 assignment 时 `findClosestByRange` 最近 site |
| R2-10 | builder 无 site 时执行回退链：填 spawn/extension → 关键维修 → 升级 → idle |

### 4.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R2-B-01 | 建造优先级：第一批 5 个 extension（`core.ext.01-05`）> source container > 道路 |
| R2-B-02 | extension 使用 `compact-core-v2` 模板相对 spawn 的偏移位置 |
| R2-B-03 | source container 由 `layout-planner` 动态生成位置（选相邻 walkable 格） |
| R2-B-04 | 道路仅在交通热度超过 `minTraffic`（10）且连续两个采样窗口都超标时创建 |
| R2-B-05 | 每房最多 2 个 normal site + 1 个 critical site；全局最多 5 个 active site |
| R2-B-06 | `developmentGate` 必须通过：非 recovery/bootstrap、无敌对、无 P0/P1 spawn 缺口、能量 ≥ `buildEnergySurplus + recoveryEnergyReserve`（400） |

### 4.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| extension 被摧毁 | harvester 回退到直接填 spawn；`developmentGate` 将重建 extension 升为 P0 critical |
| container 被摧毁 | harvester 回退到直接填 spawn/extension；hauler 无 pickup 时 idle；container 重建升为 critical |
| source 一侧矿工死亡 | `sourceOccupancy` 更新；spawn-manager 补充 harvester 到该 source |
| hauler 存活但 container 空 | hauler idle 等待；不尝试 harvest（无 WORK）；不跨房找能量 |
| 多个 harvester 争抢同一 source | `assignment-service` 按 `sourceOccupancy` 分配最少拥挤的 source；maxWorkers = `sourceTargetWorkParts / 1`（5） |
| builder 队列为空 | 执行回退链：填 spawn/extension → 关键维修 → 升级 → idle |
| 能量低于 300 | upgrader idle；builder 回退到填能；harvester 继续采能 |

---

## 5. RCL3 — 防御雏形期

### 5.1 场景描述

- **能量容量**：800（1 spawn + 10 extensions）
- **解锁结构**：补充 5 extensions（共 10）、1 tower（`CONTROLLER_STRUCTURES[STRUCTURE_TOWER][3] = 1`）
- **核心挑战**：建立基础防御能力；extension 补齐支持更大 body
- **新增系统**：tower-defense（P0）

### 5.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 说明 |
|------|----------|------|---------|------|
| harvester | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2 | 不变 |
| hauler | `[CARRY×3, MOVE×3]` | 300 | 2 | 不变 |
| upgrader | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1 | 不变 |
| builder | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1 | 不变 |

### 5.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R3-01 | Tower 系统优先级 P0，在所有角色之前运行；永不被冷却 |
| R3-02 | Tower 优先攻击 `findClosestByRange(hostileCreeps)`；无敌人时执行紧急维修（<50% 血量）；无紧急维修时维护 wall/rampart 到目标血量（RCL3: 100K） |
| R3-03 | Tower 能量 <50 时不维修（保留攻击能量）；能量 =0 时跳过 |
| R3-04 | 无 Tower 且有敌人时激活 safe mode |
| R3-05 | `shouldFlee` 检测到 hostileCreeps 时，非战斗角色进入 flee；`invalidateAssignments` 使普通 assignment 失效 |
| R3-06 | flee 期间 creep 优先走向敌人反向出口；spawn 比敌人更近时走向 spawn |
| R3-07 | Tower 维修优先级：spawn/extension → tower → container → wall/rampart（`findCriticalRepair` 分组顺序） |

### 5.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R3-B-01 | 建造优先级：tower（P0 critical）> 第二批 5 extension（`core.ext.06-10`）> controller container > 道路 |
| R3-B-02 | tower 位置由模板 `core.tower.01`（spawn 偏移 `+2,+2`）定义 |
| R3-B-03 | controller container 由 `layout-planner` 动态生成（RCL3+） |
| R3-B-04 | 道路依据交通热度逐段添加，不预铺全房 |

### 5.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| Tower 无能量而 builder 正在消耗能量 | Tower 不维修但保留攻击能量；builder 在 defense 状态下先 flee |
| Tower 被摧毁 | safe mode 考虑；builder 重建 tower 升为 P0 critical |
| 敌人突破防御 | 所有非战斗 creep flee；Tower 集中攻击；safe mode 激活 |
| Tower 误攻击友方 | 不可能 — `FIND_HOSTILE_CREEPS` 不包含友方 |
| safe mode 冷却中 | 无法激活；依赖 Tower 和 flee |

---

## 6. RCL4 — 稳态成形期

### 6.1 场景描述

- **能量容量**：1300（1 spawn + 20 extensions）
- **解锁结构**：补充 10 extensions（共 20）、1 storage（`CONTROLLER_STRUCTURES[STRUCTURE_STORAGE][4] = 1`）
- **核心挑战**：建立 storage 能量缓冲；形成可控能量池
- **经济转型**：hauler 可从 storage 取能量；harvester 满载时可存入 storage

### 6.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 说明 |
|------|----------|------|---------|------|
| harvester | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2 | 不变 |
| hauler | `[CARRY×3, MOVE×3]` 或 `[CARRY×4, MOVE×2]`（道路优化） | 300/200 | 2 | 可从 storage 取能 |
| upgrader | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1-2 | 可从 storage 取能 |
| builder | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1-2 | 可从 storage 取能 |

### 6.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R4-01 | hauler 在 spawn/extension 全满时回退到 `storage.transfer` |
| R4-02 | hauler 无 container 可取时回退到 `storage.withdraw`（仅当 `storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0`） |
| R4-03 | harvester 在所有 spawn/extension 和 container 都满时回退到升级控制器 |
| R4-04 | upgrader 优先从 storage 取能量（`storage.withdraw`）；storage 能量不足时回退到 container 或直接采集 |
| R4-05 | builder 优先从 container 取能量；无 container 时回退到直接采集 |
| R4-06 | storage 成为能量缓冲：harvester 产出 → container → hauler → spawn/extension 或 storage |

### 6.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R4-B-01 | 建造优先级：storage（P1）> 第三批 10 extension（`core.ext.11-20`）> 核心物流路 > 道路 |
| R4-B-02 | storage 位置由模板 `core.storage.01`（spawn 偏移 `0,+1`）定义 |
| R4-B-03 | storage 建成后 `snapshot.storage` 可用，所有角色可读取 |

### 6.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| storage 满仓 | hauler 停止向 storage 送能；回退到升级控制器或 idle；系统应限速采集 |
| storage 被摧毁 | hauler 回退到 container → spawn/extension 链；storage 重建升为 critical |
| storage 空但 container 有能量 | hauler 从 container 取能，不从 storage 取 |
| storage 有能量但 container 空 | hauler 从 storage 取能 |
| harvester 满载但所有交付结构满 | harvester 回退到升级控制器 |

---

## 7. RCL5 — 链接与扩张准备期

### 7.1 场景描述

- **能量容量**：1800（1 spawn + 30 extensions）
- **解锁结构**：补充 10 extensions（共 30）、2 links（`CONTROLLER_STRUCTURES[STRUCTURE_LINK][5] = 2`）、第 2 个 tower
- **核心挑战**：引入 link 网络减少物流 CPU；准备远矿扩张
- **新增能力**：link 传输能量（source link → storage link / controller link）

### 7.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 说明 |
|------|----------|------|---------|------|
| harvester | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2-3 | 可考虑纯 miner 模式 |
| hauler | `[CARRY×3, MOVE×3]` | 300 | 2-3 | link 减少本地物流负担 |
| upgrader | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2 | controller link 供能 |
| builder | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1-2 | 不变 |

### 7.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R5-01 | link 建成后，source link 自动将能量传输到 storage link 或 controller link |
| R5-02 | hauler 在 link 网络就绪后减少 source-container → spawn 的搬运频率 |
| R5-03 | upgrader 在 controller link 就绪后优先从 controller link 取能量 |
| R5-04 | 远矿扩张仅在 `colonyState === "normal"` 且 `budget.tier >= "guarded"` 时考虑 |
| R5-05 | 远矿 creep 必须有 TTL 和撤退条件；`recovery` 时撤回 home |

### 7.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R5-B-01 | 建造优先级：第 2 个 tower（P0 defense）> 第四批 10 extension > link（storage link + source link）> 远矿配套 |
| R5-B-02 | link 位置：storage link 由模板 `core.link.01`（spawn 偏移 `+1,0`，依赖 `core.storage.01`）定义 |
| R5-B-03 | source link 由 `layout-planner` 动态生成（近 source 位置） |

### 7.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| source link 被摧毁 | 回退到 container → hauler 物流链 |
| storage link 被摧毁 | source link 能量积压；hauler 从 container 取能 |
| link 冷却中 | 等待冷却；hauler 临时补充物流 |
| 远矿房被攻击 | 远矿 creep 撤回 home；远矿任务暂停 |
| 远矿 source 耗尽 | 远矿 creep idle 等待 regen；不跨房找替代 source |

---

## 8. RCL6 — 采矿与 terminal 期

### 8.1 场景描述

- **能量容量**：2000（1 spawn + 30 extensions，RCL6 不增加 extension 数量上限）
- **解锁结构**：1 terminal（`CONTROLLER_STRUCTURES[STRUCTURE_TERMINAL][6] = 1`）、extractor + lab（矿物处理）
- **核心挑战**：引入矿物经济；terminal 支持市场交易和跨房资源传输
- **新增能力**：矿物采集、lab 合成、terminal 自动送能/送矿

### 8.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 说明 |
|------|----------|------|---------|------|
| harvester | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2-3 | 不变 |
| hauler | `[CARRY×3, MOVE×3]` | 300 | 3 | 增加矿物搬运 |
| upgrader | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2 | 不变 |
| builder | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1-2 | 不变 |
| miner（矿物） | `[WORK×4, MOVE]` | 450 | 0-1 | 按矿物 regen 周期工作 |

### 8.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R6-01 | 矿物 miner 仅在 mineral 有 `mineralAmount > 0` 时工作；regen 冷却期间 idle |
| R6-02 | hauler 扩展职责：能量搬运 + 矿物搬运（从 extractor 到 terminal/storage） |
| R6-03 | terminal 自动平衡：能量低于阈值时 hauler 补充；矿物超过阈值时自动出售或传输 |
| R6-04 | lab 合成仅在能量和矿物都充足时运行；`recovery` 时暂停 |
| R6-05 | terminal 交易是 P3 工作；`conserve` 以下不执行 |

### 8.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R6-B-01 | 建造优先级：terminal（P2）> extractor（P2）> lab（P3）> 道路 |
| R6-B-02 | terminal 位置由 `layout-planner` 动态生成（近 storage） |
| R6-B-03 | extractor 建在 mineral 位置上 |

### 8.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| mineral 耗尽 | miner idle 等待 regen（约 30000 tick）；hauler 不搬运矿物 |
| terminal 被摧毁 | 矿物存入 storage；市场交易暂停；重建升为 P2 |
| lab 被摧毁 | 合成暂停；hauler 不向 lab 送矿 |
| terminal 能量不足 | hauler 从 storage 补充能量到 terminal |
| 市场价格暴跌 | terminal 不自动出售；等待价格恢复或人工干预 |

---

## 9. RCL7 — 双 spawn 与三塔期

### 9.1 场景描述

- **能量容量**：2300（2 spawns + 30 extensions）
- **解锁结构**：第 2 个 spawn（`CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][7] = 2`）、第 3 个 tower
- **核心挑战**：双 spawn 提高孵化吞吐；三塔增强防御纵深
- **新增能力**：并行孵化、更强防御

### 9.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 说明 |
|------|----------|------|---------|------|
| harvester | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 3-4 | 双 spawn 加速孵化 |
| hauler | `[CARRY×3, MOVE×3]` | 300 | 3-4 | 不变 |
| upgrader | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2-3 | 不变 |
| builder | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 1-2 | 不变 |

### 9.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R7-01 | spawn-manager 优先使用空闲 spawn（`!s.spawning`）；两个 spawn 可并行孵化 |
| R7-02 | 三塔协同攻击：所有 tower 攻击同一目标（`findClosestByRange`） |
| R7-03 | 三塔维修分工：无敌人时按 `findCriticalRepair` 分组顺序维修 |
| R7-04 | 第二 spawn 位置由模板 `core.spawn.02`（spawn 偏移 `-1,0`）定义 |
| R7-05 | 孵化错峰：同类 creep 的 `spawnIndex` 不同，避免同 tick 集体寿终 |

### 9.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R7-B-01 | 建造优先级：第 3 个 tower（P0 defense）> 第 2 个 spawn（P1 core）> 道路 |
| R7-B-02 | 第 3 个 tower 位置由模板 `core.tower.03`（spawn 偏移 `+2,-2`）定义 |
| R7-B-03 | 第 2 个 spawn 建成后 `snapshot.spawns` 包含 2 个 spawn |

### 9.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| 一个 spawn 被摧毁 | 另一个 spawn 继续孵化；重建被摧毁 spawn 升为 P0 critical |
| 两个 spawn 同时忙 | 队列等待；不取消正在进行的孵化 |
| 三塔同时攻击但敌人有 heal | 塔伤害分散；优先攻击无 heal 的敌人或集火最低血量目标 |
| 第 2 spawn 建成但无 spawnIndex 分配 | spawn-manager 按 `countPending` 分配新 index |

---

## 10. RCL8 — 满级运行期

### 10.1 场景描述

- **能量容量**：2300（2 spawns + 30 extensions，RCL8 不增加 extension 数量上限）
- **解锁结构**：无新增结构（RCL8 是最高等级）
- **核心挑战**：长期稳态运行；CPU 优化；多房扩张；power farming
- **新增能力**：power bank 攻击、多房殖民、高级市场策略

### 10.2 角色配置

| 角色 | body 模板 | 成本 | 最低人数 | 说明 |
|------|----------|------|---------|------|
| harvester | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 3-4 | 稳态 |
| hauler | `[CARRY×3, MOVE×3]` | 300 | 3-4 | 含矿物/资源搬运 |
| upgrader | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 3 | `maxCount` 上限 |
| builder | `[WORK, WORK, CARRY, MOVE, MOVE]` | 350 | 2 | `maxCount` 上限 |
| claimer | `[CLAIM, MOVE]` | 700 | 按需 | 仅多房扩张时 |
| scout | `[MOVE]` | 50 | 按需 | 定期侦察 |

### 10.3 行为约束

| 约束 ID | 约束内容 |
|---------|---------|
| R8-01 | RCL8 稳态后重点是 CPU 优化：减少不必要扫描、优化路径缓存、分房轮询 |
| R8-02 | power farming 仅在 `budget.tier === "healthy"` 且 `colonyState === "normal"` 时考虑 |
| R8-03 | 多房扩张门禁：本地经济稳定、CPU 有余量、有足够 energy 储备 |
| R8-04 | claimer 必须有明确目标房和撤退条件；`recovery` 时撤回 |
| R8-05 | scout 定期侦察周边房间（每 50-100 tick）；`conserve` 以下停止 |
| R8-06 | 多房 creep 必须有 `home` 字段指向其服务房间；不在 home 时 `ensureHome` 返回 false |
| R8-07 | 远程 creep 的 assignment 由 home 房间的 `assignment-service` 管理 |

### 10.4 建造约束

| 约束 ID | 约束内容 |
|---------|---------|
| R8-B-01 | RCL8 无新增结构建造；重点维护现有结构 |
| R8-B-02 | rampart/wall 建造仅在防御插件明确计划时执行 |
| R8-B-03 | 道路维护依据交通热度持续更新 |

### 10.5 边缘场景

| 场景 | 预期行为 |
|------|---------|
| 多房中一个房异常 | 错误隔离到房间；其他房和全局 P0 继续运行 |
| 远矿房被占领 | 远矿 creep 撤回 home；远矿任务暂停；评估反攻或放弃 |
| power bank 被他人抢走 | scout 报告；power farming 小队撤回 |
| CPU 持续高位 | 降级到 conserve/recovery；暂停远矿和 power farming；收缩到本地 P0/P1 |
| Memory 接近上限 | 清理旧 creep memory；压缩远矿数据；分批清理 |
| global reset | 所有 global 缓存惰性重建；Memory 保留所有跨 tick 状态 |

---

## 11. 各角色详细行为约束

### 11.1 Worker（P0 恢复混合角色）

#### 职责
启动期和灾后恢复的混合角色，直接采集并运送能量到 spawn/extension。

#### 状态机

```
acquire（从 source 采集）
  ↕ 背包满/空
work（运送到 spawn/extension）
  ↓ 无目标
idle（在 spawn 附近待命）
  ↑ 威胁出现
flee（逃跑到安全位置）
```

#### 约束表

| 约束 ID | 约束内容 |
|---------|---------|
| W-01 | body 固定 `[WORK, CARRY, MOVE]`，成本 200，始终可孵化 |
| W-02 | `ensureHome` 失败时 idle，不跨房盲走 |
| W-03 | `shouldFlee` 为 true 时进入 flee，释放普通 assignment |
| W-04 | work 模式：优先 assignment.targetId → `getFillTarget` → 升级控制器 → idle |
| W-05 | acquire 模式：优先 assignment.sourceId → `getSource`（最少拥挤 source）→ idle |
| W-06 | `ERR_NOT_ENOUGH_RESOURCES`（source 耗尽）时 idle 等待 regen |
| W-07 | harvester 和 hauler 建立后不再孵化 worker（`harvesterCount > 0` 时不生成 P0 worker 请求） |
| W-08 | 即将死亡时替换请求优先级 P1（`role === "worker"` 时 priority = 1） |

#### 禁止事项
- 等待大 body（始终用最小 body）
- 建普通 road
- 跨房找 source

### 11.2 Harvester（P1 固定 source 采集）

#### 职责
从固定 source 采集能量并运送到 spawn/extension/container。

#### 状态机

```
acquire（从固定 source 采集）
  ↕ 背包满/空
work（运送到 spawn/extension/container）
  ↓ 全部满
回退：升级控制器
  ↓ 无控制器
idle
  ↑ 威胁出现
flee
```

#### 约束表

| 约束 ID | 约束内容 |
|---------|---------|
| H-01 | body 从高到低尝试：`[W,W,C,M,M]`(350) → `[W,C,M,M]`(250) → `[W,C,M]`(200) |
| H-02 | source 由 `assignment.sourceId` 或 `creep.memory.sourceId` 绑定，不每 tick `findClosestByPath` |
| H-03 | work 模式优先级：assignment.targetId → `getFillTarget` → container（`findEmptiestContainer`）→ 升级控制器 → idle |
| H-04 | `ERR_FULL` 时调用 `updateMode` 切换目标，不反复 `findClosestByRange` |
| H-05 | `ERR_NOT_ENOUGH_RESOURCES`（source 耗尽）时 idle 等待 |
| H-06 | source 消失时清除 `sourceId` 并通过 `getSource` 重新分配 |
| H-07 | 每人分配到最少拥挤的 source（`sourceOccupancy` 最低） |
| H-08 | 即将死亡时替换请求优先级 P1 |

#### 禁止事项
- 重新选最近 source（使用绑定 source）
- 全房 `find`
- 创建 Spawn 请求

### 11.3 Hauler（P1 物流角色）

#### 职责
从 container/storage 取能量并运送到 spawn/extension。

#### 状态机

```
acquire（从 container/storage 取出）
  ↕ 背包满/空
work（运送到 spawn/extension/storage）
  ↓ 无目标
回退：升级控制器
  ↓ 无控制器
idle
  ↑ 威胁出现
flee
```

#### 约束表

| 约束 ID | 约束内容 |
|---------|---------|
| HA-01 | body 从高到低尝试：`[C,C,C,M,M,M]`(300) → `[C,C,C,C,M,M]`(200，道路优化，1 MOVE 可带动 2 CARRY) → `[C,C,M,M]`(200) |
| HA-02 | 仅在有 container 或 storage 时孵化（`hasLogistics` 检查） |
| HA-03 | 仅在 harvester 达到 `minCount` 后孵化 |
| HA-04 | acquire 模式优先级：assignment.sourceId(container) → `findRichestContainer` → storage（仅 `store.getUsedCapacity > 0`）→ idle |
| HA-05 | work 模式优先级：assignment.targetId → `getFillTarget` → storage → 升级控制器 → idle |
| HA-06 | `ERR_NOT_ENOUGH_RESOURCES`（container 空）时 idle 等待 |
| HA-07 | **禁止 `harvest`** — 无 WORK 部件，会返回 `ERR_NO_BODYPART` 并卡住 |
| HA-08 | 无 container 且 storage 也空时 idle，等待 harvester 填充 container |
| HA-09 | 即将死亡时替换请求优先级 P1 |
| HA-10 | `[C,C,C,C,M,M]` 道路优化变体仅在核心物流路已铺设（RCL4+）时使用；道路未覆盖时使用 `[C,C,C,M,M,M]` 保证移动效率 |

#### 禁止事项
- `harvest`（无 WORK）
- 每 tick `findClosestByPath`
- 在无 container/storage 时孵化

### 11.4 Upgrader（P2 控制器升级）

#### 职责
升级控制器以提升 RCL 或防止降级。

#### 状态机

```
acquire（从 container/source 采集）
  ↕ 背包满/空
work（升级控制器）
  ↓ 能量低于 floor
idle
  ↑ 威胁出现
flee
  ↑ 降级风险
强制升级（绕过 floor）
```

#### 约束表

| 约束 ID | 约束内容 |
|---------|---------|
| U-01 | body 从高到低尝试：`[W,W,C,M,M]`(350) → `[W,C,M,M]`(250) → `[W,C,M]`(200) |
| U-02 | 遵守 `upgradeEnergyFloor`：RCL1-3 时 `energyAvailable < 300` 则 idle；RCL4+ 有 storage 时 `storage.store.getUsedCapacity(RESOURCE_ENERGY) < upgradeEnergyFloorStorage`（默认 1000）则 idle，避免与 spawn 孵化竞争 extension 能量 |
| U-03 | 紧急例外：`ticksToDowngrade < controllerDowngradeThreshold`（10000）时强制升级，绕过 floor |
| U-04 | acquire 模式优先从 container 取能量（`findRichestContainer`）；无 container 时回退到直接采集 |
| U-05 | `colonyState === "bootstrap"` 时不孵化（除非降级风险） |
| U-06 | `colonyState === "recovery"` 时跳过（除非降级风险） |
| U-07 | 降级风险时优先级提升为 P1（`hasDowngradeRisk ? 1 : 2`） |
| U-08 | `colonyState !== "normal" && !hasDowngradeRisk` 时不生成 upgrade 任务 |

#### 禁止事项
- 抢占 P0 能源（遵守 floor）
- 在 recovery/bootstrap 时工作（除非降级风险）

### 11.5 Builder（P2 建造角色）

#### 职责
执行 BuildTask，建造 construction site。

#### 状态机

```
acquire（从 container/source 采集）
  ↕ 背包满/空
work（建造 site）
  ↓ 无 site
回退链：填 spawn/extension → 关键维修 → 升级 → idle
  ↑ 威胁出现
flee
```

#### 约束表

| 约束 ID | 约束内容 |
|---------|---------|
| B-01 | body 从高到低尝试：`[W,W,C,M,M]`(350) → `[W,C,M,M]`(250) → `[W,C,M]`(200) |
| B-02 | 仅当存在 `myConstructionSites` 时孵化 |
| B-03 | work 模式优先级：assignment.targetId(site) → `findClosestByRange(sites)` → 回退链 |
| B-04 | `ERR_INVALID_TARGET` 时释放 assignment（site 不再有效） |
| B-05 | 回退链严格按序：`getFillTarget` → `findCriticalRepair` → 升级控制器（`energyAvailable >= upgradeEnergyFloor`）→ idle |
| B-06 | `conserve` tier 下只执行 priority 0/1 的 site |
| B-07 | `recovery` tier 下释放普通 task lease，转为送能或待命 |
| B-08 | acquire 模式优先从 container 取能量；无 container 时回退到直接采集 |
| B-09 | 即将死亡时替换请求优先级 P2 |

#### 禁止事项
- 创建 site（`createConstructionSite` 由 construction-manager 独占）
- 扫描房间找 site（使用快照 `myConstructionSites`）
- 无目标时空转（必须执行回退链）
- 修墙/rampart（除非防御任务或 Tower 不可用/无能量时，builder 可作为 fallback 维护 wall/rampart 到最低血量）

### 11.6 未来角色约束预留

| 角色 | 优先级 | 解锁条件 | 核心约束 |
|------|--------|---------|---------|
| miner（纯矿工） | P1 | container 就绪 + hauler 存活 | 固定 source+container；无 CARRY；container 毁坏时切 harvester 模式 |
| repairer | P2 | RCL3+ | 仅修 RepairTask；修墙/rampart 需防御任务；回退：critical repair → fill/idle |
| scout | P3 | RCL5+ | `[MOVE]` body；定期侦察；`conserve` 以下停止；有 TTL 和撤退条件 |
| claimer | P3 | 多房扩张时 | `[CLAIM, MOVE]` body；claim 后转为 builder 建造 spawn |
| reserver | P3 | 远矿房 | `[CLAIM, MOVE]` body；reserve controller 防止他人 claim |
| remote harvester | P3 | 远矿解锁 | 固定 remote source；有 home 指向原住房；`recovery` 时撤回 |
| defender | P3 | 敌袭频繁 | `[TOUGH, ATTACK, MOVE]` body；仅在 defense 状态激活 |
| healbot | P3 | power farming | `[HEAL, MOVE]` body；跟随战斗 creep |

---

## 12. 跨角色交互约束

### 12.1 任务分配竞争规则

| 约束 ID | 约束内容 |
|---------|---------|
| X-01 | `assignment-service` 每 tick 每房运行一次，在角色执行之前生成任务列表 |
| X-02 | 每个 source 的 maxWorkers 按 RCL 分级：RCL1-3: 5 / RCL4-6: 6 / RCL7-8: 8；基于 `sourceTargetWorkParts` 配置和 harvester body 的 WORK 部件数动态计算 |
| X-03 | fill 任务在 `energyAvailable < 300` 时提升为 P0（`priority = 0`） |
| X-04 | build 任务中 spawn/tower 类型的 site 为 critical（`priority = 1, maxWorkers = 2`），其他为 normal（`priority = 2, maxWorkers = 1`） |
| X-05 | upgrade 任务仅在 `colonyState === "normal"` 或 `hasDowngradeRisk` 时生成 |
| X-06 | 紧急抢占：P0 fill/flee 可使普通 assignment 失效（`invalidateAssignments(roomName, minPriority)`） |
| X-07 | 角色 不自行在不同战略之间争抢 — 由系统完成抢占 |

### 12.2 能量优先级链

```
P0: worker 恢复采能 → spawn 供能
P1: harvester 采能 → hauler 物流 → spawn/extension 填充
P2: upgrader 升级（仅 energyAvailable >= 300）
P2: builder 建造（仅 developmentGate 通过）
P3: 远矿/scout/市场（仅 healthy/guarded）
```

### 12.3 Source 占用均衡

| 约束 ID | 约束内容 |
|---------|---------|
| X-08 | Kernel 预构建全局 `sourceOccupancy` 映射，避免每房独立遍历 `Game.creeps` |
| X-09 | harvester 出生时分配到 `sourceOccupancy` 最低的 source |
| X-10 | `assignment-service` 按 `getCreepsAssignedToSource` 统计实际占用（使用 assignment 而非遗留 sourceId） |
| X-11 | 同一 source 的 creep 数达到 `maxWorkers`（按 RCL 分级，见 X-02）时不再分配新 creep |

### 12.4 孵化协调

| 约束 ID | 约束内容 |
|---------|---------|
| X-12 | `spawn-manager` 是唯一调用 `spawnCreep` 的模块 |
| X-13 | 存在 P0 请求时暂停所有非 P0 孵化 |
| X-14 | `spawn.spawning` 和已提交请求计入人口，避免重复孵化 |
| X-15 | body 不超过 `energyCapacityAvailable`；P0 可按 `energyAvailable` 降级 |
| X-16 | P0/P1 角色的 body 降级阈值基于 `energyAvailable`（当前可用能量）而非 `energyCapacityAvailable`（容量上限）；当 extension 不满时，优先使用最小可孵化 body 速出，避免等待 extension 充满 |
| X-17 | 替换请求在 `replaceBy`（`body.length * 3 + 15`）前入队；普通请求不侵占其窗口 |
| X-18 | 同类 creep 的 `spawnIndex` 错峰，避免同 tick 集体寿终 |

### 12.5 能量交付时序约束

同一 container 的 harvester→hauler 能量交付链需要时序协调，避免无效操作：

| 约束 ID | 约束内容 |
|---------|---------|
| X-19 | harvester 与 hauler 同为 P1 时，harvester 应在 hauler 之前执行（通过 `ticksToLive` 排序或角色前缀排序），确保先填 container 再取 |
| X-20 | hauler 从 container 取能量时，使用 `container.store.getUsedCapacity(RESOURCE_ENERGY)` 预估可用量；若预估量 < CARRY 容量，限制 `withdraw` 量为当前可用量，避免返回 `ERR_NOT_ENOUGH_RESOURCES` |
| X-21 | harvester 向 container 填能量时，使用 `container.store.getFreeCapacity(RESOURCE_ENERGY)` 预估可用空间；若预估空间为 0，跳过 transfer 直接进入下一个交付目标 |
| X-22 | 同一 container 的 harvester 和 hauler 不应在同一 tick 内同时操作同一个 container（避免竞态），但允许通过上述时序约束自然错峰 |
| X-23 | container 被毁后，harvester 回退到直接填 spawn/extension；hauler 清除该 container 的 targetId 并重新分配 |

---

## 13. 返回码处理规范

### 13.1 通用返回码处理表

所有角色对 Screeps API 返回码的处理必须遵循以下表格，不允许散落 if：

| 返回码 | 含义 | 处理方式 |
|--------|------|---------|
| `OK` | 成功 | 更新任务进度，续 lease，必要时切状态 |
| `ERR_NOT_IN_RANGE` | 不在范围 | 交给 `moveToTarget`，当前 tick 不再换目标 |
| `ERR_NOT_ENOUGH_RESOURCES` | 资源不足 | 清空对应 target，进入 acquire 或 idle |
| `ERR_FULL` | 目标已满 | 切到 work/delivery 或换明确下一目标；调用 `updateMode` |
| `ERR_INVALID_TARGET` | 目标无效 | 释放 assignment，限流记录配置错误 |
| `ERR_NO_BODYPART` | 缺少部件 | 释放 assignment，限流记录配置错误（hauler 尝试 harvest 时） |
| `ERR_NO_PATH` | 无路径 | 增加失败计数；一次受控重寻路后释放目标并回退 |
| `ERR_TIRED` | 疲劳 | 不重置卡位计数；不重寻路；下一 tick 继续 |
| `ERR_BUSY` | spawn 忙 | 不是错误；下一 tick 再试（仅 spawn-manager） |
| `ERR_NOT_ENOUGH_ENERGY` | 能量不足 | 等待能量；不是错误（仅 spawn-manager） |
| `ERR_RCL_NOT_ENOUGH` | RCL 不足 | 保持队列，RCL 提升后重试（仅 construction-manager） |
| `ERR_INVALID_ARGS` | 参数错误 | 限流记录配置错误；隔离请求 |

### 13.2 harvest 返回码

| 返回码 | 角色处理 |
|--------|---------|
| `OK` | 继续采集 |
| `ERR_NOT_IN_RANGE` | `moveToTarget(creep, source)` |
| `ERR_NOT_ENOUGH_RESOURCES` | source 暂时耗尽 → idle 等待 regen |
| `ERR_NO_BODYPART` | hauler 误调 → 释放 assignment，记录错误 |
| `ERR_INVALID_TARGET` | source 消失 → 清除 sourceId，重新分配 |

### 13.3 transfer 返回码

| 返回码 | 角色处理 |
|--------|---------|
| `OK` | 继续运送 |
| `ERR_NOT_IN_RANGE` | `moveToTarget(creep, target)` |
| `ERR_FULL` | 目标已满 → `updateMode` → 换下一个目标或回退 |
| `ERR_NOT_ENOUGH_RESOURCES` | creep 空 → `updateMode` → acquire |
| `ERR_INVALID_TARGET` | 目标消失 → 清除 targetId → 重新分配 |

### 13.4 build 返回码

| 返回码 | 角色处理 |
|--------|---------|
| `OK` | 继续建造 |
| `ERR_NOT_IN_RANGE` | `moveToTarget(creep, site)` |
| `ERR_INVALID_TARGET` | site 不再有效 → `releaseAssignment` → 重新分配 |
| `ERR_NOT_ENOUGH_RESOURCES` | creep 空 → `updateMode` → acquire |
| `ERR_NO_BODYPART` | 缺 WORK → 释放 assignment，记录错误 |

### 13.5 withdraw 返回码

| 返回码 | 角色处理 |
|--------|---------|
| `OK` | 继续取出 |
| `ERR_NOT_IN_RANGE` | `moveToTarget(creep, container)` |
| `ERR_NOT_ENOUGH_RESOURCES` | container 空 → idle 等待 |
| `ERR_INVALID_TARGET` | container 消失 → 清除 targetId → 重新分配 |
| `ERR_FULL` | creep 满 → `updateMode` → work |

### 13.6 upgradeController 返回码

| 返回码 | 角色处理 |
|--------|---------|
| `OK` | 继续升级 |
| `ERR_NOT_IN_RANGE` | `moveToTarget(creep, controller)` |
| `ERR_NOT_ENOUGH_RESOURCES` | creep 空 → `updateMode` → acquire |
| `ERR_NO_BODYPART` | 缺 WORK → 释放 assignment，记录错误 |
| `ERR_INVALID_TARGET` | controller 不存在或非己方 → idle |

---

## 14. 状态转移矩阵

### 14.1 通用状态转移

| 当前状态 | 事件 | 目标状态 | 触发条件 |
|---------|------|---------|---------|
| acquire | 背包满（`free === 0`） | work | `updateMode` 检测 |
| work | 背包空（`used === 0`） | acquire | `updateMode` 检测 |
| acquire/work | `shouldFlee === true` | flee | hostileCreeps 出现 |
| flee | 威胁解除 | acquire/work | `shouldFlee === false` + `updateMode` |
| acquire/work | 无有效任务 | idle | `getAssignment` 返回 undefined |
| idle | 分配到任务 | acquire/work | `getAssignment` 返回有效 assignment |
| idle | P0 紧急 | acquire/work | `invalidateAssignments` 后重新分配 |
| 任意 | `ensureHome` 失败 | idle | creep 不在 home 房间 |
| 任意 | 卡位 ≥ `stuckThreshold + repathLimit` | idle | `moveToTarget` 检测 |

### 14.2 updateMode 逻辑

```
if (mode === "acquire" && free === 0) → work
if (mode === "work" && used === 0) → acquire
if (!mode) → used > 0 ? work : acquire
```

> **关键**：仅在阈值跨越时写 `memory.mode`。如果 `mode === "acquire"` 且 `free > 0`，不写 Memory。

### 14.3 assignment 生命周期

```
出生 → 无 assignment
  ↓ getAssignment
分配 → assignment 有效（lease 未过期、target/source 存在）
  ↓ 每 tick 续约（leaseUntil = tick + leaseDuration）
续约 → 继续工作
  ↓ lease 过期 / target 消失 / source 消失 / revision 变化
失效 → 释放旧 assignment → 重新请求
  ↓ 无可用任务
idle → 等待下一 tick 重新分配
  ↓ 紧急抢占（invalidateAssignments）
强制失效 → 清除 memory.assignment → 重新请求
```

---

## 15. 边缘场景全集

### 15.1 CPU 相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| tickLimit 临时低于 20 | `Game.cpu.tickLimit` 波动 | 预算取 `limit` 和 `tickLimit` 较小值；立即切更低 tier | mock 不同 tickLimit |
| 单个系统耗时突刺 | 某系统 CPU 消耗异常 | 当前工作完成后熔断后续低优先级；记录模块 CPU | 人工增加 getUsed 序列 |
| bucket 阈值附近波动 | 900/1100/900 反复 | 降级立即生效；恢复须满足滞回（+500 且持续 20 tick） | 连续输入波动 bucket |
| global reset 后缓存消失 | global 对象清空 | 重建 global 索引；惰性重建路径缓存；Memory 保留 | 清空 global 后 dry tick |
| CPU 死亡螺旋 | 连续 10 tick Conserve/Recovery | 强制暂停发展和远程；只留 P0/P1；检查 telemetry 热点 | 长时间低 bucket mock |

### 15.2 Memory 相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| 根 Memory 为空 | 新 server / 首次运行 | 初始化安全默认值；不假设 rooms/creeps 存在 | 空对象 fixture |
| 字段部分缺失 | schema 升级后部分字段未迁移 | 使用可选链和默认值；不抛错 | 畸形 fixture |
| 迁移运行中重启 | server 重启或代码回滚 | cursor 可重复执行；未完成前不提升 schemaVersion | 迁移中途重启 fixture |
| 大量死亡 creep memory | 战争 / 远矿损失 | 分批清理（每 tick 限量或每 10 tick）；不在一个 tick 全量 delete | 上千条旧记录 |
| CreepMemory role 被删除 | 角色重命名 / 删除 | 限流记录未知 role；将 creep 置为安全待命；后续迁移清理 | 旧 role fixture |
| Memory 接近上限 | 长期运行 + 多房 | 清理旧 creep memory；压缩远矿数据；分批清理 | 大量数据 mock |

### 15.3 Spawn 相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| 全员死亡 + spawn 有 200 能量 | 战争损失 | P0 worker 立即孵化；所有非 P0 请求暂停 | 冷启动 fixture |
| 全员死亡 + spawn 无 200 能量 | spawn 断能 | 系统继续运行，等待 spawn 被动回能（1 能量/tick）；每 tick 检查 `energyAvailable >= 200`，达到后立即孵化 P0 worker；恢复时间约 200 tick（约 3.3 分钟） | 0 能量 fixture |
| spawn 正在孵化时出现 P0 | 低优先级孵化中 | 不取消当前孵化；记录最晚恢复时间；孵化完成后补 P0 | busy spawn + P0 fixture |
| P0 body 不满足 energyAvailable | 能量不足但容量足够 | P0 使用最小降级 body `[WORK, CARRY, MOVE]` | 200/300/550 能量档位测试 |
| 同一 source 多请求重复创建 | 需求评估重复 | 根据稳定 key 合并；计入 spawning 和已提交请求 | 连续 50 tick 断言队列长度 |
| 关键 creep 即将死亡但队列被占 | TTL 临近 | 替换请求提升优先级；普通请求不侵占窗口 | TTL + 长 body 组合测试 |
| 两个 spawn 同时空闲 | RCL7+ | spawn-manager 找到第一个空闲 spawn 孵化；下一 tick 用另一个 | 双 spawn fixture |
| body 超过 energyCapacityAvailable | 配置错误 | 隔离请求；递增 retries；限流报警 | 配置错误 fixture |

### 15.4 Creep 相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| targetId 指向已拆除目标 | 结构被毁 | 清空 target 和 assignment；重新分配或 idle | 目标从 mock 移除 |
| creep 满背包但所有交付结构满 | 能量过剩 | 不反复 findClosestByRange；转 container/storage 或升级；idle | 所有结构满 fixture |
| creep 空背包但 source 暂无能量 | source regen 中 | 保留 source 绑定；idle 等待 regen；不扫全房 | source regen 前 fixture |
| 多个 creep 争抢同一 source | 无 assignment 分配 | assignment-service 分配槽位；角色不各自抢最近 | 两个以上同角色竞争 |
| 连续卡位 | 路径被堵 | 2 tick 后关闭 ignoreCreeps；4 tick 后清目标 idle | blocker mock |
| 跨房出口不可达 | 出口被堵 | 记录卡位；有限次重寻路后回退/撤退 | 无路径 mock |
| builder 在 Recovery 仍有任务 | CPU 降级 | 立即停止发展性动作；回退为送能或待命 | 低 bucket 状态机测试 |
| upgrader 在 bootstrap 被跳过 | colonyState 门禁 | 跳过执行；降级风险时例外强制运行 | bootstrap fixture |
| creep 不在 home 房间 | 跨房移动中 | ensureHome 返回 false；moveTowardRoom 走出口；不执行经济动作 | 跨房 fixture |
| creep 的 role 未知 | 角色被删除 | 清除 target 和 assignment；限流记录；置为安全待命 | 旧 role fixture |
| assignment lease 过期 | 超过 leaseDuration | validateAssignment 返回 false；释放旧 assignment；重新请求 | lease 过期 fixture |
| assignment revision 变化 | 布局修订 | validateAssignment 返回 false；重新请求 | revision 变化 fixture |

### 15.5 建造相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| RCL 不足 | RCL 未达到 | 任务保持 queued；RCL 提升后重试 | RCL 边界测试 |
| 地形冲突 | 墙/不可建 | 标记 blocked；长冷却（100 tick）；3 次后删除 | 地形 fixture |
| site 已存在 | 重复创建 | 同步为 site 状态；不重复创建 | 已有 site fixture |
| 达到 site 上限 | 全局/每房上限 | 等待（retryAt + 10）；不创建 | 上限 fixture |
| builder 队列为空 | 无 BuildTask | 回退为填能/维修/升级/idle | 空 BuildQueue fixture |
| RCL 升级后大量可建项目 | 一次性解锁多结构 | 仅创建队头满足依赖的少数 site；规划分 tick | RCL 升级后队列断言 |
| 关键 container 被拆 | 被攻击 | 回退到混合 harvester 直接送能；重建升为 critical | container 丢失 fixture |
| storage 被毁 | 被攻击 | hauler 回退到 container → spawn 链；重建升为 critical | storage 丢失 fixture |
| tower 被毁 | 被攻击 | safe mode 考虑；重建升为 P0 critical | tower 丢失 fixture |
| spawn 被毁 | 被攻击 | 另一 spawn 继续孵化；重建升为 P0 critical | spawn 丢失 fixture |
| 布局模板冲突 | spawn 位置占模板格 | 标记 blocked；报警；不自动拆建筑 | 初始 spawn 冲突 fixture |
| 永久 blocked 格 | 地形永久冲突 | 超过 3 次重试后删除；人工确认或布局修订才解封 | 永久冲突 fixture |

### 15.6 防御相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| 出现 hostiles 且 bucket 很低 | 敌袭 + 低 CPU | P0 威胁检查和 Tower 仍运行；builder/远矿立即停工 | hostile + Recovery fixture |
| Tower 无能量而 builder 消耗能量 | Tower 空能量 | Tower 不维修但保留攻击能量；builder 在 defense 状态先 flee | tower 能量不足 fixture |
| 敌人有 heal creep | Tower 攻击被 heal | 三塔集火同一目标；优先攻击无 heal 的敌人 | heal 敌人 fixture |
| safe mode 冷却中 | 刚结束 safe mode | 无法激活；依赖 Tower 和 flee | safe mode 冷却 fixture |
| safe mode 不可用 | 已用过 | 无法激活；依赖 Tower 和 flee | safe mode 不可用 fixture |
| 敌人数量远超 Tower 容量 | 大规模入侵 | 所有非战斗 creep flee；Tower 集火；safe mode 考虑 | 大规模入侵 fixture |
| 敌人在房间边缘 | 刚进入 | shouldFlee 触发；creep 走向 spawn 或出口 | 敌人边缘 fixture |

### 15.7 经济相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| storage/容器满 | 能量过剩 | 停止或限速采集；hauler idle；生成消费/转运任务 | 满仓 fixture |
| source 一侧矿工死亡 | creep 损失 | hauler 清空无效 assignment；转为关键送能或 idle；spawn 优先补 miner | miner 死亡 fixture |
| 所有 source 同时 regen | 300 tick 周期 | 所有采集者 idle 等待；不跨房找 source | source regen fixture |
| 能量链断裂 | hauler 死亡 | harvester 回退到直接填 spawn/extension；spawn 补 hauler | hauler 死亡 fixture |
| 能量低于 floor | energyAvailable < 300 | upgrader idle；builder 回退到填能；harvester 继续 | 低能量 fixture |
| 控制器即将降级 | ticksToDowngrade < 10000 | upgrader 强制升级（绕过 floor）；P1 优先级孵化 | 降级风险 fixture |
| link 网络中断 | link 被毁 | 回退到 container → hauler 物流链 | link 毁坏 fixture |
| mineral 耗尽 | mineralAmount = 0 | miner idle 等待 regen（~30000 tick）；hauler 不搬运矿物 | mineral 耗尽 fixture |

### 15.8 多房相关边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| 一个房间规划异常 | 代码 bug / 数据损坏 | 错误隔离到房间；其他房和全局 P0 继续运行 | 两房单房抛错 fixture |
| home 房不可见 | 视野丢失 | 本地 creep 回家/待命；remote 任务延后；不盲走 | Game.rooms 缺失 fixture |
| controller 被他人 claim | 控制权丢失 | 任务失效；停止对应角色；不向无权限目标发 intent | 控制权切换 mock |
| 远矿房被攻击 | 敌袭远矿 | 远矿 creep 撤回 home；远矿任务暂停 | 远矿敌袭 fixture |
| 远矿 source 耗尽 | regen 周期 | 远矿 creep idle 等待；不跨房找替代 | 远矿 regen fixture |
| 多房 CPU 分配不均 | 某房 CPU 消耗大 | 分房轮询（roomIndex % interval）；低优先级房延后 | 多房 CPU mock |
| 新 claim 房无 spawn | 刚 claim | claimer 转 builder 建造 spawn；P0 critical 优先 | 新 claim fixture |
| 跨房路径过长 | 远程房距离远 | 预计算 route waypoint；低频更新；不每 tick 寻路 | 远程房 fixture |

### 15.9 外部状态边缘场景

| 场景 | 触发条件 | 预期行为 | 验证方式 |
|------|---------|---------|---------|
| 新代码部署后 body 变更 | 配置更新 | migration + feature flag 逐步启用；保留兼容读取 | schema 升级 smoke test |
| 新代码部署后 Memory 语义变更 | schema 升级 | migration 函数幂等；cursor 分 tick；成功后才升版本 | 迁移中断恢复测试 |
| API 返回异常码 | 引擎 bug / 限制 | 限流记录；退避重试；不每 tick 重试 | 异常码 fixture |
| 服务器重启 | global reset | global 缓存惰性重建；Memory 保留；assignment/sourceId 保留 | 清空 global 后 dry tick |
| 延迟 / 慢 tick | 服务器负载 | 预算检测；降级；跳过低优先级 | 模拟高 CPU |

---

## 附录 A：RCL 解锁速查表

| RCL | 能量容量 | extension | tower | storage | link | spawn | terminal | lab | 核心阶段 |
|-----|---------|-----------|-------|---------|------|-------|----------|-----|---------|
| 1 | 300 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 生存启动 |
| 2 | 500 | 5 | 0 | 0 | 0 | 1 | 0 | 0 | 吞吐建立 |
| 3 | 800 | 10 | 1 | 0 | 0 | 1 | 0 | 0 | 防御雏形 |
| 4 | 1300 | 20 | 1 | 1 | 0 | 1 | 0 | 0 | 稳态成形 |
| 5 | 1800 | 30 | 2 | 1 | 2 | 1 | 0 | 0 | 链接扩张 |
| 6 | 2000 | 30 | 2 | 1 | 3 | 1 | 1 | 3 | 采矿终端 |
| 7 | 2300 | 30 | 3 | 1 | 3 | 2 | 1 | 6 | 双 spawn 三塔 |
| 8 | 2300 | 30 | 3 | 1 | 3 | 3 | 1 | 10 | 满级运行 |

## 附录 B：角色优先级速查表

| 角色 | 优先级 | body 成本 | RCL 解锁 | minCount | maxCount |
|------|--------|----------|---------|----------|----------|
| worker | P0 | 200 | RCL1 | 0 | 2 |
| harvester | P1 | 200-350 | RCL1 | 2 | 4 |
| hauler | P1 | 200-300 | RCL2 | 2 | 4 |
| upgrader | P2 | 200-350 | RCL2 | 1 | 3 |
| builder | P2 | 200-350 | RCL2 | 1 | 2 |
| miner（矿物） | P2 | 450 | RCL6 | 0 | 1 |
| scout | P3 | 50 | RCL5 | 按需 | 按需 |
| claimer | P3 | 700 | 多房 | 按需 | 按需 |
| reserver | P3 | 700 | 远矿 | 按需 | 按需 |
| defender | P3 | 变动 | 敌袭 | 按需 | 按需 |

## 附录 C：配置参数速查表

| 参数 | 值 | 位置 | 说明 |
|------|-----|------|------|
| `stuckThreshold` | 2 | `CONFIG.kernel` | 卡位后重寻路的 tick 数 |
| `repathLimit` | 2 | `CONFIG.kernel` | 释放目标前的最大重寻路次数 |
| `errorLogInterval` | 25 | `CONFIG.kernel` | 相同错误日志最小间隔 |
| `cpuReserve` | 0.8 | `CONFIG.kernel` | 硬上限以下保留的安全 CPU 余量 |
| `replaceBuffer` | 15 | `CONFIG.spawn` | body 替换窗口的额外 tick 缓冲 |
| `maxRetries` | 5 | `CONFIG.spawn` | 孵化请求隔离前的最大重试次数 |
| `recoveryEnergyReserve` | 200 | `CONFIG.spawn` | P0 恢复 body 预留的最低能量 |
| `maxNormalSitesPerRoom` | 2 | `CONFIG.construction` | 每房最大活跃 normal site 数 |
| `maxCriticalSitesPerRoom` | 1 | `CONFIG.construction` | 每房额外允许的 critical site 数 |
| `maxGlobalSites` | 5 | `CONFIG.construction` | 全局活跃 site 上限 |
| `planInterval` | 50 | `CONFIG.layout` | 布局规划器运行间隔 |
| `minTraffic` | 10 | `CONFIG.layout.road` | 道路候选最小通行次数 |
| `maxCandidates` | 5 | `CONFIG.layout.road` | 每房最多道路候选数 |
| `leaseDuration` | 20 | `CONFIG.assignment` | 本地任务租约时长 |
| `sourceTargetWorkParts` | 5 / 6 / 8 | `CONFIG.assignment` | 每个 source 目标 work parts 总数，按 RCL 分级：RCL1-3: 5 / RCL4-6: 6 / RCL7-8: 8 |
| `upgradeEnergyFloor` | 300 | `CONFIG.economy` | upgrader 允许工作的最低 extension 能量（RCL1-3） |
| `upgradeEnergyFloorStorage` | 1000 | `CONFIG.economy` | upgrader 允许工作的最低 storage 能量（RCL4+）；避免与 spawn 孵化竞争 extension 能量 |
| `buildEnergySurplus` | 200 | `CONFIG.economy` | builder 允许工作的最低能量盈余 |
| `controllerDowngradeThreshold` | 10000 | `CONFIG.economy` | 触发紧急升级的 ticksToDowngrade 阈值 |
