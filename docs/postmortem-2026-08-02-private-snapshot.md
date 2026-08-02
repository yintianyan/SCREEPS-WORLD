# 私服快照事后分析 — 2026-08-02

> 基于 238K tick 私服快照（W3N7 单房 RCL1→5 + 远矿 W3N8）的代码考古与修复方案。
> 本文档自包含，无需外部上下文即可继续实施。

## 目录

- [一、事件概述](#一事件概述)
- [二、七大病灶根因验证](#二七大病灶根因验证)
- [三、协议偏差清单](#三协议偏差清单v2-1-7)
- [四、分批修复方案](#四分批修复方案)
- [五、测试用例设计](#五测试用例设计)
- [六、实施顺序与依赖](#六实施顺序与依赖)
- [七、回滚总策略](#七回滚总策略)

---

## 一、事件概述

### 1.1 快照信息

- **tick 范围**：2348000 - 2428010（约 80K tick 观测窗口）
- **场景**：W3N7 单房 RCL1→5 + 远矿 W3N8
- **结局**：主房 RCL5 危机期 storage 流失归零、spawn churn 4238 次、远矿吸血 54795 tick 未关闭

### 1.2 核心症状

| # | 症状 | 量化指标 |
|---|---|---|
| 1 | colonyState 状态机失明 | srcRatio=1.0 持续 31000 tick 仍判 normal/growth |
| 2 | 远矿吸血 | W3N8 active 54795 tick，4 个 remoteHauler 全 idle 0 回流 |
| 3 | spawn churn 循环 | 4238 次（harvester 2631 + remoteHarvester 735 + hauler 351 + ...） |
| 4 | storage 单向流失 | 阶段 C: 374K→0 (12 E/tick) + 阶段 D: 134K→0 (3.4 E/tick) |
| 5 | 建筑积压 | buildQueue=61（rampart×56），builder 仅 1 个 [work,carry,move] |
| 6 | 调参引擎失明 | frozen=3 / pending=1 / baseline 切换 1 次 |
| 7 | defense 误触发 | colonyState=defense 但 hostiles=0 持续 761 tick |

### 1.3 spawn churn 全周期分布

```
harvester:       2631 次（62%）  ← body 从 8W1C2M 退化到 1W1C1M
remoteHarvester:  735 次（17%）
hauler:           351 次（8%）
remoteHauler:     235 次（6%）
distributor:      142 次（3%）
builder:           80 次（2%）
reserver:          64 次（2%）
```

spawn energy 末段仅 15/300，P0 路径持续降级到最小 body。

---

## 二、七大病灶根因验证

### 病灶 1：colonyState 状态机对 srcRatio 失明

**根因**：`evaluateColonyPhase` 双维度模型（drainScore + liquidityScore）无 source 满载率信号。

**证据链**：

1. `src/domain/economy/phase.ts:151-210` — `PhaseInput` 字段：reserve、spendable、spendableRatio、frozenRatio、harvesterCount、sourceCount、rcl — **无 srcRatio**。
2. `src/domain/economy/phase.ts:162` — `draining = reserveDelta < 0 && spendableRatio < drainSpendableFloor(0.5)` — spawn 口袋健康时储备下降不计赤字。
3. `src/systems/room-state.ts:32-94` — 计算 reserve/spendableRatio/frozenRatio/harvesterCount 后注入 `evaluateColonyPhase`，**未采集 source.energy / source.energyCapacity**。
4. `src/domain/economy/phase.ts:182` — `understaffed = harvesterCount < max(1, sourceCount)` — churn 期 harvesterCount≥1 → 不进 bootstrap。

**失明路径**：

```
spawn churn 期
  ├─ harvester body 退化（8W1C2M → 1W1C1M）→ 单体采集能力塌方
  ├─ harvesterCount 仍 ≥1（每代 1W1C1M 短命但存活）→ understaffed=false
  ├─ spendableRatio > 0.5（hauler 持续补 spawn）→ drainScore 不计赤字
  ├─ source 持续满载（3000/3000）→ srcRatio=1.0
  └─ storage 单向流失（无采集补给）→ drainScore 看不到（drainSpendableFloor 豁免）

结果：colonyState 仍判 normal/growth，所有消费侧不收缩
```

### 病灶 2：远矿吸血 — 主房危机时不关闭

**根因**：`roomReadyForNewRemote` 只挡"新开点"，不挡现役 op 的 spawn 推送。

**证据链**：

1. `src/systems/remote-mining-manager.ts:130` — `if (newOpsAllowed && roomReadyForNewRemote(...) && activeCount < maxOps)` — 仅门禁新开点。
2. `src/systems/remote-mining-manager.ts:258-274` — `evaluateRemoteDemand` 接收 `colonyState` 但**无现役 op 收缩逻辑**，继续推送 remoteHarvester/remoteHauler/reserver 请求。
3. `src/systems/remote-mining-manager.ts:408-416` — `roomReadyForNewRemote` 注释明文：「只裁『是否新开』，不影响现役 op」。

**吸血路径**：

```
主房 RCL5 危机期
  ├─ harvester churn 中（spawn 占用紧张）
  ├─ remote-mining-manager 继续推 remote spawn 请求
  ├─ remoteHarvester/remoteHauler/reserver 与主房 harvester 竞争 spawn
  ├─ 主房 spawn energy 进一步被压榨（15/300）
  └─ 远矿 54795 tick 持续吸血，4 个 remoteHauler 全 idle 0 回流
```

### 病灶 3：spawn churn 熔断与 failure reserve 缺失

**根因**：SP-2 黑名单对 `harvester:`/`worker:` 明文豁免隔离，cleanQueue 清除后 demand 立即重建形成无限循环。

**证据链**：

1. `src/systems/spawn-manager.ts:70` — `if (key.startsWith("worker:") || key.startsWith("harvester:")) continue;` — 采集角色豁免隔离。
2. `src/systems/spawn-manager.ts:57-80` — maxRetries 是单请求级；cleanQueue 清除后下一 tick demand 立即重建同 key 请求。
3. `src/systems/spawn-manager.ts:261-412` — `trySpawn` 降级机制：P0 始终降级 + survivalPath 豁免地板 → body 可退化到 1W1C1M。
4. 无全局 churn 频率熔断机制（无近 N tick 同 role churn 次数统计）。

**churn 循环**：

```
demand 生成 harvester 请求
  → trySpawn 降级失败（能量不足）
  → retries++ 达 maxRetries
  → cleanQueue 清除（harvester 豁免隔离）
  → 下一 tick demand 重建同 key 请求
  → 循环（4238 次/全周期）
```

### 病灶 4：upgrader 在 storage 流失期持续抽能

**根因**：`upgraderGate` 不读 colonyState；`dynamicStorageLimit` 只看 storage 绝对水位，不看净流出率。

**证据链**：

1. `src/creeps/roles/upgrader.ts:89-133` — `upgraderGate` 仅检查 `controller.ticksToDowngrade < threshold`、RCL8、container 能量、storage 水位 — **不读 colonyState**。
2. `src/creeps/roles/upgrader.ts:148-157` — `dynamicStorageLimit`：
   - `energy < upgradeEnergyFloorStorage(1k)` → 0
   - `energy >= sprintStorage(50k)` → carry 满载
   - `energy >= sustainedStorage(10k)` → 500/tick
   - 其他 → 200/tick
   - **无 storage 净流出率检查**。
3. `src/domain/spawn/demand.ts:679` — `allowUpgrader = (colonyState === "normal" || hasDowngradeRisk) && !rcl8NoUpgrade` — colonyState=normal 时仍孵 upgrader 替补，现役 upgrader 持续抽 storage。

**流失路径**：

```
srcRatio=1.0 期间（采集为 0）
  ├─ colonyState=normal（病灶 1 失明）
  ├─ upgrader 现役存活，gate 不拦截
  ├─ dynamicStorageLimit 按 storage 水位返回 200-500/tick
  ├─ upgrader 持续从 storage 取能升级
  └─ storage 从 374K → 0（12 E/tick 流失，阶段 C）
```

### 病灶 5：builder 编制看实时 site 数而非 backlog

**根因**：`dynamicBuilderTarget` 用 `myConstructionSites.length`（受全局 site 配额限制），看不到 queued backlog。

**证据链**：

1. `src/domain/spawn/demand.ts:772-785`：
   ```typescript
   let dynamicBuilderTarget = Math.min(
     builderConfig.maxCount,
     economyCap,  // harvester + worker + 1
     Math.max(
       builderConfig.minCount,
       snapshot.myConstructionSites.length,  // ← 实时 site 数
       roadRepairDemand ? 1 : 0,
     ),
   );
   ```
2. `src/systems/construction-manager.ts:191` — `ctx.globalSiteCount + getRemoteSiteTotal() >= CONFIG.construction.maxGlobalSites(7)` 限制全局 site 数。
3. `src/systems/construction-manager.ts:255` — `normalSites >= CONFIG.construction.maxNormalSitesPerRoom(3)` 限制单房 normal site。
4. layout-planner 推入 61 个 queued 任务，但只有 ≤7 个能 site 化 → builder 编制被卡在低值（1-3）。
5. `economyCap = harvester + worker + 1` — churn 期 harvester 数可能维持但能力塌方，economyCap 严重低估。

### 病灶 6：调参引擎对采集速率失明

**根因**：`aggregateSignals` 输出无 srcRatio/harvestRate；frozen/pending 参数完全跳过评估。

**证据链**：

1. `src/systems/tuning-engine.ts:510-582` — `aggregateSignals` 返回字段：avgReserveDelta、avgPressure、avgDrainScore、crisisRatio、avgStorageEnergy、containerFillRatio、spawnFillRatio、haulerCount、harvesterCount、upgraderCount、builderCount、buildQueueBacklog、tierRank、rcl — **无 srcRatio**。
2. `src/systems/tuning-engine.ts:255-273` — `buildExcludedParams`：pending + frozen 参数都进 excludedParams。
3. `src/systems/tuning-engine.ts:192-200` — `evaluateTuning(... excludedParams)` — 排除集中的参数跳过评估，newTrend 置 "none"。
4. frozen=3 / pending=1 时，harvester/hauler maxCount 被锁定，即使采集塌方也无法上调。

### 病灶 7：defense 误触发（待进一步调查）

**部分确认**：`phaseToColonyState(phase, hasHostiles)` 直接 `if (hasHostiles) return "defense"`。

**待调查**：hostiles=0 但 colonyState=defense 持续 761 tick 的具体来源。

**调查清单**：

1. grep `lastHostileAt` 全消费方（empire-strategy / tower-defense / role-runner flee）。
2. 确认是否 `phaseToColonyState` 之外有独立 defense 触发路径。
3. 检查 `threatCreeps` 是否包含已死亡但快照未更新的 creep。

---

## 三、协议偏差清单（V2 §1-§7）

| 协议条款 | 偏差描述 | 对应病灶 |
|---|---|---|
| V2 §1 | 派生值（srcRatio）无 invalidation 机制 | 病灶 1 |
| V2 §2 | 远矿 Plan 无 budget/fallback | 病灶 2 |
| V2 §3 | upgrader 未随 storage 流失降级 | 病灶 4 |
| V2 §4 | spawn 无 failure reserve / 全局熔断 | 病灶 3 |
| V2 §5 | 远矿未在主房危机时关闭 | 病灶 2 |
| V2 §6 | 消费侧（upgrader）未分级降级 | 病灶 4 |
| V2 §7 | defense 由不可观测条件触发 | 病灶 7 |

---

## 四、分批修复方案

**设计原则**：每条改动独立可回滚，不重构架构，新增信号优先于改迟滞阈值。

### 4.1 P0 止血（24h 内可上线，目标：阻断失血回路）

---

#### **P0-1: colonyState 引入 srcRatio 强制 crisis 通道**

**改什么**：在 `src/systems/room-state.ts` 计算 srcRatio（最满 source 的填充率）+ storageDrainRate，传入 `evaluateColonyPhase`；`src/domain/economy/phase.ts` 新增"srcRatio 持续满载 + storage 净流出"双条件强制 crisis 通道，绕过 drainScore 迟滞。

**为什么改**：病灶 1 根因。当前双维度（drainScore/liquidityScore）在 spawn 口袋健康时（drainSpendableFloor=0.5）看不到采集塌方，srcRatio=1.0 持续 31000 tick 仍判 normal。

**影响面**：`src/systems/room-state.ts`（信号采集）、`src/domain/economy/phase.ts`（状态机）、`src/types/global.d.ts`（PhaseInput/PhaseState/PhaseOptions 类型）；可能影响所有读 colonyState 的下游（spawn/construction/remote/tuning）— 但仅新增 crisis 触发路径，不删除既有路径。

**diff 草图**：

```typescript
// src/domain/economy/phase.ts — PhaseInput 增加字段
export interface PhaseInput {
  // ...既有字段...
  /** 最满 source 的填充率 (0..1)。> 0.9 持续 = source 满载但采不动。 */
  srcRatio: number;
  /** storage 净流出率 (E/tick，负值=流失)。无 storage 时为 0。 */
  storageDrainRate: number;
}

// PhaseState 增加持续计数
export interface PhaseState {
  // ...既有字段...
  /** srcRatio > srcRatioTrap 持续评估次数。 */
  srcStallTicks?: number;
}

// PhaseOptions 增加阈值
export interface PhaseOptions {
  // ...既有字段...
  srcRatioTrap: number;          // 默认 0.9
  srcStallEnterTicks: number;    // 默认 50 — 50 tick 持续满载 + 流失即触发
  storageDrainThreshold: number; // 默认 -2 E/tick
}

// DEFAULT_PHASE_OPTIONS 增加默认值
export const DEFAULT_PHASE_OPTIONS: PhaseOptions = {
  // ...既有字段...
  srcRatioTrap: 0.9,
  srcStallEnterTicks: 50,
  storageDrainThreshold: -2,
};

// evaluateColonyPhase 中新增强制 crisis 通道（在 crisisScore 判定之前）
export function evaluateColonyPhase(
  input: PhaseInput,
  prev: PhaseState,
  options: PhaseOptions = DEFAULT_PHASE_OPTIONS,
): PhaseResult {
  const reserveDelta = prev.prevReserve === undefined ? 0 : input.reserve - prev.prevReserve;

  // ── P0-1：srcRatio 强制 crisis 通道 ──
  // 双条件：srcRatio > 阈值（source 满载） + storageDrainRate < 阈值（storage 流失）
  // 单条件不触发：srcRatio 满载但 storage 在涨 = harvester 正常采空盈余入 storage
  const srcStalled = input.srcRatio > options.srcRatioTrap
    && input.storageDrainRate < options.storageDrainThreshold;
  const newStallTicks = srcStalled ? (prev.srcStallTicks ?? 0) + 1 : 0;
  const forceCrisis = newStallTicks >= options.srcStallEnterTicks;

  // ── 既有双维度模型（保留）──
  const draining = reserveDelta < 0 && input.spendableRatio < options.drainSpendableFloor;
  const delta = draining ? options.scoreStep : -options.recoveryStep;
  const drainScore = Math.max(0, Math.min(options.drainEnterScore, prev.drainScore + delta));

  const liquidityTrap = input.spendableRatio < options.liquiditySpendableRatio
    && input.frozenRatio > options.liquidityFrozenRatio;
  const liquidityDelta = liquidityTrap ? options.liquidityStep : -options.liquidityRecoveryStep;
  const prevLiquidity = prev.liquidityScore ?? 0;
  const liquidityScore = Math.max(0, Math.min(options.drainEnterScore, prevLiquidity + liquidityDelta));

  const crisisScore = Math.max(drainScore, liquidityScore);
  const understaffed = input.harvesterCount < Math.max(1, input.sourceCount);
  const inCrisisBand = prev.phase === "crisis" || prev.phase === "recovery";
  const bandTicksSoFar = inCrisisBand ? (prev.bandTicks ?? 0) : 0;
  const dwellSatisfied = bandTicksSoFar >= options.minBandTicks;

  // P0-1：强制 crisis 通道优先（绕过迟滞）
  if (forceCrisis) {
    return {
      phase: "crisis",
      prevReserve: input.reserve,
      drainScore: options.drainEnterScore,
      liquidityScore,
      bandTicks: bandTicksSoFar + 1,
      reserveDelta,
      srcStallTicks: newStallTicks,
    };
  }

  // ── 既有 phase 决策（保留）──
  let phase: ColonyPhase;
  if (crisisScore >= options.drainEnterScore) {
    phase = "crisis";
  } else if (inCrisisBand && crisisScore >= options.drainExitScore) {
    phase = "crisis";
  } else if (inCrisisBand && (crisisScore > options.recoveryClearScore || !dwellSatisfied)) {
    phase = "recovery";
  } else if (input.rcl >= 8 && !understaffed) {
    phase = "steady";
  } else if (understaffed) {
    phase = "bootstrap";
  } else {
    phase = "growth";
  }

  const stillInBand = phase === "crisis" || phase === "recovery";
  const bandTicks = stillInBand ? bandTicksSoFar + 1 : 0;

  return {
    phase,
    prevReserve: input.reserve,
    drainScore,
    liquidityScore,
    bandTicks,
    reserveDelta,
    srcStallTicks: newStallTicks,
  };
}
```

```typescript
// src/systems/room-state.ts — 计算 srcRatio + storageDrainRate 后注入 PhaseInput

// 在 evaluateColonyPhase 调用前，增加信号采集
let srcRatio = 0;
for (const s of snapshot.sources) {
  const cap = (s as Source).energyCapacity ?? 3000;
  if (cap > 0) {
    const fill = ((s as Source).energy ?? 0) / cap;
    if (fill > srcRatio) srcRatio = fill;
  }
}

// storage 净流出率：用上一 tick storage 能量与本 tick 差值
const prevStorageEnergy = roomMem.phase?.storageEnergyPrev ?? 0;
const currentStorageEnergy = snapshot.storage
  ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY)
  : 0;
const storageDrainRate = prevStorageEnergy - currentStorageEnergy; // 正值=流失

// 持久化当前 storage 能量供下一 tick 计算
// （扩展 roomMem.phase 写入逻辑）

const phaseResult = evaluateColonyPhase(
  {
    reserve,
    spendable: snapshot.energyAvailable,
    spendableRatio,
    frozenRatio,
    harvesterCount,
    sourceCount: snapshot.sources.length,
    rcl: snapshot.rcl,
    srcRatio,            // 新增
    storageDrainRate,    // 新增
  },
  prevPhase,
);
```

**回滚条件**：观察 1 个私服周期（约 5000 tick），若 colonyState 频繁误判 crisis（srcRatio 短暂满载但 harvester 正常产出），调高 `srcStallEnterTicks` 至 200 或回滚。

**验证指标**：

- srcRatio > 0.9 持续 > 50 tick 时 colonyState 必须 = crisis
- storage 净流出 < -2 E/tick 持续 > 50 tick 时 colonyState 必须 = crisis
- 已有 drainScore/liquidityScore 路径不退化（既有测试全绿）

---

#### **P0-2: 远矿在主房 crisis 时暂停 spawn 推送**

**改什么**：`src/systems/remote-mining-manager.ts` 在 `colonyState === "recovery" || "bootstrap" || "defense"` 时跳过 `evaluateRemoteDemand` 调用；现役 creep 不召回，自然寿终榨干残值。

**为什么改**：病灶 2 根因。当前 colonyState 只挡"新开点"，不挡现役 op 的 spawn 推送，主房 RCL5 危机期远矿持续吸血 54795 tick。

**影响面**：仅 `src/systems/remote-mining-manager.ts`；现役 remoteHarvester/remoteHauler/reserver 自然寿终，不召回（沉没成本已付）；colonyState 恢复 normal 后自动重启 spawn 推送。

**diff 草图**：

```typescript
// src/systems/remote-mining-manager.ts — evaluateRemoteDemand 调用前
const colonyState: ColonyState = roomMem.colonyState ?? "normal";
const queue = roomMem.spawnQueue ?? [];

// P0-2：主房 crisis/defense 时暂停远矿 spawn 推送
// 现役 creep 自然寿终，不召回（沉没成本已付）
// maintainExistingOps/reevaluateActiveOps/recycleExcessRemoteCreeps 仍运行（清理/重估/配额照常）
if (colonyState === "recovery" || colonyState === "bootstrap" || colonyState === "defense") {
  recycleExcessRemoteCreeps(snapshot.roomName, remoteOps);
  continue; // 跳过 spawn 推送，进入下一房处理
}

const remoteCreeps = collectRemoteCreeps(snapshot.roomName);
// ...既有 evaluateRemoteDemand 调用与 submitRequest 逻辑不变...
```

**回滚条件**：观察 crisis 期远矿 creep 是否在寿终前能恢复主房经济；若主房恢复后远矿重启太慢（> 1000 tick 才回到稳态），改为只跳过 `remoteHauler/reserver` 推送，保留 `remoteHarvester`。

**验证指标**：

- colonyState=recovery 期间 spawnQueue 不新增 remote* 请求
- colonyState 恢复 normal 后 ≤ 100 tick 内远矿 spawn 推送恢复
- 主房 harvester churn 在 crisis 期下降 ≥ 50%

---

#### **P0-3: spawn churn 全局熔断（harvester 不再永久豁免隔离）**

**改什么**：`src/systems/spawn-manager.ts` 将 harvester/worker 隔离改为短冷却（500 tick 而非 1000 tick 永久豁免）；新增"近 200 tick 内同 role churn > 20 次 → 暂停该 role 孵化 100 tick"全局熔断。

**为什么改**：病灶 3 根因。harvester 豁免隔离 + cleanQueue 后 demand 立即重建 = 无限 churn 循环（4238 次全周期）。

**影响面**：`src/systems/spawn-manager.ts`、`src/domain/spawn/demand.ts`（读取 churnFreezeUntil 跳过角色）、`src/types/global.d.ts`（RoomMemory.churnFreezeUntil 字段）；harvester 持续失败时短暂停孵（最多 100 tick），可能加剧采集危机 — 但 P0-1 的 crisis 触发会同步收缩消费侧，缓解能量竞争。

**diff 草图**：

```typescript
// src/systems/spawn-manager.ts — cleanQueue 后的隔离逻辑（line 57-80 修改）
const purgedKeys = cleanQueue(
  queue,
  ctx.tick,
  CONFIG.spawn.maxRetries,
  (key, reason) => recordSkip(`spawn/churn/${key.split(":")[0]}/${reason}`),
);
if (purgedKeys.length > 0) {
  roomMem.spawnBlacklist ??= {};
  for (const key of purgedKeys) {
    // P0-3：harvester/worker 不再永久豁免，改用短冷却（500 tick）
    // 持续配置错误依然存在时，500 tick 后重建请求会再次失败再次隔离 —
    // 比 1000 tick 更快进入熔断，比永久豁免避免无限 churn。
    const ttl = key.startsWith("worker:") || key.startsWith("harvester:")
      ? Math.floor(CONFIG.spawn.requestTtl / 2)  // 500 tick
      : CONFIG.spawn.requestTtl;                  // 1000 tick
    roomMem.spawnBlacklist[key] = ctx.tick + ttl;
    console.log(`[${ctx.tick}] spawn/${snapshot.roomName}: quarantined ${key} for ${ttl} ticks`);
  }
}

// 新增全局 churn 熔断 — 在 spawnManagerSystem.run 入口处
function checkChurnCircuitBreaker(ctx: TickContext, roomMem: RoomMemory): void {
  const g = globalCache() as any;
  if (!g.__churnCounter) g.__churnCounter = { records: [] as Array<{ tick: number; role: string }> };

  // 清理过期记录（200 tick 滑窗）
  const cutoff = ctx.tick - 200;
  g.__churnCounter.records = g.__churnCounter.records.filter(
    (r: { tick: number; role: string }) => r.tick > cutoff,
  );

  // 按角色聚合
  const byRole = new Map<string, number>();
  for (const r of g.__churnCounter.records) {
    byRole.set(r.role, (byRole.get(r.role) ?? 0) + 1);
  }

  // 触发熔断：200 tick 内同 role churn > 20 次
  roomMem.churnFreezeUntil ??= {};
  for (const [role, count] of byRole) {
    if (count > 20 && roomMem.churnFreezeUntil[role] === undefined) {
      roomMem.churnFreezeUntil[role] = ctx.tick + 100;
      console.log(`[${ctx.tick}] spawn/${roomMem}: CIRCUIT_BREAKER ${role} frozen for 100 ticks (churn=${count}/200t)`);
    }
  }

  // 清理到期熔断
  for (const role of Object.keys(roomMem.churnFreezeUntil)) {
    if (ctx.tick >= roomMem.churnFreezeUntil[role]!) {
      delete roomMem.churnFreezeUntil[role];
    }
  }
}

// recordSkip 适配层需要同时写入 churnCounter
// （修改 recordSkip 回调或在 spawnManagerSystem.run 中独立统计）
```

```typescript
// src/domain/spawn/demand.ts — 评估前检查 churnFreezeUntil
export function evaluateDemand(
  snapshot: RoomSnapshot,
  queue: readonly SpawnRequest[],
  colonyState: ColonyState,
  creeps: readonly CreepSummary[],
  spawning: readonly SpawningSummary[],
  roomCtx: RoomDemandContext,
  tick: number,
): DemandResult {
  // P0-3：读取 churnFreezeUntil，构造冻结角色集合
  const roomMem = Memory.rooms[snapshot.roomName];
  const frozenRoles = new Set<string>();
  if (roomMem?.churnFreezeUntil) {
    for (const [role, until] of Object.entries(roomMem.churnFreezeUntil)) {
      if (tick < until) frozenRoles.add(role);
    }
  }

  // 各角色评估时跳过 frozenRoles（harvester/upgrader/builder 等块开头）
  // P0 worker 恢复路径不冻结（livingHarvesters === 0 时仍孵 worker）
  // ...

  // 例：harvester 评估块
  if (!frozenRoles.has("harvester")) {
    // 既有 harvester 评估逻辑
  }
}
```

**回滚条件**：harvester 熔断期间导致 colonyState 长期 recovery 无法恢复（> 2000 tick），调高阈值至 50 或回滚 harvester 短冷却隔离。

**验证指标**：

- harvester churn 次数 / 单位时间下降 ≥ 70%
- 熔断触发后 100 tick 内能量储备回升（spawn energyAvailable 从 15 → ≥ 200）
- P0 worker 恢复路径不退化（rcl1-survival 回归测试全绿）

---

#### **P0-4: upgrader 增加 storage 净流出率门禁**

**改什么**：`src/creeps/roles/upgrader.ts` 的 `dynamicStorageLimit` 跨 tick 跟踪 storage 净流出率，流失过快时返回 0（停止取能）；`upgraderGate` 增加该信号检查。

**为什么改**：病灶 4 根因。当前 `dynamicStorageLimit` 只看绝对水位，srcRatio=1.0 期间 storage 从 374K → 0 持续流失 12 E/tick，upgrader 抽到归零。

**影响面**：`src/creeps/roles/upgrader.ts`；`src/config/index.ts`（新增 `CONFIG.economy.upgrade.drainRateLimit`）；upgrader 在流失期 idle，可能影响 controller 进度 — 但 P0-1 触发 crisis 后 upgrader 本就该收缩。

**diff 草图**：

```typescript
// src/creeps/roles/upgrader.ts — dynamicStorageLimit 增加净流出检查
function dynamicStorageLimit(ac: ActionContext): number {
  const st = ac.snapshot.storage;
  if (!st) return CONFIG.economy.upgrade.perTickWithdrawLimit;
  const energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
  const cfg = CONFIG.economy;
  if (energy < cfg.upgradeEnergyFloorStorage) return 0;

  // P0-4：storage 净流出率检查 — 跨 tick 跟踪
  // 用 roomMem.phase.reserve 近似上一 tick storage 能量（或新增字段 storageEnergyPrev）
  const roomMem = Memory.rooms[ac.snapshot.roomName];
  const prevEnergy = roomMem?.phase?.storageEnergyPrev ?? energy;
  const drainRate = prevEnergy - energy; // 正值 = 流失

  // 双门槛：低水位（< sustainedStorage*2）+ 流失（> drainRateLimit）
  // 高水位期允许流失（盈余消化），低水位期流失即停止取能
  const lowWater = energy < cfg.upgrade.sustainedStorage * 2;
  const draining = drainRate > cfg.upgrade.drainRateLimit; // 默认 5 E/tick
  if (lowWater && draining) {
    return 0; // 停止取能，让 storage 回血
  }

  if (energy >= cfg.upgrade.sprintStorage) return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
  if (energy >= cfg.upgrade.sustainedStorage) return cfg.upgrade.perTickWithdrawLimit;
  return 200;
}
```

```typescript
// src/config/index.ts — 新增配置
export const CONFIG = {
  // ...既有字段...
  economy: {
    // ...既有字段...
    upgrade: {
      // ...既有字段...
      drainRateLimit: 5, // P0-4：storage 净流失率上限（E/tick），超过且低水位时 upgrader 停止取能
    },
  },
};
```

**回滚条件**：upgrader 长期 idle 导致 controller 降级风险频发，调高 `drainRateLimit` 至 20 或回滚。

**验证指标**：

- storage 净流出 < -5 E/tick 持续 50 tick 时 upgrader 取能 = 0
- storage 流失率从 12 E/tick 降至 ≤ 2 E/tick
- controller 降级风险发生率不上升

---

### 4.2 P1 短期（1 周内，目标：补齐协议缺失字段）

---

#### **P1-1: builder 编制纳入 buildQueue backlog**

**改什么**：`src/domain/spawn/demand.ts` 的 `dynamicBuilderTarget` 增加 `queuedBacklogWeighted` 项。

**为什么改**：病灶 5 根因。当前用 `myConstructionSites.length`（受全局/单房 site 配额限制），看不到 61 个 queued 积压。

**diff 草图**：

```typescript
// src/domain/spawn/demand.ts — builder 评估块（line 772-785 修改）
if (colonyState !== "bootstrap" && (snapshot.myConstructionSites.length > 0 || roadRepairDemand)) {
  const builderConfig = getRoleBounds("builder", home);
  const builderTotal = (counts.builder ?? 0) + pending.builder;
  const economyCap = (counts.harvester ?? 0) + (counts.worker ?? 0) + 1;

  // P1-1：纳入 buildQueue backlog（保守权重 0.5）
  // site 数受全局/单房配额限制看不到 backlog，backlogWeighted 补盲
  const queuedBacklog = snapshot.buildQueue
    ? snapshot.buildQueue.filter(t => t.state === "queued").length
    : 0;
  const backlogWeighted = Math.floor(queuedBacklog * 0.5);

  let dynamicBuilderTarget = Math.min(
    builderConfig.maxCount,
    economyCap,
    Math.max(
      builderConfig.minCount,
      snapshot.myConstructionSites.length,
      backlogWeighted, // 新增
      roadRepairDemand ? 1 : 0,
    ),
  );
  // ...既有 builderPressureState 迟滞逻辑不变...
}
```

**回滚条件**：builder 扩编后能量竞争加剧 harvester 饥饿，调低权重至 0.3 或回滚。

**验证指标**：

- buildQueue backlog > 20 时 builder 编制 ≥ 3
- backlog 清空后 builder 自然收缩回 minCount
- builder churn 不上升

---

#### **P1-2: tuning-engine 增加 srcRatio 信号 + 危机解锁冻结**

**改什么**：`src/systems/tuning-engine.ts` 的 `aggregateSignals` 增加 srcRatio 字段；`evaluateTuning` 在 srcRatio > 0.9 持续时**强制解冻** harvester/hauler 的 maxCount（绕过 frozenUntil）。

**为什么改**：病灶 6 根因。frozen=3 / pending=1 锁住关键参数，采集塌方时无法上调。

**diff 草图**：

```typescript
// src/systems/tuning-engine.ts — aggregateSignals 增加 srcRatio
function aggregateSignals(ctx: TickContext, roomName: string): TuningSignals | null {
  // ...既有逻辑...

  // P1-2：新增 srcRatio 信号
  let srcRatio = 0;
  for (const s of snapshot.sources) {
    const cap = (s as Source).energyCapacity ?? 3000;
    if (cap > 0) {
      const fill = ((s as Source).energy ?? 0) / cap;
      if (fill > srcRatio) srcRatio = fill;
    }
  }

  return {
    // ...既有字段...
    srcRatio, // 新增
  };
}

// safeRunTuning — 在 buildExcludedParams 之后、evaluateTuning 调用之前
function safeRunTuning(ctx, roomName, boundsSnapshot): void {
  // ...既有逻辑...

  // P1-2：srcRatio > 0.9 持续 50 tick 时强制解冻关键参数
  // 配合 P0-1 的 srcStallTicks 计数（写入 RoomMemory.phase）
  const roomMem = Memory.rooms[roomName];
  const srcStallTicks = roomMem?.phase?.srcStallTicks ?? 0;
  if (signals.srcRatio > 0.9 && srcStallTicks > 50) {
    const criticalParams = ["harvester.maxCount", "hauler.maxCount"];
    for (const p of criticalParams) {
      if (roomTuning.frozenParams?.[p]) {
        delete roomTuning.frozenParams[p];
        console.log(`[${ctx.tick}] tuning/${roomName}: FORCE_UNFREEZE ${p} (srcRatio=${signals.srcRatio.toFixed(2)}, stallTicks=${srcStallTicks})`);
      }
      excludedParams.delete(p); // 本 tick 允许评估
    }
  }

  // 既有 evaluateTuning 调用
  const evaluation = evaluateTuning(...);
  // ...
}
```

**回滚条件**：解冻后参数振荡（频繁调整无法收敛），改为只解冻 maxCount 不解冻 minCount。

**验证指标**：

- srcRatio > 0.9 持续 50 tick 时 harvester.maxCount 不被 frozen 阻塞
- 调整后参数收敛（不出现连续 3 次回滚）

---

#### **P1-3: defense 误触发调查 + 修复**

**改什么**：先调查 `lastHostileAt` 消费方（empire-strategy/tower-defense/role-runner flee），确认 761 tick 误触发的具体来源；若是 lastHostileAt 残留导致，增加过期失效（> 100 tick 未刷新即清除）。

**为什么改**：病灶 7。hostiles=0 但 colonyState=defense 持续 761 tick 不合理。

**调查清单**：

1. grep `lastHostileAt` 全消费方
2. 确认是否 `phaseToColonyState` 之外有独立 defense 触发路径
3. 检查 `threatCreeps` 是否包含已死亡但快照未更新的 creep

**验证指标**：

- hostiles=0 持续 > 100 tick 时 colonyState ≠ defense
- fortify 姿态不再误触发

---

### 4.3 P2 长期（1 月内，目标：架构级修复协议偏差）

---

#### **P2-1: colonyState 信号架构重构（V2 §1 派生值 invalidation）**

**改什么**：把 srcRatio / harvestRate / storageDrainRate / spawnChurnRate 作为一级信号注入 PhaseInput；重构 `evaluateColonyPhase` 为多信号融合 + invalidation 机制（任一信号超阈值持续 N tick 即强制 crisis，绕过迟滞）。

**为什么改**：当前双维度（drain/liquidity）模型对采集塌方失明是架构缺陷，P0-1 的强制通道是补丁，长期需要统一信号架构。

**影响面**：`src/domain/economy/phase.ts`、`src/systems/room-state.ts`、所有消费 colonyState 的系统；需要完整测试覆盖。

---

#### **P2-2: 远矿 Plan 增加 budget/fallback（V2 §2）**

**改什么**：`RemoteOp` 增加 `expectedCost`（spawn + maintain CPU/energy 预算）；主房 crisis 时按 expectedCost 排序收缩（abandoned 最贵的）；远矿 op 带 fallback 策略（被压制/失联时自动暂停而非持续推送 spawn）。

**为什么改**：P0-2 的"全暂停"是粗暴止血，长期需要精细化 budget 感知收缩。

---

#### **P2-3: spawn churn 自适应熔断（V2 §4 failure reserve）**

**改什么**：基于 churn 历史动态调整 maxRetries / 隔离时长 / failure reserve；spawn 持续失败时自动提高 recoveryEnergyReserve 比例；引入"churn 熵"指标（角色 × 时间窗口）作为 demand 收缩信号。

**为什么改**：P0-3 的固定阈值是粗粒度，长期需要自适应机制。

---

## 五、测试用例设计

**测试惯例对齐**：vitest BDD 风格，工厂函数（`input()` / `opts()` / `makeSnapshot()` / `mockContext()`），测试名英文，注释中文。

### 5.1 测试覆盖矩阵

| 修复项 | 测试文件 | 正常 | 边界 | 异常 | 总计 |
|---|---|---|---|---|---|
| P0-1 | `tests/unit/economy/phase-src-ratio.test.ts` + `tests/unit/systems/room-state-src-ratio.test.ts` | 4 | 5 | 3 | 12 |
| P0-2 | `tests/unit/remote/crisis-pause.test.ts` | 3 | 4 | 3 | 10 |
| P0-3 | `tests/unit/spawn/churn-circuit-breaker.test.ts` | 5 | 5 | 3 | 13 |
| P0-4 | `tests/unit/role/upgrader-drain-rate.test.ts` | 3 | 4 | 3 | 10 |
| P1-1 | `tests/unit/spawn/demand-builder-backlog.test.ts` | 3 | 5 | 2 | 10 |
| P1-2 | `tests/unit/economy/tuning-src-ratio-unfreeze.test.ts` | 3 | 4 | 3 | 10 |
| **合计** | | **21** | **27** | **17** | **65** |

### 5.2 P0-1 测试用例

#### `tests/unit/economy/phase-src-ratio.test.ts`

**前置 setup**：扩展 `input()` 工厂增加 `srcRatio` / `storageDrainRate` 字段（默认 0）；扩展 `opts()` 增加新阈值。

```typescript
function input(overrides?: Partial<PhaseInput>): PhaseInput {
  return {
    reserve: 2000,
    spendable: 300,
    spendableRatio: 0.3,
    frozenRatio: 0.0,
    harvesterCount: 2,
    sourceCount: 2,
    rcl: 3,
    srcRatio: 0,           // 新增
    storageDrainRate: 0,   // 新增
    ...overrides,
  };
}
```

**正常路径**（4 用例）：

```typescript
describe("P0-1 srcRatio 强制 crisis 通道 — 正常路径", () => {
  it("srcRatio < 阈值（< 0.9）时不触发强制 crisis，沿用原 drainScore 路径", () => {
    const r = evaluateColonyPhase(
      input({ srcRatio: 0.3, storageDrainRate: 0, reserve: 5000 }),
      FRESH,
    );
    expect(r.phase).toBe("growth");
    expect(r.srcStallTicks).toBe(0);
  });

  it("srcRatio > 0.9 但 storageDrainRate >= 阈值（未流失）→ 不触发强制 crisis", () => {
    const r = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: 5, reserve: 5000 }),
      FRESH,
    );
    expect(r.phase).toBe("growth");
    expect(r.srcStallTicks).toBe(0);
  });

  it("srcRatio > 0.9 + storageDrainRate < -2 持续 50 tick → 强制 crisis", () => {
    let state = FRESH;
    for (let i = 0; i < 49; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 - i * 5 }),
        state,
      );
      expect(state.phase).not.toBe("crisis");
    }
    const finalState = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 4755 }),
      state,
    );
    expect(finalState.phase).toBe("crisis");
    expect(finalState.srcStallTicks).toBe(50);
  });

  it("强制 crisis 优先级高于 drainScore 路径（即使 spawn 口袋健康也触发）", () => {
    let state = FRESH;
    for (let i = 0; i < 50; i++) {
      state = evaluateColonyPhase(
        input({
          srcRatio: 0.95,
          storageDrainRate: -5,
          spendableRatio: 0.8,
          reserve: 5000,
        }),
        state,
      );
    }
    expect(state.phase).toBe("crisis");
  });
});
```

**边界条件**（5 用例）：

```typescript
describe("P0-1 srcRatio 强制 crisis 通道 — 边界条件", () => {
  it("srcRatio 恰好等于 0.9（边界）→ 不触发（> 才触发，防 = 误判）", () => {
    let state = FRESH;
    for (let i = 0; i < 100; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.9, storageDrainRate: -5, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).not.toBe("crisis");
  });

  it("srcRatio = 0.91 + drainRate = -2.1（边界）→ 触发（> 0.9 且 < -2）", () => {
    let state = FRESH;
    for (let i = 0; i < 50; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.91, storageDrainRate: -2.1, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).toBe("crisis");
  });

  it("srcStallTicks 计数器在条件不再满足时立即归零（防残留累积）", () => {
    let state = FRESH;
    for (let i = 0; i < 30; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
        state,
      );
    }
    expect(state.srcStallTicks).toBe(30);
    state = evaluateColonyPhase(
      input({ srcRatio: 0.5, storageDrainRate: -5, reserve: 5000 }),
      state,
    );
    expect(state.srcStallTicks).toBe(0);
    expect(state.phase).not.toBe("crisis");
  });

  it("无 storage 时 storageDrainRate=0 → 永不触发 srcRatio 通道", () => {
    let state = FRESH;
    for (let i = 0; i < 200; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: 0, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).not.toBe("crisis");
  });

  it("srcStallEnterTicks=0 时首次满足条件即触发（用于快速熔断场景）", () => {
    const r = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
      FRESH,
      opts({ srcStallEnterTicks: 0 }),
    );
    expect(r.phase).toBe("crisis");
  });
});
```

**异常情况**（3 用例）：

```typescript
describe("P0-1 srcRatio 强制 crisis 通道 — 异常情况", () => {
  it("srcRatio 为 NaN（source 数据缺失）→ 不触发（保守，按 0 处理）", () => {
    let state = FRESH;
    for (let i = 0; i < 100; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: NaN, storageDrainRate: -5, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).not.toBe("crisis");
  });

  it("已有 drainScore crisis 时 srcRatio 通道不覆盖 bandTicks（叠加而非重置）", () => {
    let state = runDrain(FRESH, 2000, -100, 11);
    expect(state.phase).toBe("crisis");
    const prevBandTicks = state.bandTicks;
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 1000 }),
      state,
    );
    expect(state.phase).toBe("crisis");
    expect(state.bandTicks).toBe(prevBandTicks! + 1);
  });

  it("强制 crisis 恢复时仍走 recovery 迟滞带（不秒退 normal）", () => {
    let state = FRESH;
    for (let i = 0; i < 50; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).toBe("crisis");
    state = evaluateColonyPhase(
      input({ srcRatio: 0.3, storageDrainRate: 5, reserve: 5000 }),
      state,
    );
    expect(state.phase).toBe("recovery");
  });
});
```

#### `tests/unit/systems/room-state-src-ratio.test.ts`

```typescript
describe("room-state — srcRatio 信号采集", () => {
  it("多 source 取最满的填充率作为 srcRatio", () => {
    const snap = makeSnapshot({
      sources: [
        { id: "s1", energy: 2500, energyCapacity: 3000 } as Source,
        { id: "s2", energy: 2900, energyCapacity: 3000 } as Source,
      ],
    });
    roomStateSystem.run(makeCtx([snap]));
    expect(Memory.rooms.W1N1.phase!.phase).not.toBe("crisis");
  });

  it("source.energyCapacity 缺失时回退默认 3000（防除零）", () => {
    const snap = makeSnapshot({
      sources: [{ id: "s1", energy: 2900 } as Source],
    });
    expect(() => roomStateSystem.run(makeCtx([snap]))).not.toThrow();
  });

  it("storage 净流出率跨 tick 计算正确（prevStorage - currentStorage）", () => {
    Memory.rooms.W1N1.phase = {
      phase: "growth", reserve: 10000, drainScore: 0, liquidityScore: 0,
      storageEnergyPrev: 10000,
    };
    const snap = makeSnapshot({
      storage: { store: makeStore(9000) } as unknown as StructureStorage,
    });
    roomStateSystem.run(makeCtx([snap]));
    // 验证 storageEnergyPrev 更新为 9000
    expect(Memory.rooms.W1N1.phase!.storageEnergyPrev).toBe(9000);
  });
});
```

### 5.3 P0-2 测试用例 — `tests/unit/remote/crisis-pause.test.ts`

**正常路径**（3 用例）：

```typescript
describe("P0-2 远矿 crisis 暂停 — 正常路径", () => {
  it("colonyState=recovery → 不推送任何 remote* spawn 请求", () => {
    const snap = makeSnapshotWithRemoteOps({
      colonyState: "recovery",
      remoteOps: { W2N2: { state: "active", sources: 1, haulerNeed: 2, lastSeen: 100 } },
    });
    runRemoteMiningManager(snap);
    const queue = Memory.rooms.W1N1.spawnQueue ?? [];
    expect(queue.filter(r => r.role.startsWith("remote"))).toHaveLength(0);
  });

  it("colonyState=bootstrap → 不推送 remote* spawn 请求（嫩房不开远矿）", () => {
    const snap = makeSnapshotWithRemoteOps({ colonyState: "bootstrap" });
    runRemoteMiningManager(snap);
    expect((Memory.rooms.W1N1.spawnQueue ?? []).filter(r => r.role.startsWith("remote"))).toHaveLength(0);
  });

  it("colonyState=normal → 正常推送 remote* spawn 请求（无回归）", () => {
    const snap = makeSnapshotWithRemoteOps({
      colonyState: "normal",
      remoteOps: { W2N2: { state: "active", sources: 1, haulerNeed: 2, lastSeen: 100 } },
    });
    runRemoteMiningManager(snap);
    const remoteReqs = (Memory.rooms.W1N1.spawnQueue ?? []).filter(r => r.role.startsWith("remote"));
    expect(remoteReqs.length).toBeGreaterThan(0);
  });
});
```

**边界条件**（4 用例）：

```typescript
describe("P0-2 远矿 crisis 暂停 — 边界条件", () => {
  it("colonyState 缺失（undefined）→ 默认 normal，正常推送（保守不误伤）", () => {
    const snap = makeSnapshotWithRemoteOps({ colonyState: undefined });
    runRemoteMiningManager(snap);
    expect((Memory.rooms.W1N1.spawnQueue ?? []).filter(r => r.role.startsWith("remote")).length).toBeGreaterThan(0);
  });

  it("crisis 期 maintainExistingOps 仍运行（清理废弃 op 不中断）", () => {
    const snap = makeSnapshotWithRemoteOps({
      colonyState: "recovery",
      remoteOps: { W2N2: { state: "abandoned", lastSeen: 1, sources: 1, haulerNeed: 1 } },
    });
    runRemoteMiningManager(snap);
    // abandoned op 应被 cleanup 逻辑处理
  });

  it("crisis 期 reevaluateActiveOps 仍运行（不停止经济重估）", () => {
    // 防止 crisis 期 op 状态滞后导致恢复后误判
  });

  it("colonyState 从 recovery 恢复 normal 后 ≤ 1 个 interval 内恢复 spawn 推送", () => {
    let snap = makeSnapshotWithRemoteOps({ colonyState: "recovery" });
    runRemoteMiningManager(snap);
    expect((Memory.rooms.W1N1.spawnQueue ?? []).filter(r => r.role.startsWith("remote"))).toHaveLength(0);
    snap = makeSnapshotWithRemoteOps({ colonyState: "normal" });
    runRemoteMiningManager(snap);
    expect((Memory.rooms.W1N1.spawnQueue ?? []).filter(r => r.role.startsWith("remote")).length).toBeGreaterThan(0);
  });
});
```

**异常情况**（3 用例）：

```typescript
describe("P0-2 远矿 crisis 暂停 — 异常情况", () => {
  it("crisis 期现役 remoteHarvester 自然寿终不被强制召回（沉没成本已付）", () => {
    // 验证 recycleBlockedRoomCreeps 不因 crisis 触发
  });

  it("crisis 期 remoteOps 状态不丢失（active 保持 active，不误转 abandoned）", () => {
    const snap = makeSnapshotWithRemoteOps({
      colonyState: "recovery",
      remoteOps: { W2N2: { state: "active", lastSeen: 100, sources: 1, haulerNeed: 1 } },
    });
    runRemoteMiningManager(snap);
    expect(Memory.rooms.W1N1.remoteOps!.W2N2.state).toBe("active");
  });

  it("colonyState=defense 时也暂停远矿推送（战时统一收缩）", () => {
    const snap = makeSnapshotWithRemoteOps({ colonyState: "defense" });
    runRemoteMiningManager(snap);
    expect((Memory.rooms.W1N1.spawnQueue ?? []).filter(r => r.role.startsWith("remote"))).toHaveLength(0);
  });
});
```

### 5.4 P0-3 测试用例 — `tests/unit/spawn/churn-circuit-breaker.test.ts`

**正常路径**（5 用例）：

```typescript
describe("P0-3 spawn churn 熔断 — 正常路径", () => {
  it("harvester 请求达 maxRetries 后进入黑名单（短冷却 500 tick）", () => {
    const queue = [makeRequest("harvester", "W1N1", 0, { retries: CONFIG.spawn.maxRetries })];
    const purgedKeys = cleanQueue(queue, 100, CONFIG.spawn.maxRetries, () => {});
    expect(purgedKeys).toContain("harvester:W1N1:0");
    expect(Memory.rooms.W1N1.spawnBlacklist!["harvester:W1N1:0"]).toBe(100 + 500);
  });

  it("非采集角色（如 hauler）达 maxRetries → 长冷却 1000 tick（无回归）", () => {
    const queue = [makeRequest("hauler", "W1N1", 0, { retries: CONFIG.spawn.maxRetries })];
    cleanQueue(queue, 100, CONFIG.spawn.maxRetries, () => {});
    expect(Memory.rooms.W1N1.spawnBlacklist!["hauler:W1N1:0"]).toBe(100 + 1000);
  });

  it("近 200 tick 内 harvester churn > 20 次 → 触发 100 tick 熔断", () => {
    for (let i = 0; i < 21; i++) {
      recordSkip("spawn/churn/harvester/retries");
    }
    runSpawnManagerWithChurnCounter(201);
    expect(Memory.rooms.W1N1.churnFreezeUntil!.harvester).toBe(201 + 100);
  });

  it("熔断期间 demand 不生成 harvester 请求", () => {
    Memory.rooms.W1N1.churnFreezeUntil = { harvester: 300 };
    const snap = makeSnapshot({ colonyState: "normal" });
    const { requests } = evaluateDemand(snap, [], "normal", [], [], normalCtx(), 250);
    expect(requests.filter(r => r.role === "harvester")).toHaveLength(0);
  });

  it("熔断到期后 harvester 请求恢复生成", () => {
    Memory.rooms.W1N1.churnFreezeUntil = { harvester: 300 };
    const snap = makeSnapshot({ colonyState: "normal" });
    const { requests } = evaluateDemand(snap, [], "normal", [], [], normalCtx(), 301);
    expect(requests.filter(r => r.role === "harvester").length).toBeGreaterThan(0);
  });
});
```

**边界条件**（5 用例）：

```typescript
describe("P0-3 spawn churn 熔断 — 边界条件", () => {
  it("churn 计数窗口：第 201 tick 时第 1 tick 的 churn 已过期（200 tick 滑窗）", () => {
    // tick 1 churn 20 次（不触发），tick 201 churn 1 次（窗口内 20+1=21 → 触发）
  });

  it("churn 阈值恰好 20 → 不触发（> 才触发，防 = 误判）", () => {
    for (let i = 0; i < 20; i++) recordSkip("spawn/churn/harvester/retries");
    runSpawnManagerWithChurnCounter(200);
    expect(Memory.rooms.W1N1.churnFreezeUntil).toBeUndefined();
  });

  it("不同 role 独立计数（harvester 21 次 + hauler 5 次 → 只熔断 harvester）", () => {
    for (let i = 0; i < 21; i++) recordSkip("spawn/churn/harvester/retries");
    for (let i = 0; i < 5; i++) recordSkip("spawn/churn/hauler/retries");
    runSpawnManagerWithChurnCounter(200);
    expect(Memory.rooms.W1N1.churnFreezeUntil!.harvester).toBeDefined();
    expect(Memory.rooms.W1N1.churnFreezeUntil!.hauler).toBeUndefined();
  });

  it("熔断期间 P0 worker 恢复路径不阻塞（livingHarvesters=0 仍可孵 worker）", () => {
    Memory.rooms.W1N1.churnFreezeUntil = { harvester: 300 };
    const snap = makeSnapshot({ colonyState: "normal" });
    const { requests } = evaluateDemand(snap, [], "normal", [], [], normalCtx(), 250);
    expect(requests.filter(r => r.role === "worker").length).toBeGreaterThan(0);
  });

  it("熔断到期后 churnFreezeUntil 字段自动清理（防 Memory 泄漏）", () => {
    Memory.rooms.W1N1.churnFreezeUntil = { harvester: 300 };
    runSpawnManagerWithChurnCounter(301);
    expect(Memory.rooms.W1N1.churnFreezeUntil!.harvester).toBeUndefined();
  });
});
```

**异常情况**（3 用例）：

```typescript
describe("P0-3 spawn churn 熔断 — 异常情况", () => {
  it("churnCounter globalCache 丢失（global reset）→ 不影响判定，重新计数", () => {
    // 模拟 global reset：churnCounter 为 undefined
  });

  it("recordSkip key 格式异常（无 role 段）→ 跳过该条不计数", () => {
    // key 如 "spawn/churn/" 或 "spawn/churn///retries"
  });

  it("churnFreezeUntil 字段类型异常（非 number）→ 视为到期清理", () => {
    Memory.rooms.W1N1.churnFreezeUntil = { harvester: "invalid" as unknown as number };
    runSpawnManagerWithChurnCounter(100);
    expect(Memory.rooms.W1N1.churnFreezeUntil!.harvester).toBeUndefined();
  });
});
```

### 5.5 P0-4 测试用例 — `tests/unit/role/upgrader-drain-rate.test.ts`

**正常路径**（3 用例）：

```typescript
describe("P0-4 upgrader storage 流失率门禁 — 正常路径", () => {
  it("storage 高水位 + 无流失 → dynamicStorageLimit 返回 carry 满载（正常取能）", () => {
    Memory.rooms.W1N1.phase = { reserve: 60000, storageEnergyPrev: 60000 } as any;
    const snap = mockSnapshot({
      storage: mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep = mockAcquireCreep();
    upgraderRole.run(creep, mockContext(snap));
    expect(creep.withdraw).toHaveBeenCalled();
  });

  it("storage 流失率 > drainRateLimit(5) + 低水位 → 返回 0（停止取能）", () => {
    Memory.rooms.W1N1.phase = { reserve: 10000, storageEnergyPrev: 10000 } as any;
    const snap = mockSnapshot({
      storage: mockStructure("storage", { id: "st", energy: 9000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep = mockAcquireCreep();
    upgraderRole.run(creep, mockContext(snap));
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("storage 流失但水位仍 > sustainedStorage*2 → 不拦截（盈余期允许流失）", () => {
    Memory.rooms.W1N1.phase = { reserve: 100000, storageEnergyPrev: 100000 } as any;
    const snap = mockSnapshot({
      storage: mockStructure("storage", { id: "st", energy: 95000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep = mockAcquireCreep();
    upgraderRole.run(creep, mockContext(snap));
    expect(creep.withdraw).toHaveBeenCalled();
  });
});
```

**边界条件**（4 用例）：

```typescript
describe("P0-4 upgrader storage 流失率门禁 — 边界条件", () => {
  it("drainRate 恰好等于 5（边界）→ 不拦截（> 才触发）", () => {
    Memory.rooms.W1N1.phase = { reserve: 10005, storageEnergyPrev: 10005 } as any;
    const snap = mockSnapshot({
      storage: mockStructure("storage", { id: "st", energy: 10000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep = mockAcquireCreep();
    upgraderRole.run(creep, mockContext(snap));
    expect(creep.withdraw).toHaveBeenCalled();
  });

  it("无 storage（RCL1-3）→ 不走流失率检查（沿用既有逻辑）", () => {
    const snap = mockSnapshot({ storage: undefined, rcl: 3 });
    const creep = mockAcquireCreep();
    expect(() => upgraderRole.run(creep, mockContext(snap))).not.toThrow();
  });

  it("phase.storageEnergyPrev 缺失（首次运行）→ drainRate=0，不拦截", () => {
    delete Memory.rooms.W1N1.phase;
    const snap = mockSnapshot({
      storage: mockStructure("storage", { id: "st", energy: 5000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep = mockAcquireCreep();
    upgraderRole.run(creep, mockContext(snap));
    expect(creep.withdraw).toHaveBeenCalled();
  });

  it("storage 水位恰好 = sustainedStorage*2 → 触发拦截（< 才放行）", () => {
    Memory.rooms.W1N1.phase = { reserve: 20000, storageEnergyPrev: 20000 } as any;
    const snap = mockSnapshot({
      storage: mockStructure("storage", { id: "st", energy: 19000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep = mockAcquireCreep();
    upgraderRole.run(creep, mockContext(snap));
    expect(creep.withdraw).not.toHaveBeenCalled();
  });
});
```

**异常情况**（3 用例）：

```typescript
describe("P0-4 upgrader storage 流失率门禁 — 异常情况", () => {
  it("storage.store 读取异常 → 退化为既有逻辑（不抛错）", () => {
    // 模拟 getUsedCapacity 抛错
  });

  it("降级风险（ticksToDowngrade < 阈值）→ 豁免流失率门禁（保级优先）", () => {
    Memory.rooms.W1N1.phase = { reserve: 10000, storageEnergyPrev: 10000 } as any;
    const ctrl = mockController({ ticksToDowngrade: 9000 });
    const snap = mockSnapshot({
      controller: ctrl,
      storage: mockStructure("storage", { id: "st", energy: 9000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep = mockAcquireCreep();
    upgraderRole.run(creep, mockContext(snap));
    expect(creep.upgradeController).toHaveBeenCalled();
  });

  it("storage 回正（drainRate 转正）→ 立即恢复取能（防残留门禁）", () => {
    // 先流失触发门禁，下一 tick storage 涨 → 恢复
  });
});
```

### 5.6 P1-1 测试用例 — `tests/unit/spawn/demand-builder-backlog.test.ts`

**正常路径**（3 用例）：

```typescript
describe("P1-1 builder backlog 信号 — 正常路径", () => {
  it("myConstructionSites.length=0 + buildQueue backlog=20 → builder 编制 ≥ 10", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      buildQueue: Array(20).fill({ state: "queued" }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000);
    const builders = requests.filter(r => r.role === "builder");
    expect(builders.length).toBeGreaterThanOrEqual(10);
  });

  it("backlog=0 + myConstructionSites.length=3 → 编制 = 3（无回归）", () => {
    const snap = mockSnapshot({
      myConstructionSites: Array(3).fill({}),
      buildQueue: [],
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000);
    expect(requests.filter(r => r.role === "builder").length).toBe(3);
  });

  it("backlog + site 同时存在 → 取 max(site, backlogWeighted)", () => {
    const snap = mockSnapshot({
      myConstructionSites: Array(2).fill({}),
      buildQueue: Array(20).fill({ state: "queued" }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000);
    expect(requests.filter(r => r.role === "builder").length).toBe(10);
  });
});
```

**边界条件**（5 用例）：

```typescript
describe("P1-1 builder backlog 信号 — 边界条件", () => {
  it("backlog 全是 done/blocked 状态 → 不计入（只算 queued）", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      buildQueue: Array(20).fill({ state: "done" }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("backlog=1 → backlogWeighted=0（向下取整）→ 不影响编制", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      buildQueue: [{ state: "queued" }],
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000);
    expect(requests.filter(r => r.role === "builder")).toHaveLength(0);
  });

  it("economyCap（harvester+worker+1）仍生效（backlog 大但采集者少）", () => {
    const creeps = [{ name: "h1", role: "harvester", home: "W1N1", ticksToLive: 1000, bodyLength: 5 }];
    const snap = mockSnapshot({
      myConstructionSites: [],
      buildQueue: Array(20).fill({ state: "queued" }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", creeps, [], normalCtx(), 1000);
    expect(requests.filter(r => r.role === "builder").length).toBeLessThanOrEqual(2);
  });

  it("buildQueue 字段缺失（undefined）→ 不计入 backlog（防抛错）", () => {
    const snap = mockSnapshot({ myConstructionSites: [], buildQueue: undefined });
    expect(() => evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000)).not.toThrow();
  });

  it("colonyState=recovery → builder 仍可扩编（灾后重建是生存行为）", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      buildQueue: Array(20).fill({ state: "queued" }),
    });
    const { requests } = evaluateDemand(snap, [], "recovery", livingHarvester(), [], { ...normalCtx(), colonyState: "recovery" }, 1000);
    const builders = requests.filter(r => r.role === "builder");
    expect(builders.length).toBeGreaterThan(0);
    expect(builders[0]!.priority).toBe(1);
  });
});
```

**异常情况**（2 用例）：

```typescript
describe("P1-1 builder backlog 信号 — 异常情况", () => {
  it("buildQueue 元素 state 字段异常 → 跳过该元素不抛错", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      buildQueue: [{ state: "invalid" }, { state: "queued" }, {}],
    });
    expect(() => evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000)).not.toThrow();
  });

  it("backlog 巨大（1000）→ 仍受 maxCount 钳制（防过度扩编）", () => {
    const snap = mockSnapshot({
      myConstructionSites: [],
      buildQueue: Array(1000).fill({ state: "queued" }),
    });
    const { requests } = evaluateDemand(snap, [], "normal", livingHarvester(), [], normalCtx(), 1000);
    const builderConfig = getRoleBounds("builder", "W1N1");
    expect(requests.filter(r => r.role === "builder").length).toBeLessThanOrEqual(builderConfig.maxCount);
  });
});
```

### 5.7 P1-2 测试用例 — `tests/unit/economy/tuning-src-ratio-unfreeze.test.ts`

**正常路径**（3 用例）：

```typescript
describe("P1-2 tuning srcRatio 解冻 — 正常路径", () => {
  it("srcRatio > 0.9 持续 50 tick + frozen harvester.maxCount → 强制解冻", () => {
    // setup: frozenParams.harvester.maxCount = { frozenUntil: far future }
    // run tuning with srcRatio=0.95 持续 50 tick
    // expect: frozenParams.harvester.maxCount 被删除
    // expect: excludedParams 不含 harvester.maxCount
  });

  it("srcRatio < 0.9 → 不解冻（保留 frozen 状态）", () => {
    // 验证无回归
  });

  it("解冻后 evaluateTuning 可对 harvester.maxCount 产出调整", () => {
    // 解冻后下一 tick 评估应能产出 adjustment
  });
});
```

**边界条件**（4 用例）：

```typescript
describe("P1-2 tuning srcRatio 解冻 — 边界条件", () => {
  it("srcRatio=0.91（边界 > 0.9）+ 持续 50 tick → 触发解冻", () => {});
  it("srcRatio 持续 49 tick（未达 50）→ 不解冻", () => {});
  it("只解冻 harvester/hauler maxCount，不解冻 minCount（防振荡）", () => {});
  it("srcRatio 持续满载但 frozenParams 不含关键参数 → 无副作用", () => {});
});
```

**异常情况**（3 用例）：

```typescript
describe("P1-2 tuning srcRatio 解冻 — 异常情况", () => {
  it("frozenParams 字段类型异常 → 安全跳过不抛错", () => {});
  it("解冻后 evaluateTuning 抛错 → 不影响下 tick（safeRun 隔离）", () => {});
  it("解冻后参数立即被再次冻结（连续回滚）→ 100 tick 冷却不再解冻（防振荡）", () => {});
});
```

### 5.8 测试实施注意事项

1. **测试先于实现**：每条修复先写失败测试（TDD），验证测试本身能捕获病灶，再实施修复让测试转绿。
2. **Memory 隔离**：所有测试用 `beforeEach` 重置 `globalThis.Memory`，防跨用例污染（参考现有 `tests/unit/systems/room-state.test.ts` 模式）。
3. **mock 边界**：domain 纯函数测试不 mock Game，只传对象；systems 层测试 mock Game.rooms 等最小必要 API。
4. **回归保护**：每条新测试文件对应运行既有 `tests/unit/economy/phase.test.ts` / `tests/unit/role/upgrader.test.ts` / `tests/unit/spawn/demand.test.ts` / `tests/unit/remote/room-ready-gate.test.ts`，确保无回归。
5. **覆盖率门槛**：每条修复对应代码分支覆盖率 ≥ 80%（项目既有 `npm test` 标准）。

---

## 六、实施顺序与依赖

```
P0-1 (colonyState srcRatio)      ← 病灶 1，根因
  ↓ 解锁
P0-2 (远矿 crisis 暂停)           ← 病灶 2，依赖 colonyState 准确
P0-3 (spawn churn 熔断)           ← 病灶 3，独立
P0-4 (upgrader 流失率门禁)        ← 病灶 4，独立

P1-1 (builder backlog)            ← 病灶 5，独立
P1-2 (tuning srcRatio 解冻)       ← 病灶 6，依赖 P0-1 信号
P1-3 (defense 调查)               ← 病灶 7，独立

P2-* 长期架构修复
```

**P0 四项可并行开发，互不依赖**；P0-1 是根因修复，其他三项在 P0-1 上线后效果放大。

### 6.1 实施步骤（TDD 顺序）

1. **P0-1 测试先行**
   - 创建 `tests/unit/economy/phase-src-ratio.test.ts`，写 12 个用例
   - 运行 `npm run test:unit -- phase-src-ratio` 确认全红（测试本身能编译）
   - 修改 `src/domain/economy/phase.ts` + `src/systems/room-state.ts`
   - 运行测试至全绿
   - 运行 `npm run typecheck` + 既有 `phase.test.ts` 确认无回归

2. **P0-2 ~ P0-4 并行实施**
   - 各自创建测试文件
   - TDD 流程同上

3. **P0 全部上线后观察 1 个私服周期**
   - 验证指标见各修复项
   - 无回归后进入 P1

4. **P1-1 / P1-2 / P1-3 并行实施**
   - P1-2 依赖 P0-1 的 `srcStallTicks` 字段，需在 P0-1 上线后实施

5. **P2 长期架构修复**
   - 在 P0 + P1 稳定后规划

---

## 七、回滚总策略

### 7.1 Memory flag 热切换

每条改动通过 Memory flag 控制，可在线热切换：

```typescript
// 实施时增加 flag 检查
if (Memory.kernel?.fixes?.p0_1_srcRatio !== false) {
  // P0-1 逻辑
}
```

上线时默认 `undefined`（视为启用）；回归时设置 `Memory.kernel.fixes.p0_1_srcRatio = false` 即可关闭单条修复。

### 7.2 回滚决策树

```
观察异常
  ├─ 单一修复引入 → 关闭对应 flag
  ├─ 多修复交互 → 按 P0-3 → P0-4 → P0-2 → P0-1 顺序逐项关闭
  └─ 全局回归 → 关闭所有 P0/P1 flag，回到修复前状态
```

### 7.3 观察窗口

- **P0 上线后**：观察 1 个私服周期（约 5000 tick）
- **P1 上线后**：观察 2 个私服周期（约 10000 tick）
- **回归指标**：
  - colonyState 误判率 < 5%
  - spawn churn 次数 / 单位时间下降 ≥ 70%
  - storage 流失率 ≤ 2 E/tick
  - 既有 `npm test` 全绿

### 7.4 文档维护

本文档（`docs/postmortem-2026-08-02-private-snapshot.md`）随实施进度更新：

- 每条修复实施完成后，在对应章节标记 `[已实施 yyyy-mm-dd]`
- 观察期结束后，记录实际验证指标
- 长期修复（P2）规划完成后，将 P0/P1 内容归档至 `docs/remediation-plan-2026-08.md`

---

## 附录 A：相关文件清单

### 修改文件（P0/P1）

| 文件 | 修复项 | 修改内容 |
|---|---|---|
| `src/domain/economy/phase.ts` | P0-1 | PhaseInput/PhaseState/PhaseOptions 扩展 + 强制 crisis 通道 |
| `src/systems/room-state.ts` | P0-1 | srcRatio + storageDrainRate 信号采集 |
| `src/types/global.d.ts` | P0-1, P0-3 | RoomMemory.phase.storageEnergyPrev + RoomMemory.churnFreezeUntil |
| `src/systems/remote-mining-manager.ts` | P0-2 | crisis 时跳过 evaluateRemoteDemand |
| `src/systems/spawn-manager.ts` | P0-3 | harvester 短冷却隔离 + churn 熔断 |
| `src/domain/spawn/demand.ts` | P0-3, P1-1 | churnFreezeUntil 跳过 + builder backlog |
| `src/creeps/roles/upgrader.ts` | P0-4 | dynamicStorageLimit 流失率检查 |
| `src/config/index.ts` | P0-4 | drainRateLimit 配置 |
| `src/systems/tuning-engine.ts` | P1-2 | srcRatio 信号 + 强制解冻 |

### 新增测试文件

| 文件 | 修复项 | 用例数 |
|---|---|---|
| `tests/unit/economy/phase-src-ratio.test.ts` | P0-1 | 12 |
| `tests/unit/systems/room-state-src-ratio.test.ts` | P0-1 | 3 |
| `tests/unit/remote/crisis-pause.test.ts` | P0-2 | 10 |
| `tests/unit/spawn/churn-circuit-breaker.test.ts` | P0-3 | 13 |
| `tests/unit/role/upgrader-drain-rate.test.ts` | P0-4 | 10 |
| `tests/unit/spawn/demand-builder-backlog.test.ts` | P1-1 | 10 |
| `tests/unit/economy/tuning-src-ratio-unfreeze.test.ts` | P1-2 | 10 |

### 既有测试回归保护

- `tests/unit/economy/phase.test.ts`
- `tests/unit/systems/room-state.test.ts`
- `tests/unit/role/upgrader.test.ts`
- `tests/unit/spawn/demand.test.ts`
- `tests/unit/remote/room-ready-gate.test.ts`
- `tests/integration/scenarios/rcl1-survival.test.ts`
- `tests/integration/scenarios/live-anomaly-reproduction.test.ts`

---

## 附录 B：质量门槛

实施完成后，合并前必须全绿：

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run（全部）
npm run build       # rollup -c
```

见 `AGENTS.md`「合并前质量门槛」与 `docs/plan.md §8`「质量门槛」。
