# 业务逻辑优化方案（老玩家视角审查）

> 本文档记录一次以资深 Screeps 玩家视角对现有业务逻辑的审查结论与优化方案。
> 遵循项目架构约束：纯 domain 函数、`config` 单一入口、Memory 只存 ID/枚举、
> `bootstrap.ts` 唯一组合根、角色不做全房 `find`、改 Memory 结构须版本化迁移。
> 相关硬约束见 [AGENTS.md](../AGENTS.md) 与 [docs/plan.md](plan.md)。

## 目录

- [问题总览](#问题总览)
- [P0-1 矿工同 tick 采集+倒能](#p0-1矿工同-tick-采集倒能消除-17-产能损失)
- [P0-2 敌人判定分级](#p0-2敌人判定分级scout-不再冻结经济--不误烧-safe-mode)
- [P1-3 Tower 目标选择](#p1-3tower-目标选择集火--识别治疗--能量管理)
- [P1-4 Link 最小传输阈值](#p1-4link-最小传输阈值)
- [P1-5 危机信号去噪](#p1-5危机信号去噪含-creep-携带能量--窗口平滑)
- [P2-6 harvest 任务 maxWorkers 语义修正](#p2-6harvest-任务-maxworkers-语义修正)
- [P2-7 站桩矿工不离岗](#p2-7站桩矿工不离岗)
- [P2-8 Lab 反应校验相邻](#p2-8lab-反应校验相邻)
- [P2-9 boostedCreeps 内存泄漏](#p2-9boostedcreeps-内存泄漏)
- [实施顺序与质量门槛](#实施顺序与质量门槛)

---

## 问题总览

| 编号 | 严重度 | 问题 | 影响 | 主要位置 |
| --- | --- | --- | --- | --- |
| P0-1 | 🔴 严重 | 矿工不能同 tick 采+倒 | 每源持续损失 ~17% 产能 | `creeps/role-runner.ts`、`creeps/harvester.ts` |
| P0-2 | 🔴 严重 | 敌人判定不过滤 | 一个 scout 冻结全经济 + 误烧 safe mode | `systems/room-snapshot.ts` 等 5 处 |
| P1-3 | 🟠 中等 | Tower 只打最近目标 | 被治疗单位奶穿、空耗能量 | `systems/tower-defense.ts` |
| P1-4 | 🟠 中等 | Link 无最小传输阈值 | 冷却空窗、source link 溢出 | `domain/economy/links.ts` |
| P1-5 | 🟡 隐患 | 危机信号逐 tick 净储备噪声大 | 误判 crisis 砍角色 | `systems/room-state.ts`、`domain/economy/phase.ts` |
| P2-6 | 🟡 隐患 | harvest 任务 maxWorkers 语义混淆 | 过采/堵位埋雷 | `domain/assignment/service.ts` |
| P2-7 | 🟡 隐患 | 站桩矿工会离岗 | source 通勤期间无人采 | `creeps/harvester.ts` |
| P2-8 | 🟡 隐患 | Lab 反应不校验相邻 | RCL7-8 多 lab 永不反应 | `systems/lab-system.ts` |
| P2-9 | 🟡 隐患 | boostedCreeps 内存泄漏 | 死 creep 名永久累积 | `systems/lab-system.ts` |

每条方案统一给出：**优化目标 / 根因 / 具体改动 / 配置与内存 / 测试要点 / 风险与降级**。

---

## P0-1｜矿工同 tick 采集+倒能（消除 ~17% 产能损失）

**优化目标**：让 `5W1C1M` 站桩矿工每 tick 同时 `harvest` + `transfer`，稳定 10/tick，
不再因“采满后停一 tick 倒能”而损失产能。

**根因**：`creeps/role-runner.ts` 每 tick 只执行 `acquire` **或** `work` 一条链：

```ts
const candidates = creep.memory.mode === "work" ? policy.work : policy.acquire;
```

配合 `creeps/lifecycle.ts` 的满/空模式切换，矿工循环变成
「采 5 tick → 停 1 tick 倒能」：50 能量 / 6 tick ≈ **8.3/tick** < source 上限 10/tick，
每源每再生周期（300 tick）浪费约 500 能量。

引擎语义：同一 tick 内 `harvest` 与 `transfer` 是不同 intent，可并存执行；
`transfer` 按 tick 开始时的 store 结算，`harvest` 之后入账，1 CARRY 即可维持满吞吐。

**具体改动（方案 A，推荐，改动最小）**：

1. 在 `creeps/actions.ts` 新增合并动作 `mineIntoSink()`：
   - `predicate`：已就位（到 source `getRangeTo <= 1`）且身边（range≤1）有 link 或 container。
   - `execute`：先 `creep.harvest(source)`；若 `store[energy] > 0` 且身边 link/container 有空位，
     同 tick `creep.transfer(sink, RESOURCE_ENERGY)`（link 优先，其次 container）。
2. 在 `creeps/harvester.ts` 将该动作同时置于 `acquire[0]` 与 `work[0]`，
   使其无论 FSM 处于哪个 mode 都会执行，绕开单模式限制。
3. 未就位（通勤中）时落到现有 `harvestSource()` 走位。

**备选方案 B**：为 `role-runner` 增加可选 `perTick` 钩子（角色声明每 tick 必执行动作，
先于 mode 分支）。更通用但触及内核调度面，不作首选。

**配置与内存**：无新增。

**测试要点**（`tests/role-harvester.test.ts`）：
- 矿工在 source+container 相邻位，mock `harvest` 与 `transfer` 均被调用。
- 容器满时只 `harvest`（溢出容忍），不报错。
- 未就位时调用 `moveToTarget`。

**风险与降级**：container/link 均满时退化为纯 `harvest`（与现状一致，无回归）。

---

## P0-2｜敌人判定分级（scout 不再冻结经济 / 不误烧 safe mode）

**优化目标**：区分“威胁 creep”与“无害过客（scout / reserver / 中立）”，
只对真正威胁做防御反应。

**根因**：`systems/room-snapshot.ts` 的 `FIND_HOSTILE_CREEPS` 未过滤，被 5 处直接当“有敌人”消费：
`creeps/lifecycle.ts:shouldFlee`、`systems/room-state.ts`、`systems/construction-manager.ts`、
`systems/assignment-service.ts`、`systems/tower-defense.ts`。任何路过 scout 会同时触发
全体逃跑、切 defense、停建造、作废任务、误烧 safe mode。

**具体改动**：

1. 新增威胁分类纯函数 `src/domain/defense/threat.ts`：
   - 输入 creep 的 body / owner 摘要，输出 `{ hostiles, threats }`。
   - `threat` 判定：拥有 `ATTACK | RANGED_ATTACK | HEAL | WORK | CLAIM` 任一有效部件
     （`WORK` 识别拆迁，`CLAIM` 识别攻击控制器）。
   - 支持白名单：命中 `CONFIG.defense.allies` 的 owner 从 hostiles 中剔除。
2. `RoomSnapshot` 扩展只读字段 `threatCreeps: readonly Creep[]`（保留 `hostileCreeps` 供观测）；
   在 `systems/room-snapshot.ts` 一次计算，并同步更新 `src/kernel/contracts.ts` 类型。
3. 将 5 处消费方改为读取 `threatCreeps`。
4. safe mode 收紧（`systems/tower-defense.ts`）：仅当**有威胁 creep 且**（关键结构 hits 下降 /
   rampart 破防 / 威胁已进入核心区 `range <= CONFIG.defense.safeModeTriggerRange`）时才
   `activateSafeMode()`。无塔 + 仅 scout → 不触发。
5. （可选增强）`shouldFlee` 仅当威胁进入逃跑半径内才逃，减少无谓摆动。

**配置与内存**：
- `CONFIG.defense.allies: string[]`（默认 `[]`）。
- `CONFIG.defense.safeModeTriggerRange: number`（默认 5）。
- 无 Memory 结构变化（`threatCreeps` 为快照运行时字段，不持久化）。

**测试要点**（新增 `tests/threat.test.ts`）：
- 纯 body 数组区分威胁 / 无害；空 body scout 判为非威胁。
- 白名单 owner 被剔除。
- 集成层可在 `tests/integration/scenarios` 增加“scout 过境不停摆”用例。

**风险与降级**：分类函数异常时默认按“有威胁”处理（保守偏防御，不误判为安全）。

---

## P1-3｜Tower 目标选择（集火 + 识别治疗 + 能量管理）

**优化目标**：优先集火治疗单位 / 最脆单位，避免被奶穿空耗能量。

**根因**：`systems/tower-defense.ts` 使用 `findClosestByRange` 只选最近，
不识别 HEAL 奶妈、不集火、不做能量管理。

**具体改动**：新增纯函数 `src/domain/defense/tower-target.ts`：
- 输入：威胁 creep 摘要（`healParts`、`hits`、`hitsMax`、到塔距离）、塔位置。
- 排序键：① 带 `HEAL` 优先；② `effectiveHp = hits + 治疗能力估算` 最低优先；
  ③ 距离近优先（塔伤随距离衰减：≤5 满伤 600，≥20 仅 150，据此加权）。
- 输出 `targetId`，令 `systems/tower-defense.ts` 全塔集火同一目标。
- **能量管理（可选，需确认）**：无 rampart 掩护且总奶量 > 全塔可用 DPS 时进入“蓄能”，
  仅在敌人贴近时开火，避免拉锯耗空。默认先不做，仅集火 + 治疗优先。

**配置与内存**：无新增（能量管理若做，加 `CONFIG.defense.towerHoldFireDps`）。

**测试要点**（新增 `tests/tower-target.test.ts`）：“奶妈优先”“同血取近”“距离衰减加权”。

**风险与降级**：纯函数、无副作用；异常时回退现有 `findClosestByRange`。

---

## P1-4｜Link 最小传输阈值

**优化目标**：攒够再发，避免小额传输占冷却导致 source link 溢出。

**根因**：`domain/economy/links.ts:planLinkTransfers` 只要 `energy > 0` 就发起传输，
小额传输让 link 立即进冷却，source link 装不进新能量而溢出。

**具体改动**（改 `planLinkTransfers`）：
- source→controller / source→storage 仅当
  `src.energy >= CONFIG.economy.link.minTransfer`（默认 400）**或**
  `src` 空闲容量 < 单批矿工产出（快满、防溢出）时才发起。
- controller link 处于“急需”（`energy` 低于升级 1 tick 消耗）时豁免阈值，保证升级不断粮。

**配置与内存**：`CONFIG.economy.link = { minTransfer: 400 }`。

**测试要点**（扩 `tests/links.test.ts`）：低于阈值不传；接近满即便低于阈值也传；
controller 急需豁免。

**风险与降级**：阈值过高会延迟供能 → 以“controller 急需豁免”兜底；参数集中在 config 便于调。

---

## P1-5｜危机信号去噪（含 creep 携带能量 + 窗口平滑）

**优化目标**：让 `drainScore / crisis` 反映真实经济盈亏，
不被物流搬运抖动和孵化瞬时扣能误导。

**根因**：`systems/room-state.ts` 的 `reserve = energyAvailable + containers + storage`
**不含 creep 身上能量**，hauler 取/送、spawn 孵化都会造成逐 tick delta 抖动，
误推 `drainScore` → 误判 crisis → 砍掉 upgrader / builder / hauler。
此外“储备下降”把健康升级（能量转 GCL 的正常支出）也误当失败信号。

**具体改动**（分两步，先做 ① 收益最大）：
1. **reserve 计入 creep 携带能量**：在 `room-state` 汇总本房 creep 的 `store[energy]`
   （复用 Kernel 已遍历 `Game.creeps` 的结果，避免额外全量遍历）。物流搬运不再改变 reserve。
   —— 不改 schema，仅改计算，可独立先行验证。
2. **窗口平滑**：把逐 tick delta 改为 N tick 移动平均（对最近若干次评估的 `reserveDelta`
   取均值再判 `drainScore`），或改判据为“source 累计采集 vs 消耗”的滑窗净值。
   `PhaseState` 中存一个短的数字环形数组（仅数字，符合 Memory 约束）。
   —— 需同步更新 `domain/economy/phase.ts` 的 `PhaseState / evaluateColonyPhase`，
   递增 `CONFIG.memory.schemaVersion` 并在 `kernel/memory.ts` 写幂等迁移。

**配置与内存**：② 涉及 `PhaseState` 结构变化，须版本化迁移
（幂等、先写新字段验证后删旧字段、全部成功才更新 `schemaVersion`）。

**测试要点**（扩 `tests/phase.test.ts`）：纯物流等额搬运不推高 `drainScore`；
持续净支出才进 crisis；迟滞保持。

**风险与降级**：建议先仅做 ①（无 schema 变化），验证稳定后再评估 ②。

---

## P2-6｜harvest 任务 maxWorkers 语义修正

**优化目标**：让每 source 的分配上限反映“能站几个矿工 / WORK 是否够”，
而非误用“目标 WORK 数”当 creep 数。

**根因**：`domain/assignment/service.ts` 把 `getSourceTargetWorkParts`（返回 5/6/8，
本意为**目标 WORK 总数**）直接当 `maxWorkers`（**可分配 creep 数**）用。
当前因 harvester `minCount=2` 侥幸未暴露，一旦调大矿工数即允许 5–8 个 5W 矿工
挤一个只需 5W 的 source，严重过采 / 堵位。

**具体改动**（改 `service.ts` 的 harvest 任务生成）：
- 新增纯函数计算 `maxWorkers = 该 source 可开采工位数`
  （由 source 周围可站空地数决定，或取 `min(可站位, ceil(目标WORK / 单矿工WORK))`）；
  站桩矿工模式默认 1–2。
- `getSourceTargetWorkParts` 保留“目标 WORK 总数”原义，仅用于决定单矿工 body 大小 /
  是否需要第二矿工，不再直接当 maxWorkers。

**配置与内存**：无新增。

**测试要点**（扩 `tests/assignment.test.ts`）：RCL7-8 单 source 不再接受 5–8 个 creep；
工位数约束生效。

**风险与降级**：低；属预防性修复，改动局限在 domain 纯函数。

---

## P2-7｜站桩矿工不离岗

**优化目标**：矿工在无法倒能时原地待命 / drop，绝不跑去建造 / 升级弃守矿位。

**根因**：`creeps/harvester.ts` 的 work 链末尾有 `buildNearestSite()` / `upgradeController()`，
容器满时矿工会离开矿位远行，通勤期间 source 无人采集。

**具体改动**（改 `creeps/harvester.ts`）：
- 移除 work 链末尾的 `buildNearestSite()` / `upgradeController()`，
  或用 predicate 限制其触发条件。
- 推荐：容器 / link 均满且无处倒能时 `drop(RESOURCE_ENERGY)` 到脚下，
  矿工保持在位继续 `harvest`。与 P0-1 的合并动作天然契合。
- drop 的能量由 hauler 现有的 `pickupDroppedEnergy` 回收。

**配置与内存**：无新增。

**测试要点**：矿工在容器满时位置不变，执行 drop 或空转，不 move 向 controller。

**风险与降级**：低。

---

## P2-8｜Lab 反应校验相邻

**优化目标**：保证选出的 output / input lab 满足 `runReaction` 的 `range <= 2`，
避免 RCL7-8 多 lab 分散布局时永不反应。

**根因**：`systems/lab-system.ts:planLabs` 按 `find()` 顺序取 `labs[0..2]`，
不校验三者是否互相相邻。

**具体改动**（改 `planLabs`）：
- 抽出纯函数 `selectReactionTrio(labsPos)`：遍历找一个 output lab，使**至少两个其它 lab
  都在其 range≤2 内**，返回该三元组；找不到则本 tick 不反应。
- boost lab 从“不参与反应且靠近待 boost 集结点”的 lab 中选。

**配置与内存**：无新增。

**测试要点**（新增 `tests/lab-layout.test.ts`）：分散布局选不出三元组则不反应；
紧凑布局正确选出相邻三元组。

**风险与降级**：低；纯几何判断，可独立测试。

---

## P2-9｜boostedCreeps 内存泄漏

**优化目标**：不再无限累积死 creep 名，符合“Memory 不存历史”硬约束。

**根因**：`systems/lab-system.ts` 的 `industryMem.boostedCreeps` 只 `push` 从不清理，
死 creep 名永久累积。

**具体改动**（二选一）：
- **首选**：不再用房级名字列表，改在 creep 自身 `CreepMemory.boosted?: true`
  记录 boost 状态，随 creep 死亡由 `kernel/memory.ts` 的 creep 清理自动回收；
  判重时读 `creep.memory.boosted`。
- 备选：每次运行时用当前存活 creep 名 `Set` 过滤 `boostedCreeps`，剔除已死名字。

**配置与内存**：首选方案改 `CreepMemory` 字段 → 递增 `schemaVersion` 并写迁移
（新字段默认无需回填，属向后兼容新增）。

**测试要点**：boost 后置位；creep 死亡后不残留；重复 boost 被拦截。

**风险与降级**：首选方案随 creep GC 自动清理，无需房级清理逻辑，最干净。

---

## 实施顺序与质量门槛

### 分批实施

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| 第 1 批 | P0-1、P0-2、P2-7 | 收益最大且互相关联（矿工吞吐 + 敌人分级 + 不离岗），一起做 |
| 第 2 批 | P1-3、P1-4、P2-6 | 战斗 / link / 分配，纯 domain 为主，易测 |
| 第 3 批 | P1-5、P2-8、P2-9 | 涉及 Memory 迁移（P1-5②、P2-9），单独小心处理 |

### 合并前质量门槛（AGENTS.md §8）

- `npm run typecheck`（`tsc --noEmit`）
- `npm test`（`vitest run`）
- `npm run build`（`rollup -c`）

三项全绿方可合并。

### Memory 迁移规范（涉及结构变更时）

- 每次结构变更递增 `CONFIG.memory.schemaVersion`。
- 迁移必须幂等；先写新字段并验证，再删旧字段；所有步骤成功后才更新 `schemaVersion`。
- 新增 Memory 字段须同时更新类型声明、迁移逻辑与 `docs/plan.md`。

### 涉及新增插件 / 模块

- 新增 System / CreepRole 只改 `src/bootstrap.ts` 与新模块，**不改 Kernel**。
- 名称全局唯一 kebab-case；模块顶层禁止访问 `Game` / `Memory`。
