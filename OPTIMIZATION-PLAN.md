# Screeps 帝国优化方案（2026-11-12）

> 证据基线：静态代码考古 + 官服 shard3 纯只读动态验证。线上 `main.js` sha `86317408db89`，与本地 `dist/main.js` 逐字一致。
> 本文是**待办方案**，不是已实现功能记录；代码与测试仍是唯一真相源。
> 本文只做规划，**不含任何代码改动**。标签：**[F]** 代码/线上读数事实，**[E]** 老玩家与架构判断，**[H]** 需动态验证的假设。

---

## 0. 先读：证据基线、硬约束、三条因果链

### 0.1 线上快照（tick ≈ 84,212,895，shard3）

| 项 | 读数 | 来源 |
|---|---|---|
| 领土 | 3 房 W37S58/W38S56/W39S55 = RCL 8/7/5，59 creep，schemaVersion 49 | `observe.mjs`, `peek.mjs` |
| CPU | limit 20、bucket 10000、300t 环 avg 17.1、10t 窗 avg 18.6→16.5 | `observe.mjs` |
| 两条 tier 轴 | `kernel.tier=healthy` 与 `kernel.capacity.tier=constrained@84212109` 同时成立 | `peek.mjs` |
| 容量闸输入 | `rateTotal=16.73`、`rateWindowTicks=767`、`unsampledTicks=0`、`avg10` 在动 | 三次间隔读数 |
| 扩张 | `Blocked=G6`，两条 plan 恒 `EVALUATED`；`expansionAllowed` 在 30 拍内 false→true 但仍被 G6 挡 | `observe.mjs`, `modules.mjs` |
| 合同 | `ca=ua=ac=83316316`、`td=0/cs=0` ⇒ 约 896,579 拍未更新 | `peek.mjs` |
| 战争 | `warPlan` 缺席、编成零战斗角色、事件 `EnemyInvasion 2 / TowerVolley 18 / EnemyCleared 2` | `observe.mjs`, `modules.mjs` |
| 情报 | `intelCoverage={rooms:0,players:3,tick:84212733}` 三次不变；段 5 三玩家 `lastHostileAt` 全 0 | `peek.mjs`, 段 5 GET |
| 高级实体 | `powerCreeps.homeAssignments={}`、`powerFarmMissions=[]`、账户 resources 仅 `pixel`、`boostedCreeps=[]` | `modules.mjs`, `auth/me` |
| 自检 | `memoryHistory` 两条路径都不存在；`violationsTotal=0`；`recent` 全是约 116,000 拍前旧条目 | `peek.mjs` |
| 打包 | 50 个 src 模块从 `main.ts` 不可达；线上包字符串阳性/阴性对照成立 | import 可达闭包 + `/api/user/code` |
| 段体量 | seg0=503B、seg1=76,674B、seg2=23,300B、seg3=26,922B、seg4=69,887B、seg5=292B | `memory-segment` GET |

### 0.2 发布链硬约束（**先于一切编码**）

- **[F] `dist/main.js` = 856,124 B，CI 预算 `CAP=819200` 超限 36,924 B**（`.github/workflows/deploy-screeps.yml:70-78`）。线上跑的正是这份本地构建。[H：线上 sha 相同却超预算，推断发布通道绕过了该门禁，实施前需核实]** **任何新增代码都会先撞这堵墙**。
- **[F] 工作树有大量未提交改动**（`git status` 多行 `M`），而线上 sha 等于本地 `dist/main.js`。发布前必须审完并对齐，否则会把未审改动一起带上线。
- **[F] `npm test` 在本沙箱被 `node-brokered-fs-shim` 打断**（vitest worker 连不上 broker.sock）⇒ 验收走 `test:unit` / `test:integration` / `typecheck` / `check:docs` / `build` 分跑，不把整包 `npm test` 当判据。
- **[F] 质量门禁**：`typecheck` / `check:docs` / `test` / `build` 全绿（`AGENT.md:59-63`）；`test:e2e:smoke` 是 CI 成员；bundle 800KB 闸门。
- **[F] 测试规模**：unit 468 文件、integration 30、e2e 34 场景；`STANDARD_ROOM_LAYOUT` 是唯一布局源（`tests/support/room-blueprints.ts:31-39`），改它须 integration + e2e smoke 双绿。

### 0.3 三条因果链（方案的主干，不是功能清单）

**链 A — CPU 自锁**（最高优先，其余优化都建立在它能响应之上）

```
kernel.ts:236/305/309  cpuCumulative(heap, boot 起累计, ticks 单调增)
  → telemetry-collector.ts:551  computeCpuRate(cum, Game.time - boot)
      写在 sampleMemorySize() 内，门控 populationInterval=100 拍（:217/:225）
      且 recovery/conserve 档直接 return（:178-197）⇒ 这些档位根本不写
  → Memory.kernel.stats.cpuRate（低频累计快照，40 拍内一字未变）
  → empire-strategy.ts:207-213（生效 interval=5 拍）读 total/windowTicks/unsampledTicks
  → capacity.ts:51-57 pickCpuUsagePerTick → evaluateCapacity → G6 红 → 扩张停
```
决策频率 5 拍，数据刷新 100 拍且内容是进程寿命累计 ⇒ **20 倍频率错配 + 旧样本永不退出**。[F]
动态证据：三次读数里 `avg10` 18.5→17.6→16.5、`capacity.inputs.at` 在推进，而 `rateTotal=16.73`、`rateWindowTicks=767` 完全冻结，`capacity.tier` 与 `upgradeTicks=0` 不动。[F]
**口径澄清（重要）**：40 拍内不变本身是 `CONFIG.telemetry.populationInterval=100` 的设计结果，不是异常冻结。真正的缺陷是三条叠加——(a) 写入内容是 boot 起累计（`cum.ticks` 单调增）而非最近 100 拍窗口；(b) 消费侧 `empire-strategy` 生效 interval=5 拍（`config/index.ts:169-170`）却读这份累计账；(c) `recovery`/`conserve` 档在 `telemetry-collector.ts:178-197` 提前 return，`cpuRate` **完全不写**。方案只修这三条，不改「100 拍采样」这一节拍本身。[F]

