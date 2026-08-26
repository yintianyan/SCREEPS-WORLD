# Phase 3: Runtime Foundation Audit — Kernel/Scheduler/CPU/Memory 生命周期可靠性

> **审计基准**: 2026-08-26  
> **方法**: 边界条件分析 + 崩溃恢复路径追踪 + 死亡场景模拟

---

## 3.1 Kernel 生命周期 — 每 Tick 执行管线

### 3.1.1 执行顺序可靠性

```
1. createBudget()          ← 若失败? safeRun 隔离, budget 用 undefined?
   ⚠️ 风险: createBudget 在 safeRun 外调用 — 如果 Game.cpu.bucket 为 null/undefined
   导致 resolveTier 异常, 整个 tick 中断
   ✅ 防御: scheduler.ts 使用 `?? 10000` 兜底

2. requestSegments()       ← safeRun 隔离
3. runMigrations()         ← safeRun 隔离, 永不冷却 (critical=true)
4. maintainMemory()        ← safeRun 隔离, 永不冷却 (critical=true)
5. pruneDeadCreepCache()  ← 每 100 tick, safeRun 隔离
6. initTelemetry()         ← 无 safeRun 包裹! 但只是赋值, 极低风险
7. buildSnapshots(ctx)    ← 无 safeRun 包裹!
   ⚠️ 风险: buildRoomSnapshot 失败由 safeRunBuild 隔离 (critical=true),
   但 ctx._addSnapshot 在 safeRunBuild 外 — 不过它只在 snapshot 非空时执行

8. runSystems(ctx)        ← 内部循环每个系统用 safeRun 隔离
9. runCreeps(ctx)         ← 内部循环每个 creep 用 safeRun 隔离
10. runPostSystems(ctx)   ← 内部循环每个系统用 safeRun 隔离
11. emitSummary(budget)   ← 无 safeRun! 但只读 + console.log
12. runExpectations(ctx)  ← safeRun 隔离
13. flushSkips()          ← safeRun 隔离, 永不冷却
14. flushSegments()        ← safeRun 隔离, 永不冷却
```

**裁决**: 8-10 (核心执行管线) 和 11-14 (收尾管线) 的 safeRun 覆盖是合理的。6-7 (initTelemetry + buildSnapshots) 未被 safeRun 包裹，但 initTelemetry 是纯赋值操作，buildSnapshots 内部已有 safeRunBuild。整体覆盖度: ✅ 高。

### 3.1.2 CPU 预算边界条件

| 边界场景 | 代码处理 | 裁决 |
|---------|---------|------|
| Game.cpu.limit = 0 (测试环境) | `?? 20` 兜底 | ✅ |
| Game.cpu.limit = 10 (低 limit 服) | hardLimit = min(10 × hardRatio, 10 - cpuReserve) | ✅ 比例化 |
| Game.cpu.bucket = 0 (透支) | resolveTier → recovery | ✅ |
| Game.cpu.bucket = null | `?? 10000` 兜底 | ✅ |
| Game.cpu.tickLimit < limit | `Math.min(limit, tickLimit)` | ✅ 取较保守值 |
| softLimit < 0 (极限低 limit) | `Math.max(0, ...)` 兜底 | ✅ |
| 自愿放血 (pixel 后) | voluntaryDrain → recovery 地板抬到 conserve | ✅ |
| P3 饥饿自锁 | expectations → p3StarveBypassUntil + bucket ≥ 3000 门禁 | ✅ 已修复 |

### 3.1.3 前馈预测可靠性

scheduler.ts canStart 中的前馈预测:

```typescript
// 上窗峰值真实触及硬上限 → P2+ 拒绝
if (stats.cpuMax10 >= this.hardLimit) return false;
// 基线持续高位 → P3+ 拒绝 (P2 仍放行)
if (priority >= 3 && stats.cpuAvg10 >= this.softLimit) return false;
```

**已修复的死亡螺旋**: 旧判据用峰值做永久惩罚 → P2/P3 被冻结保证 max 不回落 → 自锁。修正后峰值仅在真实触顶时硬拒, 基线压力只拒 P3+。✅ 自愈旁路 (expectations E2 触发) 进一步打破自锁。

**残余风险**: cpuMax10/cpuAvg10 必须为正数才视为有效 — 测试环境或 reset 首 tick stats 可能未初始化, 此时跳过前馈预测。✅ 有守卫。

### 3.1.4 错误隔离完整性

safeRun 实现:

| 特性 | 实现 | 裁决 |
|------|------|------|
| 单点错误不中断整 tick | try/catch per system/creep | ✅ |
| P0 永不冷却 | `critical = (priority === 0)` → isCoolingDown 返回 false | ✅ |
| 非 P0 连续 3 次失败 → 50-200 tick 冷却 | count >= 3 → cooldownTicks = min(50 + count × 10, 200) | ✅ |
| 计数不清零 (冷却期内保留) | K-2b: 冷却期满后再失败从上次计数继续递增 | ✅ |
| 相同错误 25 tick 限流 | shouldSuppress: errorLogInterval = 25 | ✅ |
| 错误快照入 Memory (外部采集器) | recordLastErrorSnapshot → Memory.kernel.stats.lastError | ✅ |
| 冷却跳过记 skipReason | K-2a: isCoolingDown → recordSkip | ✅ |
| PluginCooldown 事件 | K-2c: recordEvent(EventKind.PluginCooldown) | ✅ |

