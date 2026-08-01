# 技术债治理方案（2026-08 代码考古）

> 来源：2026-08-01 全项目代码考古（基于真实代码逐行验证，非注释）。
> 验证基线：`npm run typecheck` 全绿；`npm test` 1268/1268 通过（含 RCL8 50-creep / 5000-tick 终局集成）。
> 本文档是修改高风险区域的**前置阅读补充**：每个条目给出根因（文件:行号）、修复设计、
> 验证方式、风险与回滚。实施前仍须按 AGENTS.md 的速查表读 plan.md 对应小节。
>
> ---
>
> **评审记录（2026-08-01 第二轮独立复核）**：四组并行代码考古逐条对账。
> 结论：15 条根因 13 条完全属实、2 条部分属实（G 行号偏差、I 角色数偏差），
> 文件:行号引用绝大多数精确到行。
> **发现 1 个方案缺陷**（P0-B 修复不完整，遗漏 BFS typed array 扩容，照原案实施将恒 complete=false）、
> **2 个设计缺口**（P0-A siteCount 账本只增不减 + tick 配额仲裁缺失）、
> **6 处引用/表述偏差**（G :188、I 角色数、K 行号、min-cut 缓存非 segment、「100 site」为引擎硬限制、A 限流行号）。
> 受影响条目下均以「评审修正」小节标注；实施前必须按修正后方案执行。
>
> **评审记录（2026-08-01 第三轮 review）**：已提交 Batch 1-4 + 工作区 Batch 5 收尾审查。
> Batch 1-4 八条目（B/A/C/D/E/F/G/H/I/J）按修正后方案**全部验证通过**——含两个评审
> 修正必须项：B 的 totalNodes+四 typed array 扩容（min-cut-defense.ts:175-182）、
> A 的 siteCount 实测校正（remote-mining-manager.ts:664-667）。
> Batch 5 审查结论 **PASS_WITH_SUGGESTIONS**（工作区未提交 diff 649+ 行）：
> K/L/M/N/O + R2/R3/R4/R6/R7 全部落地，无 BLOCKER/HIGH；3 个新问题 R8-R10
> （见文末「Batch 5 验收追加」）：P2-M 缺回归测试（MEDIUM）、kernel→pathfinding
> 分层债务（MEDIUM）、P2-N 表述不精确（LOW）。**2026-08-01 复核：R8/R9/R10 已全部闭环。**

## 0. 总览

| # | 级别 | 问题 | 位置 | 修复成本 |
|---|------|------|------|---------|
| A | **P0** | 远矿角色私自 createConstructionSite，site 垄断被打破 | creeps/roles/remote-harvester.ts:258 | 中 |
| B | **P0** | min-cut 超级源汇与格 (49,49) 拆点冲突，结果静默错误 | domain/layout/min-cut-defense.ts:129-130 | 小 |
| C | P1 | remote-defender 每 tick 无缓存全房 find | creeps/roles/remote-defender.ts:51 | 小 |
| D | P1 | 走廊 incomplete 路径不进 per-tick 共享缓存，同 tick 重复寻路 | creeps/movement/pathfinding.ts:398 | 小 |
| E | P1 | traffic 模式动态目标每 tick 全量 PathFinder | creeps/movement/pathfinding.ts:491-519 | 中 |
| F | P1 | layout 规划突发 + 多房间同相位扎堆 | systems/layout-planner.ts:527 | 中 |
| G | P1 | intel.dangerUntil 双写者 | systems/remote-mining-manager.ts:232,244 × systems/room-observer.ts:188 | 中 |
| H | P1 | expansion-manager 直接 splice sponsor 的 spawnQueue | systems/expansion-manager.ts:107-112 | 小 |
| I | P1 | tuning 覆盖值无版本失效；ROLE_PARAM_MAP 不全 | config/tuned.ts:25-33,56 | 小 |
| J | P1 | domain 纯度破口：demand 直读写 Memory | domain/spawn/demand.ts:547-562,726-734 | 中 |
| K | P2 | spawn 队列 churn 循环缺可观测性 | systems/spawn-manager.ts:246-256,316-328 | 小 |
| L | P2 | __creepPathCache 无死 creep 清理 | creeps/movement/pathfinding.ts:416-420 | 小 |
| M | P2 | role-runner 引擎层硬编码 remoteHauler | creeps/engine/role-runner.ts:203 | 小 |
| N | P2 | 半径扩张全量重建候选网格 | domain/layout/constraint-placer.ts:299-302 | 中 |
| O | P2 | remote-harvester sourceId 失效时全量扫 Game.creeps | creeps/roles/remote-harvester.ts:55 | 小 |

**实施顺序**：B → A → C/D（一天内）→ E/F/G/H/I/J（本周）→ K/L/M/N/O（计划内）。
**评审修正**：B 必须连同 BFS typed array 扩容一起实施（见 P0-B 评审修正）；
A 必须先补 siteCount 实测校正与 tick 配额仲裁（见 P0-A 评审修正）。其余批次顺序不变。
**验收追加**：Batch 1-3 review 新发现 R1-R5（1 个 P2 测试缺口 + 3 个 P3 + 1 行为变更确认），
Batch 4 review 新发现 R6-R7（1 个 P2 守卫缺口 + 1 部署提醒），
见文末两节「验收追加」；R1 为 Batch 4 前置（已闭环），R2-R4/R6/R7 随 Batch 5。

---

## P0-A：site 建造垄断被打破

### 根因 [Facts]

`remote-harvester.ts:254-265` 的 `buildSourceContainer()` 在 execute 阶段直接调用
`room.createConstructionSite(ac.creep.pos, STRUCTURE_CONTAINER)`。后果链：

