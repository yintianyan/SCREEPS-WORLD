# PHASE38 · 时间一致性审计（Temporal Integrity Audit）

> 范围：任务书 §六（时间字段语义/窗口错位/泄漏）+ §七（跨房间一致性）
> 原则：event identity > timestamp proximity > array position

## A. 时间字段普查结论

grep 域：tick/startedAt/completedTick/decisionTick/createdTick/endTick/expireTick(sAt)/lastTick/timestamp/deadline/resolvedTick/dueTick。

### A1. startedAt 字段复用 —— 确认存在（TMP-1, P1）

`Memory.kernel.expansion.startedAt` 在**每一次状态转换**被覆写：
expansion-manager.ts :194(init), :218, :233, :325, :345, :429, :462, :559, :573, :683。

| 读者 | 用途 | 判定 |
|---|---|---|
| 各状态超时闸 (:330,:361,:456,:565,:679) | 与本状态起点比较 | ✅ 正确（每次转换重置计时器是预期语义） |
| recordExpansionOutcome duration (:724,:734) | `tick - startedAt` | ❌ 只量到最后状态的时长。30k tick 的扩张若在 integrating 停留 80t，报 duration=80 |
| lastExpansionOutcome.startedAt (global-cache.ts:349) | 注释已自认「最后一次状态转换的 tick」 | ⚠️ 字段语义与名字不符 |
| experience-collector:441 → attribution:672 | expansionDuration 归因输入 | ❌ 谎报进入学习层 |

**修复方向**：新增 `firstStartedAt`（consume 时一次性写入，永不覆盖）供 duration 使用；超时闸继续用每态 startedAt。

### A2. Prediction → Resolution 窗口

- 到期闸严格：`endTick + RESOLUTION_GRACE_PERIOD(100) <= currentTick`（calibration/ring-buffer.ts:178；常量 types.ts:376）——无提前 resolve。
- 采样过滤严格 `[startTick, endTick]`（calibration-resolution-system.ts:219,:234）——**无未来泄漏**（任务书最关切项，GREEN）。
- 缺陷 (a)：reserveHistory 反推样本时间戳假设「恰以 100t 节奏采样、末点恰为 endTick」（:216-227）——漏采或延迟时发明时间戳（CAL-1a, P2）。
- 缺陷 (b)：computeActualValue 无窗口内样本时回退取全部观测的最后一个（resolve.ts:356-360）——可能拿窗口前的旧值当 actual（后向泄漏，P2）。
- 缺陷 (c)：regime 签名一票否决——posture 翻转即把全部 in-flight 预测判 REGIME_CHANGED 排除出校准（resolve.ts:432-438）。损失率∝姿态切换频率，损失非污染。

### A3. Decision → Outcome 窗口

- 测量延迟闸正确：isDecisionReadyForOutcome（experience.ts:521-528），提前采集不可能（CF-LONG-11 固化）。
- **单槽丢失窗口确认（TMP-2, P1→并入主册 EXP 组）**：lastExpansionOutcome 是单槽 latest-wins；两个 Outcome 间隔 <collector 周期(100t) 时前者被静默丢弃，对应 Experience 于 maxDelay=8000t 后 UNRESOLVED。丢失非错配——符合「宁可 UNRESOLVED」的底线，但属于应避免的系统性数据缺口。

### A4. grace vs expiration 配对扫描

未发现僵尸配对。登记两处不一致：
- 过期边界 `>`（domain/operation/lifecycle.ts:131）vs `>=`（construction-manager.ts:383）——风格分裂（P3）。
- LOST_ROOM_GRACE=blacklistCooldown=prospectCooldown=20000t：20k 内重获自己的房仍被自家黑名单挡（P3）。

### A5. ring[last] 关联反模式扫描

全部 `getRecentRecords(...,1)` / `records[length-1]` 用于展示或预算测量，无一用于事件关联；
事件关联全走 decisionId 严格相等。✅ CLEAN（latest ≠ same event 原则未被违反——除了 EXP-1 的单槽 Outcome 通道本身）。

## B. 跨房间一致性

### B1. roomName 作为 identity
- 丢房清理：20k 宽限后删 Memory.rooms[name]（连带 intel/remoteOps/队列）+ tuning purge（memory.ts:1044-1063）✅
- 残留：宽限期内未拥有房的 spawnQueue/buildQueue/remoteOps 仍可被远矿/demand 逻辑看到（P2 观察）；layout segment 死键不随丢房清除（R1 P3 未修）
- expansionBlacklist/prospectCooldown 不区分房主变更——敌占→我夺回仍受冷却（P3）

### B2. 同 tick 代际混用
快照每 tick 构建一次、系统顺序消费；但以下系统直读 Game.* 绕过快照：
expansion-manager（Game.rooms[target]/energyCapacityAvailable/:945,1002）、war-planner liveThreat 扫描、
calibration-resolution countOwnedRooms。最坏情形：本 tick 早先系统（construction/link）改变世界后，
expansion-manager 用与快照矛盾的新值做 spawn sizing。影响限单 tick 且为资源估算级——P3 登记，无需阻断。

### B3. Empire 快照滞后
queryEmpirePlannerInput() 返回 cachedPlannerInput **无陈旧度守卫**（empire-economy.ts:230-231）；
budget 跳过期间 expansion-planner 可消费任意旧的帝国视图（实际 100-300t，理论无界）（P2，F6/TMP 组）。
建议：缓存带 writtenTick，消费者拒绝 age>X。

### B4. 新房首 tick
maintainMemory 先于 buildSnapshots 为每个 controller.my 房播种空队列（memory.ts:1032-1038）→
spawn-manager 运行时快照与队列均已就绪。**无需求空洞**；claim 发生在 creeps 相位，次 tick 才入快照=1 tick 检测延迟，非缺陷。

## C. 发现汇总

| # | 级别 | 发现 |
|---|---|---|
| TMP-1 | P1 | expansionDuration 系统性谎报（startedAt 复用） |
| TMP-2 | P1 | 单槽 Outcome 的 <100t 覆盖丢失窗口（并入主册 EXP-3） |
| TMP-3 | P2 | reserveHistory 发明时间戳 + actual 回退可取窗口前值 |
| TMP-4 | P2 | empire planner 输入无 staleness guard |
| TMP-5 | P2 | regime 一票否决的结构性数据损失 |
| TMP-6~9 | P3 | 边界符号分裂 / 黑名单跨重获 / 直读 Game 代际混用 / segment+intel 残留（承 R1） |

## D. 结论

时间完整性在**防未来泄漏**维度 GREEN（预测窗口、测量延迟、事件身份优先全部成立）；
在**过去冒充现在**维度有系统性缺陷（A1 duration、A6 分册的累计计数器与 BEFORE/AFTER 错位——同根：
写入端未冻结「事件时刻」的数据）。跨房一致性无代际性错误，仅滞后与残留类 P2/P3。