**链 B — 反馈断裂**：判定与台账只写不读 ⇒ 恢复/合同/L2/战果无法回流 Strategy，帝国「能检测、不能学习」。[F]

**链 C — 反复失忆**：`globalCache()` 直接返回 `globalThis`（`global-cache.ts:1153-1155`），情报 Map、健康史、恢复表、EMA、E7/E8 tracker 全 heap-only ⇒ 每次部署/Global Reset 归零，一年尺度上无法积累历史。[F][E]

### 0.4 决策优先级（按 `AGENT.md` / 本方案遵循的 8 级）

1. 长期自主运行能力 → 2. 系统稳定性 → 3. 架构演化能力 → 4. CPU/Memory 效率 → 5. 多房扩展 → 6. 可维护性 → 7. 开发成本 → 8. 短期收益（最低）。
**Architecture Challenge 五问**（每个子方案都必须答）：当前收益 / 10,000 tick 后 / 10 房能否跑 / CPU 影响 / 维护成本。第 8 节给出逐阶段答案。

---

## 1. 阶段 0：发布链前置（P0，不动业务逻辑）

| # | 动作 | 验收 |
|---|---|---|
| 0.1 | 审完工作树未提交改动；`node tmp/tools/official/check-code.mjs` 确认线上 sha 与将发布的 `dist/main.js` 一致 | 两侧 12 位 sha 相同且逐字等于待发布产物 |
| 0.2 | **解决 bundle 超预算**：`wc -c dist/main.js` = 856,124 > 819,200。用 `tmp/tools/bundle-per-module.mjs` 定位前 10 大模块；减体积手段：合并重复实现（`config/metrics.ts` 的 15 条目录 vs `telemetry/index.ts` 的 16 个注册器）、压缩遥测字符串、删除已接线模块里的重复纯函数 | `wc -c ≤ 819200`，且留 ≥5% 余量 |
| 0.3 | 建立「缺陷台账 → 代码锚点」映射表（放本文/测试名，不写进代码注释——`AGENT.md:32-43` 禁止注释引文档编号） | 每条 #编号 有 文件:行号 与一个复现测试路径 |

**⚠️ 反直觉但必须写清**：删除阶段 4 那 50 个不可达模块**不会减小 bundle**——rollup `treeshake.moduleSideEffects:false` 早就把它们剔除了。删死码的收益是验证真相与维护成本，不是体积。[F]
**属人**：调高 `CAP` 属于改安全预算（`rollup.config.mjs:37-39` 的 reload death loop 论证），不自行决定；优先减体积。[E]

---

## 2. 阶段 1：止血（P0，不改变对外行为，只修仪表与容错）

### 2.1 CPU 读数改真窗口 —— 全案第一刀

**根因锚点**：`kernel.ts:236/305/309`（累计账）、`telemetry-collector.ts:74-164`（`computeCpuRate`）、`:551`（写点与名义窗 `Game.time - boot`）、`:217/:225`（100 拍门）、`:178-197`（低档位不写）、`capacity.ts:51-57`、`empire-strategy.ts:207-213`。

**改法**：

1. 新增 **滚动窗口**（`kernel/global-cache.ts` 加 `CpuWindow`，heap，允许 reset 归零但由窗口自描述）：
   ```ts
   interface CpuWindow {
     size: number;                 // CONFIG.cpu.rateWindowTicks，建议 300
     samples: Float64Array;        // 环形，每拍拍尾 push end
     sum: number;
     count: number;
     head: number;
     missing: number;              // 窗口内退拍数，随窗口滚动可归零
     lastWriteTick: number;
   }
   ```
   拍尾 `kernel.ts:298-313` 在 `cum.total += end` 之外同时 `pushCpuSample(w, end)`，O(1) 常数开销。[H：每拍额外成本需 bench 确认 <0.01 CPU]
2. `telemetry-collector.ts:74-164` 增 `computeCpuRateFromWindow(w)`：分母 = `w.count`，`windowTicks = w.size`（真窗口，不再 767），`unsampledTicks = w.missing`（**不再 `max(0, window - cum.ticks)` 单调累积**），新增 `at: Game.time` 时间戳。保留 `bySystem/byRole/byPhase/unphased/tail` 恒等式与 `*Count/*TailSum` 自证列，现有三份测试不返工。
3. **把写入点从 `:551` 移出 `sampleMemorySize`**：该函数每 100 拍才跑，且 `recovery`/`conserve` 档在 `:178-197` 提前 return ⇒ 低档位根本不写。**首选**在 `kernel.ts:298-313` 拍尾的 `safeRun("cpu/tick-tail", ..., true)`（critical、每拍必走、不受档位影响）内每 10 拍调 `mirrorCpuWindow()`；**次选**挂 `updateStatsSummary`（`:232` 主路径 / `:195` conserve 路径，每 10t，但 recovery 仍不写 ⇒ 必须在 capacity 侧把「读数超龄」显式退回 `avg10` 并记 `skipReason`）。两条都要求 `stats.cpuRate.at` 单调递增、刷新频率 ≥ 决策频率，且不得让 recovery 档读到一份无声冻结的旧账。
4. `capacity.ts:51-57`：`CpuUsageMeasurement` 增 `tick`/`measuredAt`/`maxAgeTicks`；`trustworthy` 加一条 `tick - measuredAt <= maxAgeTicks`，过期退回 `avg10` 并 `recordSkip("capacity/stale-rate")`。domain 层保持纯函数（`tick` 由入参给，不读 `Game.time`）。
5. `empire-strategy.ts:207-213` 传 `at`；`:287-316` 的 `capacity.inputs` 增 `rateAt`/`rateAgeTicks` 留痕。
6. `CONFIG.cpu` 新增 `rateWindowTicks: 300`、`maxRateAgeTicks: 50`（单一真相源），保留 `windowedRate` 开关一个版本用于回滚。