1. 全局 site 账本 `ctx.globalSiteCount`（kernel.ts:46）只累加**自有房**快照的
   `myConstructionSites`——远机房不是快照对象，其 site 对限流不可见。
2. construction-manager 的「全局每 tick 1 普通 + 1 紧急」限流
   （construction-manager.ts:30-31）因此只约束自有房，远机房每个 remoteHarvester
   都可各建 1 site/tick。
3. 全局 site 硬上限（游戏引擎限制，超出后 `createConstructionSite` 返回 `ERR_FULL`；
   项目自身软上限是 `CONFIG.maxGlobalSites: 7`）被静默顶满后，主基地灾后重建吃
   `ERR_FULL`，而 construction-manager 的遥测里看不到任何异常——**故障表现为远处静默、近处暴毙**。

设计动机可以理解（远机房不归 construction-manager 的快照体系管），
但「角色不得创建 site」是 plan.md §5.5 的硬约束，动机不构成豁免理由。

### 修复设计：远矿 site 收编到 remote-mining-manager

**原则**：site 创建的单一写者从「construction-manager」修正为
「construction-manager（自有房）+ remote-mining-manager（远机房）」，
角色层永远只**申请**。两个系统共享同一个全局限流账本。

1. **申请通道**：remote-harvester 的 `buildSourceContainer` execute 不再调游戏 API，
   改为写 `creep.memory.needContainer = true`（含 sourceId，已在 memory）。
   resolve 阶段的 site 检测（remote-harvester.ts:238-250）保留——已有 site 照常 build。
2. **执行者**：remote-mining-manager（P2，每 managerInterval tick 跑）新增
   `fulfillContainerRequests(remoteRoom)`：
   - 遍历该 remote 房的 remoteHarvester，收集 `needContainer` 标记；
   - 校验：source 旁 1 格内仍无 container / container site（用 creep 所在房的
     lookForAtArea，复用现有逻辑）；
   - **每 tick 全局最多 1 个远矿 site**，与 construction-manager 共用计数：
     在 globalCache 增加 `remoteSitesCreatedThisTick`，construction-manager
     的全局限流读取同一账本（globalSiteCount + 远矿已建数）；
   - 成功后清标记并写 `containerSiteCooldown` 防重复申请。
3. **账本对齐**：remoteOps 记忆 `siteCount`（我方创建的远矿 site 数），
   construction-manager 的全局上限判定改为
   `ctx.globalSiteCount + Σ remoteOps.siteCount < maxGlobalSites`。
4. **回收**：远矿目标废弃（remoteOps 条目删除）时由 remote-mining-manager
   清理对应 site（`ConstructionSite.remove()`），避免幽灵 site 占位。
   （CTO 补充：construction-manager.ts:76-80 已有**孤儿工地低频清扫**，
   收口扩张超时/失守/远矿 abandoned 的 Game 层 site——回收路径应复用该
   sweep 统一兜底，remote-mining-manager 只负责 remoteOps 账本侧，
   不要新增第二条删除路径。）

### 验证

- 单测：`fulfillContainerRequests` 的限流（构造 3 个申请 creep，断言每 tick 只建 1 个）、
  幂等（已有 site 时不重复建）、ERR_FULL 时写冷却。
- 集成：远矿场景断言「角色 memory 只有 needContainer，全 src grep
  `createConstructionSite` 仅剩 construction-manager 与 remote-mining-manager 两处」
  —— 建议固化为 role-config-parity 同款守卫测试，防回归。
- 回归：rcl 终局集成场景不动，远矿集成场景补「container 建成后 remoteHarvester
  正常 build」断言。

### 风险与回滚

remote-mining-manager 每 managerInterval tick 才跑，container 建成延迟最多
interval tick——远矿 container 是一次性基建，可接受。回滚 = 还原 remote-harvester
execute 分支（保留冷却逻辑），无 Memory 结构变更，无迁移负担。

### 评审修正（2026-08-01 复核）

1. **siteCount 账本漂移（必须修）**：`remoteOps.siteCount` 只在目标废弃时回收，
   正常建成 container 后 site 消失但计数不减 → 几个远矿房即可永久占满
   `maxGlobalSites: 7` 额度，自有房重建反而被饿死——修 A 引入新的静默问题。
   **要求**：fulfillContainerRequests 每次运行时用 `lookForAtArea` 实测该房现存
   site 数校正记忆值与实际的偏差（或 siteCount 仅作 tick 级缓存、总量判定每次实测）。
2. **tick 配额仲裁缺失（必须补）**：「每 tick 全局最多 1 个远矿 site，与
   construction-manager 共用计数」未定义竞争仲裁——自有房 emergency site 与远矿
   基建同 tick 竞争时谁赢？**要求**：远矿 site 永远让位自有房 emergency；normal
   槽位两者公平竞争。且「tick 速率」（每 tick 1 个）与「总存量」（maxGlobalSites）
   是两个维度，账本须分开写清，不要混在「同一账本」一句里。
3. **守卫测试机制澄清**：`role-config-parity` 是**运行时一致性断言**（CONFIG↔registry
   双向），与「全 src grep createConstructionSite 仅剩两处」的**静态检查**机制不同。
   **要求**：静态禁止用 eslint `no-restricted-syntax`（或自定义 rule 禁止
   remote-harvester 目录内调用），运行时断言另建集成测试 mock 断言调用来源。
4. **表述修正**：限流判定实际在 construction-manager.ts:67-73（原稿 :30-31 是
   每 tick 计数变量声明）；「100 site 上限」为游戏引擎硬限制（无代码常量）。

