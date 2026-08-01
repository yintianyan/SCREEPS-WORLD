# Tuning Engine 改进设计文档

> 状态：已实现并提交（de0d2d3，2026-08-01）— A 方案完整版（pending-lock + verifyDelay
> + 人口合同 TTL + 下调护栏 + 冻结复位 + event-log 审计）+ v20 迁移 + 28 个测试已落地。
> 附录 E.2 的 P1-P4 已全部修复（代码考古确认，状态见 E.2 表）；P5 文档同步本次完成。
> 架构评审已并入（附录 D）：A 的验证语义按 D.2-D.5 修正后实施；文档一致性按 D.6 统一；
> 改进 D 范围按 D.7 收窄。
> 观察期已完成（tick 1623282→1676531，53249 tick），W8N3 `builder.maxCount` 振荡 1 次
> → 触发完整版 A。P1/P2/P3 设计方案见 §3.1.6-3.1.8（附录 B-P1/P2/P3 已修）。
> 触发场景：调参状态实证分析发现 tuning 已陷入「棘轮式锁死」状态，需在动手改代码前确认设计方向。
> 关联代码：[src/systems/tuning-engine.ts](../src/systems/tuning-engine.ts)、[src/domain/tuning/evaluator.ts](../src/domain/tuning/evaluator.ts)、[src/domain/tuning/bounds.ts](../src/domain/tuning/bounds.ts)、[src/domain/tuning/types.ts](../src/domain/tuning/types.ts)、[src/config/tuned.ts](../src/config/tuned.ts)
> 关联 plan.md 小节：§3.4 版本化 Memory、§2.3 数据所有权、§5.1 角色硬约束、§9 风险与应对

---

## 0. 收益边界声明（防误判 tuning 无效）

**本期修复（B+C）的成功标准**：
1. `roleBounds` 偏离 CONFIG 基线 ≤ 1（probe-tuning.js 实测，50000 tick 内回归基线附近）。
2. `lastEval.signals` 与调整决策一致（如 W8N3 storage=32 万应触发 upgrader 上调 desired=up）。
3. `lastEval.adjustments` 在合理场景下产出非空（W8N3 应在 1-2 个评估周期内触发 upgrader.maxCount 3→4）。

**B+C 不解决（需独立诊断，不归因 tuning）**：
- **spawn demand 排队问题**：W7N3/W7N4 RCL7 房 harvester=2-3、upgrader=1 — 实际人口 < CONFIG maxCount，但 spawn queue 未排队（colonyState / skipReasons / demand 逻辑问题）。
- **colonyState 与 skipReasons 矛盾**（handoff 提到 `creep/upgrader/colony-state` 跳过 112 次但 colonyState=normal）。
- **远矿能量流错配**（W8N2 → W8N3 过剩房收远矿）。

**关键防误判**：B+C 上线后，即使 roleBounds 回归基线，**实际人口不会自动增加**（spawn demand 仍未排队）。若以「人口是否变多」判断 B+C 成功，会误判 tuning 无效。判定必须用上述 3 条指标。

---

## 1. 背景与问题陈述

### 1.1 实测状态（私服 tick=1578870，CPU=100，healthy 档，3 claimed 房）

| 房间 | RCL | storage | hauler.max 覆盖 | upgrader.max 覆盖 | builder.max 覆盖 | 上次 hauler.max 调整距今 |
|---|---|---|---|---|---|---|
| W7N3 | 7 | 2964（饥饿） | 6→**2** | 3→**1** | 4→**1** | 1003604 tick |
| W7N4 | 7 | 9057（低位） | 6→**2** | 3→**1** | 4→3 | 771104 tick |
| W8N3 | 5 | 329153（过剩） | 6→**2** | 3→3 | 4→**1** | 94604 tick |

`hauler.maxCount` 在三房一致被压到 `TUNING_BOUNDS` 硬下限 2，最早一次调整在 100 万 tick 前，**至今未恢复**。最近一次评估（tick=1578766）三个房全部产出 0 个 adjustment、trend 全为 none — tuning 当前在空转，但过去的错误覆盖值仍在生效。

### 1.2 根因分析（4 个独立缺陷）

**缺陷 A：调整效果无闭环、无回滚（最高优先级）**

`lastAdjusted` 只记录调整时的 tick 用于冷却计算，**不记录调整前的 signals 基线、不在冷却后验证效果、不回滚**。后果：任何瞬态信号触发的下调会永久锁定，没有反向恢复路径。

实测证据：W7N4 在 77 万 tick 前下调 `hauler.max=2`，至今 77 万 tick（约 175 游戏日）未恢复 — 因为恢复条件（上调门禁）当前**永久不成立**（见缺陷 B）。

**缺陷 B：上调门禁用错信号**