**验收（预注册，写死判据）**：

- `node tmp/tools/official/peek.mjs kernel.stats.cpuRate kernel.capacity` 连续三次、间隔 ≥30 拍：`windowTicks` 稳定在 300 附近（**不再 767**）、`at` 单调递增、`total` 随真实 CPU 波动、`capacity.inputs.rateTotal` 与 `avg10` 在短窗内收敛。
- `capacity.inputs.rateAgeTicks ≤ 50`；`skipReasons` 无 `capacity/stale-rate`。
- 「能响应」判据：连续 300 拍驻留后 `capacity.upgradeTicks > 0` 或 `since` 前进。**不要求翻绿**——真实 usage 16.7 > 门槛 12.0 时仍红才是正确行为。
- 若 `Blocked=G6` 仍红，必须能用 `usage` 解释，不能用「读数冻结」解释。

**测试**：`tests/unit/systems/role-cpu-ema.test.ts`、`tests/unit/telemetry/cpu-rate-truncation.test.ts`、`tests/unit/kernel/phase-span.test.ts`、`tests/unit/strategy/capacity.test.ts:108-191`、`tests/unit/systems/empire-strategy.test.ts:70-100`；**新增 integration**：窗口滚动、退拍后 `missing` 随窗口归零、global reset 后窗口重建、低档位仍刷新。

**风险与回滚**：只改读数口径、不改阈值，但会真实改变分档结果 ⇒ **`AGENT.md:16` 把「阈值」列为属人边界，本项需你确认后实施**。`CONFIG.cpu.windowedRate=false` 保留旧路径一版；git revert 单 commit 可回。

### 2.2 顶层容错边界（预防性 P0）

**事实**：`main.ts:3` 单行 `loop = () => kernel.run()` 无 try/catch；`measuredRun` 只有 `finally` 无 `catch`（`safe-run.ts:105-116`）；`kernel.ts:157 createBudget`、`:186 new Context`、`:193 recordPhaseSpan`、`:227 emitSummary` 及四个调度循环骨架都在 `safeRun` 之外。现有测试只覆盖被包裹段（`tests/integration/edge-cases/edge-cases.test.ts:439`）。[F]
**今晚 `errorsPerTick=0`，唯一 builder bad-ID 异常被 `safeRun` 兜住 ⇒ 未观测到触发，这是预防性加固，不是事故修复。**[F]

**改法**：在 `main.ts:3` 包一层（最小侵入，不动 `kernel.ts:153-155` 的取表点与相位账）：
```ts
export const loop = (): void => {
  try { kernel.run(); }
  catch (e) { recordTickFatal(e); }   // 限频 25t、落 Memory.kernel.stats.lastError、记事件
};
```
`recordTickFatal` 复用 `safe-run.ts:128-141` 的 `lastError` 通道；catch 内部自身再包一层空 try/catch（照 `:138-140` 先例），绝不因诊断失败二次抛出。
**测试**：unit（mock `kernel.run` 抛错 → 断言 `loop` 不抛、`lastError` 落盘、限频生效）；integration（`createBudget`/`emitSummary` 抛错后下一 tick 仍推进相位）。
**风险**：吞错后静默 ⇒ 必须留事件 + `skipReason`，不允许只 log。

### 2.3 自检复活（E4 / E9 / 拆段）

| 缺陷 | 锚点 | 改法 |
|---|---|---|
| E4 恒假（无写者 + 路径错配 + 整体覆写） | `global.d.ts:1018` 定义在 `expectations.memoryHistory`；`kernel.ts:615` 读顶层 `kernelMem.memoryHistory`；`:628-636/:662-676` 两支整体覆写 `expectations` 丢字段；唯一体积采样只写 `stats.memorySize`（`telemetry-collector.ts:418`）；判据 `expectations.ts:405-439` 要 `bootAge≥1500 && length≥3`、间隔 500 | 在 `:418` 旁 push 环形 3–6 样本到 `Memory.kernel.expectations.memoryHistory`；`:615` 改读正确路径；两支覆写改逐字段 merge |
| E9 无判别力 | `kernel.ts:859-860` `missingStructures/missingRoles` 硬编码 0；`expectations.ts:521-536` 判据只看 recovery 时长，采集到的 `storageEnergy/spawnQueueLength/buildQueueLength`（`:861-863`）完全不参与 | 两列改为从 `RoomSnapshot` 真实派生，并让三列进入判据/detail |
| 单段 safeRun 吞掉全部自检 | `kernel.ts:275-277`；先例 `intelligence.ts:209-253` 已把老化拆三段 | 把 `:617-625` 的 8 个采集点拆成独立 `safeRun` 段（至少 critical 段独立），任一抛错不影响其余 |

**验收**：`violationsTotal` 不再恒 0；`expectations.recent` 的 `lastAt` 随 tick 前进；注入内存膨胀场景能触发 E4 事件。
**测试缺口**：`tests/unit/kernel/expectations-e4-e9.test.ts` 现有用例把 `memoryHistory`/`recoverySnapshots` **直传入参**，绕过 kernel 采集器 ⇒ 必须新增 integration 端到端，否则改完仍是假绿。[F]

### 2.4 layout 段 0 容量守卫 + 失守清段（预防性）