> **✅ 已落实（第三轮 review 验证）**：siteCount 实测校正（remote-mining-manager.ts:664-667
> 每次运行 `room.find(FIND_CONSTRUCTION_SITES)` 实测回写）+ 配额仲裁（:706-712 远矿让位
> emergency、双维度账本落 site-quota.ts）+ 守卫测试（remote-site-guard.test.ts）。

---

## P0-B：min-cut 超级源汇节点冲突

### 根因 [Facts]

`min-cut-defense.ts:95` `nodeCount = 50*50*2 = 5000`，`:129-130`
`SUPER_SOURCE = nodeCount-2 = 4998`、`SUPER_SINK = nodeCount-1 = 4999`。
而 `nodeId(x,y,isOut) = (x*50+y)*2 + isOut` → 格 **(49,49) 的 in = 4998、out = 4999**。

只要 (49,49) 不是墙（角落出口房完全常见）：

1. 它的拆点边 `vIn→vOut`（cap=1）变成 SUPER_SOURCE→SUPER_SINK 的**退化直连边**，
   每轮增广至少 +1 虚假流量；
2. 若 (49,49) 恰为出口格，`:135` 会再建 SUPER_SOURCE→vOut(=SUPER_SINK) 的
   **INF 直连边** → maxFlow 爆炸 → 必返回 complete=false 退 fallback；
3. (49,49) 的邻接边挂在 vOut(=SUPER_SINK) 上 → 汇点有出边，残余图被污染，
   割集 BFS（:215-223）结果错误。

**最恶劣的是全程无报错**——防御线要么算错，要么永远 fallback，排查无从下手。

### 修复设计

```ts
// min-cut-defense.ts:95-96
const nodeCount = 50 * 50 * 2;
const adj: Edge[][] = Array.from({ length: nodeCount + 2 }, () => []);
// :129-130
const SUPER_SOURCE = nodeCount;     // 5000，不与任何格冲突
const SUPER_SINK = nodeCount + 1;   // 5001
```

一行本质修复 + 一行容量修复。domain 纯函数，无 Memory 影响。

### 验证

- **必加回归测试**：构造合成地形——50×50 全开（含 (49,49) 非墙）、核心在中心、
  出口在四边中点；断言 `complete === true` 且 `cutSize > 0`、
  rampartPositions 不含核心格与出口格。
- 再加一角：(49,49) 为出口格的地形，断言不再恒 complete=false。
- 既有 min-cut 单测全部保持通过（修复不改变合法输入的结果，只消除冲突输入的错误）。
- 存量房：min-cut 结果缓存在 segment（min-cut-defense.ts:26 注释），
  修复后需让 defense-planner 对缓存失效一次——给缓存 key 带上算法版本号
  `mincut-v2`，旧 key 自然废弃，免迁移。

### 风险与回滚

纯函数 + 算法版本戳缓存，回滚 = 还原两行。零风险。

### 评审修正（2026-08-01 复核）

1. **BFS typed array 扩容（必须，否则新回归）**：BFS 工作区 `totalNodes`（:145）与
   parent/parentEdgeIdx/visited/bfsQueue 四个 typed array（:149-152）均以
   `nodeCount = 5000` 预分配。源汇改为 5000/5001 后 `visited[5000]` 等越界写入被
   JS typed array **静默丢弃** → `visited[SUPER_SINK]` 恒 undefined → maxFlow 恒 0
   → **修复后全部 min-cut 恒返回 `complete=false`**。`nodeCount + 2` 必须同步作用于
   totalNodes 与四个数组，否则比原 bug 更严重。
2. **「一行本质修复 + 一行容量修复」「零风险」表述不成立**——实际改动面含 4 个
   typed array 与 totalNodes；回归门槛相应提高。
3. **回归测试强化**：现有 noWalls 测试断言宽松（只查 complete/cutSize 范围，bug
   不改结论或 +1 流量不越界），捕捉不到「恒 fallback」。必须加「全开地形单出口
   maxRamparts=30 断言 `complete === true`」的显式回归。
4. **部署尖峰**：`mincut-v2` 版本戳使全部房间 min-cut 缓存一次性失效 → 部署后首个
   规划 tick N 房同时重算 5000 节点 max-flow。部署说明须注明首 tick 峰值预算或分批失效。
   （CTO 补充：不主动批量失效——版本戳打在 key 上，各房按 defense-planner 自身
   interval=10 的节拍**惰性**重算，旧 key 永不命中自然淘汰，尖峰被 interval 摊平。）
5. **缓存机制修正**：min-cut 结果缓存在 globalCache（`__minCutCache`，key=roomName
   + coreSignature）与 Memory（`roomMem.minCut`），**非 segment**（min-cut-defense.ts:27
   注释过时）。`mincut-v2` 版本戳打在两者上，不涉及 segment。

> **✅ 已落实（第三轮 review 验证）**：SUPER_SOURCE/SINK = 5000/5001
> （min-cut-defense.ts:152-153）、totalNodes+四数组扩容到 nodeCount+2（:175-182）、
> MINCUT_ALGO_VERSION="v2" 惰性失效（:42 + defense-planner.ts:60-62）、
> 显式 `complete===true` 回归（min-cut.test.ts:96-104）。

---

## P1-C：remote-defender 每 tick 无缓存 find

### 根因 [Facts]

`remote-defender.ts:51` 在 resolve 内直接 `room.find(FIND_HOSTILE_CREEPS, {filter})`，
无缓存。n 个 remoteDefender = 每 tick n 次全房 find。
同模块的 threat 判定（lifecycle.ts 的 getRoomThreats）明明已有 per-tick 缓存模式。

