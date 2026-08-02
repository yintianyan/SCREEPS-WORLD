# 布局系统最优方案（2026-08）

> 范围：在不考虑 AGENTS.md「核心结构建成后不自动拆改」约束下，从资源流网络模型
> 出发，重新设计 Screeps 房间布局系统。覆盖结构放置、link 网络、道路、防御、
> RCL1-8 演化、缺口审计、死资产拆改、重开稳定性。
>
> 本文先用架构八问与 V2 决策协议审视初版设计，修正 12 处漏洞后给出最优方案。
>
> 关联：[plan.md §5.5/5.6](plan.md)、[empire-mind-map.md](empire-mind-map.md)、
> [remediation-plan-2026-08.md](remediation-plan-2026-08.md)、
> [postmortem-2026-08-02-private-snapshot.md](postmortem-2026-08-02-private-snapshot.md)。

---

## 实施状态（2026-08-02 复核）

| 阶段 | 状态 | 关键改动 |
|---|---|---|
| P0-1 link 分配顺序 | ✅ 已完成 | RCL5 controller link 提到 storage 之前 |
| P0-2 gaps 角色感知 | ✅ 已完成 | link 按角色计数（source/controller/storage/hub）+ 死资产暴露 |
| P1-1 死资产检测 | ✅ 已完成 | 三重校验（source + energy=0 + 无 outlet）持续 500t |
| P1-2 tower RCL5+ 分桶 | ✅ 已完成 | controller 桶 + anchor ≤5 硬约束降级 ≤7 + 通用池兜底 |
| P1-3 link fallback | ✅ 已完成 | isLinkConstrained 标记 + 1000t 过期重试 + shouldHave 谓词 |
| P1-4 受限拆改通道 | ✅ 已完成 | 完整 Plan 契约（waiting→validating→success/abort/fallback）+ 战时暂停 + 1000t 冷却 |
| P2 枢纽道路/走廊路/MVC/rampart | ✅ 已完成 | 枢纽路 createCoreRoadTasks + 走廊路 globalCache 缓存 + MVC auditLinkRoleGaps + rampart 独立计额 |
| P3 热度路/出口封堵增强 | ✅ 已完成 | minTrafficForRcl 动态阈值（RCL2-6=5, RCL7-8=50）|
| min-cut v3（漏洞 #13/#14） | ✅ 已完成 | wall 割集 + 8 邻接 + 切角规则 + wall/rampart 分流（MINCUT_ALGO_VERSION=v3）|
| 可观测性指标（漏洞 #11） | ✅ 已完成 | LayoutMetrics（deadAssetRate/linkUtilization/dismantleCount/mvcGapCount/defenseWallRatio 等）|

**质量门槛**：typecheck + 全部测试通过 + build 成功。

**实现与设计差异**（2026-08-02 review 修正）：
- `linkConstrained` / `dismantlePlans` / `lastDismantleTick` / `dismantleCount` / `corridorPathCache` 存 globalCache heap 而非 segment（避免 schema 升级；global reset 丢失可接受 — 重开后重新评估）
- 战时判定用 `colonyState === "defense"`（代码实际值），非设计文档的 "alert/defense"
- `schemaVersion` 实际 = 25（P0-P3 改动未升 schema — 新增字段全走 heap）
- `findReplacementForDeadLink` 只匹配 `state === "queued"` 任务（done 表示替代已建成但死资产仍在 → 应走 fallback）
- **热度路阈值**：设计文档原写 RCL4-6=30、RCL7-8=50，但代码当前用 `minTrafficForRcl`（RCL2-6=5, RCL7-8=50）。RCL2-6 保持 5 是已验证的早期优化值（修复了旧值 10 对 RCL2-3 太严的病灶），直接套文档 30/50 会让 RCL4 道路突然修不出
- **走廊路缓存存储**：设计文档原方案是 segment 缓存 + schemaVersion 22 升级，改为 globalCache heap 存储（受 maxRoadsPerCycle=12 + hasPendingCritical 门禁限制，CPU 影响有限，且 schema 升级风险高于收益）
- **min-cut v3 割集分流**：设计文档原写"wall site 名额竞争 → 新增 wallSites 独立计额"，实际实现按位置特征分流（有结构 → rampart 共格，无结构 → wall 阻挡通行），复用既有 road/rampart site 名额管理

---


## 一、世界快照（最小世界状态）

### 1.1 事实（可复现观测）

- **私服 W3N7 RCL5**：
  - storage @ (38,16)，周围 8 格全被 extension(4)/road(4) 占满 → storage link 几何上无法建成
  - controller @ (17,42)，周围 2 格内仅 1 container(18,43) + 1 road(19,44)，空旷可建
  - 2 个 source link：@ (38,4) 紧邻 source(38,3)、@ (11,21) 紧邻 source(12,21)，energy 均为 0（死资产，harvester 不灌）
  - controller container @ (18,43) energy=0 → upgrader 长途取能（33 格到 storage）
  - source container @ (37,4) energy=2000、@ (11,20) energy=2000（满载）