`segment-store.ts:483-486` 是唯一没有 `SEGMENT_SIZE_LIMIT`(`:459`, 90KB) 守卫的段；`memory.ts:96-104` 失守房只删 `Memory.rooms`，只有 `territory-manager.ts:195-203` 主动释放才删段条目。[F] 当前段 0 仅 503B，风险未触发。
**改法**：`:483-486` 加与 CPU 段同形守卫（超额按房裁最旧/裁 `overrides`）；`maintainMemory` 失守清理补 `delete layoutSeg[room]; markLayoutDirty()`，复用 territory-manager 的 try 模板。
**测试**：`tests/unit/kernel/segment-store.test.ts`、`tests/unit/systems/territory-manager.test.ts`、`tests/unit/migration/v4-segment-gate.test.ts`，新增「段 0 超 90K 自动裁剪」与「失守房段条目被清」。

---

## 3. 阶段 2：决策状态持久化，Global Reset 自愈（P1）

**架构原则**：`StateStore`（`contracts.ts:240-247` / `state-store.ts`）**不能**当统一镜像层——它只存 6 个固定族的版本号、无泛型 get/set、无 Map 序列化、无 dirty/flush 钩子。[F] 仓内唯一可复用的范例是 `defense-planner.ts:65-107` 的 `getMinCutCache`/`setMinCutCache`（heap miss → Memory → 双写）。
**做法**：新建 `kernel/mirrored-state.ts`（纯 helper：`read/write/serialize` 钩子 + 字段白名单），按族逐个接入；**只落摘要与环形短窗**，禁止把完整 Map/历史数组写进 Memory（`AGENT.md:77`）。新增 Memory 字段必须同步 `config/index.ts:32` 升 v50、`migrations/late.ts:437` 后追加 `{from:49,to:50,run}`、`global.d.ts` 类型、`kernel/memory.ts:34-41` 兜底（`AGENT.md:78-80`）。

### 3.1 房情报落段（本阶段最高价值）

动态证据：`intelCoverage.rooms=0` 且三次读数不变，房情报只住模块级 Map（`intelligence.ts:33`），`segId` 表里根本没有房情报段。[F] 这直接让 war 选靶与扩张候选长期为空。

**最小接口集合（照玩家域段 5 模板，逐条必须做全，缺一即半接线）**：

1. `config/index.ts:45-58` 配额表加 `intelRooms:{id:7}`（占 7–9 预留位）。
2. `kernel/segment-store.ts`：`:24-33` 加 `SEGMENT_INTEL_ROOMS`；`:56-70` 加 `IntelRoomsSegmentData`；`:73-94` 加 `intelRoomsSeg?/intelRoomsDirty?`；`:97-105` 加进 `ALL_SEGMENT_IDS`；`:332-356` 加 `read/mark`；`:480-545` 加 flush 分支（含 90KB 裁剪）。
3. `domain/intel.ts:450-497` 加 `toRoomsRecord/fromRoomsRecord`（现只有 players 版），幂等沿用 `upsertRoomEntry`（`:445`，`prev.observedAt > entry.observedAt` 拒绝）。
4. `systems/intelligence.ts:94-110` 加 `restore/persistRooms`；`:204-253` 把 **restore 排在 `ageRooms` 之前**（否则恢复即被 expiry 清掉），persist 排在老化之后。
5. `global.d.ts:526-623` 补 `intelCoverage` 类型，去掉 `intelligence.ts:237-243` 的 `(Memory as any)`。

**验收**：一次部署后立刻 `peek.mjs kernel.stats.intelCoverage` 的 `rooms > 0`；`intel-players.mjs 7` 读到段且 epoch 推进；`tests/unit/systems/intelligence-aging-gate.test.ts` 与新增 integration「reset 后房情报重建」双绿。

### 3.2 恢复台账 / 冷却 / 健康史 / 自检 tracker

| 族 | heap 锚点 | 落盘策略（摘要级） |
|---|---|---|
| 恢复动作表 | `recovery-execution-system.ts:99-202`、`:235-237` 自认部署归零；`repeats` 已在 `Memory.kernel.escalations`（`recovery-lifecycle.ts:928-963`，cap 12） | 新增 `Memory.kernel.recovery`：每房/动作一条 `{room,domain,actionType,attempts,repeats,lastAt}`；`recoveryCooldowns` 二选一——接 `recordRecoveryAttempt`（`recovery-priority.ts:129`，当前零调用者）或删除恒空支路上收 policy |
| 健康史 | `empire-health-system.ts:204-208` 写 heap；`global-cache.ts:484-524` 的 `__*History` 七列 | 只镜像**最新一帧** `empireHealth/failureGraph/recoveryActions` + 30 拍环形短窗；`g.recoveryActions` 的消费者是 `recovery-execution-system.ts:88`，重建后必须同拍可用 |
| 自检 tracker | `global-cache.ts:615-633` `siteProgressTracker/pathFailureTracker`；E7 阈值 5000t（`expectations.ts:126`） | 落短窗，避免部署间隔 <5000t 时 E7 永不触发 |
| CPU/EMA | `processBootTick`（`kernel.ts:609`）、`cpuCumulative`（`kernel.ts:236`） | **明确标注为进程级、允许归零**；但阶段 1 之后 `computeCpuRate` 不得依赖它做窗长 |

**验收协议**：扩展 `tests/integration/edge-cases/global-reset.test.ts:25-62`（`simulateGlobalReset()` 已删 heap），新增断言覆盖 intel / recovery / health / tracker 四族；`tests/e2e/scenarios/14-old-schema-migration.test.ts` 覆盖 v49→v50；`tests/unit/migration/v19-to-v20.test.ts:328` 的幂等形状照抄。

---

## 4. 阶段 3：反馈闭环接线（P1）