### 修复设计

把查找换成 per-tick per-room 缓存的共享 helper（放 creeps/support/targeting.ts，
与既有缓存模式一致：key = roomName，tick 戳失效）：

```ts
// targeting.ts 新增
export function getHostilesCached(room: Room): Creep[] {
  // globalCache 上挂 __hostileCache: { tick, byRoom: Record<string, Creep[]> }
  // tick 变化即重建；filter 复用 CONFIG.defense.allies 白名单
}
```

remote-defender.ts:51 改为 `getHostilesCached(ac.creep.room)`，
`findClosestByRange` 在缓存数组上做（数组查找不耗 find 成本）。
remote-hauler 的 :108/:155 同类缓存已有先例，照抄模式即可。

### 验证

- 单测：同 tick 两次调用返回同一数组引用（缓存命中）；tick 推进后重建。
- 集成：多 defender 同房场景，用 Game.cpu 或 find 调用计数 mock 断言每房每 tick ≤1 次 find。

### 风险

缓存数组在 tick 内不变——hostile 死亡当 tick 仍会被选中一次，
`creep.attack` 返回 ERR_INVALID_TARGET 由现有错误容忍处理。无行为回归。

---

## P1-D：走廊 incomplete 路径的 per-tick 共享缓存

### 根因 [Facts]

`pathfinding.ts:398-404`（tryCorridorPath）：`if (!result.incomplete && path.length>0)`
才 `cache.set(cKey, path)`。incomplete 时**连 per-tick 共享缓存也不写**——
同一 tick 内后续每个走向同走廊的 creep 都重跑一次 :374 的 PathFinder.search。
跨 tick 不重算是自愈设计（:474-479 注释的线上事故教训），但**同 tick 内的
N-1 次重复没有任何自愈收益**。

### 修复设计

只改共享层语义，不动持久层：

- `cache`（cKey 所在 Map，per-tick 生命周期）允许写 incomplete 结果，
  值标记 `{ path, incomplete }`；
- 命中 incomplete 共享路径时照常 `issuePathStep`（部分路径推进语义与
  引擎 moveTo 一致，:476-478 已论证）；
- **持久层 `__creepPathCache` 维持不写 incomplete**（跨 tick 自愈保留，红线不动）。

### 验证

- 单测：构造不可达目标，同 tick 两个 creep 走同走廊 → PathFinder.search 调用计数 = 1；
  下一 tick 缓存失效重算（计数 +1）。
- 回归：线上事故场景（controller 唯一落点被静态阻挡 → upgrader 沿部分路径
  走近开工）的集成测试必须保持通过。

### 风险

同 tick 内多个 creep 共享同一条 incomplete 前缀，在阻塞点会排队——
traffic-resolver 的换位/推挤链负责解堵，与现状一致。

---

## P1-E：traffic 模式动态目标的寻路限频

### 根因 [Facts]

`registerStepViaPathfinder`（pathfinding.ts:491-519）缓存 key = 目标格 + 路网 revision。
**动态目标**（flee 的逃逸点、追击中的 hostile、跟车目标）targetKey 每 tick 变 →
缓存必 miss → 每 tick 每 creep 一次 PathFinder.search，无引擎 reusePath 兜底。
战时 10 个 creep 同时 flee = 每 tick 10 次 search ≈ 10-30 CPU，直接爆 hard limit。

### 修复设计：三档限频

1. **目标驻留量化**：动态目标的 targetKey 不用精确格，用 3×3 区块 key
   （`x/3*100 + y/3`）。目标在区块内移动不触发重寻路，沿旧路径走。
2. **重寻路冷却**：`creep.memory.lastRepathAt`，同一 creep 两次
   PathFinder.search 间隔 ≥ `CONFIG.movement.dynamicRepathInterval`（建议 3），
   冷却内沿旧路径/直走（getDirectionTo）。
3. **每房每 tick 寻路预算**：globalCache 计数 `pathSearchBudget`，
   每房每 tick 上限 `CONFIG.movement.maxSearchesPerRoomPerTick`（建议 6）；
   超预算的移动意图降级为「沿旧路径走一步」或「原地让行」（交给
   traffic-resolver 仲裁），遥测记录 `movement/path-budget` skip 原因。

三档全部走 config，可独立开关；默认仅开 1+2，3 作为战时保险丝。

### 验证

- 单测：目标在 3×3 区块内移动不重算；跨区块重算；冷却期不调用 search。
- 集成：10 creep 同时 flee 的合成场景，断言每 tick search 次数 ≤ 预算。
- 性能：终局 50-creep 场景 CPU 基线对比（前后各跑 5000 tick 场景，平均 CPU 不升）。

### 风险

驻留量化在 1-2 格微操场景（tower 下绕柱）路径略钝——可接受，
flee 场景活下来优先于路径最优。

### 评审修正（2026-08-01 复核）

1. 目标驻留量化后，**路径耗尽但目标仍在同区块**时的行为必须明确：`getDirectionTo`
   直走而非原地等待；
2. 冷却内「沿旧路径」需明确旧路径已空时的降级直走路径；
3. `CONFIG.movement.dynamicRepathInterval`（建议 3）/`maxSearchesPerRoomPerTick`
   （建议 6）为**新增配置**（当前 config/movement 仅有 localMaxRooms、trafficManager、
   trafficPriority 三项）——须登记进 config/index.ts 与类型定义，不可散落硬编码；
   三档开关默认 1+2 开、3 关。

---

## P1-F：layout 规划突发与多房间同相位