## 3.2 Memory 迁移链可靠性

### 3.2.1 迁移链结构

```
v0→v1→v2→v3→v4→v5→v6→v7→v8→v9→...→v38→v39
```

39 个迁移步骤, 每个注册为 `{from, to, ready?, run}`。

**幂等性**: 每个迁移函数检查目标态再动手 (如 v6: `if templateId === "compact-core-v2" continue`) ✅

**Segment 就绪门禁**: v4 迁移有 `ready: () => layoutSegmentReady()` — segment 未加载时跳过, 停在 v3, 下 tick 重试 ✅

**全步骤成功才升版本**: `migrateMemory` 依次执行 from→to, 任何一步 throw 则中断, schemaVersion 不更新, 下 tick 从断点继续 ✅

### 3.2.2 回退语义

```typescript
if (current > CONFIG.memory.schemaVersion) {
  // 高版本遇低代码: 只读不写, 输出告警
  console.log("[schema] WARNING: Memory.schemaVersion=" + current + " > code " + ...);
}
```

✅ 符合回退合同 — 不回滚数据, 停在中间态。

### 3.2.3 潜在风险

| 风险 | 严重度 | 描述 |
|------|--------|------|
| 迁移链长度 | 🟡 中 | 39 步迁移, reset 后首 tick 若 schemaVersion=0 需依次执行 39 步。但每步极轻量(遍历 Memory.rooms/creeps 赋值), 总 CPU < 1 tick 预算 |
| 迁移中断恢复 | ✅ 低 | 每步幂等, 中断后从断点续跑 |
| segment 就绪等待 | ✅ 低 | ready 门禁防止空结构写入 |
| Memory 体积膨胀 | 🟡 中 | schemaVersion=39 意味着 39 次结构变更, 部分旧字段可能未被清理迁移 (需 Phase 10 深审) |

## 3.3 Segment Store 可靠性

### 3.3.1 激活与加载

```
requestSegments() → RawMemory.setActiveSegments([0,1,2,3])
  → 下一 tick: RawMemory.segments[0..3] 可读
  → globalCache segCache 缓存读取结果
```

**就绪守卫**: `layoutSegmentReady()` 检查 `segCache().requested && RawMemory.segments[SEGMENT_LAYOUT] !== undefined`

**首 tick 问题**: global reset 后首 tick `requestedAt` 未设置, 守卫返回 false, v4 迁移延后一 tick。✅ 符合设计。

### 3.3.2 写入与 flush

```
写入 → segCache 标 dirty → tick 末 flushSegments() → RawMemory.segments[id] = JSON.stringify(data)
```

**批量 flush**: 所有 dirty segment 在 tick 末统一 flush, 避免多次 JSON.stringify ✅

### 3.3.3 激活上限

当前激活 4 个 segment (0,1,2,3), 官方限制 10 个。✅ 有余量。

## 3.4 期望自检 (Expectations) 可靠性

### 3.4.1 E1 遥测新鲜度

- 阈值: 500 tick (50 个采样周期)
- 检测: stats.lastSample 距今 > 500 tick → 违例
- 处置: 仅记录事件 + Memory, 不触发自动修复
- ⚠️ 风险: 如果 telemetry-collector 系统本身崩溃, 谁来检测? → expectations 在 kernel.run() 中运行, 只要 kernel 不挂就能检测

### 3.4.2 E2 P3 存活

- Boot 宽限: 1500 tick (reset 后系统需数个 interval 才能各跑一遍)
- 宽限倍数: interval × 3
- 检测: systemLastRun[name] 距今 > grace → 违例
- 自愈旁路: p3StarveBypassUntil = tick + 1200, bucket ≥ 3000 时生效
- ✅ 已验证: P3 饥饿 ~13h 事故的根因(前馈自锁)已修复, 旁路机制存在

### 3.4.3 旁路安全性

```typescript
const p3Escape = (Memory.kernel?.p3StarveBypassUntil ?? 0) > Game.time 
  && (Game.cpu.bucket ?? 0) >= 3000;
```

- bucket ≥ 3000 门禁: 不拿生存换观测 ✅
- 软/硬上限仍生效: 旁路只跳过前馈拒绝, 不跳过 budget 硬上限 ✅

## 3.5 Cadence 错峰可靠性

### 3.5.1 相位偏移

```typescript
function hashPhase(key: string, interval: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % interval;
}
```

- 系统名哈希分散到 [0, interval) ✅
- 房间名哈希分散到 [0, interval) ✅
- 稳定性: 同名同 interval 永远同一相位 ✅

### 3.5.2 内部二级采样一致性