统一模板：**断链证据 → 接线点 → 合规约束 → 验收读数 → 回退**。

### 4.1 供给合同记账

- **断链**：`recordDelivery`（`domain/economy/supply-contract.ts:291`）零调用者；`contract-lifecycle.ts` 状态机与 `contract-node-bridge.ts` 只有 tests 引用；写回链唯一写者是 `specialization-planner.ts:320 saveContractsToMemory`；读侧 `logistics-planner.ts:263-278`。[F]
- **合规**：`compliance.test.ts:108-119` R3 禁止 creeps 值导入 systems、`:336-420` R11 白名单 ⇒ **不能在 `carrier.ts` 里直接调 `saveContractsToMemory`**。
- **推荐接线**：`carrier.ts:53-68` 已写 `creep.memory.lastDelivery = {amount,tick}`（回执同构），`agenda-manager.ts:790-815` 消费回执时在同一 systems 层按 `(home, target, resource)` 找合同 → `recordDelivery` → `saveContractsToMemory`。备选：`specialization-planner.ts:244 maintainSupplyContracts` 低频批量扫回执，避免动 agenda 的完成判定。
- 状态机：接 `contract-lifecycle.ts:42/226` 让 `td/cs/ua` 随交付流转；`bridge` 若无消费者则删除（不留半接线）。
- **验收**：真实交付后 `peek.mjs kernel.supplyContracts` 的 `td/ua` 前进，896,579 拍化石停止增长；`tests/unit/economy/supply-contract.test.ts:307-321` 改为经 systems 层端到端，`tests/unit/empire/agenda-manager-carrier-binding.test.ts:291-326` 增合同断言。

### 4.2 恢复判定回流

- `recovery-execution-system.ts:1165/:1169` 传 `totalInvested: 0` ⇒ `recovery-lifecycle.ts:626` 的「>5000」恒假；`:1173-1180` unviable 只 log；`recommendation` 零消费者；`escalations`（`:1139/:1147`）零决策读者；事件 `RecoveryEscalation=48` 零消费者。[F]
- **改法**：① `totalInvested` 取真实值（`recoveryBeforeStates` + `energyLedger` 差分，或先用已持久化的 `repeats` 作代理）；② unviable 写 `Memory.kernel.recoveryUnviable` + 新事件，而非只 log；③ `recommendation` 作为 `shouldSubmitAction` 的抑制输入；④ `escalations` 接一个决策读者（如扩张暂停/恢复优先级）或明确删台账。
- **最小且最便宜的一刀**：`repeats` 已在 Memory ⇒ 「同 (room,domain,actionType) `repeats ≥ N` 不再提交」不需要新数据。但**抑制恢复本身是方向性安全决策**（抑制过头＝该救的不救），`CAPABILITY-MATRIX §10 #110` 已列三形态 ⇒ **属人，需你裁决**。[E]
- **验收**：`recoveryRejections` 中 `GLOBAL_ROOM` / `room memory not found: global` 不再无界增长（当前 `logistics_fix:retryable=1635`）；`repeats=6` 的动作在第 N 次后停止提交。
- **测试**：`tests/unit/strategy/a4-6-recovery-lifecycle.test.ts:662-688`、`recovery-escalation-list.test.ts`、`recovery-rejection-tally.test.ts`、`tests/integration/scenarios/recovery-action-pipeline.test.ts`。

### 4.3 L2 外部建议摄入

- 断在复核层输入：`tuning-intake-system.ts:84` 写 `intakePending` → `empire-health-system.ts:244-254` 调 `reviewStrategy` 时**不传也不读** → `strategy-reviewer.ts:6-25` 输入类型无该字段 → 建议永不复核/采纳/清空。[F]
- **改法**：`StrategyReviewInput` 加 `intakePending`；`empire-health-system.ts:244-254` 传入并在 `:256-265` 写 `strategyOverrides` 后清空；保留六层护栏（`intake-guardrail.test.ts`）；`migrations/late.ts:304-314` 的 v45 畸形自愈与 `global.d.ts:1332` 类型同步。
- **验收**：一条 `L2Intake` 事件后，要么 `strategyOverrides` 有变更、要么 `intakePending` 被清空；**不允许两者都不动**。

### 4.4 战术微操与「只写不读」字段总决算

| 项 | 事实 | 处置 |
|---|---|---|
| `microDecisions/microPlans/targetLocks` | `combat-micro-runtime.ts:92-96` 产物全仓零读者；角色读的是 `tacticalRoleIntents`/`attackIntents`（`attacker.ts:40-55`、`healer.ts:26-27`）；`ranged-attacker.ts` 零 intent | **推荐删除**（战争链本身未上线，接线无消费者、只烧 CPU）：动 `combat-micro-runtime.ts:45-106` + `tactical-runtime-pipeline.ts:10/:64` + R11 白名单。若选择接线，只能经 `globalCache()` 直读（R3），并补 ranged-attacker 读侧 |
| 全队共用 intent | `tactical-runtime-system.ts:169-172` 一次计算 set 给全体，且 interval=10t | 按 member 分别计算；刷新提到 3t；中间 tick 明确标注陈旧指令 |
| 两套战争系统 | `war-planner.ts:74-105` legacy `selectWarTarget` 与 A5.3 `writeCompatibleWarPlan`（`war-planning-system.ts:508-575`）双写者，姿态切换首拍行为不一致；`tactical-runtime-system.ts:641` 硬编码 `isOffensive = true` | **合并为单一写者**（保留 A5.3 canonical），legacy 降级为只读观测。此项**不新增进攻能力**，可在阶段 3 做 |
| `lostRooms` | `memory.ts:86-97` 写，只有 territory-manager 清账 | 接一个决策读者（重占/黑名单）或删 |
| `safeModeRequested` | `recovery-execution-system.ts:926-928` 写，注释称「kernel 下拍消费」，实际零读者；safe mode 真出口在 `tower-defense.ts:407-422` | 删除标记或接进 tower-defense；**不得改动 safe mode 触发条件**（`AGENT.md` 安全边界） |
| `executionDashboard` / `CooldownTable` | `state-machine.ts:130-141`、`empire-health-system.ts:105/:208` 恒空 | 删除或明确标注为观测桩 |
| `roadBuild` | `telemetry-collector.ts:554-556` 写 `stats.roadBuild`，注释自认不参与决策 | 保留但必须在方案中标注「纯观测」，不排产优化 |