### 根因 [Facts]

- 重规划触发即整段跑完（computeDistanceField + placeStructures + blueprintToTasks），
  单房单次可达数 CPU，函数内无 budget 中检；
- `layout.nextPlanTick = ctx.tick + planInterval`（layout-planner.ts:527）——
  所有房在同一 tick 初始化，此后**永远同相位**：N 个房每 50 tick 在同一 tick 扎堆规划；
- kernel 的恢复豁免（kernel.ts:241-246）会把 layout-planner 提为 P1 等效，
  在 recovery tier 也跑——紧急重建路径需要，但全量重规划不需要。

### 修复设计

1. **相位偏移**：初始化/重置 nextPlanTick 时加房间名哈希偏移：
   `nextPlanTick = ctx.tick + planInterval + (hash(roomName) % planInterval)`。
   kernel 已有 systemPhase 同款哈希（kernel/phase.ts），抽出来复用。
2. **规划分片**：把「distance field → 候选评分 → 放置 → 生成任务」拆成
   4 个 stage，存 `layout.planStage`，每 tick 只推进一个 stage。
   中间产物（distance field 是 2500 个数字）放 globalCache 不存 Memory。
3. **豁免收窄**：kernel.ts:243 的 construction-critical 豁免保留
   construction-manager，layout-planner 的豁免仅在
   `assessEmergencyRebuild(snapshot).any === true` 时成立——
   把判断从 layout-planner 内部上移到 kernel（snapshot 已有数据，成本相同），
   常规 50-tick 重规划不再享受恢复档豁免。

### 验证

- 单测：两个房名哈希不同 → nextPlanTick 错开；planStage 状态机四步走完
  结果与单 tick 版一致（快照对比 buildQueue）。
- 集成：双房场景 CPU 采样，峰值 tick CPU 下降，无规划丢任务。

### 风险

分片使规划从触发到完成最多 4 tick 延迟——50 tick 周期下可忽略。
planStage 是新增 RoomMemory 字段：按迁移规范升 schemaVersion（幂等回填 0）。

### 评审修正（2026-08-01 复核）

「把紧急重建判断上移到 kernel」会**加深内核业务耦合**——kernel.ts:241-243 已硬编码
`"construction-manager"`/`"layout-planner"` 两个 system 名（本身违反 plan.md §2.1
「内核不感知业务」）。二选一，不得含糊：
①（推荐）System 接口加可选钩子 `recoveryEligible?: (ctx) => boolean`，kernel 只调
   钩子不识名——顺带解耦既有硬编码；
②接受现状，只改豁免条件，不碰 kernel 结构。

**CTO 裁决（2026-08-01）**：采纳 ①。kernel.ts:241-243 的 system 名硬编码本身就是
plan.md §2.1 的既有违规，借本次修复一并清除——hook 由 construction-manager 自报
「buildQueue 有 P0 queued」、layout-planner 自报「assessEmergencyRebuild.any」，
kernel 只读 `system.recoveryEligible?.(ctx)`。

---

## P1-G：intel.dangerUntil 双写者

### 根因 [Facts]

`remote-mining-manager.ts:232,244` 直接写 `roomMem.intel[room].dangerUntil`；
`room-observer.ts:188`（`roomMem.intel = intel` 整体写回）路径上，observer 侧对
dangerUntil 的保留/清除实际发生在 `domain/intel.ts:102-103`（由 :154/:185 的
prev 传参驱动，:154 传参本身属实）。全 src `dangerUntil` 写入点多于一方——
写者身份靠口头约定，加一个写者就崩。

### 修复设计：字段搬家，单一写者

- `dangerUntil` 从 `intel[room]` 迁到 `remoteOps[room].dangerUntil`
  （remoteOps 的唯一写者本来就是 remote-mining-manager）；
- room-observer 停止透传该字段，intel 回归 observer 单写；
- 消费端（remote-mining 自己 :99/:230 附近、construction-manager 等）
  改读 remoteOps；防御规划若消费 dangerUntil，改从 remoteOps 读或
  由 empire-strategy 姿态中转发。
- Memory 迁移：升 schemaVersion，幂等搬运
  `intel[room].dangerUntil → remoteOps[room].dangerUntil` 后删旧字段。

### 验证

- 迁移测试：旧格式 Memory → 迁移后字段到位、幂等（跑两次不变）。
- grep 守卫测试：`dangerUntil` 的写入点全 src 仅 remote-mining-manager 一处。

### 风险

读端遗漏 = 冷却失效（远矿重复派兵）。修复 PR 必须 grep 全消费端一次性改完。

---

## P1-H：expansion-manager 直接 splice spawnQueue

### 根因 [Facts]

`expansion-manager.ts:107-112`（reclaimExpeditionCreeps）直接 splice
sponsor 房的 spawnQueue。当前安全完全依赖「spawn-manager P0 先跑」的
隐式执行顺序——顺序一变就是并发写 bug。

### 修复设计

- domain/spawn/queue.ts 增加纯函数 `cancelRequest(queue, key): boolean`
  （幂等，返回是否移除）；
- expansion-manager 改调 cancelRequest，**禁止直接 splice**；
- spawn-manager 内部 splice 保留（它是队列属主，tick 内独占消费）。
- 守卫测试：grep 断言 `spawnQueue` 的 splice 调用仅存在于 spawn-manager
  与 domain/spawn/queue。

### 验证

cancelRequest 单测（存在/不存在/重复取消幂等）；expansion 集成场景保持绿。

### 风险

纯函数抽取，零运行时风险。

---

## P1-I：tuning 覆盖值的版本失效与角色钳制

### 根因 [Facts]