- **当前架构事实**（源码可查）：
  - [layout-planner.ts L569-L608](../src/systems/layout-planner.ts#L569-L608) link 分配顺序：source(1)→storage→controller→source(rest)
  - [task-factory.ts createStorageLinkTask](../src/domain/layout/task-factory.ts#L490-L536) `findAdjacentBuildable` 只搜 1 格邻域
  - [gaps.ts](../src/domain/layout/gaps.ts) 按结构**类型**计数，不区分 link 角色
  - [constraint-placer.ts TYPE_PLACE_ORDER](../src/domain/layout/constraint-placer.ts#L178-L187) link 仍保留 priority=3（历史残留）
  - `schemaVersion = 25`（见 `CONFIG.memory`；P0-P1 改动未升 schema — 新增字段全走 globalCache heap）

### 1.2 派生状态

- link 利用率 = 0/2（死资产率 100%）
- upgrader 通勤成本 = 33 格 × 2（往返）× plain fatigue(2) = 132 fatigue/tick 循环
- 物流瓶颈 = controller 升级链断裂（source link 死资产 + controller container 空置）

### 1.3 未知量

- 其他房间是否有类似问题（缺多房 snapshot）
- 拆改机制的 CPU 成本（未 profile）
- 破碎房几何放不下 controller link 的概率（未统计）

### 1.4 瓶颈定位

| 层级 | 瓶颈 | 根因 |
|---|---|---|
| 信息 | gaps 不区分角色 → 死资产骗过检测 | [gaps.ts](../src/domain/layout/gaps.ts) 按类型计数 |
| 位置 | storage link 几何死锁 → 不拆改无法闭环 | [findAdjacentBuildable](../src/domain/layout/task-factory.ts#L635) 只搜 1 格 + AGENTS.md 不拆改约束 |
| 决策 | link 分配顺序固定 → 不按 RCL 阶段调整 | [layout-planner.ts L569-L608](../src/systems/layout-planner.ts#L569-L608) |

---

## 二、大师级审核（架构八问 + V2 协议）

### 2.1 架构八问审视

| 问 | 答案 | 漏洞 |
|---|---|---|
| 系统为何存在，失败损失？ | 最小化物流成本 + 最大化防御纵深 | 失败造成死资产、能量流断裂、升级链通勤 — 已验证 |
| 属于哪层？ | Planning(layout-planner) + Execution(construction-manager) + Feedback(gaps) | **缺失 Strategy 层**：当前是「按 RCL 模板填充」，没有「资源流目标驱动」；但 MVC 是合理简化，不必引入完整 Strategy |
| 真相源？ | 结构数量=CONTROLLER_STRUCTURES；link 角色=classifyLinkRole | **缺失**：死资产真相源、MVC 真相源未定义 |
| 谁决策谁执行？ | layout-planner 决策 + construction-manager 执行（解耦）✓ | 死资产检测归 link-system 还是 layout-planner 未明确 |
| 生命周期？ | BuildTask: queued→site→done ✓ | **死资产拆改任务的生命周期不完整**：缺 ttl/abort/fallback |
| 降级恢复？ | global reset → planStageData 丢失 → 重置 planStage=0 ✓ | **战时降级缺失**：拆改在 alert/defense 时应暂停 |
| 验证指标？ | gaps 落盘 Memory.kernel.layoutGaps ✓ | **指标不足**：缺死资产率、link 利用率、拆改次数 |
| 十倍规模瓶颈？ | roomPhase 哈希偏移消除 CPU 尖峰 ✓ | 死资产检测每 tick 每 link O(1)，10 房可接受 |

### 2.2 V2 协议审视：14 处漏洞

| # | 漏洞 | 协议条款 | 严重度 |
|---|---|---|---|
| 1 | 死资产拆改 Plan 契约不完整（缺 ttl/abort/fallback） | V2 §2 Plan 必须有完整生命周期 | P0 |
| 2 | link 网络演化缺 fallback（controller link 几何放不下时无降级） | V2 §10 退出条件 | P0 |
| 3 | linkHasOutlet 定义不清晰 | V2 §1 派生状态必须记录 source | P0 |
| 4 | tower RCL5+ controller 分桶可能两塔都在 controller 侧 | V2 §7 战时目标感 | P1 |
| 5 | 走廊路 segment 缓存失效条件不完整 | V2 §9 Recovery 与 Schema | P1 |
| 6 | MVC 缺口与 GAP_RETRY_INTERVAL 关系不清 | V2 §6 CPU 硬预算 | P1 |
| 7 | 枢纽道路 RCL2+ 启用未评估 CPU 成本 | V2 §6 CPU 硬预算 | P2 |
| 8 | 走廊路缓存是新增 segment 字段，未升 schemaVersion | V2 §9 迁移规范 | P0 |
| 9 | 核心 rampart 覆盖会与 extension 竞争 site 名额 | V2 §2 资源预算 | P1 |
| 10 | 拆改在战时未暂停 | V2 §7 战时状态机 | P1 |
| 11 | 缺死资产率/link 利用率/拆改次数指标 | V2 §可观测反馈 | P2 |
| 12 | 拆改误拆活资产的风险缓释不足 | V2 §2 fallback | P1 |
| 13 | **min-cut 用 rampart 作割集顶点 — rampart 不阻挡通行，割集语义错误** | V2 §1 派生状态必须反映真实世界 | **P0** |
| 14 | **min-cut 正交 4 邻接忽略对角线移动 — 算法割集不完整** | V2 §1 派生状态必须反映真实世界 | **P0** |

---

## 三、最优方案（优化后设计）

### 3.1 结构放置优先级（修订）

**[事实]** 当前 [TYPE_PLACE_ORDER](../src/domain/layout/constraint-placer.ts#L178-L187)：

```
spawn(0) > storage(1) > tower(2) > link(3) > terminal(4) > factory(5) > lab(6) > extension(7)
```

**最优方案**：

```
spawn(0) > storage(1) > tower(2) > terminal(3) > factory(4) > lab(5) > extension(6)
```

- **移除 link**：link 走 [task-factory](../src/domain/layout/task-factory.ts#L363-L536) 角色感知流程，不参与通用放置器
- **extension 三档优先级**（扩展 [BUILD_STRATEGY](../src/domain/layout/constraint-placer.ts#L100-L105)）：
  - RCL2-4：priority 1（早期能量上限关键）
  - RCL5-7：priority 2（后期批量填充）
  - RCL8：priority 3（最后填充）

### 3.2 Link 网络演化（含 fallback）

> **实施状态：✅ 已完成（2026-08-02）**。P0-1 分配顺序 + P1-3 fallback（isLinkConstrained + shouldHave 谓词）。
> 实现见 [layout-planner.ts](../src/systems/layout-planner.ts) + [task-factory.ts](../src/domain/layout/task-factory.ts)。

**最优 RCL 演化路径**（修订 §三）：

| RCL | 槽位 | 首选分配 | Fallback 1 | Fallback 2 |
|---|---|---|---|---|
| RCL5 | 2 | source(1) + controller | source(1) + storage（controller 几何失败时） | source(1) only（storage 也失败，标记待拆改） |
| RCL6 | 3 | + storage | + controller（RCL5 未建成时补） | 维持 2 link |
| RCL7 | 3 | 维持 | — | — |
| RCL8 | 6 | + source(2) + 2 hub | + 1 hub + 1 source | 按几何可用性分配 |

**关键修订**（vs 初版）：
- RCL5 时 **controller 优先于 storage**（当前是 storage 优先，导致 storage 几何失败后 controller 被跳过）
- **补充 fallback 链**（漏洞 #2）：几何放不下时降级到下一角色，不静默跳过

**linkHasOutlet 明确定义**（漏洞 #3）：

```typescript
/** source link 的 outlet = 存在可达的 controller link 或 storage link */
function linkHasOutlet(
  linkRole: LinkRole,
  otherLinks: readonly LinkInfo[],
): boolean {
  if (linkRole !== "source") return true; // 非 source link 不需要 outlet
  return otherLinks.some(l => l.role === "controller" || l.role === "storage");
}
```

**死资产判定**（三重校验，漏洞 #12）：
1. `link.role === "source"`
2. `link.energy === 0` 持续 500t（`deadAssetSince` in globalCache）
3. `!linkHasOutlet(link.role, otherLinks)` — 无 controller/storage link 可达

### 3.3 死资产拆改（完整 Plan 契约，漏洞 #1/#10/#12）

> **实施状态：✅ 已完成（2026-08-02）**。实现见 [link-system.ts](../src/systems/link-system.ts)
> （DISMANTLE_COOLDOWN/TTL/VALIDATION_DELAY 常量 + 计划跟踪函数）、
> [layout-planner.ts](../src/systems/layout-planner.ts)（stage 2 拆改规划）、
> [construction-manager.ts](../src/systems/construction-manager.ts)（processDismantlePlans 执行）。
> 测试见 [dismantle-plan-lifecycle.test.ts](../tests/unit/systems/dismantle-plan-lifecycle.test.ts)
> + [dismantle-replacement-match.test.ts](../tests/unit/systems/dismantle-replacement-match.test.ts)。

**Plan 契约**（V2 §2）：

```typescript
interface DismantlePlan {
  objective: "消除死资产 link，恢复 link 网络吞吐";
  owner: "layout-planner（决策）+ construction-manager（执行）";
  budget: {
    energy: 1000,        // link 建造成本
    cpu: 0.1,            // 每 tick 检测成本
    spawn: 0,            // 不需要 spawn
    time: 1500,          // 最多 1500t 完成（500t 检测 + 1000t 拆改冷却）
  };
  priority: 1;           // 与 container 同级
  ttl: 1500;             // 1500t 未完成则 abort
  success: "替代 link 建成 + 旧 link destroy + 新 link 被灌能(energy>0)";
  blocked: "替代 link 几何放不下 → 标记房间为 linkConstrained，不再拆改";
  abort: "ttl 到期或房间进入 alert/defense → 取消拆改，保留旧 link";
  fallback: "接受死资产，标记 linkConstrained，避免重复拆改空转";
}
```

**战时降级**（漏洞 #10）：
- 房间 `colonyState === "defense"` 时暂停拆改（不新建计划、不 destroy 旧 link），保留现有计划待恢复
- 房间状态恢复 `normal`/`bootstrap`/`recovery` 后继续处理
- **实现注**：代码实际只有 `defense` 状态（无 `alert`），用 `isRoomInDefense()` 判定

**拆改流程**：

```
1. 死资产检测（link-system，每 tick）
   ↓ source link energy=0 && !linkHasOutlet 持续 500t
2. 替代位置搜索（layout-planner，角色感知 findAdjacentBuildable）
   ↓ 找到可建位置
3. 拆改任务入队（priority 1）
   - 先建新 link（createSourceLinkTasks 等已有流程）
   - 新 link 建成后，旧 link 标记 toDismantle
4. construction-manager 执行
   - 新 link site 创建 → 建造 → 完成
   - 旧 link structure.destroy()
5. 验证（500t 后）
   - 新 link energy > 0 → 拆改成功，清除 deadAssetSince
   - 新 link energy = 0 → 替代位置也是死资产，标记 linkConstrained，fallback
```

**拆改限制**：
- 每房每 1000t 最多 1 个 link 拆改（globalCache 跟踪 `lastDismantleTick`）
- 不拆 spawn/storage/tower（核心结构）
- 不拆 `energy > 0` 的 link
- **先建替代，后拆旧**（避免空窗）

### 3.4 RCL1-8 最小可用配置（MVC）

**[事实]** CONTROLLER_STRUCTURES 是结构数量真相源。MVC 在此基础上按资源流优先级定义每 RCL 的最小可用配置。

| RCL | MVC 配置 | 资源流目标 |
|---|---|---|
| RCL1 | 1 spawn + 1 road(spawn→source1) | harvester 站桩采矿 |
| RCL2 | +5 ext + source container×2 + controller container + 枢纽路 | upgrader 站桩升级，0 通勤 |
| RCL3 | +1 tower(anchor 侧) + 补齐 10 ext + 1 road(spawn→source2) | 基础防御，能量上限 1300 |
| RCL4 | +1 storage + 补齐 20 ext + 走廊路 + rampart 线 | 储能启动，hauler 物流成型 |
| RCL5 | +2 links(source1+controller) + 补齐 30 ext + 2 towers + 核心 rampart | link 网络启动，0 通勤升级 |
| RCL6 | +1 link(storage) + 1 terminal + 1 extractor + 1 mineral container + 3 labs + 补齐 40 ext | 工业链启动 |
| RCL7 | 维持 3 links + +1 spawn + 1 factory + 补齐 6 labs + 3 towers + 50 ext | 工业链满配，多 spawn 容错 |
| RCL8 | +3 links(source2+2 hub) + +1 spawn + 补齐 6 towers + 10 labs + observer/powerSpawn/nuker + 60 ext | 满配帝国 |

**MVC 与 GAP_RETRY_INTERVAL 关系**（漏洞 #6）：
- MVC 缺口 > 0 立即触发规划（不等 nextPlanTick）
- 但受 `nextGapPlanTick` 节流（500t 慢速重试），不每 tick 强制触发
- 复用现有 [GAP_RETRY_INTERVAL](../src/systems/layout-planner.ts#L43) 机制

### 3.5 角色感知缺口审计

**[事实]** [gaps.ts](../src/domain/layout/gaps.ts) 当前按类型计数，2 死资产 source link 骗过 `link: 2` 满足判定。

**最优方案**：

```typescript
interface MvcGaps {
  /** MVC 缺口（必须闭合，影响当前 RCL 最小可用配置） */
  mvc: Record<string, number>;
  /** 目标缺口（可延迟，MVC 之外的额外配置） */
  target: Record<string, number>;
  /** 角色级缺口（仅 link，区分 source/controller/storage/hub） */
  linkRoles: {
    source: number;      // MVC 期望 = min(sources.length, linkSlotsForRcl)
    controller: number;  // MVC 期望 = rcl >= 5 ? 1 : 0
    storage: number;     // MVC 期望 = rcl >= 6 ? 1 : 0
    hub: number;         // MVC 期望 = rcl >= 8 ? 2 : 0
  };
  /** 死资产（从 globalCache 读取，不进 Memory） */
  deadAssets: { linkIds: string[] };
  /** 几何受限标记（拆改 fallback 后标记，避免重复空转） */
  linkConstrained: boolean;
}
```

**MVC link 角色期望**：

| RCL | source | controller | storage | hub |
|---|---|---|---|---|
| RCL5 | 1 | 1 | 0 | 0 |
| RCL6 | 1 | 1 | 1 | 0 |
| RCL7 | 1 | 1 | 1 | 0 |
| RCL8 | 2 | 1 | 1 | 2 |

### 3.6 道路网络（含 CPU 评估，漏洞 #7）

**三层道路网络**：

1. **枢纽道路（Hub Roads）— RCL4+ 启用**（修订：初版建议 RCL2+，但 CPU 评估后调整为 RCL4+）
   - **CPU 评估**：RCL2-3 期间枢纽结构少（spawn + source container），枢纽路收益低；RCL4+ storage 建成后枢纽结构增至 4+ 类，收益显著
   - 覆盖：spawn/storage/link/container 的正交邻格
   - 每枢纽最多 2 条，每周期最多 6 条

2. **走廊道路（Corridor Roads）— globalCache heap 缓存**（漏洞 #5/#8，**设计变更**）
   - 路径结果存 globalCache heap（`corridorPathCache`），key = roomName
   - **失效条件**（完整，signature = pairKey + rcl + anchor）：
     - pairKey 变化（端点 container/storage 消失或新建）
     - RCL 变化（解锁新结构，路径可能变化）
     - 锚点变化（spawn 重建在新位置）
     - 路径格被新建结构占用 → 由 planCorridorRoads 内部 occupied 过滤，不触发缓存失效
   - **存储方案变更**：原设计为 segment 缓存 + schemaVersion 22 升级，改为 globalCache heap
     （受 maxRoadsPerCycle=12 + hasPendingCritical 门禁限制，CPU 影响有限；schema 升级风险高于收益；
     global reset 丢失可接受 — 重开后首个规划周期重新计算，单次 PathFinder 0.5-2ms）

3. **热度道路（Heat Roads）— RCL2+ 动态阈值**（**阈值修订**）

| RCL | 通过阈值 | 理由 |
|---|---|---|
| RCL2-6 | 5 | 早期流量小，低阈值尽早铺路（代码实际值，修复了旧值 10 对 RCL2-3 太严的病灶）|
| RCL7-8 | 50 | 后期流量大，高阈值避免铺低频路 |

> **阈值修订说明**：设计文档原写 RCL4-6=30、RCL7-8=50，但代码当前用 `minTrafficForRcl`（RCL2-6=5, RCL7-8=50）。
> RCL2-6 保持 5 是已验证的早期优化值，直接套文档 30/50 会让 RCL4 道路突然修不出。

### 3.7 防御布局（含 tower 硬约束，漏洞 #4/#9）

> **tower 分桶实施状态：✅ 已完成（P1-2）**。实现见 [constraint-placer.ts](../src/domain/layout/constraint-placer.ts)
> （towerBucketQuota + placeTowerBuckets）。
> **min-cut v3 实施状态：✅ 已完成**（漏洞 #13/#14，wall 割集 + 8 邻接 + 切角规则 + wall/rampart 分流）。
> 实现见 [min-cut-defense.ts](../src/domain/layout/min-cut-defense.ts)（MINCUT_ALGO_VERSION=v3 + 8 邻接 + 切角规则）
> + [defense-planner.ts](../src/systems/defense-planner.ts)（割集分流：有结构 → rampart，无结构 → wall）。

**Tower 布局（按 RCL 阶段，硬约束：至少 1 塔守核心）**：

| RCL | 塔数 | 放置策略 | 硬约束 |
|---|---|---|---|
| RCL3 | 1 | anchor 侧 | — |
| RCL5 | 2 | 1 anchor 侧 + 1 controller 侧 | **至少 1 塔在 anchor Chebyshev≤5** |
| RCL7 | 3 | 1 anchor + 1 controller + 1 出口侧 | **至少 1 塔在 anchor Chebyshev≤5** |
| RCL8 | 6 | 3 守 controller + 3 守核心 | **至少 2 塔在 anchor Chebyshev≤5** |

**实现**：扩展 [BUILD_STRATEGY[STRUCTURE_TOWER]](../src/domain/layout/constraint-placer.ts#L94-L98) 的 `phaseFor`，RCL5+ 即启用 controller 距离分桶，但分桶后强制保留至少 1-2 塔走通用池（anchor 侧）。

**防御工事布局（三层协同：wall 封锁 + rampart 叠盾 + tower 火力）**：

> 老玩家认知：纯 rampart 防线有两个结构性缺陷 — ① 衰减维护是永续能量税
> （300 hits/100tick，10M rampart 每年衰减 ~30M 能量）；② hitsMax 远低于 wall
> （rampart 随 RCL，wall 恒为 300M）。wall 不衰减、更硬、敌人必啃，但不可共格
> 且阻友方通行。两者必须协同：割集位置优先 wall（硬封锁），核心结构位置
> 必须 rampart（共格 + 友方通行）。

**第 1 层 — 周界封锁线（min-cut 割集，RCL4+ 主路径）**

> **P0 算法缺陷（2026-08-02 复核发现）**：当前 min-cut 实现存在**双重盲点**，
> 导致 RCL4+ 房间防线形同虚设。这不是参数调整能解决的，是算法建模错误。

**盲点 1：rampart 作为割集顶点 — 语义错误**

min-cut 算法语义：移除割集顶点后 source（出口）与 sink（核心）不连通。
"移除顶点 = 不可通行"只有 wall 满足：

| 结构 | 阻挡敌方通行 | 可作割集顶点 |
|---|---|---|
| wall | ✅ 不可进入 | ✅ 语义正确 |
| rampart | ❌ 敌方可自由走上 | ❌ 语义错误 |

[事实] [min-cut-defense.ts L128-L131](../src/domain/layout/min-cut-defense.ts#L128-L131)
把所有非墙格作为"可切割顶点"，割集位置放 rampart。但 rampart **不阻挡通行**，
敌方可以直接走过 rampart 割集到达核心 — 算法计算的"最小割"在游戏中根本不是割。

**盲点 2：正交 4 邻接 — 忽略对角线移动**

[事实] [min-cut-defense.ts L134](../src/domain/layout/min-cut-defense.ts#L134)：

```typescript
const neighbors: [number, number][] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
```

[事实] Screeps creep 有 8 个移动方向（`TOP_RIGHT` 等对角线方向是官方 API 常量），
PathFinder 默认支持对角线移动。算法只用正交 4 邻接建图，忽略对角线路径。

**用户实测案例**：(17,17) 与 (18,16) 对角线相邻 — 算法认为通过正交链"连续封锁"，
但敌方可以从对角线绕过，算法根本没考虑这条边。

**Screeps 对角线切角规则** [模式，需实测精核]：
- creep 可对角线移动
- 切角规则：对角线移动的两个正交邻居都是不可通行（wall）时，不能切角通过
- rampart 不算不可通行 → 切角规则不适用于 rampart

**双重盲点的叠加后果**：
- 即使算法用正交图计算了"完整割集"，rampart 不挡通行 → 敌方直接走过
- 即使改用 wall，正交图忽略对角线 → 敌方对角线绕过
- 两个缺陷必须同时修正，单修任一个都不构成有效防线

**修正方案（min-cut v3，算法版本戳升级）**：

1. **割集顶点改用 wall**：
   - 无核心结构的割集格 → `STRUCTURE_WALL`（真正阻挡通行）
   - 有核心结构的割集格 → `STRUCTURE_RAMPART`（共格需求，但标注为防线弱点，需 tower 火力覆盖）
   - 走廊路/高流量路径的割集格 → `STRUCTURE_RAMPART`（友方通行需求，同上）

2. **算法扩展为 8 邻接 + 切角规则**：

```typescript
// 正交 4 邻接（原样保留）
const orthogonal: [number, number][] = [[x+1,y], [x-1,y], [x,y+1], [x,y-1]];
// 对角线 4 邻接（新增，带切角规则）
// 切角规则：对角线边 (x,y)→(x+dx,y+dy) 仅当两个角落格都非墙时存在
const diagonal: Array<[number, number, number, number, number, number]> = [
  // [dx, dy, corner1x, corner1y, corner2x, corner2y]
  [ 1,  1, x+1, y,   x,   y+1],  // 右下
  [ 1, -1, x+1, y,   x,   y-1],  // 右上
  [-1,  1, x-1, y,   x,   y+1],  // 左下
  [-1, -1, x-1, y,   x,   y-1],  // 左上
];
for (const [dx, dy, c1x, c1y, c2x, c2y] of diagonal) {
  const nx = x + dx, ny = y + dy;
  if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
  if (getTerrain(nx, ny)) continue;
  // 切角规则：两个角落格都必须可通行（非墙）
  if (getTerrain(c1x, c1y) || getTerrain(c2x, c2y)) continue;
  addEdge(vOut, nodeId(nx, ny, false), INF_CAP);
}
```

3. **算法版本戳**：`MINCUT_ALGO_VERSION` 从 `v2` 升到 `v3`，让旧缓存自然失效。
   defense-planner 的 `withAlgoVersion` 已支持版本戳，无需额外迁移逻辑。

4. **割集结构分流**：[defense-planner.ts L252-L268](../src/systems/defense-planner.ts#L252-L268)
   的割集生成循环按位置特征分流：
   - wall 任务 key 前缀 `defense.mincut.wall.`
   - rampart 任务 key 前缀 `defense.mincut.rampart.`（仅限共格/走廊路）

**修正后的防线语义**：

| 层 | 结构 | 作用 | 算法建模 |
|---|---|---|---|
| 周界封锁 | **wall**（割集主体） | 真正阻挡通行 | min-cut 8 邻接 + 切角规则 |
| 周界弱点 | rampart（共格/走廊路割集） | 不挡通行，仅拖延 | 标注弱点，需 tower 火力覆盖 |
| 核心叠盾 | rampart（建筑共格） | 保护建筑不被直接攻击 | 不参与 min-cut，独立覆盖 |

**关键认知**：rampart 不是"防线"，是"拖延工具"。只有 wall 是真正的防线。
min-cut 算法必须以 wall 为割集顶点，否则算法在数学上正确但在游戏语义上错误。

**第 2 层 — 核心结构叠盾（rampart 共格覆盖，保留现有逻辑）**

每个核心结构位置叠 rampart，使敌方必须先拆 rampart 才能攻击建筑：

- 覆盖范围：spawn / extension / storage / tower / link（**container 移除** —
  见下方"覆盖范围哲学"）
- priority 2，phase rcl4
- 独立 site 名额：[construction-manager.ts](../src/systems/construction-manager.ts)
  新增 `rampartSites` + `wallSites` 计额，与 road/source container 同类，
  不与 extension 竞争 normal 名额

**覆盖范围哲学（修订）**：

| 资产类别 | 是否叠 rampart | 维护档位 | 理由 |
|---|---|---|---|
| spawn/storage/tower | ✅ | core（全额 × 0.3） | 高价值、不可重建损失大、敌方优先攻击 |
| extension/link | ✅ | core（全额 × 0.3） | 重建耗能低但数量多，叠盾成本远低于逐个修复 |
| container | ❌（移除） | — | 重建成本 50 能量，10k 维护血量 ≈ 3.3 个 container 重建成本；低 RCL 时维护预算更应留给周界 |

**第 3 层 — 扇区防御 fallback（RCL3 或 min-cut 失败时）**

RCL3 是"刚有 Tower 但无 rampart"的最脆弱窗口，min-cut 计算昂贵不值得，
走扇区防御。当前参数（`lineLength=3, maxLinesPerCycle=1`）确实产生孤立短线段，
但 RCL3 阶段只是"撑到 RCL4 min-cut 接管"的过渡防线，可接受。

增强（RCL3 专属，不拖慢 RCL 冲刺）：
- `lineLength: 5`（从 3 增到 5，单线长度翻倍）
- `maxLinesPerCycle: 2`（从 1 增到 2，覆盖 2 个暴露扇区）
- priority 2

**维护预算与连续性（新增，解决"耐久掉完重新建造"）**

用户观察到的"rampart 维护不足，耐久掉完重新建造"根因分析：

- **根因 1**：`repairFreshRampart` 进场线 1500 hits（10k 的 15%）过低 —
  rampart 衰减 3 hits/tick，从 10k 到 1500 需 ~2833 tick，但 builder 链被
  建造任务占满时无人维护，rampart 塌毁后规划器重新入队 → builder 重建 →
  又 1 hit → 形成"建了就塌"死循环。
- **根因 2**：`repairFortifications` 盈余门禁过严（和平期 storage ≥ 50k）—
  低 RCL 阶段 storage 储备不足时墙体维护完全停滞。
- **根因 3**：rampart 数量无上限控制 — 核心覆盖 + min-cut 割集可达 50-80 个，
  全额灌到 RCL 分级目标（RCL7-8 = 10M）需 500M+ 能量，与 controller 升级
  直接争夺盈余，长期维护不可持续。

**维护方案（三层）**：

1. **急救层**（`repairFreshRampart`，builder 链前置）：
   - 进场线从 1500 提到 **3000 hits**（给 ~1000 tick 缓冲，避免 builder 短暂忙碌就漏救）
   - 放手线保持 10k
   - 无门禁（急救是止损，不是发展投资）

2. **常规维护层**（`repairFortifications`，builder 链尾）：
   - 保留分层目标：perimeter 全额 / core × 0.3 / utility 仅 10k
   - 盈余门禁维持现状（和平期 50k / 受袭期 10k）— 这是"墙是死资本，RCL 是复利"的正确取舍
   - **新增维护配额**：每 tick 至多 N 个 builder 修墙（N = RCL / 2，向下取整），
     避免全队 builder 锁死在墙上导致建造/填充停滞

3. **tower 安全网**（`findWallRepairTarget`，tower-defense.ts）：
   - 保留现状：仅当本房无 builder/worker 时启用，能量 > 70% 时修墙
   - tower 修墙是能量黑洞（10 能量/次 + 距离衰减），日常维护必须由 builder 承担

**wall 与 rampart 维护分工**：

| 结构 | 衰减 | 维护策略 | 目标血量 |
|---|---|---|---|
| wall | 不衰减 | 一次性投资，只在受袭时灌血 | RCL 分级全额（与 rampart perimeter 同档） |
| rampart（perimeter） | 3 hits/tick | 常规维护 + 急救 | RCL 分级全额 |
| rampart（core） | 3 hits/tick | 常规维护（折扣档） | 全额 × 0.3 |

**wall 不衰减是关键经济优势**：割集位置优先 wall 后，周界维护能量只花在
少量 rampart（割集上有核心结构或走廊路的格）上，wall 一次灌到 RCL 目标后
和平期零维护成本，受袭时才需补血。这把"周界维护永续税"降到最低。

### 3.8 可观测性指标（漏洞 #11）

**新增指标**（落盘 `Memory.kernel.layoutMetrics[room]`，仅变化时写入）：

```typescript
interface LayoutMetrics {
  /** 死资产率 = deadLinks / totalLinks */
  deadAssetRate: number;
  /** link 利用率 = sum(energy) / sum(capacity) */
  linkUtilization: number;
  /** 拆改次数（累计） */
  dismantleCount: number;
  /** MVC 缺口数（当前） */
  mvcGapCount: number;
  /** 几何受限标记 */
  linkConstrained: boolean;
  /** 防御完整性：min-cut 割集中 wall 占比（漏洞 #13/#14 修复后监控） */
  defenseWallRatio: number;
  /** 防御算法版本戳（MINCUT_ALGO_VERSION，监控 v3 部署进度） */
  defenseAlgoVersion: string;
  /** rampart 割集弱点数（共格/走廊路 rampart 割集，需 tower 火力覆盖） */
  defenseRampartWeakPoints: number;
}
```

**消费方**：
- `deadAssetRate` > 0.5 → 触发拆改评估
- `linkUtilization` < 0.3 → 触发 link 网络审查
- `dismantleCount` 单调递增但 `deadAssetRate` 不降 → 拆改机制失效，告警
- `defenseWallRatio` < 0.7 → 割集 wall 占比过低，防线弱点过多，告警
- `defenseAlgoVersion` !== "v3" → 旧算法缓存未失效，需检查 withAlgoVersion 逻辑
- `defenseRampartWeakPoints` > 5 → rampart 割集弱点过多，需评估 tower 火力覆盖是否充分

### 3.9 重开稳定性（无状态重启原则）

**核心原则**：布局决策必须可从「地形 + 锚点 + RCL」完全重推导，不依赖运行时状态。

| 数据类别 | 存储位置 | 重开后 |
|---|---|---|
| 锚点 | Memory.layout.anchor | 从 spawn 位置恢复 |
| overrides（relocation 持久化） | segment | 保留 |
| blocked（黑名单） | segment | 保留（带过期清理） |
| 走廊路路径缓存 | globalCache heap（**设计变更**：原方案 segment + schemaVersion 22，改为 heap 避免 schema 升级） | 丢失 → 重新计算（单次 PathFinder 0.5-2ms，开销可忽略） |
| minCut 割集缓存 | Memory.rooms[*].minCut + globalCache heap | 从 Memory 恢复到 heap；算法版本戳变化时重算 |
| planStageData | globalCache | 丢失 → 重置 planStage=0 |
| roomTraffic（流量） | globalCache | 丢失 → 从 0 重新采样 |
| deadAssetSince | globalCache | 丢失 → 从 0 重新检测 |
| linkConstrained | globalCache heap | 丢失 → 重新评估一次（开销可忽略） |
| dismantlePlans / lastDismantleTick | globalCache heap（**P1-4 新增**） | 丢失 → 死资产重新检测 + 重新规划拆改 |
| dismantleCount | globalCache heap（**P1-4 新增**，layout-metrics 消费） | 丢失 → 从 0 重新计数（不影响死资产检测/拆改逻辑） |
| link 角色分类 | 运行时 classifyLinkRole | 重算 |

**风险与缓解**：
- 重开后 500t 内死资产不被拆改 → 可接受（避免抖动）
- 重开后流量数据为空 → 可接受（枢纽路+走廊路已覆盖关键路径）
- segment 数据损坏 → `schemaVersion` 迁移机制兜底（已有）

---

## 四、迁移路径（P0-P3）

### 4.1 P0（立即，解决私服死资产 + 防线失效）

| 改动 | 状态 | 文件 | 风险 | 回滚 |
|---|---|---|---|---|
| link 分配顺序修订：RCL5 controller 优先于 storage | ✅ | [layout-planner.ts L569-L608](../src/systems/layout-planner.ts#L569-L608) | 老房已有 storage link 被跳过 | 检查已建结构，已满足则跳过 |
| gaps 角色感知：link 按角色计数 | ✅ | [gaps.ts](../src/domain/layout/gaps.ts) | 老房缺口告警风暴 | 缺口分两级，MVC 缺口才强制触发 |
| linkHasOutlet 明确定义 | ✅ | [link-outlet.ts](../src/domain/economy/link-outlet.ts) | — | 纯函数，无副作用 |
| schemaVersion 升级（corridorPaths + linkConstrained） | ⏳ 未升（设计变更） | [memory.ts](../src/kernel/memory.ts) | 迁移失败 | P0-P1 新增字段全走 heap，未升 schema（当前 = 25）。走廊路缓存改为 globalCache heap 存储，避免 schema 升级 |
| **min-cut v3：割集顶点改用 wall**（漏洞 #13） | ✅ | [min-cut-defense.ts](../src/domain/layout/min-cut-defense.ts) + [defense-planner.ts L252-L268](../src/systems/defense-planner.ts#L252-L268) | 老房 rampart 割集失效需重建 wall | 算法版本戳 v2→v3 让旧缓存自然失效；老房 rampart 保留作核心叠盾 |
| **min-cut v3：8 邻接 + 切角规则**（漏洞 #14） | ✅ | [min-cut-defense.ts L139-L170](../src/domain/layout/min-cut-defense.ts#L139-L170) | 割集大小可能增大（对角线路径需更多 wall 封锁） | MAX_CUT_RAMPARTS 从 30 提到 50；超限 fallback 到扇区防御 |
| **MINCUT_ALGO_VERSION v2 → v3** | ✅ | [min-cut-defense.ts L47](../src/domain/layout/min-cut-defense.ts#L47) | 旧缓存全部失效，首 tick 重算 CPU 峰值 | 已有 bucket < 5000 跳过门禁；分 tick 重算由 defense-planner interval=10 自然限流 |
| **割集结构分流：wall/rampart key 前缀** | ✅ | [defense-planner.ts L289-L292](../src/systems/defense-planner.ts#L289-L292) | wall site 名额竞争 | wall/rampart 分流：有结构 → rampart（共格），无结构 → wall（阻挡通行） |

### 4.2 P1（短期，闭环死资产）

| 改动 | 状态 | 文件 | 风险 | 回滚 |
|---|---|---|---|---|
| 死资产检测：link-system 维护 deadAssetSince | ✅ | [link-system.ts](../src/systems/link-system.ts) | 误判活资产 | 三重校验 + 500t 持续 |
| 受限拆改：dismantle 通道 + 完整 Plan 契约 | ✅ | [construction-manager.ts](../src/systems/construction-manager.ts) + [layout-planner.ts](../src/systems/layout-planner.ts) + [link-system.ts](../src/systems/link-system.ts) | 误拆活资产 | 三重校验 + 1000t 冷却 + 战时暂停 |
| link 网络演化 fallback | ✅ | [task-factory.ts](../src/domain/layout/task-factory.ts) | fallback 链过深导致 link 永远不建 | 最多 2 级 fallback，超则标记 linkConstrained |
| tower RCL5+ controller 分桶 + 硬约束 | ✅ | [constraint-placer.ts](../src/domain/layout/constraint-placer.ts) | 分桶导致核心无塔 | 硬约束：至少 1-2 塔在 anchor Chebyshev≤5 |

### 4.3 P2（中期，优化物流）

| 改动 | 状态 | 文件 | 风险 | 回滚 |
|---|---|---|---|---|
| 枢纽道路 RCL4+ 启用 | ✅ | [layout-planner.ts L686](../src/systems/layout-planner.ts#L686) + [task-factory.ts createCoreRoadTasks](../src/domain/layout/task-factory.ts) | CPU 增加 | 测量 CPU 后启用，限定结构数上限 |
| 走廊路缓存（globalCache heap） | ✅ | [corridor-roads.ts](../src/domain/layout/corridor-roads.ts) + [global-cache.ts corridorPathCache](../src/kernel/global-cache.ts) | 缓存失效条件遗漏 | 完整失效条件（pairKey+rcl+anchor）+ global reset 丢失可接受 |
| MVC 缺口审计 | ✅ | [gaps.ts auditLinkRoleGaps](../src/domain/layout/gaps.ts) | MVC 缺口持续存在空转 | 复用 GAP_RETRY_INTERVAL 慢速重试 |
| 核心 rampart 覆盖 + 独立 site 名额 | ✅ | [task-factory.ts](../src/domain/layout/task-factory.ts) + [construction-manager.ts](../src/systems/construction-manager.ts) | rampart 数量上限 | 按 RCL 分阶段，rampart 上限 = CONTROLLER_STRUCTURES |
| 可观测性指标 | ✅ | [layout-metrics.ts](../src/kernel/layout-metrics.ts) | Memory 写入抖动 | 仅变化时写入 |

### 4.4 P3（长期，防御强化）

| 改动 | 状态 | 文件 | 风险 | 回滚 |
|---|---|---|---|---|
| 热度路动态阈值 | ✅ | [road-policy.ts minTrafficForRcl](../src/domain/layout/road-policy.ts) | 阈值不当导致铺路过少/过多 | 按 RCL 分档（RCL2-6=5, RCL7-8=50），可调 |
| 出口封堵线增强（lineLength=5, maxLines=2） | ✅ | [task-factory.ts](../src/domain/layout/task-factory.ts) | rampart 上限 | 按 RCL 分阶段 |

---

## 五、验证方案

### 5.1 单元测试（新增）

| 测试 | 状态 | 覆盖点 |
|---|---|---|
| `link-has-outlet.test.ts` | ✅ | source link 有/无 controller/storage link 时的 outlet 判定 |
| `link-allocation-rcl5.test.ts` | ✅ | RCL5 时 controller 优先于 storage + fallback 链 |
| `dead-asset-detection.test.ts` | ✅ | 三重校验：energy=0 + 无 outlet + 500t 持续 |
| `dismantle-plan-lifecycle.test.ts` | ✅ | ttl/abort/fallback/blocked + 战时暂停 + 冷却（35 测试） |
| `dismantle-replacement-match.test.ts` | ✅ | findReplacementForDeadLink 关联逻辑 + queued 过滤（9 测试） |
| `link-fallback.test.ts` | ✅ | isLinkConstrained 标记 + 1000t 过期重试 + shouldHave 谓词（17 测试） |
| `mvc-gaps-rcl5.test.ts` | ✅ | RCL5 MVC 缺口：source + controller link 角色感知（6 测试） |
| `corridor-cache-invalidation.test.ts` | ✅ | 走廊路缓存失效：pairKey/rcl/anchor 变化 + global reset + pathFn 注入（8 测试） |

### 5.2 集成测试

| 测试 | 状态 | 场景 |
|---|---|---|
| `layout-restart-stability.test.ts` | ✅ | global reset 后 heap 丢失 → deadAssetSince/linkConstrained/dismantlePlans 重建 + layout-planner 从 Memory.anchor 重新规划 + 决策一致性（12 测试） |
| `dismantle-wartime-pause.test.ts` | ✅（单元覆盖） | 房间进入 defense 时拆改暂停，恢复后继续（dismantle-plan-lifecycle 场景4） |

### 5.3 运行时验证指标

| 指标 | 目标 | 告警阈值 |
|---|---|---|
| `deadAssetRate` | = 0 | > 0.5 触发拆改评估 |
| `linkUtilization` | > 0.7 | < 0.3 触发 link 网络审查 |
| `dismantleCount` 增长但 `deadAssetRate` 不降 | — | 拆改机制失效，告警 |
| 拆改 CPU 成本 | < 0.1 CPU/tick/房 | > 0.3 CPU 告警 |
| MVC 缺口闭合时间 | < 1500t | > 3000t 告警（受限地形） |

### 5.4 长期运行门槛

- 10 房时 layout-planner CPU < 5 CPU/tick（roomPhase 哈希偏移消除尖峰）
- 死资产拆改在 10 房时 < 0.5 CPU/tick
- segment schema 迁移幂等，失败可回滚

---

## 六、与当前架构差异总结

| 维度 | 当前架构 | 最优方案 | 改动量 |
|---|---|---|---|
| 放置优先级 | link=3 残留，extension 两档 | link 移除，extension 三档 | 小 |
| link 分配顺序 | source(1)→storage→controller→source(rest) | 按 RCL 阶段 + fallback 链 | 中 |
| gaps 审计 | 按类型计数 | MVC + 角色感知 + 死资产 + linkConstrained | 中 |
| 死资产拆改 | 不拆改 | 完整 Plan 契约 + 三重校验 + 战时暂停 | 大 |
| linkHasOutlet | 未定义 | 明确：source link 的 outlet = controller/storage link 可达 | 小 |
| 枢纽道路 | RCL6+ | RCL4+（CPU 评估后调整） | 小 |
| 走廊路 | 每周期重算 | segment 缓存 + 完整失效条件 | 中 |
| 热度路阈值 | 固定 | RCL 动态（30/50） | 小 |
| tower 布局 | RCL8 才 controller 分桶 | RCL5+ 即分桶 + 硬约束（至少 1-2 塔守核心） | 小 |
| rampart | 仅出口封堵线 | 核心 rampart 叠盾（共格）+ 出口线增强 + 独立 site 名额 | 中 |
| wall | **无建造逻辑（完全缺失）** | **min-cut v3 割集主体用 wall**（漏洞 #13/#14 修正） | **大** |
| min-cut 算法 | 正交 4 邻接 + rampart 割集（语义错误） | 8 邻接 + 切角规则 + wall 割集（v3） | 大 |
| MVC | 无 | 每 RCL 最小可用配置 | 中 |
| schemaVersion | 21 | 22（corridorPaths + linkConstrained） | 小 |
| 可观测性 | gaps 落盘 | + 死资产率/link 利用率/拆改次数/MVC 缺口/防御完整性 | 小 |
| 战时降级 | 不适用 | 拆改在 alert/defense 时暂停 | 小 |

---

## 七、决策校准

### 7.1 紧急故障止血（如私服死资产再现 / 防线被突破）

1. 立即：手动标记死资产 link 为 `toDismantle`，触发拆改
2. 短期：执行 P0 改动（link 分配顺序 + gaps 角色感知 + min-cut v3）
3. 验证：观察 `deadAssetRate` 指标 1500t 内归零；`defenseWallRatio` > 0.7

### 7.2 架构建议

- **责任边界**：layout-planner 决策 + construction-manager 执行 + link-system 检测死资产 + gaps 反馈 + defense-planner 防御规划
- **迁移阶段**：P0 → P1 → P2 → P3，每阶段验证指标后进入下一阶段
- **验证指标**：deadAssetRate、linkUtilization、dismantleCount、MVC 缺口闭合时间、defenseWallRatio、defenseRampartWeakPoints
- **失败回退**：拆改 fallback 到 linkConstrained；MVC 缺口慢速重试；走廊路缓存失效则重算；min-cut 割集超限 fallback 到扇区防御

### 7.3 未知量与验证步骤

- **未知**：破碎房几何放不下 controller link 的概率
  - **验证**：统计 10 房 RCL5 时 controller link 放置成功率，<80% 则需调整 fallback 链
- **未知**：拆改 CPU 成本
  - **验证**：P1 完成后 profile 10 房 1000t，确认 < 0.5 CPU/tick
- **未知**：核心 rampart 覆盖的 rampart 上限是否够用
  - **验证**：统计 RCL4-8 核心 rampart 数量 vs CONTROLLER_STRUCTURES[rampart] 上限
- **未知**：Screeps 对角线切角规则的精确语义
  - **验证**：私服实测两个对角 wall + 角落空地时敌方能否穿过；若规则与文档假设不符，调整 min-cut v3 的对角线边条件
- **未知**：min-cut v3 割集大小（8 邻接后可能增大）
  - **验证**：统计 10 房 RCL4-8 的 v3 割集大小分布；若 > 50 则 MAX_CUT_RAMPARTS 需提到 80
- **未知**：老房 rampart 割集迁移为 wall 的能量成本
  - **验证**：统计老房现有 rampart 割集数量 × wall 建造成本（1 能量/wall hit，灌到 RCL 目标）；若 > 100M 能量则分 RCL 阶段渐进迁移