**验收**：每条「接线 or 删除」完成后，用 `tmp/tools/bundle-exports.mjs` / 字符串判据复核线上包符号，并照 `tests/unit/architecture/remote-pipeline-producer.test.ts:9-15` 的**互斥契约**写回归：「有人接线 ⟺ 纸面门移除，单动一半即红」。

---

## 5. 阶段 4：死码总决算与规模（P2）

### 5.1 50 个不可达模块

- **证据**：42 个零 src 引用者 + 8 个悬空子链；集中在 `domain/logistics/`（20 文件 / 2,509 行，19 个连测试都没有）、`domain/economy`、`domain/expansion`；线上包字符串判据已坐实它们没进产线。[F]
- **决策表**（逐条给出，实施时按此分类）：
  - **接线**：`supply-contract` 写回链（已在 4.1）、`contract-lifecycle`（4.1）、`target-selection`（属进攻能力，见第 6 节）。
  - **删除**：`domain/logistics/` 整片未测的 19 个、`config/metrics.ts`（与 `telemetry/index.ts` 两套目录）、`kernel/state-store.ts`（零引用且不能复用）、`domain/expansion/` 的仪表盘簇。删时同步删测试。
  - **保留待评估**：`domain/operation/transport-planner.ts` 等有明确后续用途的，标 `DESIGNED` 而非 `TESTED`，避免能力矩阵继续冒充已实现。
- **纪律**：`TESTED ≠ WIRED`。凡「零 src 调用者 + tests 有导入」一律标 `NOT_WIRED`，不得计入能力覆盖（`CAPABILITY-MATRIX.md:329-334` 已立此规矩）。
- **收益**：验证真相与维护成本；**不减 bundle、不减线上 CPU**（treeshaking 早已剔除）。

### 5.2 CPU 规模优化（真正减 CPU 的部分，按动态读数排序）

动态结账：总 17.1/t = 角色 5.5 + 系统 6.6 + 其余 5.1；`traffic-manager 4.26/t`、`snapshots 1.81/t`、creeps 相位 7.18/t、post 相位 4.28/t；`skippedPerTick=12.6`（预算闸每拍吞 12.6 个动作）。[F]

| 优化 | 锚点 | 预期 | 验证 |
|---|---|---|---|
| 每拍三次全量 `Game.creeps` 合并为一次 | `kernel.ts:354/770/972`（另有多系统各自遍历） | 固定开销降 O(k·N) 的 k | integration CPU 对照 + 线上 `byPhase` 差分 |
| 整段 `JSON.stringify` 降频/增量 | `segment-store.ts:480-557`（CPU 环 300 条/10t、事件环 500 条/10t）；注释自称最贵单次动作 | 拍尾 `tail=0.64/t` 下降 | `cpuRate.tail` 前后差分 |
| 先修读数再评估降级 | 阶段 1 完成后 `skippedPerTick` 是否仍 12.6 | 避免为假 CPU 压力牺牲产能 | `observe.mjs` skip 段 |
| 10 房推演 | 固定项 + 每房线性项（当前每房 CPU 2.838/0.83/3.131） | 目标 `usage/limit ≤ 0.6`（G6 门槛 12.0） | `capacity-reach.mjs` + 差分 |

[H] 上述收益量级需 bench，不预设数字；`tmp/tools/bundle-*.mjs` 与 `tests/unit/kernel/cpu-per-tick-unit.test.ts` 是现成载体。

### 5.3 测试瘦身

生产 110,570 行 vs 测试 128,367 行；423 个导出仅被 tests 引用。[F] 删模块时同步删测试；把「接线回归」改写为架构守卫断言（互斥契约），避免用大量夹具单测给死码发绿灯。

---

## 6. 阶段 5：能力补齐（**需授权，不进自动执行**）

| 能力 | 前置/锚点 | 为何属人 |
|---|---|---|
| 主动进攻（#100） | `war-planning.ts:244-265` 加进攻分支、`:277-324` 目标支、`war-posture.ts:224-228` 授权、`war-planning-system.ts:218` playerIntel、`:565-573` attackerTarget、`war-planner.ts:74-105` legacy、`tactical-runtime-system.ts:641` 硬编码 | **主动战争**（L0 §1.5）。且会转红 `war-planning-a5-3.test.ts:1410-1422`（CRITICAL+FULL_ASSAULT→DEFEND）、`war-funnel.test.ts:230-236`（selectTarget 永不被调用）、deterministic replay hash ⇒ 改测试即改行为契约 |
| SK 房 / Deposit / Season / 跨 shard | 全 src 零 `KEEPER_LAIR`/`RESOURCE_DEPOSIT`/`InterShardMemory`；官方 `InterShardMemory` 每 shard 100 KB | 新域 + 对外行为 |
| 主动挂买单 / 撤单 / 市场阈值 / power 买入 | `terminal-manager.ts:440-441` 只有 `ORDER_SELL`；`cancelOrder` 零调用；`terminal-selfaid.ts:85`、`terminal-market.ts:445` 把 POWER 优先级置 0 | `AGENT.md:16` 市场、阈值、付费资源属人 |
| Power Creep 第一炉 | `power-creep-manager.ts:23/52`、`Game.gpl.level=0`、账户 resources 仅 pixel | 需开买入口（花钱）或打 Power Bank（真战斗） |
| 全灭 respawn 后重建 | `kernel.ts:474-475` 只建 `controller.my` 房快照；`memory.ts:85-105` 20,000t 清账 | 战略方向；当前只能当新扩张目标重 claim |
| pixel 生成 | `config/index.ts:203` `pixel.enabled=false`（reload death loop 事故论证） | 属人已定过一次，不自开 |
| 核心建筑自动拆改 | `construction-manager.ts:629` 唯一 `.destroy()` 是死 link | `AGENT.md:13` 仅限灾难接管且须审计 |