- `tuned.ts:56` 读 `Memory.kernel.tuning.rooms[r].roleBounds` 覆盖 config 基线，
  **无版本戳**：CONFIG 基线升级后，旧覆盖值（可能基于旧经济假设）继续压制新基线；
- `ROLE_PARAM_MAP`（tuned.ts:25-33）实为 **7 个角色**（hauler/harvester/upgrader/
  builder/remoteHarvester/remoteHauler/reserver）——真正缺钳制的是 CONFIG.roles
  余下 6 个（distributor/worker/defender/remoteDefender/claimer/mineralMiner），
  未来被 tuning 接管时无硬钳制，evaluator 可以写出离谱值。
  （评审修正：原稿「只有 4 个」不实；另注意 tuning-engine.ts:68 有一处 bounds
  快照只对 4 角色，补全钳制时两处须同步。）

### 修复设计

1. **版本戳**：`Memory.kernel.tuning.baselineVersion = CONFIG.tuning.baselineVersion`
   （新增 config 常量）。tuning-engine 每次写入前比对：Memory 版本 ≠ config 版本 →
   清空 rooms 覆盖并重新定版。CONFIG 角色基线改动时人工 +1。
2. **通用钳制**：ROLE_PARAM_MAP 补全全部在役角色（与 bootstrap 注册表对齐，
   role-config-parity 测试同步加断言）；钳制规则统一走 clampParam。
3. 迁移：升 schemaVersion，幂等初始化 baselineVersion（缺失 → 当前版本，
   等价于「信任存量覆盖」或「清零重来」，建议清零重来——自调优会重新收敛）。

### 验证

- 单测：版本不匹配触发清零 + 重新定版；各角色覆盖值被钳制在 map 范围内。
- 集成：tuning-engine 500-tick 周期场景，断言清零后 3 个周期内重新收敛。

### 风险

清零瞬间人口边界回到基线，可能引起一波补员孵化——选 bucket 高位时部署。

---

## P1-J：domain 纯度收口（demand 的 Memory 破口）

### 根因 [Facts]

两处迟滞状态在 domain 内直读写 Memory，与其自述「不访问 Game/Memory」（:235）矛盾：

1. `distScaleUpSince`（demand.ts:547-562）——distributor 扩编确认计时器；
2. `builderPressureState`（demand.ts:726-734）——builder 压力迟滞带状态。

这两个字段还游离在迁移体系之外（无 schema 管理）。

### 修复设计：状态提升为显式输入输出

- `RoomDemandContext` 增加 `prevHysteresis: { distScaleUpSince?: number; builderPressureState?: 'full'|'shrinking' }`；
- `evaluateDemand` 返回结果增加 `nextHysteresis`（同构）；
- spawn-manager（适配层）负责：调用前从 RoomMemory 读 → 传入；
  调用后把 nextHysteresis 写回 RoomMemory。
- 两个字段登记进 RoomMemory 类型（global.d.ts）+ 升 schemaVersion
  幂等建档（畸形数据自愈模式，照抄 v5/v10 先例）。

domain 恢复纯函数，两个迟滞状态获得迁移保护，单测不再需要 mock Memory。

### 验证

- 单测：demand 全部现有测试改为传 prevHysteresis（去掉 Memory mock），
  断言 nextHysteresis 输出；
- 集成：distributor 扩编延迟、builder 压力迟滞两个场景行为与修复前逐 tick 一致
  （用终局场景的行为快照 diff 验证）。

### 风险

适配层忘记写回 = 迟滞失效（每 tick 从零确认，distributor 永不扩编）。
用一个集成断言覆盖：尖峰持续 > delay 后 distTarget 必须放行。

---

## P2 组（计划修，一并给出方案要点）

| # | 方案要点 |
|---|---------|
| K spawn churn | churn 本身是已论证的设计（worker/harvester 黑名单豁免 + cleanQueue 重建，**实现在 spawn-manager.ts:52-64 + domain/spawn/queue.ts:74-89**；评审修正：原稿 :246-256/:316-328 实为 P0 阻塞/降级逻辑，非 churn 循环），缺的是**可观测性**：cleanQueue 删除处（queue.ts:84-85）`recordSkip('spawn/churn/{role}')`，遥测 skipHotspot 可见即可。不改行为。 |
| L 路径缓存泄漏 | `__creepPathCache` 挂到 obj-cache 的 tick-flip 钩子：每 100 tick 扫一次，删除 Game.creeps 中不存在的 key。O(cache) 每 100 tick，成本可忽略。 |
| M 引擎硬编码 | role-runner.ts:203 的 remoteHauler 特判下沉为 RolePolicy 可选钩子（如 `idleBehavior`），引擎只调钩子不识角色名。 |
| N 网格重建 | constraint-placer 半径扩张改为增量：缓存旧半径的候选与评分，仅计算新增环带（半径 r 到 r+1 的 O(r) 格），避免 9 倍重算。 |
| O 全量扫描 | remote-harvester.ts:55 的 sourceId 失效重扫，从 `Object.values(Game.creeps)` 收窄为「同 remoteTarget 房的 creep」（先按 room 过滤再遍历），或改用 snapshot 的 sourceOccupancy 反查。 |

---

## 实施节奏