[evaluator.ts:164-173](../src/domain/tuning/evaluator.ts#L164-L173) `hauler.maxCount` 上调条件之一是 `spawnFillRatio < SPAWN_SATURATED(0.8)`。但实测三房 `spawnFillRatio` = 0.89 / 0.95 / 0.98 — distributor 职责本就是维持 spawn+ext 满载，**这条门禁在正常态下永远成立**，等于「distributor 在工作时永远禁止加 hauler」。

设计意图（避免「container 满但 spawn 已饱和时加 hauler 无益」）是对的，但用错了代理变量：`spawnFillRatio` 是 hauler/distributor 的**输出结果**而非**消费端真实需求**。spawn 满载可能因为：(1) spawn 在孵化消耗 / (2) spawn 不孵化但 distributor 维持满 / (3) source 产能 >> spawn 容量无去处。三种情况对 hauler 需求完全不同，不能用同一阈值区分。

**缺陷 C：阈值未按 RCL / phase 分级**

[evaluator.ts:67-69](../src/domain/tuning/evaluator.ts#L67-L69) `STORAGE_SURPLUS=50000`、`STORAGE_LOW=10000` 是全局常量。但 RCL5 房（W8N3）storage 32 万 = 6 倍 SURPLUS，本应上调 `upgrader.maxCount` 燃烧库存冲 RCL6；RCL7 房（W7N3）storage 2964 = 0.3 倍 LOW，本应继续压制 — 当前同一套阈值无法区分这两种状态。

**缺陷 D：长期基线未参与决策**

`economy ring buffer` 容量 300 采样 × 50 tick = 15000 tick，但 `EVAL_WINDOW_SIZE=20` 只用最近 1000 tick（1/15）。短期窗口对季节性波动（远矿车队往返、市场周期、Builder 周期）过敏，可能因瞬态触发调整后无法自愈。

### 1.3 附带发现：部署滞后

`Memory.kernel.tuning.baselineVersion = undefined`（CONFIG 是 1）。按 [tuning-engine.ts:66-75](../src/systems/tuning-engine.ts#L66-L75) 的检查，`undefined !== 1` 应触发清空 rooms，但实测 rooms 未被清空。唯一合理解释：私服上跑的 bundle 不含 P1-I 修复代码（v18 迁移引入），需重新构建上传。**本设计文档假设该问题会在下次部署时自愈，不单独处理。**

---

## 2. 设计目标

### 2.1 做什么

- **A 闭环**：调整后 1 个完整评估窗口验证效果，未改善或反向恶化 → 自动回滚。
- **B 门禁修正**：把 `hauler.maxCount` 上调门禁从 `spawnFillRatio < 0.8` 改为反映「消费端真实无去处」的双信号组合。
- **C RCL 分级**：storage 阈值按 RCL 分档，让不同发展阶段的房间用不同标准。
- **D 长期基线**：新增 10000 tick 长期均值作为「期望稳态」，调整目标改为「短期回归长期」。

### 2.2 不做什么（防止 scope 蔓延）

- 不改 `evalInterval`(500) / `cooldownTicks`(1000) / `EVAL_WINDOW_SIZE`(20) — 数据规模已足够，问题在用法不在量。
- 不引入机器学习 / 模型预测 — 简单规则 + 闭环验证已能覆盖当前缺陷。
- 不改 `TUNABLE_ROLES` 全集（13 角色）— evaluator 仍只对前 4 角色产出调整。
- 不改 `tuned.ts` 的 `getRoleBounds` 接口 — 消费者无感。
- 不做跨房相关性分析（如「A 房 hauler 过剩可调度给 B 房」）— 远超本期范围。

---

## 3. 改进设计

### 3.1 改进 A：调整效果闭环 + 回滚机制（P1）

#### 3.1.1 数据结构变更

在 [types.ts](../src/domain/tuning/types.ts) 的 `RoomTuningState` 新增字段：

```typescript
export interface RoomTuningState {
  roleBounds: Record<string, RoleBoundsOverride>;
  lastAdjusted: Record<string, number>;
  lastTrend?: Record<string, TrendDirection>;

  /** 改进 A 新增：调整效果验证闭环。
   * 每个参数路径记录调整时的 signals 快照与可验证的「期望改善方向」。
   * - 调整触发时写入：preAdjustSignals + expectedDirection + adjustTick
   * - 冷却到期后第一次评估时验证：若 signals 未按 expectedDirection 改善 → 回滚
   * - 验证完成后清空此字段（无论回滚与否，闭环结束）
   * - 同一参数若再次触发调整，覆盖旧记录（前一次闭环未验证就被新调整覆盖，
   *   说明新信号足够强 — 接受覆盖并重新开始闭环）
   * - 评审修正（附录 D.2）：pending 存在期间该参数禁止再次调整（pending-lock），
   *   覆盖旧记录语义作废 — 否则第一次调整永远不被验证，闭环只审最后一步。
   */
  pendingValidation?: Record<string, {
    /** 调整前的 signals 快照（仅记本参数相关的子集，控体积） */
    preAdjustSignals: AdjustSignalsSnapshot;
    /** 期望的改善方向："improve"=希望变好 / "worsen"=主动恶化（如节能下调） */
    expectedDirection: "improve" | "worsen";
    /** 调整时的 tick（= lastAdjusted[param]） */
    adjustTick: number;
    /** 调整前的值（用于回滚） */
    preAdjustValue: number;
  }>;
}

/** 闭环验证用的信号子集 — 只记与该参数相关的字段，控制 Memory 体积。
 * 设计原则：每个参数只验证它当时触发调整所依据的 1-2 个核心信号，
 * 不验证全部 signals（避免噪声 + 控体积）。 */
interface AdjustSignalsSnapshot {
  // hauler.maxCount/minCount 验证 container 填充率
  containerFillRatio?: number;
  // harvester.maxCount 验证 reserveDelta
  avgReserveDelta?: number;
  // upgrader.maxCount 验证 storageEnergy（主动恶化时希望 storage 上升）
  avgStorageEnergy?: number;
  // builder.maxCount 验证 buildQueueBacklog
  buildQueueBacklog?: number;
}
```

#### 3.1.2 算法伪代码

evaluator 入口在调用各角色评估函数前，先对每个有 `pendingValidation` 的参数做验证 pass：

```
function verifyPendingAdjustments(
  signals: TuningSignals,
  pending: Record<param, PendingValidation>,
  lastAdjusted: Record<param, tick>,
  currentTick: tick,
  bounds: Record<role, {min, max}>,
): {
  rollbacks: TuningAdjustment[];    // 需要回滚的调整
  clearedParams: string[];          // 验证完成、清空 pending 的参数
} {
  for each param in pending:
    // 冷却未到期 — 还没到验证时机
    if (currentTick - lastAdjusted[param] < TUNING_BOUNDS[param].cooldownTicks) continue;

    const pv = pending[param];
    const actual = pickSignal(signals, param);   // 取当前对应信号
    const before = pickSignal(pv.preAdjustSignals, param);
    const delta = actual - before;

    // 判断是否改善：
    //   expectedDirection="improve" → 信号应朝「好」方向移动（如 containerFillRatio 上升）
    //   expectedDirection="worsen" → 信号应朝「主动恶化」方向移动（如 storage 下降=节能生效）
    const improved = isImproved(param, delta, pv.expectedDirection);

    if (!improved) {
      // 回滚到 preAdjustValue，并清空 pendingValidation
      rollbacks.push({param, oldValue: current, newValue: pv.preAdjustValue,
        reason: `Effect verification failed: ${param} signal delta=${delta}, expected=${pv.expectedDirection}`});
    }
    clearedParams.push(param);  // 无论是否回滚，闭环结束
  return {rollbacks, clearedParams};
}
```

`isImproved` 的判定方向表（每个参数的「改善方向」）：

| 参数 | 触发上调时 expectedDirection | 触发下调时 expectedDirection | 改善判定（improve） | 改善判定（worsen，主动恶化） |
|---|---|---|---|---|
| hauler.maxCount | improve | improve | containerFillRatio ↓（hauler 增加应让 container 不那么满） | containerFillRatio ↑（hauler 减少应让 container 更满） |
| hauler.minCount | improve | improve | containerFillRatio ↓ | containerFillRatio ↑ |
| harvester.maxCount | improve | worsen | avgReserveDelta ↑（恢复储备） | avgReserveDelta ↓（主动节能） |
| upgrader.maxCount | improve | worsen | avgStorageEnergy ↓（烧库存） | avgStorageEnergy ↑（攒库存） |
| builder.maxCount | improve | worsen | buildQueueBacklog ↓ | buildQueueBacklog ↑ |

#### 3.1.3 触发与集成点

- **验证 pass** 在 [tuning-engine.ts:safeRunTuning](../src/systems/tuning-engine.ts#L112) 内、`evaluateTuning` 调用**之前**执行；产出的 rollbacks 先应用到 Memory，再进入新一轮 `evaluateTuning` 评估。
- **写入 pendingValidation** 在 [evaluator.ts:confirmAndBuild](../src/domain/tuning/evaluator.ts#L390) 触发调整时 — evaluator 需要接收 `preAdjustSignals` 子集作为额外输入（由调用方构造）。
- **清空 pendingValidation** 在验证 pass 完成后由 tuning-engine 写回 Memory。

#### 3.1.4 边界与防呆

- 同一参数若 `pendingValidation` 存在但 `lastAdjusted` 显示尚未过冷却 → 跳过验证（数据竞争或异常）。
- 若 `preAdjustSignals` 字段缺失（旧版数据迁移过来）→ 不验证，直接清空 pending。
- 若回滚后参数值超出 `TUNING_BOUNDS` → `clampParam` 兜底（不应发生，preAdjustValue 本就合法）。
- 回滚也走 `lastAdjusted[param] = currentTick` — **回滚本身算一次调整，触发 1000 tick 冷却**。这避免「回滚 → 立刻又被下调」的振荡。

---

### 3.1.5 完整版 A 触发依据（观察期 tick 1623282→1676531，53249 tick）

B+C 上线后观察期出现 W8N3 `builder.maxCount` 振荡 1 次：

- 下调 @1653766（backlog 归零触发）
- 上调 @1666766（backlog=13 + builderCount>=current 触发，回滚）
- 下调 @1668266（backlog=0 触发，同方向再调整）
- 回滚→同方向再调整间隔 1500 tick

按附录 C.2 矩阵第 5 行 → **上完整版 A**（P1 + P2 + P3）。

根因 [事实]：`buildQueueBacklog` 是瞬态信号（建筑完成即归零），[evaluator.ts:360-378](../src/domain/tuning/evaluator.ts#L360-L378) 上/下调信号不对称（上调需 backlog>3，下调仅需 backlog===0），中间地带静默。冷却期 1000 tick < 振荡间隔 1500 tick，无法阻止。

### 3.1.6 P1：verifyDelay 验证窗口匹配（附录 B-P1 修复）

`TUNING_BOUNDS` 新增 `verifyDelay` 字段，验证 pass 据此判断时机（非 `cooldownTicks`）：

```typescript
export interface ParamBounds {
  floor: number; ceiling: number; step: number;
  cooldownTicks: number;
  verifyDelay: number;  // P1：效果显现最小 tick
}
```

标定依据（附录 B-P1 因果链分类）：所有可调参数都是「人口类」——调整后需等 creep 孵化(~150 tick) + 老 creep 死亡(CREEP_LIFE_TIME 部分) + 效果在遥测窗口显现(500 tick)。取 verifyDelay=1500 tick = 3 个评估周期，确保效果在 EVAL_WINDOW_SIZE(1000 tick) 窗口内充分显现。

振荡间隔实测 1500 tick = cooldown(1000)+评估间隔(500)，verifyDelay=1500 使验证 pass 在反向调整竞态发生前抢先回滚。

所有参数 verifyDelay 统一 1500（无立即生效类参数）。

评审修正（附录 D.2）：verifyDelay=1500 必须配合 pending-lock 才成立 —
trend 在 pending 期间若继续积累，反向调整最早可在 T+1000（冷却到期 +
2 次同向确认）触发，早于或与验证同 tick 落点；pending 期间该参数
从 evals 排除（含 trend），验证完成后再重新积累。

验证 pass 集成点：[tuning-engine.ts:safeRunTuning](../src/systems/tuning-engine.ts#L112) 内、`evaluateTuning` 调用**之前**。

### 3.1.7 P2：多信号验证（附录 B-P2 修复）

`isImproved` 改为多信号 OR 判定：每个参数定义「改善证据集」，任一满足即算改善，避免单瞬态信号（如 backlog 归零）误回滚。

| 参数 | 上调验证（improve） | 下调验证（worsen） |
|---|---|---|
| hauler.max/min | containerFillRatio ↓ OR spawnFillRatio ↑（能量再分配证据） | containerFillRatio ↑ |
| harvester.max | avgReserveDelta ↑（止跌回升） | avgReserveDelta ↓（主动节能） |
| upgrader.max | avgStorageEnergy ↓（烧库存） | avgStorageEnergy ↑（攒库存） |
| builder.max | buildQueueBacklog ↓ OR **builderCount >= preAdjustValue+1**（人口到位即生效） | buildQueueBacklog ↑ |

**builder.max 关键修复**：backlog 归零不一定是 builder 无效，可能是建筑完成。新增 `builderCount 达新 max` 作为改善证据——上调后人口到位即算生效，不因 backlog 归零误回滚。

容差双门限（附录 9.2-1）：`max(5% 相对, 0.05 绝对)`，防低基数失效（container=0.1 时 5%=0.005）。

`AdjustSignalsSnapshot` 扩展新增 `spawnFillRatio`、`roleCount` 字段。

### 3.1.8 P3：冻结机制（附录 B-P3 修复）

`RoomTuningState.frozenParams` 新增字段。连续 3 次回滚 → 冻结该参数，评估跳过，console.log 告警。

```typescript
export interface FrozenParamState {
  frozenAt: number;
  frozenUntil: number;  // frozenAt + FROZEN_DURATION
  reason: string;
  rollbackCount: number;  // 解冻后保留，用于再次冻结判定
}
```

- `ROLLBACK_FREEZE_THRESHOLD = 3`
- `FROZEN_DURATION = 10000` tick（~2 个完整振荡周期，让信号稳定）
- 到期自动解冻；CLI 可手动解冻（运维介入兜底）
- 冻结参数从 evaluator 的 evals 列表移除，跳过评估

评审修正（附录 D.5）：冻结只停评估不停值 — 冻结时参数**复位到 CONFIG 基线**
（或最近一次验证通过的值），避免「振荡结束停在错误值被钉 10000 tick」；
冻结事件写 event-log（新增 EventKind），console.log 降级为运维提醒。

### 3.1.9 回滚豁免（附录 9.2-2）

回滚触发冷却（防振荡），但允许「明显反向」豁免：条件 `信号超原阈值 2x AND 距回滚 >= verifyDelay/2`。防「调错→回滚→1000 tick 不能修」死锁，同时防「刚回滚就再调」振荡。

### 3.1.10 集成流程（safeRunTuning 改造）

```
1. aggregateSignals → signals
2. getOrCreateRoomTuning → roomTuning
2.5 [A] pending-lock（附录 D.2）：pending 参数从 evals 排除（含 trend），验证完成前不评估
3. [A] verifyPendingAdjustments(signals, roomTuning, tick)  ← verifyDelay 时机 + P2 多信号
   → rollbacks[], clearedParams[]
3.5 [A] 人口合同前置（附录 D.3）：roleCount 未达新边界 → 标 pending-blocked 下周期复验，不计失败
3.6 [A] 下调护栏（附录 D.4）：主信号方向 + spawnFill/reserve 护栏，护栏触发即回滚
3.7 [A] 全局门禁（附录 E-P3，待实现）：危机/低 bucket（tier≥2、crisisRatio>0.3、rcl<2）
    期间跳过验证，pending 保留下周期复验 — 防外生信号暴跌误回滚、误冻结
4. [A] applyFreezePolicy(roomTuning, rollbacks, tick)  ← P3 冻结
   → frozenParams[], thawedParams[]
5. 应用 rollbacks 到 Memory（lastAdjusted=tick，触发冷却）
6. 清空 clearedParams 的 pendingValidation
7. [A] 过滤冻结参数：evals = filterFrozenParams(evals, frozenParams)
8. evaluateTuning(signals, bounds, lastAdjusted, tick, prevTrend)
   → confirmAndBuild 触发调整时返回 pendingValidation 写入指令
9. 应用 evaluation.adjustments + 写 pendingValidation
10. 保存 lastTrend + lastEval 诊断（含 pendingValidation/frozenParams 状态）
```

[evaluator.ts:confirmAndBuild](../src/domain/tuning/evaluator.ts#L401) 签名扩展（最小侵入）：新增 `signals` 参数，触发调整时返回 `pendingValidation` 写入指令，由 tuning-engine 落 Memory。

### 3.1.11 v20 迁移（schemaVersion 升级）

- `CONFIG.tuning.baselineVersion` 升至 2（触发 rooms 清空，从新基线收敛）
- 迁移建档：`pendingValidation`/`frozenParams` 缺失即 undefined（懒创建）
- 自愈：脏数据清理 + `expectedDirection` 枚举校验（附录 B-P5 修复）
- 幂等：仅畸形数据自愈，不写字段值
- 迁移测试：空 Memory / 脏 pendingValidation / 枚举校验 / 重复执行

### 3.1.12 上线后验证（附录 C.3）

- A 上线后重新观察 ≥50000 tick
- 监控点：pendingValidation 产出频率、回滚次数、冻结事件、振荡是否消失
- 回滚阈值：若 A 上线后振荡仍出现 ≥1 次 → 立即回滚 A，重设计
- CPU 增量 <0.1 CPU/run（验证 pass O(1) 比较 + 冻结检查 O(1)）

---

### 3.2 改进 B：上调门禁修正（P1）

#### 3.2.1 设计决策（推荐方案）

把 [evaluator.ts:164-173](../src/domain/tuning/evaluator.ts#L164-L173) `hauler.maxCount` 上调条件中的 `spawnFillRatio < 0.8` 替换为「**消费端无去处**」的双信号组合：

```typescript
// 改进 B：用「container 满 + storage 也在涨」识别消费端真实无去处
// 替代 spawnFillRatio < 0.8 永久不满足的门禁
// 协同点：storage 阈值用改进 C 的 getStorageThresholds(s.rcl).surplus（按 RCL 分级），
//         不能用全局 STORAGE_SURPLUS 常量 — 否则 B 与 C 割裂
const storageSurplus = getStorageThresholds(s.rcl).surplus;
const consumerSaturated =
  s.containerFillRatio > CONTAINER_HIGH &&              // source 端在堆积
  s.avgStorageEnergy > storageSurplus &&                // storage 也已盈余（按 RCL 分级）
  s.avgReserveDelta > 0;                                // 储备仍在涨（无处可去的净证据）

// 上调条件改为：
if (
  s.containerFillRatio > CONTAINER_HIGH &&
  s.haulerCount >= current &&
  economyHealthy &&
  !consumerSaturated &&  // 替代 spawnFillRatio < 0.8
  current < boundsDef.ceiling
) { ... }
```

#### 3.2.2 为什么这样改（方案对比）

| 方案 | 描述 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|---|
| **A：移除门禁** | 删除 spawnFillRatio 条件，仅保留 container+hauler+经济三条件 | 简单 | 容易在 spawn 真饱和时多加 hauler（hauler 跑空） | ✗ |
| **B：用 spawnFillRatio > 阈值 反向** | 改为 `spawnFillRatio > 0.95`（spawn 满载）才允许加 | 反映「消费端被喂饱」 | 与 distributor 职责重复，仍是终点状态 | ✗ |
| **C：storage + container 双信号（推荐）** | container 满 + storage 盈余 + 储备在涨 = 真无去处 | 直接证据，避免 spawn 噪声 | 新增 3 个条件组合，需测试 | **✓** |
| **D：测 hauler 实际空闲率** | 跟踪 hauler 是否空跑 | 直接 | 需新增遥测字段，工作量大 | ✗（远期） |

推荐 C：用「container 满 **且** storage 也在涨」作为「消费端无去处」的代理 — 这是真正的 source 端产出过剩证据，不依赖 distributor 行为的副作用。

#### 3.2.3 一致性同步

`hauler.minCount` 的上调条件（[evaluator.ts:209-217](../src/domain/tuning/evaluator.ts#L209-L217)）也含 `economyHealthy` 但**不含** spawnFillRatio，无需改。但为了一致性，可考虑给 `hauler.minCount` 上调也加 `!consumerSaturated`（防止「min 上调 → max 不上调 → 死锁」）。**推荐加，因为 min 和 max 应共享同一消费端约束**。

其他角色（harvester/upgrader/builder）的上调条件**不含 spawnFillRatio**，无需改。

---

### 3.3 改进 C：阈值按 RCL 分级（P2）

#### 3.3.1 设计

把 [evaluator.ts:67-69](../src/domain/tuning/evaluator.ts#L67-L69) 的全局 storage 阈值改为按 RCL 分档：

```typescript
// 改进 C：storage 阈值按 RCL 分级（百分比参数化）
// 设计依据：storage 容量固定 STORAGE_CAPACITY=1,000,000（[事实] 官方常量）。
// 不同 RCL 阶段 storage 角色不同 — RCL5 房 5 万库存是「过剩」可烧库存冲 RCL6；
// RCL7 房 5 万库存是「正常发展储备」，烧了反而阻碍冲 RCL8。
// 百分比参数化的真正收益不是「数值更准」（百分比 = 绝对值/10000，本质等价），
// 而是「文档自解释 + 跨 RCL 容量不变时无 magic number」。
const STORAGE_CAPACITY = 1_000_000;  // [事实] 官方常量
const STORAGE_THRESHOLDS_BY_RCL: Readonly<Record<rclBucket, {
  surplusPct: number;  // 触发上调的阈值（占 STORAGE_CAPACITY 百分比）
  lowPct: number;      // 触发下调的阈值
}>> = {
  early: { surplusPct: 0.02, lowPct: 0.002 },  // RCL ≤ 4：surplus=2万 / low=2千
  mid:   { surplusPct: 0.05, lowPct: 0.01 },  // RCL 5-6：surplus=5万 / low=1万（保持当前默认值）
  late:  { surplusPct: 0.25, lowPct: 0.05 }, // RCL 7-8：surplus=25万 / low=5万（贴近 W8N3 实测 32万）
};

function getStorageThresholds(rcl: number): { surplus: number; low: number } {
  const bucket = rcl <= 4 ? "early" : rcl <= 6 ? "mid" : "late";
  const t = STORAGE_THRESHOLDS_BY_RCL[bucket];
  return { surplus: t.surplusPct * STORAGE_CAPACITY, low: t.lowPct * STORAGE_CAPACITY };
}
```

#### 3.3.2 影响范围

- `evaluateUpgraderMaxCount` 用 `getStorageThresholds(s.rcl).surplus` 替代 `STORAGE_SURPLUS` 常量。
- 改进 B 的 `consumerSaturated` 中 `s.avgStorageEnergy > STORAGE_SURPLUS` 也改为按 RCL 取阈值。
- 改进 A 的 `isImproved` 验证 `avgStorageEnergy` 改善时，判定阈值也用对应 RCL 档。

#### 3.3.3 边界

- RCL 在评估窗口内可能跨档（如 RCL5→6），但 `signals.rcl` 是当前快照值，单次评估用当前 RCL 的阈值即可 — 跨档带来的瞬态不连续可接受。
- `STORAGE_THRESHOLDS_BY_RCL` 应放在 [bounds.ts](../src/domain/tuning/bounds.ts)（纯数据模块），与 `TUNING_BOUNDS` 同处管理，便于测试。

---

### 3.4 改进 D：长期基线对比（P3）

#### 3.4.1 设计

在 [tuning-engine.ts:aggregateSignals](../src/systems/tuning-engine.ts#L176) 中新增长期基线计算：

```typescript
// 改进 D：长期基线 — 最近 10000 tick（200 个 economy 采样）的均值
// 用于识别「短期波动」vs「结构性变化」
const LONGTERM_WINDOW_SIZE = 200;  // 200 采样 × 50 tick = 10000 tick

function computeLongTermBaseline(allEconomy: EconomySample[], roomName: string) {
  const roomEconomy = allEconomy.filter(s => s.r === roomName);
  const longterm = roomEconomy.slice(-LONGTERM_WINDOW_SIZE);
  if (longterm.length < 50) return null;  // 数据不足，跳过长期对比
  return {
    avgReserveDelta: avg(longterm.map(s => s.d)),
    avgStorageEnergy: avg(longterm.map(s => s.se)),
    avgPressure: avg(longterm.map(s => s.p / 100)),
  };
}
```

#### 3.4.2 应用方式（推荐保守版）

不直接用长期基线作为调整目标（避免过度复杂），仅作为**额外的上调门禁**：

```
// 改进 D：上调参数时，要求短期信号与长期基线「方向一致」
// 例：hauler.maxCount 上调条件新增：
//   短期 avgReserveDelta > 0 且长期 avgReserveDelta > 0
//   (= 不是季节性波动，是结构性需求增长)
const shortTermAlignedWithLongTerm =
  !longterm ||  // 长期数据不足时跳过此门禁（不阻塞早期调整）
  (sign(shortDelta) === sign(longDelta));

// 仅对「上调」生效；下调保持原逻辑（节能要快，不等长期确认）
```

评审修正（附录 D.7）：长期门禁仅对 ring 已收录信号（reserveDelta / storageEnergy）
生效 — hauler（containerFillRatio）与 builder（backlog）无长期数据，D 不适用；
上例信号类错误，改以 upgrader（avgStorageEnergy）为准。

#### 3.4.3 为什么是 P3

- 改进 A 的闭环验证已能处理大多数瞬态误判。
- 长期基线的主要价值在「识别季节性」 — 但当前 3 房数据规模（私服实测）未观察到明显季节性问题。
- 实施成本中（新增字段 + 测试），收益边际，排 P3。

---

## 4. 数据结构变更与迁移规范（v19 → v20）

### 4.1 变更摘要

按 [plan.md §3.4 版本化 Memory](./plan.md) 规范，本次改动需要升 schemaVersion 19 → 20。

| 字段 | 位置 | 变更 | 迁移策略 |
|---|---|---|---|
| `RoomTuningState.pendingValidation` | `Memory.kernel.tuning.rooms[room].pendingValidation` | 新增可选字段 | 迁移只做建档（不强制初始化），evaluator/tuning-engine 首次写入时创建 |
| `CONFIG.tuning.baselineVersion` | 静态 config | 升至 2（§3.1.11；评审修正 D.6-1 统一） | 触发 rooms 清空，从新基线收敛 |
| `STORAGE_THRESHOLDS_BY_RCL` | 静态 bounds.ts | 新增常量 | 不涉及 Memory |

### 4.2 v20 迁移函数（伪代码）

```typescript
{
  from: 19,
  to: 20,
  run: () => {
    // v20：tuning 改进 A — 新增 pendingValidation 字段。
    // 设计决策（参考 v18 baselineVersion 风格）：迁移只做「建档」不做「定版」。
    // 故意不主动写入 pendingValidation — 让旧覆盖值（如 hauler.max=2）
    // 保留在 rooms 中，由 tuning-engine 首次评估时通过验证 pass 自然处理：
    //   - 若 lastAdjusted[param] 距今 > cooldownTicks 且无 pendingValidation
    //     → 视为「历史遗留覆盖」，跳过验证直接进入正常评估
    //     （评审修正 D.6-4：Step 0 清空 rooms 后此路径为空操作，保留无害）
    //   - 若有 pendingValidation 但 preAdjustSignals 缺失
    //     → 数据损坏，清空该 param 的 pendingValidation
    //
    // 幂等：仅做畸形数据自愈，不写字段值。
    // tuning-engine 是 pendingValidation 的唯一写者（迁移除外）。
    const kernel = Memory.kernel as Record<string, unknown> | undefined;
    if (!kernel) return;
    const tuning = kernel.tuning as Record<string, unknown> | undefined;
    if (!tuning || typeof tuning !== "object") return;
    const rooms = (tuning as any).rooms as Record<string, any> | undefined;
    if (!rooms) return;
    for (const roomName in rooms) {
      const room = rooms[roomName];
      if (!room || typeof room !== "object") continue;
      // 自愈：pendingValidation 存在但非对象 → 删除
      if (room.pendingValidation !== undefined &&
          (typeof room.pendingValidation !== "object" || room.pendingValidation === null)) {
        delete room.pendingValidation;
      }
      // 自愈：pendingValidation 中条目缺关键字段 → 删除该条目
      if (room.pendingValidation && typeof room.pendingValidation === "object") {
        for (const param in room.pendingValidation) {
          const pv = room.pendingValidation[param];
          if (!pv || typeof pv !== "object" ||
              typeof pv.adjustTick !== "number" ||
              typeof pv.preAdjustValue !== "number" ||
              typeof pv.expectedDirection !== "string") {
            delete room.pendingValidation[param];
          }
        }
      }
    }
  },
},
```

### 4.3 迁移测试要求

按 [plan.md §3.4 第 6 条](./plan.md) 要求，新增以下 Vitest 用例：

1. **空 Memory**：从空 Memory 迁移到 v20，tuning 不存在时不报错。
2. **旧版本**：v19 完整 Memory（含 tuning.rooms[room].pendingValidation 为非对象脏数据）→ v20 后脏数据被清除。
3. **重复执行**：v20 迁移跑两次，结果一致（幂等）。
4. **中断恢复**：迁移中途异常 → 版本号不递增，下 tick 重试成功。

---

## 5. 测试策略

### 5.1 改进 A 测试用例

| 用例 | 输入 | 期望 |
|---|---|---|
| 调整后改善 | `pendingValidation[hauler.max]` 存在，冷却后 `containerFillRatio` 比调整前降低（hauler 增加生效） | 不回滚，清空 pending |
| 调整后恶化 | `pendingValidation[hauler.max]` 存在，冷却后 `containerFillRatio` 反而升高 | 回滚到 preAdjustValue，清空 pending |
| 调整后无变化 | `pendingValidation[hauler.max]` 存在，冷却后 `containerFillRatio` 变化 < 容差 | 不回滚（保守，避免误回滚），清空 pending |
| 冷却未到期 | `pendingValidation[hauler.max]` 存在但 `currentTick - lastAdjusted < cooldownTicks` | 跳过验证，保留 pending |
| preAdjustSignals 缺失 | `pendingValidation[hauler.max]` 存在但 `preAdjustSignals.containerFillRatio` 是 undefined | 清空 pending，不回滚 |
| 主动恶化方向（upgrader 下调） | `pendingValidation[upgrader.max]` 存在 expectedDirection=worsen，冷却后 `avgStorageEnergy` 上升（节能生效） | 不回滚，清空 pending |
| 回滚后触发冷却 | 回滚写入后 `lastAdjusted[param] = currentTick` | 同一参数在下一轮评估被 isInCooldown 拦截 |

### 5.2 改进 B 测试用例

| 用例 | 输入 | 期望 |
|---|---|---|
| 经典门禁解锁 | container=0.8, hauler=max(2), spawnFill=0.95（旧门禁锁死场景）, storage=60000, reserveDelta=+50 | 触发上调（旧行为不触发） |
| 消费端真饱和 | container=0.8, hauler=max, storage=60000, reserveDelta=+50（无去处） | 不触发上调（避免加空跑 hauler） |
| storage 不盈余 | container=0.8, hauler=max, storage=30000, reserveDelta=+50 | 触发上调（storage 还有空间） |
| 储备在掉 | container=0.8, hauler=max, storage=60000, reserveDelta=-30 | 触发上调（reserveDelta<0 说明 source 端产能在掉，container 满可能是 hauler 追不上 — 与「无去处」相反） |

### 5.3 改进 C 测试用例

| 用例 | 输入 | 期望 |
|---|---|---|
| RCL5 高库存 | rcl=5, avgStorageEnergy=60000 | 用 `mid.surplus=50000` 判定，触发 upgrader 上调 |
| RCL7 高库存 | rcl=7, avgStorageEnergy=60000 | 用 `late.surplus=200000` 判定，不触发上调（保守） |
| RCL8 极高库存 | rcl=8, avgStorageEnergy=300000 | 用 `late.surplus=200000` 判定，触发上调 |
| 跨档边界 | rcl=6→7 刚跨档，signals.rcl=7，avgStorageEnergy=60000 | 按 RCL7 处理，不触发上调 |

### 5.4 改进 D 测试用例

| 用例 | 输入 | 期望 |
|---|---|---|
| 短期长期一致 | shortAvgDelta=+50, longAvgDelta=+30 | 允许上调 |
| 短期长期背离 | shortAvgDelta=+50, longAvgDelta=-20 | 阻止上调（季节性波动） |
| 长期数据不足 | longterm=null | 不阻止上调（早期跳过） |

### 5.5 集成测试（tests/integration/）

> **覆盖说明（2026-08-01 评审 E.2-P5 同步）**：§5.5 integration 测试已由
> `tests/unit/economy/tuning-closed-loop.test.ts`（domain 纯函数：verifyPendingAdjustments /
> applyFreezePolicy / evaluateTuning 的 pending-lock）+ `tests/unit/economy/tuning-engine-integration.test.ts`
> （系统层集成：run() 完整链路 + 多房间 + 边界场景）覆盖，不单独建 integration 目录测试。
> domain 纯函数 + 系统层集成双层覆盖优于单一 integration 文件：可分别锁定逻辑正确性与接线正确性。

新增 `tests/integration/tuning-closed-loop.test.ts`：

1. **完整闭环场景**：mock 一个「hauler 下调 → 1 窗口后未改善 → 回滚 → 再评估不上调」的完整流程，跨 5 个评估周期（2500 tick）。
2. **棘轮锁死防护回归**：复现实测场景（hauler.max=2 锁死 100 万 tick），验证改进 B 后能恢复。

### 5.6 架构评审补充用例（附录 D.8）

| 用例 | 输入 | 期望 |
|---|---|---|
| pending-lock 竞态 | 上调后 T+500 反向信号、T+1000 冷却到期 | T+1000 不触发反向调整；T+1500 验证后才重新积累 trend |
| 人口合同 blocked | 上调后 roleCount 未达新边界（demand 阻塞） | 标 pending-blocked，不回滚、不计回滚次数 |
| 人口合同 + 效果 | 人口到位但信号未动 | 正常回滚 |
| 下调护栏 | hauler 下调后 containerFill ↑ 但 spawnFill 跌破阈值 | 回滚 |
| 外生污染 | 验证窗口内 RCL 升级 / colony 转换（event-log 有事件） | 跳过或降权验证 |
| D 信号范围 | hauler/builder 长期门禁 | 不生效（ring 无对应信号）；harvester/upgrader 生效 |

---

## 6. 实施顺序与依赖

```
┌─────────────────────────────────────────────────────────┐
│  Step 0: 应急清空（部署前 CLI 操作，独立于代码 PR）     │
│  - CLI 改 Memory.kernel.tuning.rooms = {}                │
│  - 立即解除 hauler.max=2 锁死（三房回到 CONFIG 基线）   │
│  - 必做：B+C 上线后，存量 max=2 与「container 低」共存  │
│    不会触发上调也不会下调（已在 floor），形成死锁。     │
│    不清空则 B 的门禁修了也救不出存量。                  │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Step 1: 改进 B + 改进 C 同 PR 上线（无 Memory 改动）   │
│  - B：evaluator.ts 上调门禁条件替换（hauler.max + min   │
│       一致性同步，含 consumerSaturated 用 C 的阈值）   │
│  - C：bounds.ts 新增 STORAGE_THRESHOLDS_BY_RCL（百分比）│
│       + evaluator.ts 替换 STORAGE_SURPLUS/LOW 引用      │
│  - 不升 schemaVersion（纯代码改动）                    │
│  - 测试：§5.2 (B) + §5.3 (C)                            │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: 观察期 ≥50000 tick（约 1 个游戏月）           │
│  - 用 tools/private/probe-tuning.js 定期采集             │
│  - 覆盖季节性波动（远矿车队往返、市场周期、Builder）   │
│  - 监控：roleBounds 偏离 / lastEval.adjustments 累计 /  │
│    trend 方向 / 锁死是否复现 / 振荡是否出现             │
│  - 观察期 < 50000 tick 不足以判定，禁止提前下结论      │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: 按附录 C「A 投资判定矩阵」决定 A 的级别        │
│  - 矩阵按 5 种观察现象 → 4 种投资级别映射               │
│  - 可能结果：不上 A / 简化版 A / 完整版 A / 调 C 不调 A │
│  - 决策触发后才动 A 的设计（含附录 B-P1 verifyDelay）  │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: 改进 D（长期基线）— P3，独立排期                │
│  - 仅在 Step 3 判定「不需要 A」或「A 上线后仍识别出     │
│    季节性问题」时才进入                                │
│  - 改 tuning-engine.ts + evaluator.ts                  │
└─────────────────────────────────────────────────────────┘
```

**依赖关系（修订）**：
- Step 0 必做，且必须在 Step 1 部署前完成（否则 B 修了门禁也救不出存量锁死）。
- Step 1：B 与 C 必须同 PR（B 的 `consumerSaturated` 依赖 C 的 `getStorageThresholds`，分 PR 会割裂）。
- Step 2：观察期门槛硬性 50000 tick，不可压缩。
- Step 3：按附录 C 矩阵决策，A 的具体版本由观察数据决定。
- 改进 A 不再预设为「必上」，改由 Step 3 数据驱动决策。
- 改进 D 排在最后，仅在 A 决策后或季节性问题暴露时启动。

---

## 7. 风险与回滚

### 7.1 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 改进 B 上调门禁放宽后，hauler 在 spawn 真饱和时仍被加 | 中 | 中（多 1-2 只空跑 hauler，CPU 浪费 ~0.5/tick） | Step 2 观察期监控；若频繁发生，触发附录 C 矩阵 → 上简化版 A |
| 改进 C RCL 分级阈值标定不当（如 late.surplus=25% 过高/过低） | 中 | 低（RCL7 房 upgrader 误上调/下调） | 阈值在 bounds.ts 集中管理；Step 2 观察期后微调；mid 档保持当前默认值，最小化行为变化 |
| Step 0 清空后存量 tuning 历史丢失 | 低 | 低（历史本身已是错误覆盖值，丢失是收益） | probe-tuning.js 在清空前可先快照存档 |
| 观察期 < 50000 tick 提前判定 A 投资级别 | 中 | 高（A 投资决策错误，可能过度工程或漏修） | 矩阵强制 50000 tick 门槛；未达门槛不进入 Step 3 |
| spawn demand 问题被误归因到 tuning | 高 | 高（误判 B+C 无效 → 误上 A） | §0 收益边界声明前置；成功标准用 roleBounds/signals 而非人口数 |
| 改进 A（若 Step 3 触发）的 verifyDelay 标定不当 | 中 | 高（验证过早 → 振荡；过晚 → 锁死延长） | 附录 B-P1 已识别；A 设计阶段需按因果链分类标定（立即生效类 vs 滞后生效类） |
| v20 迁移幂等性 bug（若 A 触发） | 低 | 高（失去 tuning 历史） | 严格按 §4.3 测试；迁移只做建档不写字段值 |

### 7.2 整体回滚策略

- **改进 B**：纯条件替换，回滚 = 还原 evaluator.ts 一处条件。
- **改进 A**：新增字段 + 验证 pass，回滚 = 注释掉 verifyPendingAdjustments 调用 + v21 迁移清空 pendingValidation。
- **改进 C**：常量替换，回滚 = 还原 evaluator.ts 中的 `getStorageThresholds` 调用为原常量。
- **改进 D**：新增门禁，回滚 = 删除 shortTermAlignedWithLongTerm 检查。

所有改动均不动 `getRoleBounds` 接口，**消费者（demand.ts / spawn-manager.ts）无感**，回滚不影响其他系统。

### 7.3 监控点

部署后用 [tools/private/probe-tuning.js](../tools/private/probe-tuning.js) 监控以下指标：

1. **roleBounds 偏离基线程度**：改进 A 上线后，偏离 > 2 的参数应在 2 个评估周期（1000 tick）内开始回归。
2. **pendingValidation 累积**：每个房间的 pending 条目数应 ≤ 5（每参数最多 1 个），超出说明验证 pass 未执行。
3. **回滚事件频率**：回滚 console.log 出现频率应 < 1 次 / 5000 tick / 房间，过高说明调整过于激进。

---

## 8. 不在本期范围

以下问题在诊断中识别但不在本设计文档处理：

1. **colonyState 与 skipReasons 矛盾**（handoff 提到 `creep/upgrader/colony-state` 跳过 112 次但 colonyState=normal）— 这是 spawn demand 的问题，不属于 tuning 范围。
2. **远矿能量流错配**（W8N2 → W8N3 过剩房收远矿）— 属于 remote-manager 决策，不属于 tuning。
3. **RCL7 房人口严重不足**（W7N3 7 creep、W7N4 8 creep）— 经诊断与 tuning 无关（CONFIG harvester.max=4 未被压，实际 harvester=2-3 满足 min 不达 max），是 spawn demand 未排队的问题。
4. **haulerCount 是数量非产能**（6 个 hauler 可能 3 个空跑）— 需要 hauler 行为遥测（如 `creep.memory.action` 分布），远超本期范围。
5. **containerFillRatio 分段流量**（container 满可能是 source 端/hauler 端/spawn 端任一环节问题）— 需要新增 source/container/spawn 三段独立遥测，工作量大，留待改进 D 之后评估。

---

## 9. 决策记录（2026-08-01 定稿）

> 评审已完成，决策定稿。A 的待确认项暂不求解 — A 是否上、上什么版本由附录 C 矩阵在 Step 3 触发。B+C 的关键参数已定。

### 9.1 B+C 已决策项

| 决策 | 定稿值 | 依据 |
|---|---|---|
| B 的 consumerSaturated storage 阈值 | 用 C 的 `getStorageThresholds(s.rcl).surplus` | B/C 协同，避免割裂 |
| C 的阈值参数化方式 | 占 `STORAGE_CAPACITY(1,000,000)` 百分比 | 文档自解释 + 无 magic number |
| C 的 late 档 surplus | 25%（=25 万） | 贴近 W8N3 实测 32 万（32%），略低留余量 |
| C 的 late 档 low | 5%（=5 万） | RCL7 房 storage < 5 万才视为「饥饿需节能」 |
| C 的 mid 档 | surplus=5% / low=1%（保持当前默认值） | 最小化行为变化 |
| B+C 是否升 schemaVersion | **不升**（纯代码改动） | 省 v20 迁移风险，A 触发时再升 |
| Step 0 清空 rooms | **必做**，部署前完成 | 不清空则 B 修了门禁也救不出存量死锁 |
| 观察期门槛 | **≥50000 tick** | 覆盖季节性波动；低于此禁止进入 Step 3 |

### 9.2 A 的待确认项（推迟到 Step 3 触发时求解）

> **更新（2026-08-01）**：观察期已触发完整版 A，以下待确认项已在 §3.1.6-3.1.9 给出最终答案：
> - 项 1（容差）→ §3.1.7 双门限 `max(5% 相对, 0.05 绝对)`
> - 项 2（回滚豁免）→ §3.1.9 `信号超原阈值 2x AND 距回滚 >= verifyDelay/2`
> - 项 3（verifyDelay 标定）→ §3.1.6 统一 1500（所有参数都是人口类）
> - 项 4（P3 冻结）→ §3.1.8 连续 3 次回滚冻结 10000 tick
> - 项 5（附录 D 评审修正）→ 验证语义定稿见附录 D.2-D.5；D 范围收窄见附录 D.7

以下项在 A 真正进入实施时才需要最终答案，现保留评审建议作为设计输入：

1. **`isImproved` 容差**：5% 相对值（前提是 verifyDelay 修对，附录 B-P1）。
   - 补充：5% 在低基数失效（container=0.1 时 5%=0.005），建议 `max(5% 相对, 0.05 绝对)` 双门限。
2. **回滚触发冷却 + 豁免上调**：触发（防振荡），但允许「明显反向」豁免。
   - 豁免条件待量化：推荐 `desiredDirection 与回滚反向 AND 信号超原阈值 2x AND 距回滚 ≥ verifyDelay/2`。
3. **A 的 verifyDelay 标定**：按因果链分类（立即生效类 = cooldownTicks；滞后生效类 = 1500-2000）。
4. **A 的 P3 冻结机制**：连续 3 次回滚冻结，冻结 N tick 后自动解冻或人工 CLI 解冻。

### 9.3 D 的待确认项（推迟到 Step 4 触发时求解）

- D 是否对下调也加长期对齐门禁：推荐不加（节能要快）。
- 软降级：严重恶化下调后 expectedDirection=improve（验证储备止跌）。

---

## 附录 A：参考资料

- 实测数据采集：[tools/private/probe-tuning.js](../tools/private/probe-tuning.js)（tick=1578870 私服快照）
- 原始 tuning-engine 设计：[plan.md §2.2](./plan.md)、[src/systems/tuning-engine.ts 顶部注释](../src/systems/tuning-engine.ts)
- 历史迁移：v7 引入 tuning 结构、v18 引入 baselineVersion、v19 demand 收口（[src/kernel/memory.ts](../src/kernel/memory.ts)）

---

## 附录 B：评审记录（2026-08-01）

> **更新（2026-08-01）**：观察期已完成（tick 1623282→1676531，53249 tick），W8N3 `builder.maxCount` 振荡 1 次触发完整版 A。P1/P2/P3 已在 §3.1.6-3.1.8 给出设计方案，下方原评审记录保留作为设计输入追溯。

> **评审结论**：诊断准确、方向正确；**改进 A 存在 HIGH 级设计缺陷（验证窗口与效果显现时间常数不匹配），照案实施会引入「回滚-下调」振荡**。根因 B/C 经代码逐行核实属实；改进 B/C/D 可实施。建议：先修改进 A 的验证时机设计，再按 B → A → C → D 顺序推进。

### B.1 根因核实（代码考古）

| 缺陷 | 核实 | 证据 |
|---|---|---|
| B（spawnFillRatio 门禁） | ✅ 完全属实 | evaluator.ts:168 `s.spawnFillRatio < SPAWN_SATURATED`（:65 定义 0.8）；实测 W7N4 spawnFill=0.95 恰是 distributor 正常工作的证据——门禁用错了代理变量 |
| C（全局 storage 阈值） | ✅ 完全属实 | evaluator.ts:68-69 全局常量；upgrader 上调用 SURPLUS（:301）、下调用 LOW（:314）；W8N3（RCL5）storage 32 万 = 6.6 倍 SURPLUS 被同阈值压制 |
| A（无闭环无回滚） | ✅ 属实 | confirmAndBuild（:390-416）只产出 adjustment，无验证/回滚路径；趋势重置（:410）叠加 B 门禁构成锁死机制 |
| D（短期窗口过敏） | ✅ 属实 | EVAL_WINDOW_SIZE=20 采样×50 tick=1000 tick vs ring buffer 15000 tick，仅用 1/15 |

**补充证据**：A 与 B 是因果链——B（门禁错）是根因、A（无回滚）是放大器。只修 B 时存量覆盖（如 W7N4 hauler.max=2）需 ~8000 tick 逐步爬回（4 次上调×2 确认×冷却），建议文档明示「存量恢复时间预算」。

### B.2 问题清单

| # | 严重性 | 问题 | 修复建议 |
|---|---|---|---|
| P1 | **HIGH** | **验证窗口（1000 tick）与效果显现时间常数不匹配**：hauler.maxCount 是人口上限，下调 4→2 的效果要等现有 creep 死亡/回收 + 补员，最长 ≈1500 tick。1000 tick 时旧 creep 大概率还活着 → container 填充率未变 → 判「未改善」→ 回滚 → 冷却 → 又下调 → **「下调→回滚→下调」振荡**，比现在的锁死更糟 | 验证时机改为 `max(cooldownTicks, effectLatencyTicks)`；TUNING_BOUNDS 加 `verifyDelay` 字段 per-param 配置（人口类 ≈1500） |
| P2 | MEDIUM | **单信号验证会误回滚**：`pickSignal` 只验证 1-2 个核心信号（hauler 只查 containerFillRatio）。上调后能量可能流向 spawn 而非留在 container → 判「未改善」实为已生效 | hauler 验证改为「containerFillRatio ↓ **OR** spawnFillRatio ↑」任一方向算改善（能量再分配证据） |
| P3 | MEDIUM | **连续回滚无冻结机制**：只有单次回滚+冷却，信号不稳定的参数会无限「上调→回滚」循环，每次消耗 2000 tick 与 Memory 写入 | RoomTuningState 加 `rollbackCount`，连续 3 次回滚 → 冻结该参数（跳过评估 + console.log 告警），人工介入 |
| P4 | LOW | 预期收益边界未明示：tuning 修复只让 bounds 合理，RCL7 房人口不足（§8-3）是 spawn demand 独立问题 | 方案开头明示「tuning 收益上限 = bounds 不再锁死」，避免上线后误判 tuning 无效 |
| P5 | LOW | 迁移类型校验过松：`typeof pv.expectedDirection !== "string"` 拦不住 `"sideways"` 等非法值 | 校验为 `"improve" \| "worsen"` 枚举 |
| P6 | LOW | 连续无变化无升级路径：容差内不回滚是保守正确，但长期无变化（调整无效）应累计 | N 次无变化后回滚或冻结，避免无效覆盖滞留 |
| P7 | LOW | §3.1.2 表格头歧义：hauler 下调对 container 信号是「改善」、harvester 下调是「主动恶化」，表格未说明为何不同 | 补一句注释区分两种语义 |

### B.3 §9 待确认项评审建议汇总

| 待确认 | 评审建议 |
|---|---|
| 1. isImproved 容差 5% | 同意，但前提是修好验证窗口（P1）——窗口错时容差再大也防不住误回滚 |
| 2. 回滚是否触发冷却 | 触发（防振荡），但补「回滚冷却豁免上调」：回滚后信号明显反向时允许立即反向调整，防「调错→回滚→1000 tick 不能修」死锁 |
| 3. late.surplus=200000 | 暂定可，建议按 storage 容量百分比导出参数化（late 档 ≈20-30%），实测后微调 |
| 4. 下调是否加长期门禁 | 同意不加。补软降级：严重恶化下调后 expectedDirection=improve（验证储备是否止跌） |

### B.4 验证建议（在 §5 基础上追加）

1. **振荡回归**（对应 P1）：模拟「下调 → 1000 tick 内旧 creep 未死 → 旧验证逻辑会回滚」→ 断言 verifyDelay 机制不触发回滚；再模拟 1500 tick 后效果显现 → 正常回滚。
2. **连续回滚冻结**（对应 P3）：同参数 3 次回滚 → 冻结 + 告警。
3. **存量恢复集成**（对应补充证据）：复现 W7N4 hauler.max=2 锁死，断言 ~8000 tick 内回到 4+。

### B.5 总体判定

| 维度 | 判定 |
|---|---|
| 根因诊断（A-D） | ✅ 全部属实（B/C 逐行核实） |
| 改进 B/C/D 设计 | ✅ 可实施 |
| 改进 A 设计 | ✅ 已修（v1 草案）— P1/P2/P3 设计方案见 §3.1.6-3.1.8，由观察期振荡触发完整版 A |
| 实施顺序 | ✅ 已修订为 Step0 清空 → Step1 B+C 同 PR → Step2 观察 ≥50000 tick → Step3 按矩阵决定 A |
| 迁移 v20 | ✅ 已设计（§3.1.11）— A 触发即实施，含 pendingValidation/frozenParams 建档 + 枚举校验 |
| 文档完善度 | ✅ 已补收益边界（§0）+ RCL 百分比参数化（§3.3）+ A 投资矩阵（附录 C） |

---

## 附录 C：改进 A 投资判定矩阵（Step 3 决策依据）

> 本矩阵是 §6 Step 3 的决策依据。B+C 上线后，用 [tools/private/probe-tuning.js](../tools/private/probe-tuning.js) 采集 **≥50000 tick** 数据，按下表判定改进 A 的投资级别。
>
> **判定原则**：根因已被 B（门禁修正）+ C（RCL 分级）修复，A 是「防未来未知瞬态」的保险。保险值不值得买，看 B+C 上线后还有没有瞬态误判 — 而不是看「A 的设计是否完备」。

### C.1 观察期采集指标

| 指标 | 采集方式 | 用途 |
|---|---|---|
| `roleBounds` 偏离基线程度 | probe-tuning.js per-room roleBounds delta | 判定「锁死是否复现」 |
| `lastEval.adjustments` 累计 | probe-tuning.js per-room lastEval | 判定「调整是否产出」 |
| `lastTrend` 方向变化 | probe-tuning.js per-room lastTrend | 判定「trend 是否自愈」 |
| 锁死持续时间 | manual 跟踪 lastAdjusted 距今 | 判定「是否未自愈」 |
| 振荡事件 | manual 跟踪 adjustHistory（需扩 probe） | 判定「是否振荡」 |

### C.2 判定矩阵

| 观察现象 | 出现频次 | A 投资级别 | 理由 |
|---|---|---|---|
| `roleBounds` 稳定在基线附近（\|delta\| ≤ 1） | 整个观察期 | **不上 A** | trend 确认机制已足够，A 是过度工程 |
| 瞬态误判（参数被压离基线）但下次评估自愈（trend 反向） | 1-2 次 | **不上 A** | trend 反向机制生效，闭环无需补 |
| 瞬态误判且未自愈（锁死 ≥5000 tick = 5 个评估周期） | 0 次 | **不上 A** | B 的门禁修正已根治根因 |
| 同上 | 1-2 次 | **上简化版 A**：只加 verifyDelay + 回滚，不加冻结/豁免 | 偶发瞬态需要闭环兜底，但不需要复杂冻结逻辑 |
| 同上 | ≥3 次 | **上完整版 A**（含 P3 冻结 + P2 多信号验证） | 瞬态频繁，需要冻结防振荡 + 多信号防误回滚 |
| 振荡（调整→回滚→再调整同方向） | 任意 | **上完整版 A**（含 P3 冻结 + P2 多信号验证） | 振荡比锁死更耗资源（spawn 能量反复孵化回收），必须立即修 |
| 完全无调整产出（`trend` 永远 none） | 整个观察期 | **不上 A**（是 C 的阈值标定问题） | 阈值过严，调 C 不调 A；可能需要降低 late.surplus 或调整其他门禁 |

### C.3 判定门槛与禁令

- **观察期 < 50000 tick**：禁止进入 Step 3 决策。短期数据不能区分「瞬态」与「季节性」，提前决策会误判。
- **5000 tick 锁死线**：低于此可能是冷却期内的正常静默（1000 tick 冷却 + 1000 tick 趋势确认 = 2000 tick 静默是正常的）。
- **振荡定义**：同一参数在 ≤ 2 × verifyDelay 内出现「调整 → 回滚 → 同方向再调整」。verifyDelay 在 A 设计阶段才确定，故振荡判定需先有 A 的设计草案。
- **A 上线后必须重新观察 ≥50000 tick**：验证 A 自身是否引入新问题（如过度回滚、冻结过激）。

### C.4 决策输出模板

Step 3 决策时，按下模板记录：

```
观察期：tick XXXXXX → YYYYYY（共 ZZZZZ tick，≥ 50000 ✓/✗）
采集数据：
  - roleBounds 偏离：[最大 delta, 出现房间, 持续 tick]
  - lastEval.adjustments 累计：[总数, 各房分布]
  - 锁死事件：[次数, 最长持续 tick, 涉及参数]
  - 振荡事件：[次数, 涉及参数]
判定：[现象] → [频次] → [A 投资级别]
决策：[不上 A / 上简化版 A / 上完整版 A / 调 C 不调 A]
下一步：[进入 A 设计阶段 / 调整 C 阈值后重新观察 / 结束 tuning 改进]
```

---

## 附录 D：架构评审补充（2026-08-01，grandmaster 视角）

> 评审对象：v3 全案（B/C 已落地实现 + 完整版 A 设计 + D 设计）。
> 评审方法：代码考古（evaluator.ts / bounds.ts / types.ts / tuning-engine.ts /
> telemetry-collector.ts / timeseries.ts 逐行核对）+ 设计参数推演
> （cooldown=1000、interval=500、trend 2 次确认、verifyDelay=1500）。
> 总体判定：根因诊断与 B/C 实现 ✅；A 需按 D.2-D.5 修正后实施；
> D 按 D.7 收窄；文档一致性按 D.6 统一。

### D.1 评审结论速览

| 项 | 判定 | 依据 |
|---|---|---|
| 缺陷 A-D 诊断 | ✅ 属实 | 附录 B.1 逐行核实；本次复核一致 |
| B+C 实现 | ✅ 已提交 | c139055；tuning.test.ts:823-847 覆盖 RCL7 解锁 / RCL5 饱和两向 |
| A 的 verifyDelay 竞态 | ❌ HIGH | D.2 推演：反向调整可早于或同 tick 于验证触发 |
| A 的验证语义 | ⚠️ MEDIUM ×3 | D.3 人口合同、D.4 下调护栏、D.5 假阳性/冻结/审计 |
| D 的信号基础 | ⚠️ 受限 | [事实] ring 无容器填充率归一值与 backlog（timeseries.ts） |
| 文档一致性 | ⚠️ 4 处 | D.6 |

### D.2 HIGH — 验证与反向调整竞态：必须加 pending-lock

推演（按计划参数 + 代码常数）：

1. T 时调整，trend 重置 none，pending 写入；
2. T+500 反向信号出现 → 首次观察，trend=反向；
3. T+1000 冷却到期（1000 ≥ 1000）且 trend 已连续 2 次同向 → 反向调整触发，
   早于 T+1500 的验证；相位对齐时与验证同 tick；
4. 验证同 tick 先通过（清空 pending）→ evaluator 紧接着按 trend 触发反向调整 —
   「验证有效」与「反向调整」同 tick 并存；
5. §3.1.1「覆盖旧记录」使 T+1000 的再次调整吞掉 T 的 pending —
   第一次调整永远不被验证，闭环只审最后一步。

**修正（定稿）**：

- pending 存在期间该参数从 evaluator evals **整体排除（含 trend 记录）**，
  验证完成（接受/回滚）清空 pending 后 trend 从 none 重新积累；
- 验证粒度 = 调整粒度；verifyDelay=1500 在 pending-lock 下成立（否则不保证抢先）；
- 回滚仍写 `lastAdjusted=tick` 触发冷却（原设计保留）。

### D.3 MEDIUM — 人口合同前置（防 tuning 替 spawn demand 背锅）

背景：§0 已承认 spawn demand 侧存在独立问题（RCL7 人口不足、colony-state skip 矛盾）。
若调整后人口未补上，信号不动 → 误判未改善 → 回滚 → 3 次冻结 —
病因在 demand，受罚的是 tuning。

**修正（定稿）**：

- 验证分两级：先验**合同**（roleCount 达新边界，用活快照或 population census），
  未达 → 标 `pending-blocked`，不判失败、不计回滚次数，下周期复验；
  已达 → 再验**效果**（信号方向）；
- P2 的 builder 证据（`builderCount >= preAdjustValue+1`）推广为全部参数的统一前置。
- 实现评审补充（附录 E-P1，待实现）：blocked 需 TTL（连续 2-3 个窗口后回滚或清空），
  并接线 `contractBlocked` 观测 — 防「demand 口径不匹配 + 能量饥饿」导致参数被
  pending-lock 永久排除且零告警。

### D.4 MEDIUM — 下调方向缺伤害护栏

hauler 下调验证只有 `containerFillRatio ↑ = 改善`。容器变满既可能是正确减产，
也可能是搬运塌方（spawn 饿死）— 单信号把伤害当改善接受（假阳性；计划只防了
假阴性与振荡，没防假阳性）。

**修正（定稿）**：

- 下调验证 = 主信号方向（containerFillRatio ↑ / storageEnergy ↑）**且**护栏
  （spawnFillRatio 不跌破阈值、avgReserveDelta 不转负）；护栏触发即回滚；
- upgrader 下调同样检查 avgPressure 不恶化。

### D.5 MEDIUM — 冻结语义与审计轨迹

- 冻结只停评估不停值：冻结时参数**复位到 CONFIG 基线**（或最近一次验证通过值），
  避免「振荡结束停在错误值被钉 10000 tick」；
- 调整/回滚/冻结事件写 event-log（新增 EventKind，segment 2 有界 ring），
  console.log 降级为运维提醒 — 顺带提供附录 C.1 缺失的 adjustHistory 审计源，
  Memory 零增长。

### D.6 文档一致性修正清单（定稿）

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 1 | §4.1 vs §3.1.11 | baselineVersion「保持 1」与「升至 2」冲突 | 定稿：升至 2（§3.1.11 为准），§4.1 已同步；Step 0 清空与其互为冗余 |
| 2 | §5.2 用例表 | 未标 RCL，storage=60000 在 mid 饱和 / late 不饱和，表内自相矛盾 | 每个用例补 RCL 列（已实现测试以 tuning.test.ts:825/847 为准） |
| 3 | §3.1.9 | 「信号超原阈值 2x」基准未定义 | 定义：当前信号相对 preAdjust 值偏移 ≥ 2 × 触发时信号与判定阈值的差值 |
| 4 | §4.2 | 「历史遗留覆盖由验证 pass 处理」与 Step 0 清空后的空状态重复 | 已注明 Step 0 后为死路径，保留无害 |

### D.7 改进 D 范围收窄（定稿）

[事实] economy ring（timeseries.ts `EconomySample`）只有 d/ds/p/ea/ec/se/cte/cce，
无容器填充率归一值、无 backlog。

- D 的长期门禁仅对 ring 已收录信号生效：harvester（avgReserveDelta）、
  upgrader（avgStorageEnergy）；
- hauler（containerFillRatio）/ builder（backlog）不做长期门禁，除非先扩遥测
  （ring 增加 cf/bq 字段，旧样本缺字段回退活快照）；
- §3.4.2 示例（hauler 用 reserveDelta 对齐）信号类错误，改以 upgrader 为例。

### D.8 验证补充（在 §5 基础上新增，已并入 §5.6）

| 用例 | 输入 | 期望 |
|---|---|---|
| pending-lock 竞态 | 上调后 T+500 反向信号、T+1000 冷却到期 | T+1000 不触发反向调整；T+1500 验证后才重新积累 trend |
| 人口合同 blocked | 上调后 roleCount 未达新边界（demand 阻塞） | 标 pending-blocked，不回滚、不计回滚次数 |
| 人口合同 + 效果 | 人口到位但信号未动 | 正常回滚 |
| 下调护栏 | hauler 下调后 containerFill ↑ 但 spawnFill 跌破阈值 | 回滚 |
| 外生污染 | 验证窗口内 RCL 升级 / colony 转换（event-log 有事件） | 跳过或降权验证 |
| D 信号范围 | hauler/builder 长期门禁 | 不生效（ring 无对应信号）；harvester/upgrader 生效 |

### D.9 实施顺序（定稿）

1. Step 0 清空 rooms（部署前 CLI）；
2. B/C 已上线不回退；补 §5.2 RCL 列；
3. 按 D.2-D.5 修改 A 设计后实现（pending-lock + 人口合同 + 下调护栏 +
   冻结复位 + event-log），并跑 D.8 用例；
4. D 按 D.7 收窄后独立排期，不与 A 同 PR。

---

## 附录 E：A 方案实现评审（2026-08-01）

> 评审对象：工作区已实现的完整版 A（评审时未提交，约 1300 行：evaluator.ts /
> tuning-engine.ts / bounds.ts / types.ts / event-log.ts / memory.ts 迁移 /
> global.d.ts + 28 个新测试）。
> 评审方法：对照附录 D 定稿逐条代码考古 + 设计参数推演。
> 验证基线：`npm run typecheck` 全绿；`npm run test:unit` 116 文件 / 1376 用例通过
> （新增 tuning-closed-loop 14 + v19→v20 迁移 14）。
> 总体判定：核心机制全部落地且测试锁定；存在 1×MEDIUM-HIGH + 2×MEDIUM + 2×LOW，
> 建议修复后提交。**修复已完成（de0d2d3 提交）：P1-P4 全部修复并有测试锁定
> （状态见 E.2 表），P5 文档同步随本次完成。** 验证基线：typecheck 全绿；
> `npm run test:unit` 116 文件 / 1391 用例通过。

### E.1 实现对照表（vs 附录 D 定稿）

| 定稿项 | 实现 | 证据 |
|---|---|---|
| D.2 pending-lock | ✅ | `excludedParams` 排除 pending+frozen，trend 强制 none；竞态测试锁住 T+1000 不反向 |
| verifyDelay=1500 | ✅ | bounds.ts 每参数配置，注释写明 ≥ cooldown 约束 |
| D.3 人口合同 | ⚠️ 半实现 | up/down 双向合同检查 + blocked 态都有，但 blocked 无 TTL、无观测（E.2-P1） |
| D.4 下调护栏 | ⚠️ 半实现 | spawnFill/pressure 护栏生效；hauler 的 reserveDelta 护栏是死代码（E.2-P2） |
| D.5 冻结复位基线 | ✅ | 第 3 次回滚 `rb.newValue` 改为 CONFIG 基线，测试断言 5→6 |
| event-log 审计 | ✅ | TuningAdjust/Rollback/Freeze + 稳定 paramCode |
| v20 迁移 | ✅ | 枚举校验、空对象回收、幂等，14 个测试 |
| baselineVersion 2 / schema 20 | ✅ | config + 迁移一致；集成测试改为读 CONFIG 值 |
| 容差双门限 | ✅ | max(5% 相对, 0.05 绝对) |

### E.2 问题清单

| # | 级别 | 问题 | 位置 | 证据 / 后果 | 修法 / 状态 |
|---|---|---|---|---|---|
| P1 | MEDIUM-HIGH | 人口合同 blocked 无 TTL、无观测 → 参数可被永久排除 | evaluator.ts `verifyPendingAdjustments` + tuning-engine.ts `safeRunTuning` | `blockedParams` 返回后从未被消费；`contractBlocked` 字段定义但从未写入；lastEval 无 blocked 标记。tuning 触发阈值（containerFill>0.7）与 demand 孵化阈值（0.4/0.8 分档）口径不同 + 能量饥饿排队 → 合同可能长期不满足 → pending-lock 永久排除该参数，零告警 | ✅ 已修复：blocked 连续 2 窗口（2×verifyDelay=3000 tick）超时回滚并解除 pending-lock（evaluator.ts:799-809）；`TuningBlocked` 事件 + `lastEval.blockedParams` 诊断接线（tuning-engine.ts:368-394）；5 测试锁定（tuning-closed-loop.test.ts:201-322） |
| P2 | MEDIUM | hauler 下调护栏 reserveDelta 分支是死代码 | evaluator.ts `capturePreAdjustSignals` / `isGuardrailTriggered` | hauler 快照只存 containerFillRatio + spawnFillRatio，未存 avgReserveDelta → 护栏读取恒 undefined → 永不触发；spawnFill 护栏仍生效 | ✅ 已修复：快照补 `avgReserveDelta`（evaluator.ts:515-519，注释注明「P2 修复」）；reserveDelta 护栏不再恒 false；3 测试（tuning-closed-loop.test.ts:394-442） |
| P3 | MEDIUM | 验证 pass 不继承评估的全局门禁 | tuning-engine.ts `safeRunTuning`（verify 无条件先于 evaluate 执行） | 危机 / 低 bucket 期间 containerFill/storage 外生暴跌 → 误判未改善 → 回滚 + 计次 → 可能误冻结 | ✅ 已修复：`checkVerifyGate`（tuning-engine.ts:235-247）与 evaluate 门禁逐条对齐（tier→crisis→rcl）；verify 条件执行（:162），门禁未过时 rollbackCount 不累加；3 测试（tuning-engine-integration.test.ts:936-1052） |
| P4 | LOW-MEDIUM | 解冻后 rollbackCount 保留 → 一次回滚即再冻结 10000 tick | evaluator.ts `applyFreezePolicy` + bounds.ts | 病理参数复发快冻结是特性；但对「冻结期世界已变」的场景过于粘滞 | ✅ 已修复：解冻时整条删除 frozenParams（rollbackCount 清零，evaluator.ts:897-904，采用「清零」方案）；复验测试断言「解冻后需重新累积 3 次才再冻结」（tuning-closed-loop.test.ts:555-589） |
| P5 | LOW | 注释 / 文档过期 | tuning-engine.ts 顶部注释（仍写「用 console.log 记录调优事件」）；§5.5 integration 测试未建；AGENTS.md schemaVersion=19（现 20） | 误导 + 测试债 + 文档漂移 | ✅ 已修复（残余 1 项）：tuning-engine 顶部注释已改 event-log（:36-38）；AGENTS.md 已升 20；docs 状态行随本次同步。**残余：§5.5 独立 integration 文件未建，完整闭环由 unit 层 tuning-closed-loop.test.ts 覆盖（722 行）** |

### E.3 行为推演验证（正面确认）

W8N3 builder 振荡场景（§3.1.5）在新时序下：

上调 T → pending-lock 挡住 T+500/T+1000 的 trend → T+1500 验证（人口到位即通过）
→ 反向下调最早 T+2500 → 下调验证再等人口收敛到新上限。

结论：振荡周期从实测 1500 tick 拉长到 4000+，且每步有验证点 — A 的目标达成。
代价：pending 窗口内真实需求突增的响应延迟约 2500 tick（不能反向调整），
对 P3 治理器可接受；此取舍应在文档明示。

### E.4 收尾步骤（建议顺序）

> 状态：步骤 1-3 已执行完毕（de0d2d3 提交）；步骤 4 验证基线：typecheck 全绿、
> 116 文件 1391 unit 用例通过。

1. ✅ P2（一行快照字段）+ P3（门禁前置，约 15 行）+ P5（注释 / 文档同步）；
2. ✅ P1 定 TTL 策略后实现（2 窗口回滚 + TuningBlocked 事件）；
3. ✅ 补 3 个测试：blocked TTL、hauler reserve 护栏、危机窗口验证跳过；
4. `npm run build` + `npm run test:integration` 全绿后提交（已提交 de0d2d3）。