---

## 7. 排期、依赖与「只做三件事」

```
阶段0（发布链） ──► 阶段1（止血：2.1 CPU → 2.2 容错 → 2.3 自检 → 2.4 段守卫）
                        │
                        ├──► 阶段2（状态持久化，3.1 情报可与阶段1并行起草）
                        │        │
                        │        └──► 阶段3（反馈接线，依赖阶段2的 Memory 结构）
                        │                 │
                        │                 └──► 阶段4（死码决算 + 规模优化，依赖阶段3结论）
                        │
                        └──► 阶段5（能力补齐，全程需授权，不依赖前面）
```
- **可并行**：0.1/0.2 与 2.1 的设计；3.1 情报落段与 2.1 CPU 改窗互不冲突（不同文件）。
- **强依赖**：阶段 3 的恢复台账依赖阶段 2 的 v50 迁移；阶段 4 的删码依赖阶段 3 的「接线 or 删除」裁决。
- **如果只做三件事**：① 2.1 CPU 真窗口；② 2.2 顶层容错；③ 3.1 房情报落段。这三件分别解开自锁、防止整 tick 崩、止住反复失忆，其余都是它们的下游。[E]

### Architecture Challenge 五问速答

| 阶段 | 当前收益 | 10,000 tick 后 | 10 房 | CPU 影响 | 维护成本 |
|---|---|---|---|---|---|
| 1 止血 | 解除扩张自锁、防整 tick 崩 | 分档能响应真实负载 | 不再每房累一次陈旧账 | 每拍 +O(1) 窗口 push | 新增一个 CONFIG 组，旧路径留一版 |
| 2 持久化 | 部署后不再失忆 | 情报/恢复历史可积累 | 房数增加按房摘要增长，有界 | 段读写低频 | 每个族一份白名单与迁移 |
| 3 反馈 | 策略能自我修正 | 恢复不再无限重复 | 决策有闭环、不随房数放大 | 低频记账，接近零 | 每接线一条互斥架构断言 |
| 4 决算 | 真相与体积 | 不再为死码写测试 | 固定开销下降 | 明确下降 | 大幅下降 |
| 5 能力 | 帝国能打仗/扩张 | 真正增长 | 需重新评估 CPU 预算 | 上升 | 显著上升 |

---

## 8. 验收、观测与发布纪律

### 8.1 四绿门禁与分层

- 每阶段合并前：`typecheck` → `check:docs` → `test:unit` → `test:integration` → `build` → `test:e2e:smoke`；`test:all` 留本地全量。沙箱限制见 0.2。
- 放层标准（`AGENT.md:137-138`）：依赖真实引擎物理 → e2e；kernel 内部决策 → integration；**每个线上事故必须沉淀一个复现测试**（先例 `tests/integration/scenarios/live-anomaly-reproduction.test.ts:1`）。
- 修改 `STANDARD_ROOM_LAYOUT` 须 integration + e2e smoke 双绿。
- 架构守卫会拦截的改动：R1 domain 纯度、R3 creeps 不 import systems、R6 角色禁 `spawnCreep`/`createConstructionSite`/`PathFinder.search`、R10 系统数 30–40、R11 systems 间值导入白名单（`tests/unit/architecture/compliance.test.ts:69-438`）。阶段 3/4 接线前先查白名单，否则会红。
- `check:docs` 实际只扫 `src`/`tests` 里的 `docs/` 字符串（`scripts/check-docs.mjs:12`）——方案文档不进扫描，但**代码注释仍禁止引文档编号**（`AGENT.md:32-43`）。

### 8.2 纯只读观测工具（可自主使用）

`observe.mjs`（体检）、`peek.mjs`（任意点路径）、`check-code.mjs`（线上 sha）、`modules.mjs`、`capacity-reach.mjs`（升档驻留）、`econ-ring.mjs`、`ring-dump.mjs`（按事件名过滤）、`seg1-pop.mjs`、`intel-players.mjs`（可传段号）。

**必须标为需授权、不得当只读工具**：`console-eval.mjs` / `ev.sh` / `console-ping.mjs` / `trade-probe.mjs`（POST console，写 `Memory.__evalResult`）、`deploy-screeps.js`（POST code）、`batch*-gate-and-push.sh`（git push 触发生产部署）。本轮动态验证全程未碰这些。[F]

### 8.3 判据纪律（防「绿了但没接线」）

1. **读数没动 ≠ 仪器没算**：Memory 端点是 flush 门控的（`CAPABILITY-MATRIX §19(b)`）；慢仪判据要多次采样。
2. **`TESTED ≠ WIRED`**：只有 tests 引用的导出不算能力；判状态只看 `src/` 调用者。
3. **线上判效要预注册**：先写 PASS/FAIL/UNKNOWN 形状，再读数；`STABLE` 需第二发独立复证。
4. **e2e 长 soak**：#62 在 `EVOLUTION-ROADMAP.md:7940` 记「同 seed 两遍逐字一致」结案，但 `:15717` 仍有「未结」条目 ⇒ 实施前复核当前状态；孪生 PASS 之前 soak 的红不得当因果证据。
5. **三条本方案预注册判据**：CPU 窗口（§2.1）、合同 `td` 前进（§4.1）、`intelCoverage.rooms>0`（§3.1）。