| 批次 | 内容 | 合并门槛 |
|------|------|---------|
| Batch 1（已完成 ✅） | B（min-cut 源汇 + 四数组扩容 + 版本戳缓存 + 回归测试） | typecheck + test + build 全绿 |
| Batch 2（已完成 ✅） | A（远矿 site 收编 + site-quota 账本）+ C（defender 缓存）+ D（走廊共享） | 同上 + 远矿集成场景 |
| Batch 3（已完成 ✅） | E（寻路限频）+ F（layout 分片/相位 + recoveryEligible）+ G（dangerUntil 搬家） | 同上 + 双房 CPU 采样 |
| Batch 4（已完成 ✅） | H（cancelRequestsByHome）+ I（tuning 版本戳 + TUNABLE_ROLES 单源）+ J（domain 收口）+ R1（分片等价测试，前置） | 同上 + 迁移测试 |
| Batch 5（已提交 ✅） | K/L/M/N/O + R2/R3/R4/R6/R7（review PASS_WITH_SUGGESTIONS；R8/R9/R10 已闭环，见文末「Batch 5 验收追加」） | 同上 + 验收追加测试（含 R8 回归锁） |

**每批独立 PR、独立回滚**。schemaVersion 变更（F/G/I/J 各一次）集中在 Batch 3-4，
部署选 bucket 高位窗口，部署后观察 1000 tick 的遥测 skipHotspot 与 CPU 均值。

---

## Batch 1-3 验收追加（2026-08-01 review）

验收基线：typecheck 全绿；1353 测试全过（较基线 +85）。B/A/C/D/E/F/G 七项
按修正后方案完整落地（min-cut 四数组扩容、site-quota 双维度账本、
recoveryEligible 钩子、限频三档 config 化、4-stage 分片 + roomPhase 错峰、
dangerUntil 唯一写者 + v15-17 迁移）。以下为 review 新发现问题，纳入后续批次：

| # | 级别 | 问题 | 位置 | 去向 |
|---|------|------|------|------|
| R1 | P2 | 缺「4-stage 输出 == 单 tick 输出」端到端等价测试。方案验证节要求快照对比 buildQueue，实现以分 stage 单测替代——「分片不改变规划结果」这一核心契约无直接断言 | tests/unit/systems/layout-planner.test.ts | **Batch 4 开工前补**：合成房间 4-tick 连续执行 vs 预期 buildQueue 快照对比 |
| R2 | P3 | 多源远矿房 container 串行化：房内任一 container site 存在即清全部 source 组申请标记 → B 源等 A 源建成；A 的 site 成孤儿时 B 被一并阻塞至 orphan sweep 清场 | remote-mining-manager.ts:662-666 | Batch 5：「有 site 即清标记」收窄到同 source 组，或在注释中写明串行语义 |
| R3 | P3 | fulfillContainerRequests 的 creep 收集在 per-room 循环内，R 个 active 远矿房 = R 次全 Game.creeps 遍历（managerInterval 低频下可接受） | remote-mining-manager.ts:650 | Batch 5：收集提出循环外，按 remoteTarget 单遍分桶 |
| R4 | P3 | 档 1 区块量化对静态目标同样生效（config 名 quantizeDynamicTarget 但实现不区分动静态）：同 3×3 区块内两个相邻目标共享缓存 key，错走 1 tick 后路径耗尽自愈。概率低代价小，接受现状 | pathfinding.ts:562-566 | Batch 5：改名（如 quantizeTargetKey）或补注释，防后来者按名误解 |
| R5 | 确认项 | kernel 豁免语义收窄：旧「任一房 recovery 即豁免 CM+LP」→ 新「CM 自报 P0 queued 关键基建 / LP 自报紧急重建缺口」。recovery 但结构完好的房间普通建造在 CPU recovery 档不再豁免——更正确，但属行为变更 | kernel.ts:222-231 + 两系统 recoveryEligible | 已确认。部署后遥测盯建造停顿是否符合预期 |

---

## Batch 4 验收追加（2026-08-01 review）

验收基线：typecheck 全绿；1380 测试全过（较 Batch 1-3 基线 +27）。
H/I/J/R1 四项完整落地，其中两处实现优于原方案：cancelRequestsByHome
比按 key 撤销更贴合拓荒 abort 语义；v18 迁移「建档不定版」故意让
tuning-engine 首跑检测 undefined ≠ CONFIG 触发清零（迁移直接定版会让
旧覆盖存活、修复目标自我瓦解）。以下为 review 新发现问题：

| # | 级别 | 问题 | 位置 | 去向 |
|---|------|------|------|------|
| R6 | P2 | TUNABLE_ROLES ↔ CONFIG.roles 无双向守卫。tuned.ts 注释称对齐由 role-config-parity 断言，但该测试只覆盖 CONFIG.roles ↔ bootstrap 注册表——新增第 14 个角色时 TUNABLE_ROLES 静默漏配（无钳制、无快照），正是 I 项要消灭的漂移类别断在最后一环 | config/tuned.ts:24-47 | Batch 5：role-config-parity（或新守卫）断言 TUNABLE_ROLES 与 Object.keys(CONFIG.roles) 双向相等 |
| R7 | 提醒 | baselineVersion 检查在 tuning-engine 每 500 tick 评估周期内执行，CONFIG 升版后旧覆盖最长残留 500 tick。行为可接受 | systems/tuning-engine.ts:61-72 | 已确认。Batch 5 顺手把该预期写进 CONFIG.tuning.baselineVersion 注释 |

---

## Batch 5 验收追加（2026-08-01 review）

验收基线（工作区未提交状态）：typecheck 全绿；112 测试文件 1312/1312 通过。
K/L/M/N/O 五项 + 前批遗留 R2/R3/R4/R6/R7 全部落地，review 结论 **PASS_WITH_SUGGESTIONS**
（无 BLOCKER/HIGH，3 个新问题 R8-R10 见下表）。

### 实现验证表