```
telemetry-collector 内部有 %50/%100 门 → 必须用 systemPhase() 做相位相对判定
→ 绝对对齐 tick % N === 0 与错峰后的运行 tick 可能无交集
```

✅ phase.ts 注释明确: 内部门必须用 `(tick - phase) % N === 0` 做相位相对判定。

## 3.6 崩溃恢复路径分析

### 3.6.1 Global Reset 恢复

| 步骤 | 恢复机制 | 裁决 |
|------|---------|------|
| 1. Memory 解析 | Memory 自动从 JSON 解析 (持久) | ✅ |
| 2. schemaVersion 检查 | runMigrations 从 Memory.schemaVersion 开始 | ✅ |
| 3. globalCache 重建 | 所有字段可选 + 惰性重建 | ✅ |
| 4. econRooms (heap) | 从 Memory.rooms[].economy 快照恢复平滑值 | ✅ |
| 5. poolRooms (heap) | 从空重建 (registry + latencyRing) | ✅ |
| 6. segment 缓存 | 首 tick 请求激活, 下一 tick 可读 | ✅ |
| 7. assignmentCache | 每 tick 重建 (TaskPool.init) | ✅ |
| 8. energyLedger | 从 globalCache.energyLedger 重建 (累计计数器) | ✅ 可接受 |
| 9. A6 Ring Buffer | reset 后从空重建 | ✅ 可接受 |

### 3.6.2 部分恢复风险

| 场景 | 影响 | 严重度 |
|------|------|--------|
| econRooms 丢失 EMA | 首窗只播种不结算 (无基线) | 🟢 低 |
| poolRooms 丢失 latencyRing | 延迟统计重置 | 🟢 低 |
| corridorPathCache 丢失 | 首个规划周期重算 PathFinder | 🟢 低 |
| minCutCache 丢失 | 从 Memory 恢复 (持久化) | ✅ 无影响 |
| creepLastSeen 丢失 | 死亡事件降级为无位置 | 🟢 低 |
| squadIndex 丢失 | 下一 tick 重建 | ✅ 无影响 |
| recentCombatDeaths 丢失 | 熔断计数重置, 威胁持续时快速重建 | 🟢 低 |

### 3.6.3 死亡场景模拟

**场景 1: P0 系统全部崩溃**

如果 room-state + spawn-manager + tower-defense 同时崩溃 (safeRun 冷却):
- colonyState 不更新 → 所有消费方读到旧值 → 角色被错误冻结/放行
- 孵化停止 → 人口逐渐衰减 → 帝国死亡
- 塔防停 → 入侵无抵抗
- **自愈**: P0 永不冷却 (critical=true), 只有 throw 才会被 catch → 需要确定性 bug
- **裁决**: ✅ 设计正确, 但依赖 P0 系统代码本身无 bug

**场景 2: Memory 序列化超限**

如果 Memory 体积过大, JSON.parse/stringify 超出 tick 预算:
- 官方限制: Memory 体积 2MB, parse 时间随体积线性增长
- **当前状态**: schemaVersion=39, 需要实际运行时测量
- **风险**: 🟡 中 — RoomMemory 字段较多, 多房间时可能膨胀

**场景 3: 所有 spawn 被毁**

- spawn-manager: `if (snapshot.spawns.length === 0) return` → 无法孵化
- room-state: `needsRecovery = spawns.length === 0` → colonyState = bootstrap/recovery
- **恢复路径**: 需要建造新 spawn → construction-manager 需要 builder → builder 需要 spawn 孵化
- **死锁风险**: ❌ 存在 — 没有 spawn 就无法孵化 builder, 无法建造 spawn
- **缓解**: bootstrap 期间 worker 角色可替代 builder (worker 是万能工), 但 worker 也需要 spawn 孵化
- **裁决**: ⚠️ 存在死锁风险, 需要人工干预或保留 claimer 从外部 claim 新房

## 3.7 运行时基础成熟度评级

| 维度 | 评级 | 说明 |
|------|------|------|
| 错误隔离 | M4 | safeRun + measuredRun 覆盖全面, P0 永不冷却, 限流/冷却/事件完整 |
| CPU 预算 | M4 | 比例化 + 滞回 + 前馈 + 旁路 + 自愈, 死亡螺旋已修复 |
| Memory 迁移 | M3 | 39 步幂等链 + segment 就绪门禁, 但链长度是长期风险 |
| Segment 管理 | M3 | 4 段激活, 批量 flush, 就绪守卫, 首 tick 延迟可接受 |
| 期望自检 | M4 | E1+E2 双重检测 + 自愈旁路 + bucket 门禁 |
| Cadence 错峰 | M4 | 相位偏移 + 内部二级采样一致性保障 |
| 崩溃恢复 | M3 | global reset 恢复路径完整, 但 spawn 全毁死锁存在 |
| **综合** | **M3.5** | 运行时基础扎实, 有自愈能力, 但存在极端场景死锁 |

---

*审计继续 — Phase 4: Single Room RCL1-RCL8 Audit*