### 8.4 发布与回滚

- 部署闸门：`SCREEPS_DEPLOY_CONFIRM=1` 或 `--confirm-deploy`，CI 无参数靠 `GITHUB_ACTIONS=true`（`tools/official/deploy-screeps.js:22-53`）；**只读核对一律走 `check-code.mjs`，不得给部署脚本传看起来像 dry-run 的参数**。
- 每阶段一个 CONFIG 开关，一个版本内可回退；回滚先例见 git 历史（`3b867e93 revert(towers)`、`e7b18f0a perf(snapshot): 回滚全量快照缓存` 等）。
- `AGENT.md:15-17` 的 L2 自主发布例外**不扩展**到市场、战争、阈值、付费资源、破坏性操作；灾难接管属人。
- 上线后按 §8.2 纯 GET 复读签名，禁止用 console 求值取数（避免与在飞探针抢 `__evalResult`）。

---

## 9. 属人决策清单（**需要你拍板，我不会自批**）

| # | 决策 | 依据 |
|---|---|---|
| 1 | 是否实施 §2.1（改分档读数口径会真实改变扩张行为） | `AGENT.md:16` 阈值属人 |
| 2 | bundle 超预算走「减体积」还是「调 CAP」 | CI 安全预算，`rollup.config.mjs:37-39` |
| 3 | 恢复重复抑制（`repeats ≥ N`）是否启用、N 取多少 | 抑制过头＝该救的不救，方向性安全决策 |
| 4 | 50 个不可达模块「接线 or 删除」逐条裁决 | `CAPABILITY-MATRIX §16 #107` |
| 5 | 战术微操层删除还是接线 | 影响军事架构与 CPU |
| 6 | 两套战争系统合并后 legacy 是否保留 | 行为契约与现有测试 |
| 7 | 是否新增主动进攻能力 | L0 §1.5 主动战争须授权 |
| 8 | 是否开 POWER 市场买入口 / 打 Power Bank | 花钱 / 真战斗 |
| 9 | 是否挂买单、撤单、改市场阈值 | `AGENT.md:16` |
| 10 | 是否开 pixel 生成 | reload death loop 历史事故 |
| 11 | 是否实现全灭 respawn 重建与核心建筑自动拆改 | `AGENT.md:13` 灾难接管边界 |
| 12 | 工作树未提交改动如何处置（先审、先提交还是丢弃） | 发布前必须对齐 sha |

---

## 附录 A：证据索引（速查）

| 结论 | 锚点 |
|---|---|
| CPU 累计账 / 拍尾累加 | `kernel.ts:236,298-313`；`telemetry-collector.ts:74-164,401,551,217,225,178-197` |
| 分档消费 | `capacity.ts:51-57,97-133`；`empire-strategy.ts:201-238,287-316` |
| 顶层无容错 | `main.ts:3`；`safe-run.ts:105-116`；`kernel.ts:157,186,193,227` |
| E4/E9/拆段 | `kernel.ts:275-277,615,628-636,662-676,859-860`；`expectations.ts:405-439,521-536`；`global.d.ts:1018`；`intelligence.ts:209-253` |
| segment | `segment-store.ts:24-33,97-105,459,479-557`；`memory.ts:96-104`；`territory-manager.ts:195-203` |
| heap-only 状态 | `global-cache.ts:484-524,528-532,615-633,1153-1155`；`intelligence.ts:33-35,94-110,204-253`；`defense-planner.ts:65-107`（唯一双写范例） |
| StateStore 不可复用 | `contracts.ts:240-247`；`state-store.ts:1-61` |
| 合同 | `supply-contract.ts:291`；`contract-lifecycle.ts:42,226`；`specialization-planner.ts:244,310,320`；`carrier.ts:47-72`；`agenda-manager.ts:790-815` |
| 恢复 | `recovery-execution-system.ts:1165,1169,1173-1180,1139-1149`；`recovery-lifecycle.ts:626,928-963`；`recovery-priority.ts:129,291` |
| L2 | `tuning-intake-system.ts:84`；`empire-health-system.ts:244-265`；`strategy-reviewer.ts:6-25` |
| 战争 | `war-planning.ts:221-266,277-324,330-356`；`operation.ts:258-267`；`war-planning-system.ts:218,508-575`；`war-planner.ts:74-105` |
| 迁移规范 | `config/index.ts:32,45-58`；`migrations/late.ts:437-454`；`migrations/index.ts:11-15`；`memory.ts:173-207`；`AGENT.md:75-81` |
| 门禁/守卫 | `AGENT.md:59-63,132-143`；`scripts/check-docs.mjs:12`；`tests/unit/architecture/compliance.test.ts:69-438`；`remote-pipeline-producer.test.ts:9-15`；`.github/workflows/deploy-screeps.yml:41-84` |

## 附录 B：官服动态读数出处

2026-11-12 04:1x CST，shard3，纯 GET（`/api/user/memory`、`/api/user/memory-segment`、`/api/user/code`、`/api/auth/me`、`/api/user/overview`）。线上 sha `86317408db89` = 本地 `dist/main.js`（853,846 字符 / 856,124 字节）。账号 `lastRespawnDate=2026-06-22`（实际在线约 143 天），GCL 经验 41,654,848、bot 自记 `gclLevel=5`、CPU limit 20。三次间隔读数（tick 84,212,855 → 84,212,885 → 84,212,895）用于验证 `stats.cpuRate` 冻结与 `expansionAllowed` 自解。