| # | 条目 | 实现验证 |
|---|------|---------|
| K | spawn churn 可观测性 | ✅ `cleanQueue` 加可选 `onPurge` 回调（queue.ts:97-129，不传回调行为完全等价；purgedKeys 仍只含 retries 路径，黑名单契约不变）；spawn-manager 转译 `recordSkip('spawn/churn/{role}/{reason}')`（spawn-manager.ts:53-64）；6 测试覆盖两路删除/顺序/兼容性 |
| L | 路径缓存清理 | ✅ `pruneDeadCreepCache` 放 pathfinding（cache 属主，memory.ts 不感知字段名），kernel 每 100 tick `safeRun` 触发（kernel.ts:95-101）；6 测试（空/全活/全死/混合/幂等/未初始化） |
| M | 引擎去硬编码 | ✅ remoteHauler 特判下沉为 `RolePolicy.shouldIdleWhenNoCandidate` 可选钩子（action-types.ts:93-106、role-runner.ts:201-208、remote-hauler.ts:166-173）；逐行验证与旧硬编码语义**完全等价**（`||` 短路保证钩子仅在「有 remoteTarget 且不在目标房」求值；role 由 policy 归属保证）。**缺回归测试 → R8** |
| N | 增量网格 | ✅ `buildCandidateGrid` 增量环带 + (x,y) tiebreaker 确定性总序（constraint-placer.ts:141-213, 327-341）；4 等价性测试（无墙 r8 / 墙 r10 / 向后兼容 / 增量条件不满足回退全量） |
| O | 扫描收窄 | ✅ `Object.values(Game.creeps)` → `creep.room.find(FIND_MY_CREEPS)`（remote-harvester.ts:53-62）；过路房兄弟不计入的语义差异显式注释 + 2 定向测试 |
| R2 | 多源房隔离 | ✅ `sourcesWithSite` 按 site 邻接 source（range<=1）收窄清标记（remote-mining-manager.ts:664-707）；2 测试验证「A 源 site 不阻塞 B 源申请」 |
| R3 | 收集提桶 | ✅ 申请者收集提到 per-room 循环外单遍分桶，O(M) 替代 O(R×M)（remote-mining-manager.ts:641-652） |
| R4 | 区块量化注释 | ✅ config/index.ts 加 R4 注：实现不区分动静态目标，同区块相邻目标错走 1 tick 自愈，接受现状（改名收益不抵成本） |
| R6 | TUNABLE_ROLES 双向守卫 | ✅ role-config-parity.test.ts 补 `TUNABLE_ROLES ↔ Object.keys(CONFIG.roles)` 双向断言 |
| R7 | baselineVersion 窗口注释 | ✅ config/index.ts 加 R7 注：旧覆盖最长残留 500 tick（evalInterval），可接受，需立即清空可手动改 Memory |

### 新发现问题（本轮无 BLOCKER/HIGH）

| # | 级别 | 问题 | 位置 | 去向 |
|---|------|------|------|------|
| R8 | MEDIUM | P2-M 钩子化**零回归测试**：`shouldIdleWhenNoCandidate` 重构无测试锁住等价性（grep tests/ 零命中）。逐行验证等价成立，但未来改动可致 idle→ensureHome 死循环回归（原线上问题） | role-runner.ts:201-208 + remote-hauler.ts:166-173 | ✅ 已补 [tests/unit/role/should-idle-hook.test.ts](../tests/unit/role/should-idle-hook.test.ts)：3 断言（work@home→idle / acquire@remote 不 idle / 无钩子角色默认不 idle） |
| R9 | MEDIUM | kernel 直接 `import { pruneDeadCreepCache } from "../creeps/movement/pathfinding"`（kernel.ts:17,95-101）——kernel 刚用 recoveryEligible 移除 system 名字硬编码，又引入业务模块具体函数依赖，违反 §2.1「内核不感知业务」分层方向。权衡合理（cache 属主清理、100 tick 低频）但值得登记 | kernel.ts:17,95-101 | ✅ 已决策：接受现状并在 kernel.ts:17-21 注释登记权衡（commit 5300517）；出现 3+ 维护钩子时再提取 registry 钩子机制 |
| R10 | LOW | P2-N 注释「避免 9 倍重算」不精确——增量只省**评分计算**（opennessAt + energyPenalty），`candidates.sort()` 仍是 O(n log n) 全量排序，候选数未减 | constraint-placer.ts:327 | ✅ 已修正：constraint-placer.ts:332 注释改为「sort 仍 O(n log n)，增量只省评分计算」 |

**验收更新（2026-08-01 复核）**：R8/R9/R10 已全部闭环，本表无未决项。

## 红线

- 修 A 时**不得**顺手把 construction-manager 的限流计数改成遍历
  `Game.constructionSites`（每 tick O(n) 对象遍历，是拿 CPU 换省心）；
- 修 D 时**不得**把 incomplete 写入持久层 `__creepPathCache`（:474-479 的线上事故
  教训，跨 tick 自愈是红线）；
- 修 E 时三档限频全部 config 化、可独立开关——禁止硬编码常量；
- 修 B 时**必须**同步扩容 `totalNodes` 与四个 BFS typed array（:149-152）到
  `nodeCount + 2`——只改源汇索引会因越界写入静默丢弃导致恒 `complete=false`；
- 修 A 时 `remoteOps.siteCount` **必须**带实测校正（site 建成/失效即减），禁止
  只增不减的账本——否则远矿会永久占满 `maxGlobalSites` 额度、饿死自有房重建；
- 所有 Memory 新字段走迁移规范（升版本、幂等、先写后删），与 plan.md §3.4 一致。
