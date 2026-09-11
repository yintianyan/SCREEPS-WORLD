# 远矿系统重构 — 设计方案与实施方案

> **性质**：设计提案（Design Proposal），**未冻结**。本文只描述「目标设计 + 落地路径」，不改任何冻结契约。
> 任何结构性契约修订（Memory schema、AgendaItem 类型集、site 写者边界）**必须走 ADR**，
> 登记进 `docs/architecture/ARCHITECTURE_FREEZE.md` §15 后再落代码（AGENT.md「文档与代码的裁决规则」）。
>
> **前置阅读**：`EXPANSION_ARCHITECTURE.md` §7（远矿合同）· `PLANNING_ARCHITECTURE.md` §3/§4（AgendaItem 契约与防振荡三防线）·
> `ECONOMY_ARCHITECTURE.md` §2/§3（营收/消耗/净流口径）· `docs/research/03_SCREEPS_GAME_CONSTRAINTS.md`（机制真相源）。
>
> **当前状态基线**：`docs/STATUS.md`（快照 2026-09-02，commit `4aee767`，schemaVersion 45，34 系统 / 21 角色）。

---

## 0. 结论摘要（TL;DR）

远矿系统的问题**不是「没有设计」，而是「设计做了两套、只有错的那套在跑」**：

| 事实 | 证据 |
| --- | --- |
| 真正在运行的只有 `targeting` + `demand` + `staffing` 三个纯函数 + 一个 1501 行的 manager | `remote-mining-manager.ts` 只 import 这三个 |
| 完整的「营收核算 / ROI / 预算 / 执行门 / 健康度」层（11 个文件、362 个单测）**零生产调用** | `remote-source / remote-value / remote-opportunity / opportunity-ranking / flow-accounting / economic-accounting / roi / economic-health / operation-budget / remote-dashboard / container-lifecycle / execution-gate` 全仓无 import |
| 当前**没有任何实际营收统计**。拉回主房的能量没有入账，反而被记成主房的**核算漂移（drift）** | `ledgerIncome = harvested + pickedUp + bought`；远矿 hauler 交付走 `fillStorage()` 不记账 |
| hauler 编制**完全忽略距离**（`_haulerNeed` 参数被丢弃），远房必然运力不足 → container 溢出 → 能量在地面衰减 | `staffing.ts:10-18` `remoteHaulerTarget` |
| 需求侧（`remoteHaulerTarget`）与回收侧（`op.haulerNeed`）**两套口径** | `demand.ts:208` vs `remote-mining-manager.ts:864` |
| 开点判断是**静态公式**，无实测反馈闭环 | `scoreRemoteCandidate`（`targeting.ts:86-120`） |

**重构主线（一句话）**：把「远矿能量拉回主房」变成**可测量、可入账、可决策**的一等公民 —
建立 `交付 → 入账 → 净收益 → 滞回开关` 的闭环，并让 hauler 编制按「距离 × 产出速率」精确匹配。

**分 6 个阶段落地**，前 2 个阶段**不改任何决策行为**（纯观测），用真实数据校准阈值后，第 3 阶段才让实测接管开关。

---

## 1. 现状诊断（代码实证）

### 1.1 两套并行体系

```
┌─ 活跃执行层（真正在跑，每 10 tick）────────────────────────────┐
│  systems/remote-mining-manager.ts  (1501 行)                    │
│    └─ domain/remote/targeting.ts    ← 候选评选 + 静态净收益评分   │
│    └─ domain/remote/demand.ts       ← 编队需求 → SpawnRequest    │
│    └─ domain/remote/staffing.ts     ← 替补阈值 / 运力工具（部分）  │
│  creeps/roles/remote-{harvester,hauler,defender}.ts + reserver  │
│  Memory.rooms[].remoteOps           ← 扁平台账（唯一持久真相）     │
└────────────────────────────────────────────────────────────────┘

┌─ 休眠领域层（完整纯函数 + 362 单测，但零生产调用）───────────────┐
│  flow-accounting → economic-accounting → roi → economic-health  │
│  remote-source / remote-value / remote-opportunity / ranking    │
│  execution-gate / operation-budget / remote-dashboard           │
│  container-lifecycle / operation/remote-mining-op.ts            │
│  ↑ 仅被 tests/ 与「断头管道」specialization-planner.ts 引用        │
└────────────────────────────────────────────────────────────────┘
```

`specialization-planner.ts` 是断头管道：`getOpportunities()` 读 `global.__remoteOpportunities`（**全仓无写入者**），
`buildHealthInput()` 直接 `return undefined`（`L206-213`）→ `assessEconomicHealth` 永不评估。

### 1.2 缺陷清单（按严重度）

| ID | 缺陷 | 影响 | 证据位置 |
| --- | --- | --- | --- |
| **D1** | **无真实营收核算**：拉回主房的能量不入 `ledgerIncome`，只体现为 home 房的核算 drift | 无法判断远矿是否赚钱；「营收」判断缺失 | `economy.ts:57-73`、`accounting.ts:78` |
| **D2** | **hauler 编制忽略距离**：`remoteHaulerTarget(sources, _haulerNeed, harvestersReady)` 丢弃 `haulerNeed`，恒 ≤ 1/source | 远房运力 < 产出 → container 溢出 → **能量在地面衰减（真实亏损）**；近房则运力过剩 | `staffing.ts:10-18` |
| **D3** | **需求侧 / 回收侧口径分裂**：孵化用 `remoteHaulerTarget`，回收用 `op.haulerNeed` | 编制永远收敛不到 `haulerNeed`；回收会误杀或用不满 | `demand.ts:208` vs `manager.ts:864` |
| **D4** | **开/关点纯静态模型**，无实测反馈 | 参数漂移无人校准；「评估口径 = 执行口径」假设被 D2 打破 | `targeting.ts:86-120` |
| **D5** | 休眠层 11 文件零调用（含 362 单测） | 维护成本 + 认知负担；两套 Operation 模型并存 | 见 §1.1 |
| **D6** | **两套 Operation 模型**：`RemoteOp`（活跃扁平台账）vs `RemoteMiningOperationContext`（A4.1 正式模型） | `RemoteOp.operationId/checkpoint/economicHealth/budgetConsumed` 四个字段**从未被写入**（空壳） | `global.d.ts:1037-1054` |
| **D7** | **ROI 无 CPU 账** | 蓝图 §7 明确「ROI 定价必须含 CPU 账」；`research/17` 有「CPU>能源而砍 remote」反例 | `economic-accounting.ts`（成本仅能量口径） |
| **D8** | 与蓝图 AgendaItem 契约偏离：立项权应在帝国（agenda-manager 唯一写者），现由 manager 自主评选 | 长期收敛项；被 `global.d.ts` 注释承认是「渐进迁移」 | `EXPANSION_ARCHITECTURE.md` §7 |
| **D9** | `RemoteOp.state` 的 `"scout"` 枚举**从未被写入** | 尽调阶段缺失（蓝图要求「先 remote 尽调后 colonize」） | `global.d.ts:968` |
| **D10** | 三套威胁冷却交织：`threatUntil` / `blockedUntil` / `dangerUntil` 分散写入 | 逻辑难验证，易出「收入黑洞」 | `manager.ts:200-350` |

### 1.3 可复用资产（不要重写）

- ✅ **纯函数边界干净**：`targeting` / `demand` / `staffing` 不访问 `Game`/`Memory`，单测充分（`tests/unit/remote/` 23 文件 / 362 用例）。
- ✅ **休眠层的算法是对的**：`computeHaulerSizing` 的 `throughput = carry / roundTrip`、`requiredHaulers = ceil(production / throughput)` **与社区权威模型一致**（见 §2），只是没接线。
- ✅ **降级/止损机制齐全**：威胁 RETREAT/ABORT、InvaderCore 二分、空转普查、超额收缩、crisis 暂停都已实现且有测试。
- ✅ **基础设施已具备**：`globalCache` 单 tick 缓存、`bumpEnergyCounter` L1 记账、`economy` 系统跨 tick 差分、遥测注册表。

---

## 2. 优秀案例参考（社区最佳实践）

### 2.1 权威定量模型 — ScreepsPlus Wiki「Remote Harvesting」

社区流传最广的**成本模型**（per tick，能量口径，`dist` = 单程通勤 tick 数）：

```
cost(dist) = 800/(1500-dist)        # miner 摊销（[3M1C6W] 800e / 寿命 1500-dist）
           + 15/floor(750/dist)     # hauler 摊销（100 carry 每 dist=5 一档，150e/档）
           + 625/(600-dist)         # reserver 摊销（CLAIM 寿命仅 600）
           + 0.686                  # guard 0.122 + repairer 0.064 + container 0.5
           + (1.6·dist + 10·dist/(1500-dist) + 1.5·dist/(600-dist)) × 0.001   # 道路衰减
```

**效率表（单源已预定，源产 10 e/tick）**：

| dist | 0 | 50 | 100 | 150 | 200 | 250 | 251 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 成本 e/t | 2.26 | 3.46 | 4.81 | 5.91 | 8.19 | 8.52 | 11.02 |
| 效率 | 77% | 65% | 52% | 41% | 19% | 15% | **−10%** |

**三条硬结论**：
1. **hauler 是最大成本项**（约占成本 30–70%，距离越远占比越高）；道路成本约是 miner 的一半。
2. **dist ≥ 250 tick 转负**（单源）；未预定房（源产 5 e/tick）在 dist ≈ 150 就已接近不划算。
3. 收益 = 源产速率（reserve 后 10 e/tick，未 reserve 仅 5）——**reserve 是收益翻倍的开关**。

**hauler 运力配比公式（最关键）**：

```
每源所需总运力 = 源产速率 × 往返 tick 数 = sourceRate × 2 × dist
例：sourceRate = 10 e/tick，dist = 50 → 需要 1000 carry 在途
   即 20 个 CARRY 部件（1000/50），或若干只小 hauler 合计 1000
```

> 直觉：hauler 在路上的时间里，source 一直在产。运力必须覆盖「一整趟往返周期内 source 的全部产出」，
> 否则 container 溢出 → 能量 drop 在地面 → 衰减灭失 = **纯亏损**。

### 2.2 工程实践 — jappenzeller「REMOTE_MINING.md」

- **角色分工**：miner（站桩，1/source）+ hauler（运回）+ reserver（续约，防源产减半）+ defender。
- **hauler body 随距离放大**：近房小 body 高频往返，远房大 body 满载往返。
- **首只 hauler 给予 +15 utility 加成**：确保 container 不会因为「没人运」而溢出衰减。
- **pause 生命周期**：遇袭 → `active=false` + `pausedUntil = tick + 5000`；到期重新校验后再恢复
  （「恢复必须重新过一遍有效性校验」——防「被占房被错误恢复」）。
- **上限**：`maxRemotes = min(homeSources × 2, 6)`（与本项目 FREEZE R8「远矿车道 ≤6」同源）。
- **开点前置**：`rcl >= 4 AND harvesters >= 2 AND haulers >= 1 AND energyIncome > 0`。
- **距离铁律**：**只采距主房 ≤ 2 房的房间**（3+ 房往返 150+ tick，常不划算）。

### 2.3 属地模式 — Overmind / KasamiBot（本项目 research/17 已考古）

- **Overmind**：`Colony + outposts` — 远矿归属母房属地，执行挂母房人口与物流。
  → **与本项目蓝图 `EXPANSION_ARCHITECTURE.md` §7「远矿 = Operation，属地 = 母房，立项权 = 帝国」完全一致**。
- **KasamiBot**：remote 上限 6 + SK 房；shard3 玩家**完全砍掉 remote**（CPU > 能源排序）
  → 印证蓝图「ROI 必须含 CPU 账」不是纸上条款。

### 2.4 提炼：6 条可落地原则

| # | 原则 | 本项目落地动作 |
| --- | --- | --- |
| P1 | **运力 ≥ 产出**（防溢出） | hauler 编制 = `ceil(sourceRate × 2 × dist / carry)`，统一口径（治 D2/D3） |
| P2 | **收益按「真实交付」计，不按名义产能** | 新增 `imported` 收入口径 + 每 op 账本（治 D1，对齐 `ECONOMY_ARCHITECTURE` §2.1 禁令） |
| P3 | **成本含孵化摊销 + 基建 + 风险 + CPU** | 接线 `economic-accounting` + 补 CPU 项（治 D5/D7） |
| P4 | **reserve 是收益翻倍开关** | reserver 续约按 reserve 剩余量触发（现为常驻 1 只，可优化） |
| P5 | **距离硬门槛** | 开点门控含 `pathCost` 上限 + 效率转负线（治 D4） |
| P6 | **恢复必须重新校验 + 分批节流** | 续营门用实测净收益 + 滞回 + `minDuration`（治 D4，对齐 PLANNING §4 三防线） |

---

## 3. 目标设计

### 3.1 设计原则

1. **营收闭环**：任何「开 / 关 / 扩 / 缩」决策都必须能被**实测数字**解释，而非只看静态公式。
2. **单一真相源**：`haulerNeed` 只有一个定义（距离 × 产出），需求侧、回收侧、评分侧共用。
3. **观测先行**：先让数字可见，再让数字决策。观测阶段绝不改行为（可回滚、零风险）。
4. **可降级**：`Recovery` 档远矿最先被砍；恢复分批节流（蓝图红线）。
5. **蓝图收敛**：长期把 `Memory.rooms[].remoteOps` 收敛到 AgendaItem 生命周期（需 ADR）。
6. **不改内核**：所有新增通过 `bootstrap.ts` 注册或既有模块扩展，**不动 Kernel**（AGENT.md 硬约束）。

### 3.2 目标分层架构

```
┌ 决策层（帝国 / 母房）──────────────────────────────────────────┐
│  posture（peace/normal/fortify/war/recovery）  ← 已有            │
│  开点门控链 G0..G6（§4.1）                                      │
│  续营门控：实测净收益 + 滞回 + minDuration  ← 新增               │
└────────────────────────────────────────────────────────────────┘
             ▲ 净收益快照                    │ 立项 / 撤销
┌ 账本层（新增核心）─────────────────────────────────────────────┐
│  RemoteOpLedger（每 op）：delivered / spawnCost / refund /      │
│                           infra / lost / cpu / netRate          │
│  滚动窗口 + EMA  ← 复用 domain/remote/flow-accounting           │
└────────────────────────────────────────────────────────────────┘
             ▲ 交付 / 孵化 / 回收事件          │ 读快照
┌ 执行层（已有，扩展）───────────────────────────────────────────┐
│  remote-mining-manager（评选 / 生命周期 / site / 需求）          │
│  roles: remote-harvester / remote-hauler / reserver / defender  │
│  spawn-manager（孵化记账钩子）· economy（imported 收入口径）      │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 RemoteOp 生命周期状态机（对齐蓝图 checkpoint）

现状：候选 → **直接 active**（一次性把 harvester/hauler/reserver 全孵）。

目标：**阶段化推进**，每阶段有独立门控，避免「基建没建好就孵 hauler 空跑」：

```
discovered ──▶ validated ──▶ infrastructure ──▶ mining ──▶ logistics ──▶ economic_active
   (候选)      (尽调实测)      (container/road)  (harvester)  (hauler)     (净收益为正)
                  │                │                 │            │            │
                  └────────────────┴─────────────────┴────────────┴────────────┘
                                     任一阶段失败/威胁 → degraded / suspended / abandoned
```

| 阶段 | 进入条件 | 主要动作 | 退出/失败 |
| --- | --- | --- | --- |
| `discovered` | 出现在 intel 且通过 G3 硬过滤 | 无（或派 scout 尽调，治 D9） | 无视野 → 保持 |
| `validated` | 有实测 `pathCost` + `sources` | 记录 `expectedYield` | 尽调显示不划算 → abandoned |
| `infrastructure` | 净收益预测 ≥ 门限 | 下 container site（**基建先行**） | site 冷却超时 → 重试/放弃 |
| `mining` | container 建成或有 drop 兜底 | 孵 harvester | 编队空转超时 → abandoned |
| `logistics` | container 有能量积压或 harvester 在岗 | 孵 hauler（**此时孵才不浪费**） | 运力持续不足 → 扩编 / degraded |
| `economic_active` | 连续 N 窗有交付 | 稳态运行 + 效率优化 | 净收益转负超阈 → 收缩/废弃 |

> **收益**：`logistics` 门控直接消灭「container 还没建就孵 hauler → 空跑到远房再空手回来」的浪费；
> `validated` 阶段让「先尽调后投资」成为机制而非口号（蓝图 §3）。

### 3.4 营收核算口径（核心）

#### 3.4.1 定义

```
# 收入侧（只计「真实入账」）
delivered   = Σ hauler 向主房 sink（storage/spawn/extension/tower/container）成功
              transfer 的能量（transfer 返回 OK 才计，按意图量记账）

# 成本侧（能量口径）
spawnCost   = Σ 为本 op 孵化 creep 的 body 成本（孵化成功时全额计费，gross）
refund      = Σ recycle 返还（按剩余寿命比例冲销）
infraCost   = container / road 工地创建时一次性计入（builder 后续只是兑现，不重复计）

# 净收益
netDelivered = delivered - (spawnCost - refund) - infraCost
netRate      = netDelivered / 窗口 tick 数
profitable   = netDelivered > 0
```

**这就是要的判据**：`creep 孵化等消耗 < 拉回主房的能量` ⇔ `netDelivered > 0`。
注意 `spawnCost` 是**全额 body 成本**（不是摊销）——「回本」按**投资回收**口径：
一只 hauler 花 1800 能量，必须运回 > 1800 能量才算回本。这与社区公式（摊销口径）**互补**：
- **准入评估**（还没开，无实测）→ 用**摊销口径**（社区公式 / `scoreRemoteCandidate`），回答「稳态划不划算」。
- **续营评估**（已开，有实测）→ 用**投资回收口径**（`netDelivered`），回答「这一轮投资回本了吗」。

> **实现期修正（两处刻意不单列，避免重复计数）**：
> 1. **不单列 `looted`**。坟墓/掉落被拾回后仍会经 hauler 交付进主房，已计入 `delivered`；
>    再冲销一次等于同一份能量记两次收入。
> 2. **不单列 `riskCost`**。defender 带 `remoteTarget`，其 body 成本已进 `spawnCost`；
>    再单列一次等于同一笔孵化记两次支出。
>
> **`cpuCost` 延后到 P4**：CPU 定价需先有自身遥测数据校准（蓝图 §7 标为 SPECULATION），
> 在观测期硬编码一个拍脑袋系数只会污染判据。

#### 3.4.2 实现落点

| 事件 | 落点 | 动作 |
| --- | --- | --- |
| hauler 交付 | `remote-hauler.ts` work 链（`fillStorage` / `haulFillTarget` 包装） | transfer OK → `bumpRemoteDelivered(home, target, amount)` |
| creep 孵化 | `spawn-manager.ts:477`（`bumpEnergyCounter(home,"spawned",bodyCost)` 旁） | 若 `request.memory.remoteTarget` → 记 op spawnCost |
| creep 回收 | `spawn-manager.ts:304-306`（recycle 成功处） | 记 op refund |
| creep 死亡 | `kernel/memory.ts` maintainMemory（清理死者 memory 处） | 记 op lost（bodyCost − 已回收） |
| 墓碑回收 | `remote-hauler.ts` `lootRemoteRemains` | 记 op looted（冲销 lost） |
| 基建 | `remote-mining-manager.ts` `fulfillContainerRequests` / `planRemotePathRoads` | site 创建成功 → 记 infraCost |
| 收入入账 | `kernel/global-cache.ts` `RoomEnergyCounters` 新增 `imported` | **P0 只记录不并入 `ledgerIncome`**（见下） |

> ⚠️ **`imported` 为何暂不并入收入**：`economy` 系统按 `netPerTick = (income − consumption + refunds) / ticks`
> 滚动净流 EMA，而该 EMA 驱动 `energyPrice` 与门控。把 `imported` 并入收入会**抬高主房净流**、
> 进而改变「何时开点/扩编」的决策——这是一次真实的行为变更，不属于「观测打底」。
> 待 P1 用实测数据确认其影响后，再作为独立变更接线（届时顺带消除主房 drift）。

### 3.5 决策链（何时开 / 关 / 扩 / 缩）

```
开：G0 帝国姿态 ∧ G1 母房成熟 ∧ G2 有名额 ∧ G3 候选硬过滤 ∧ G4 预测净收益 ≥ open ∧ G5 尽调 ∧ G6 分批
扩：实测 container 水位持续高 / 运力利用率 > 90% → hauler +1（不超过 haulerNeed 上限）
缩：实测 container 长期空 / 运力利用率 < 50% → hauler −1（不低于 1）
关：实测 netRate < close 连续 N 窗 ∧ 已过 minDuration → 收缩 → abandoned
```

**滞回（防振荡，PLANNING §4 第一防线）**：`openThreshold > closeThreshold`，
例如 `open = 3 e/tick`、`close = 0.5 e/tick`，中间区间**维持现状**（既不新开也不关闭）。

---

## 4. 逐问题设计（回答用户六问）

### Q1 — 何时开启远矿？

**门控链（全部满足才开）**：

| 门 | 条件 | 现配置 | 建议 |
| --- | --- | --- | --- |
| **G0 帝国姿态** | `newRemoteOpsAllowed === true`（`posture` 非 fortify/war/recovery） | ✅ 已有 | 保持 |
| **G1 母房成熟** | `rcl ≥ roomMinRcl` ∧ `colonyState = normal` ∧ `storage ≥ roomMinStorage` | `5 / 8000` | 保持（8000 而非 20000 的理由已在注释论证） |
| **G2 名额** | `activeCount < effectiveMaxOperations(hasStorage, spawnCount)` | `min(2 or 1, spawnCount)` | 保持 |
| **G3 候选硬过滤** | 普通房 ∧ 无 owner ∧ 非己方殖民地 ∧ 非敌预定 ∧ `dangerUntil` 未过期 ∧ 非他房已运营 | ✅ 已有 | 保持（这条实现质量很高） |
| **G4 预测净收益** | `netScore ≥ openThreshold`，**且 `pathCost ≤ maxPathCost`** | `minNetScore = 3` | **新增** `maxPathCost`（对齐社区 dist ≤ 250 转负线，换算后 ≈ 500） |
| **G5 尽调** | 无近期视野的候选 → 先派 scout 取实测 `pathCost`/`sources`，再评分 | ❌ 缺失（`state:"scout"` 空壳） | **新增**（治 D9） |
| **G6 分批** | 一次只开 1 个 op，两次开启间隔 ≥ `openCooldown` | ❌ 缺失 | **新增**（防恢复风暴，红队 A2） |

**为什么不是「越早越好」**：远矿是**分兵**。母房 RCL5 + storage 8000 之前，本地 20 e/tick 天花板还没吃满，
分兵去远房是「用本地升级速度换远矿收益」，净亏。**RCL5 是本地经济成熟的临界点**。

**为什么不是「越远越好」**：效率随距离陡降（§2.1 表）。`dist=250` 已转负。

### Q2 — 如何开启？

**6 步阶段化开启**（对应 §3.3 状态机）：

```
1. 尽调：scout 进房 → 实测 pathCost / sources / 威胁 → 写 intel
2. 评分：netScore（摊销口径）≥ open 且 pathCost ≤ max → 立项
3. 基建先行：下 container site（每源 1 个，range 1）；有 road 需求才铺 road
4. 采集：container 建成或有 drop 兜底 → 孵 harvester（1/source，5 WORK 饱和）
5. 物流：container 出现能量积压 → 孵 hauler（按 §Q4 公式定数量）
6. 稳态：连续 N 窗有交付 → economic_active → 进入续营门控
```

**关键**：第 5 步**必须等第 4 步**。当前代码在 `active` 时同时推 harvester + hauler 请求，
container 未建时 hauler 空跑到远房再空手回来 —— 一只 `[20C,21M,1W]` 2150 能量白烧。

**保留的既有能力**（不要动）：InvaderCore 二分（stronghold 冻结 / lesser 清核）、
入口封死检测、路径阻断墙检测、外国前置 spawn 拆除、crisis 期暂停推请求但不召回现役（沉没成本已付）。

### Q3 — 远矿 creep 配置（body）

| 角色 | 现状 body 档位 | 建议 | 理由 |
| --- | --- | --- | --- |
| **remoteHarvester** | `[5W,1C,3M]` 750 / `[3W,1C,2M]` 450 / `[2W,1C,2M]` 350 / `[1W,1C,1M]` 200 | **保留**，优先 750 档 | 5 WORK × 2 = **10 e/tick = 源再生速率**，恰好饱和。3 WORK 只有 6 e/tick，采不满 |
| **remoteHauler** | 9 档，含 `hasRoad` 分档（idx1 `[20C,21M,1W]` 2150 无路满速 / idx0 `[24C,12M]` 1800 有路 2:1） | **保留档位表**，但**选择逻辑改为按 §Q4 需求选档**（现在选档与需求脱节） | 无路需 MOVE ≈ CARRY×2（疲劳），有路 2:1 即可 —— 档位表已正确编码此规则 |
| **reserver** | `[CLAIM,MOVE]` 650（唯一档） | 保持 | reserve +1 tick/CLAIM·tick；1 CLAIM 够（reserve 上限 5000，寿命 600） |
| **remoteDefender** | `[2A,2M]` 520 / `[A,M]` 130 | 保持；威胁等级高时用 520 | 半血撤退（RD-1）已实现 |
| **coreClearer** | `[8A,2C,10M]` 1240 / `[4A,1C,5M]` 620 | 保持 | — |

**要改的只有一点**：hauler **档位选择**应与**需求运力**匹配，而非「能造多大造多大」。
现在 `selectBody("remoteHauler", energyCapacityAvailable, {hasRoad:false})` 取**可负担的最大档**，
RCL8 房会造 2150 的巨无霸去跑 2 房的近矿 → 空跑浪费。
→ 改为 `selectHaulerBodyForNeed(needCarry, hasRoad, energy)`：取 `CARRY ≥ needCarry` 的**最小**档。

### Q4 — creep 数量（编制）

#### harvester
```
harvesterCount = min(op.sources ?? harvestersPerTarget, harvestersMaxPerTarget) = 1 / source
```
✅ **现状正确，无需改**（1 harvester / source；5 WORK 饱和 10 e/tick，2 只反而互相分产能）。

#### hauler（**本次重构的核心修正**）
```
# 产出速率
sourceRate    = reserved ? 10 : 5                       # e/tick per source（3000/300 或 1500/300）
production    = op.sources × sourceRate                 # e/tick

# 单只运力（复用 staffing.ts 已有实现）
carryCapacity = haulerCarryParts × 50
roundTrip     = ceil(2 × pathCost / speed)              # speed = hasRoad ? 2 : 1
throughput    = carryCapacity / roundTrip               # e/tick per hauler

# 需求
haulerNeed    = clamp(ceil(production / throughput), 1, haulersMax)
```

**与现状对比（举例）**：

| 场景 | pathCost | 有路 | 单只 12C 运力 | 现状编制 | **目标编制** | 后果（现状） |
| --- | --- | --- | --- | --- | --- | --- |
| 近矿 1 源 | 20 | 否 | 600/(40) = 15 | 1 | **1** | ✅ 一致 |
| 中距 2 源 | 150 | 否 | 600/(300) = 2 | 2 | **10 → clamp 4** | ❌ **运力只有 4/20，容器必溢出** |
| 中距 2 源 | 150 | 是 | 600/150 = 4 | 2 | **5 → clamp 4** | ❌ 运力 16/20，仍不足 |
| 远矿 1 源 | 400 | 是 | 600/400 = 1.5 | 1 | **7 → clamp 4** | ❌ 严重不足（应已被 G4 剔除） |

> **结论**：现有 `haulersMax = 4` 对 `pathCost ≥ 150` 的房**根本不够**。
> 两条路：(a) 调大 `haulersMax`；(b) 用**更大的 hauler body**（CARRY 更多）。
> 社区做法是 (b)：远房用大 body 少数量。建议 `haulerNeed` 计算时**同时优化 body 档位**：
> 先算 `needCarryTotal = production × roundTrip / haulerCount候选`，再取 `carryParts ≥ needCarryTotal` 的最小档。
>
> **更稳的做法**：`haulerNeed = 1`（少而大）+ body 按 `needCarryTotal = production × roundTrip` 取档。
> 即**单只大 hauler 满载往返**，避免多只小 hauler 瓜分同一 container（现状注释已论证此原则，只是没算距离）。

**统一口径**：`demand` / `recycleExcess` / `score` 三处**共用同一个 `haulerNeed`**（治 D3）。
建议把计算收敛到 `staffing.ts` 一个纯函数 `resolveHaulerPlan(op, body, hasRoad): {count, carryParts}`。

#### reserver
```
reserverCount = (colonyState === "normal" && enableReserver) ? 1 : 0
```
✅ 现状正确。**优化点**：不必常驻 —— reserve 上限 5000 tick，可在 `reserveTicksLeft < 1000` 时才孵
（社区做法）。但要注意「续期空窗」风险，建议 `reserveTicksLeft < 2000` 触发，留足通勤余量。

#### defender
```
defenderCount = hasThreats ? 1 : 0
```
✅ 现状正确。

#### 稳态总编制（1 源近矿）
`1 harvester + 1 hauler + 1 reserver(间歇) ≈ 3 只`；
2 源中距：`2 harvester + 2~4 hauler + 1 reserver ≈ 5~7 只`。
**孵化占用是硬约束**：单 spawn 房开双远矿会持续占孵化位（现状注释已论证），故 `effectiveMaxOperations` 与 `spawnCount` 挂钩是对的。

### Q5 — 营收判据（消耗 < 拉回能量）

见 §3.4。一句话实现：

```
净营收 = Σ(delivered to home sinks)
       − Σ(spawnCost − recycledRefund)      # 孵化净消耗（投资回收口径）
       − infraCost                          # container + road 建造与维修
       − riskCost                           # 威胁 + defender
净营收 > 0  ⇒  该 op 是「营收」而非「补贴」
```

**三个必须坚持的口径纪律**：
1. **只计真实交付**（`transfer` 返回 `OK` 的能量），**不计名义产能**（对齐 `ECONOMY_ARCHITECTURE` §2.1 禁令）。
2. **只计拉到主房 sink 的能量**，**不计停留在远矿 container 里的存量** —— container 会衰减，且未回到主房前不算收益。
3. **用滚动窗口 + EMA**，不用单 tick 值（对齐 `ECONOMY_ARCHITECTURE` §3「禁止未平滑单 tick 值上报门控」）。

**窗口长度建议**：`max(2000, 3 × roundTrip × haulerNeed)` tick —— 至少覆盖 3 个完整物流周期，
否则「hauler 在路上」会被误判为「零交付」。

### Q6 — 如何提高远矿效率？

按 **ROI 排序**（收益/成本比从高到低）：

| # | 措施 | 预期收益 | 成本 | 优先级 |
| --- | --- | --- | --- | --- |
| E1 | **修 hauler 编制口径（D2/D3）** | ⭐⭐⭐⭐⭐ 消灭 container 溢出衰减；远房从「亏损」变「盈利」 | 低（纯逻辑改） | **P0** |
| E2 | **运力匹配 body 档位**（远房大 body 少数量） | ⭐⭐⭐⭐ 减少空跑与孵化成本 | 低 | **P0** |
| E3 | **道路覆盖**（已有 `planRemotePathRoads`） | ⭐⭐⭐⭐ hauler 速度 ×2 → 运力翻倍 → 需求编制减半 | 中（road 建造 + 衰减维护） | **P1** |
| E4 | **container 自维护**（已有 RM-2） | ⭐⭐⭐ 防 container 衰减消失导致 op 崩溃 | 已实现 | 保持 |
| E5 | **reserver 按需续约**（非常驻） | ⭐⭐ 省 1 只 creep 的孵化+通勤 | 低 | **P2** |
| E6 | **edge link**（主房边缘 link 接收 hauler 交付） | ⭐⭐⭐ 回程缩短，等同「免费缩短距离」 | 高（link 5000 能量 + RCL + 布局） | **P3**（中期） |
| E7 | **harvester 站桩 + 同 tick 倒能**（已实现） | ⭐⭐ 消除通勤 | 已实现 | 保持 |
| E8 | **剔除低效 op**（G4 `maxPathCost`） | ⭐⭐⭐ 把孵化位让给高效 op | 低 | **P1** |
| E9 | **CPU 账纳入 ROI（D7）** | ⭐⭐ 防「能源正收益但 CPU 亏」 | 低 | **P2** |
| E10 | **道路逐段按交通热度铺**（已有 traffic 双窗口） | ⭐⭐⭐ 避免全房预铺浪费 | 已实现 | 保持 |

**反直觉但重要**：E1/E2 是**纯逻辑改动，零额外能量投入**，却能消除最大的亏损源（地面衰减）。
**效率提升的第一性原理是「不要浪费已经采出来的能量」，而不是「采更多」。**

---

## 5. 实施方案（分阶段落地）

### 总览

| 阶段 | 目标 | 是否改行为 | 关键交付 | 风险 |
| --- | --- | --- | --- | --- |
| **P0** | 观测打底 | ❌ 否 | `imported` 收入口径 + 每 op 账本 + 遥测 | 极低 |
| **P1** | 账本闭环 | ❌ 否 | 接线 `flow-accounting`→`economic-accounting`→`roi` | 低 |
| **P2** | 编制口径统一 | ✅ 是 | hauler 编制按距离 + body 匹配（治 D2/D3） | 中 |
| **P3** | 实测驱动开关 | ✅ 是 | 续营门 + 滞回 + minDuration（治 D4） | 中 |
| **P4** | 效率优化 | ✅ 是 | 道路/body/reserver/CPU 账 | 中 |
| **P5** | 蓝图收敛 | ✅ 是 | AgendaItem 立项权（**需 ADR**） | 高 |

---

### Phase 0 — 观测打底（行为保持）

**目标**：让「远矿真实净收益」第一次可见，**不改任何决策**。

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 `imported` 计数 | `kernel/global-cache.ts` `RoomEnergyCounters` | 一个 `number` 字段 |
| 并入收入 | `domain/economy/accounting.ts` `EnergyLedger` + `ledgerIncome` | `income = harvested + pickedUp + bought + imported` |
| 交付记账 | `creeps/roles/remote-hauler.ts` work 链包装 | transfer OK → bump `imported`(home) + op ledger |
| 孵化/回收记账 | `systems/spawn-manager.ts:477` / `:304` | 按 `remoteTarget` 记 spawnCost / refund |
| 死亡记账 | `kernel/memory.ts` maintainMemory | 记 lost |
| 每 op 账本（heap） | **新增** `domain/remote/op-ledger.ts` | 纯函数：`accumulate / rollWindow / netRate` |
| 遥测 | `telemetry/metrics/EconomyMetrics.ts` 或新增 RemoteMetrics | `remote_delivered / remote_spawn_cost / remote_net_rate / remote_transport_efficiency` |

**验收**：
- `npm run typecheck && npm test && npm run build` 全绿。
- 单测：`imported` 并入收入后，home 房 drift 收敛（新增断言）。
- e2e：`08-multi-room` 场景遥测可见 `remote_delivered > 0`。
- **行为不变**：所有既有 `tests/unit/remote/` 用例无需修改即可通过。

**回滚**：字段新增是加法，`imported` 恒 0 时行为与现状完全一致。

---

### Phase 1 — 账本闭环

**目标**：把「预测」与「实测」并列呈现，供 Phase 3 决策。

| 动作 | 文件 |
| --- | --- |
| 接线 `flow-accounting` → `economic-accounting` → `roi` | `systems/remote-mining-manager.ts`（新增 `reconcileEconomics()` 阶段） |
| 扩展 `EconomicAccountingConfig` 补 CPU 成本项（治 D7） | `domain/remote/economic-accounting.ts` |
| op 经济快照写 Memory（紧凑，低频） | `types/global.d.ts` `RemoteOp.economics?` |
| 对齐 `RemoteOp` 与 `RemoteMiningOperationContext`（治 D6） | 二选一：把 `checkpoint/economicHealth` 真正写入，或删除空壳字段 |

**验收**：单测覆盖 `reconcileEconomics`；e2e 遥测可见 `expectedROI vs actualROI` 对比。

---

### Phase 2 — 编制口径统一（治 D2/D3）

**目标**：`haulerNeed` 只有一个定义，三处共用。

| 动作 | 文件 |
| --- | --- |
| 新增 `resolveHaulerPlan(op, body, hasRoad): {count, carryParts}` | `domain/remote/staffing.ts` |
| `demand.ts` 用 `resolveHaulerPlan.count` 替换 `remoteHaulerTarget` | `domain/remote/demand.ts:208` |
| `recycleExcessRemoteCreeps` 用同一结果 | `systems/remote-mining-manager.ts:864` |
| `scoreRemoteCandidate` 用同一公式 | `domain/remote/targeting.ts:108` |
| `selectBody("remoteHauler", ...)` 改为按需求选最小可满足档 | `config/bodies.ts` + 调用点 |
| 调参 `haulersMax`（或改为「大 body 少数量」策略） | `config/index.ts` |

**验收**：
- 新增单测：`pathCost` 20 / 150 / 400 × 有路/无路 → 断言 `haulerNeed` 单调递增且 clamp 正确。
- 更新 `road-status.test.ts` / `demand.test.ts`（口径变化是**预期内**的行为变更）。
- 集成：`remote-container-repair` 场景中 container 水位不再持续满溢。

---

### Phase 3 — 实测驱动开关（治 D4）

**目标**：续营由实测 `netRate` 决定，含滞回与 `minDuration`。

| 动作 | 文件 |
| --- | --- |
| 续营门：`netRate < close` 连续 N 窗 ∧ `tick - openedAt ≥ minDuration` → 收缩 | `systems/remote-mining-manager.ts` |
| 滞回：`open = 3` / `close = 0.5`，中间维持 | `config/index.ts` 新增 `closeNetRate` / `minDuration` / `windowTicks` |
| 断供检测：连续 X tick 无交付 → degraded → 收缩 | 同上 |
| 扩展 `reevaluateActiveOps` 用实测值替代纯静态 | `manager.ts:528-569` |
| 防振荡测试 | `tests/unit/remote/reeval.test.ts` 扩展 |

**验收**：新增「净收益转负 → 收缩 → 恢复 → 重新开启」全链路单测；
`minDuration` 内绝不因瞬时波动废弃（防 replan thrashing，PLANNING §4.1 红线）。

---

### Phase 4 — 效率优化

- E3 道路：提升 `planRemotePathRoads` 优先级，验证「有路后 haulerNeed 减半」。
- E5 reserver 按需续约（`reserveTicksLeft < 2000` 触发）。
- E6 edge link（需布局支持，中期）。
- E9 CPU 账：把 `Game.cpu` 分摊进 op 成本。

**验收**：`16-soak-sv43` 长稳场景，远矿净收益较 Phase 0 基线提升（用 Phase 0 遥测做对照）。

---

### Phase 5 — 蓝图收敛（可选，**必须走 ADR**）

把 `Memory.rooms[].remoteOps` 收敛到 AgendaItem 生命周期（`agenda-manager` 唯一写者），
实现蓝图 `EXPANSION_ARCHITECTURE.md` §7「立项权 = 帝国」。
**这是最大的一处偏离，也是最大的一次改动，建议在 P0–P4 稳定后再评估是否值得。**

---

## 6. 配置参数表（新增 / 调整建议）

| 参数 | 现值 | 建议 | 理由 |
| --- | --- | --- | --- |
| `remote.maxOperations` | 2 | 保持（FREEZE R8 上限 6，现值更保守） | — |
| `remote.minNetScore` | 3 | 拆分：`openNetScore = 3` / `closeNetScore = 0.5` | 滞回，防振荡 |
| `remote.haulersMax` | 4 | **重新评估**：按 `production × roundTrip / carry` 推导，或改「大 body 少数量」 | 现 4 只对 pathCost ≥ 150 远不够 |
| `remote.maxPathCost` | — | **新增** ≈ 500（对齐社区 dist 250 转负线） | 距离硬门槛 |
| `remote.openCooldown` | — | **新增** ≈ 1000 tick（一次只开 1 个） | 防恢复风暴（红队 A2） |
| `remote.minDuration` | — | **新增** ≈ 车道自举周期（建议 5000） | 承诺期，防开→废 churn |
| `remote.econWindowTicks` | — | **新增** ≈ `max(2000, 3×roundTrip×haulerNeed)` | 至少覆盖 3 个物流周期 |
| `remote.reserveRenewAt` | — | **新增** 2000（reserve 剩余 tick 触发续约） | 非驻留 reserver |
| `remote.cpuCostPerTick` | — | **新增**（待遥测校准，蓝图 §7 SPECULATION 初值 ~1 CPU/房） | CPU 账 |
| `remote.lowScoreGrace` | 1000 | 保持 | 静态重估宽限 |
| `remote.stallAbandonTicks` | 1500 | 保持 | 空转止损 |

---

## 7. 测试与验收

### 7.1 回归网（必须保持）
`tests/unit/remote/` **23 文件 / 362 用例**是行为保持的回归网。
- **P0/P1 阶段**：必须**零修改**全绿（纯加法）。
- **P2/P3 阶段**：允许修改 `road-status` / `demand` / `reeval` 等**口径变化**用例，
  但必须在 PR 描述中说明「口径变更理由 + 旧口径为何错误」。

### 7.2 新增测试
| 层 | 新增 |
| --- | --- |
| Unit | `op-ledger.test.ts`（累积/窗口/EMA/净收益）、`hauler-plan.test.ts`（距离→编制）、`imported-income.test.ts`（收入口径 + drift 收敛） |
| Integration | 「container 溢出 → 编制扩容 → 溢出消除」闭环；「净收益转负 → 收缩 → 恢复」闭环 |
| E2E | `08-multi-room` 增加远矿净收益断言；`16-soak` 长稳对照 |

### 7.3 门槛
`npm run typecheck && npm test && npm run build` 全绿（AGENT.md「质量门槛」）。
涉及结构变更的走 ADR（`ARCHITECTURE_FREEZE.md` §15）。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **记账错误导致误关 op** | 高（收入损失） | P0/P1 只观测不决策；P3 前用真实数据人工核对阈值 |
| Memory 膨胀（每 op 多字段） | 中 | 紧凑字段（短 key + 整数）+ heap 优先 + 低频快照 |
| `imported` 与 `pickedUp` 重复计数 | 中 | 明确边界：`imported` 只在**跨房**交付时计；同房 pickup 归 `pickedUp` |
| P2 口径变更打破既有测试 | 中 | 允许有理由的用例更新；先在 P0 观测阶段用真实数据验证新口径更优 |
| 与休眠层 362 用例冲突 | 低 | **扩展不重写**：保持纯函数签名，新增参数可选 |
| 蓝图 AgendaItem 收敛代价大 | 高 | 列为 P5 可选；P0–P4 独立于它，不被阻塞 |
| 道路维护成本侵蚀收益 | 中 | 道路成本已计入 `infraCost`；用实测 netRate 而非静态公式判断 |

---

## 9. 开放决策点（需拍板）

| # | 决策 | 选项 | 建议 |
| --- | --- | --- | --- |
| **O1** | 休眠的 accounting/roi/health/gate 层：**接线还是删除**？ | (a) 接线复用；(b) 删除重写；(c) 保留但标注 deprecated | **(a) 接线** — 算法与社区模型一致，且有 362 单测 |
| **O2** | `haulerNeed` 语义统一为？ | (a) 「数量」；(b) 「运力需求（carry 总量）」，数量由 body 档位导出 | **(b)** — 远房用大 body 少数量更省孵化成本 |
| **O3** | 营收口径用「投资回收」还是「稳态摊销」？ | (a) 只用一个；(b) 准入用摊销、续营用回收 | **(b)** — 两者回答不同问题 |
| **O4** | 是否引入 edge link 优化？ | (a) 是（中期）；(b) 否 | **(a)**，但排在 E1/E2/E3 之后 |
| **O5** | 是否推进 P5（AgendaItem 收敛）？ | (a) 推进；(b) 暂缓 | **(b) 暂缓**，先拿 P0–P4 的实测收益 |
| **O6** | `RemoteOp` 与 `RemoteMiningOperationContext` 二选一 | (a) 合并到 `RemoteOp`；(b) 迁移到 Operation 模型 | **(a)** — 改动小，且 `RemoteOp` 是活跃真相源 |

---

## 附录 A：关键文件索引

| 类别 | 文件 |
| --- | --- |
| 核心系统 | `src/systems/remote-mining-manager.ts`（1501 行） |
| 活跃领域 | `src/domain/remote/{targeting,demand,staffing}.ts` |
| 休眠领域 | `src/domain/remote/{flow-accounting,economic-accounting,roi,economic-health,operation-budget,execution-gate,remote-source,remote-value,remote-opportunity,opportunity-ranking,remote-dashboard,container-lifecycle}.ts`、`src/domain/operation/remote-mining-op.ts` |
| 角色 | `src/creeps/roles/{remote-harvester,remote-hauler,reserver,remote-defender,claimer}.ts` |
| 配置 | `src/config/index.ts`（`remote` 段 L676-751）、`src/config/bodies.ts` |
| 类型 | `src/types/global.d.ts`（`RemoteOp` L966-1055、`RoomMemory.economy` L144-159） |
| 经济核算 | `src/domain/economy/accounting.ts`、`src/systems/economy.ts`、`src/kernel/global-cache.ts` |
| 孵化 | `src/systems/spawn-manager.ts`（`spawned` L477 / `recycledRefund` L306） |
| 测试 | `tests/unit/remote/`（23 文件）、`tests/unit/role/remote-*.test.ts`、`tests/integration/scenarios/remote-*.test.ts`、`tests/e2e/scenarios/08-multi-room.test.ts` |
| 蓝图 | `docs/architecture/{EXPANSION,PLANNING,ECONOMY,CONSTRUCTION,DECISION_AUTHORITY}_ARCHITECTURE.md`、`docs/architecture/ARCHITECTURE_FREEZE.md` §15 |
| 调研 | `docs/research/03_SCREEPS_GAME_CONSTRAINTS.md`、`docs/research/17_EXPANSION_SYSTEM.md`、`docs/research/12_LOGISTICS_SYSTEM.md` |

## 附录 B：社区参考来源

1. **ScreepsPlus Wiki — Remote Harvesting**：成本公式、效率-距离表、body 配方、hauler 运力配比。
   <https://wiki.screepspl.us/Remote_Harvesting/>
2. **jappenzeller — REMOTE_MINING.md**：角色设计、pause 生命周期、`maxRemotes = min(homeSources×2, 6)`、距离铁律（≤2 房）。
   <https://github.com/jappenzeller/Screeps/blob/main/docs/REMOTE_MINING.md>
3. **Overmind / KasamiBot**（本项目 `docs/research/17_EXPANSION_SYSTEM.md` 考古）：
   属地模式（Colony + outposts）、remote 上限 6、SK 房、以及「CPU > 能源而砍 remote」反例。
4. **本项目内部**：`docs/architecture/ECONOMY_ARCHITECTURE.md` §2/§3（净流三指标）、
   `docs/architecture/PLANNING_ARCHITECTURE.md` §4（防振荡三防线）。

---

## 附录 C：Phase 0 实施记录（已完成）

**状态**：已落地，`typecheck` / `test:unit`（4693 用例）/ 相关集成与架构守卫全绿。

### 新增文件

| 文件 | 内容 |
| --- | --- |
| `src/domain/remote/op-ledger.ts` | 纯函数账本：`RemoteOpLedger` 类型、`emptyOpLedger`、`bumpOpLedger`、`opUnrecoveredInvestment`、`opNetDelivered`、`opNetRate`、`opProfitable`、`summarizeOpLedger` |
| `tests/unit/remote/op-ledger.test.ts` | 7 个用例：口径、冲销不变量、窗口速率地板、摘要格式 |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `src/kernel/global-cache.ts` | `RoomEnergyCounters` 增 `imported`；`GlobalCache` 增 `remoteOpLedgers`（heap）；新增 `getRemoteOpLedger` / `bumpRemoteOpLedger` / `eachRemoteOpLedger` / `pruneRemoteOpLedgers`。**只 type-import domain**——架构守卫 R9「kernel 禁止值导入业务模块」白名单为空，故键格式与账本字面量由 store 侧持有（字面量覆盖全部字段，domain 加字段即编译失败，防漂移） |
| `src/domain/economy/accounting.ts` | `EnergyLedger` 增 `imported`（**不并入 `ledgerIncome`**） |
| `src/creeps/engine/actions/helpers.ts` | `CountedField` 增 `imported`；`runCountedAction` 的 field 允许 `undefined`（跳过记账）；`imported` 同时记入 op 账本 |
| `src/creeps/engine/actions/fill.ts` | `fillStorage` / `haulFillTarget` 改用 `runCountedAction`，按 `creep.memory.remoteTarget` 判定是否为跨房导入 |
| `src/systems/spawn-manager.ts` | 孵化成功按 `req.memory.remoteTarget` 记 `spawnCost`；回收返还记 `refund` |
| `src/systems/remote-mining-manager.ts` | 开点时播种账本窗口；每房写回后 GC 失效账本；container / road 工地创建成功记 `infraCost`；每 1000 tick 输出一行 `[remote-ledger]` 摘要 |
| `tests/unit/economy/accounting.test.ts` | 新增守卫用例：`imported` 已记账但**不并入收入**（并入会改变净流 EMA 与门控） |

### 实施期发现并修正的两个口径错误

1. **`looted` 不能单列**：坟墓/掉落被拾回后仍经 hauler 交付进主房，已计入 `delivered`；再冲销一次等于同一份能量记两次收入。
2. **`riskCost` 不能单列**：defender 带 `remoteTarget`，其 body 成本已进 `spawnCost`；再单列一次等于同一笔孵化记两次支出。

> 这两处都是「按公式字面实现」会踩的坑——`netDelivered = delivered − (spawnCost − refund) − infraCost` 才是自洽的。

### 观测方式

Screeps 控制台每 1000 tick 会出现：

```
[t12345][INFO][remote-ledger] W1N1->W1N2 net=2100e (+2.10e/t) delivered=3000 spawn=1000 refund=200 infra=100 win=1000t
```

`net` 为正即该条远矿线是「营收」而非「补贴」。**当前不影响任何决策**——纯观测，
等积累出真实分布后再定 P3 的 `openNetScore` / `closeNetScore` 阈值。

### 环境提示

本仓库 `package.json` 声明 Node 24，且 `tests/support/constants.ts` 经 `@screeps/driver`
拉起 `isolated-vm` 原生模块（按 Node 24 编译）。**必须用 Node 24 跑测试**，
否则全部单测套件加载失败（`NODE_MODULE_VERSION 127 vs 137`）。`tsc` 不受影响。

---

## 附录 D：Phase 1 实施记录（已完成）

**目标**：让观测数据能跨 global reset 存活。**这是 Phase 0 能否产出有用数据的前提**——
每次部署代码都会 global reset 清空 heap，heap-only 的账本等于永远攒不出一个完整窗口。

**状态**：已落地，`typecheck` / 相关单测 / `build` 全绿。

### 存储分层

| 层 | 位置 | 职责 | 写者 |
| --- | --- | --- | --- |
| **heap**（实时累加器） | `globalCache().remoteOpLedgers` | 交付/孵化/回收发生时即时累加，零序列化成本 | creeps 层（`runCountedAction`）+ spawn-manager |
| **Memory**（持久层） | `Memory.rooms[].remoteOps[].ledger`（短字段 `d/s/r/i/w`） | 跨 global reset 存活 | **remote-mining-manager 唯一写者** |

> 为什么不让 creeps 直接写 Memory：`remoteOps` 归 remote-mining-manager 唯一写入
> （`STATE_OWNERSHIP_MODEL` 单一写者契约）。creeps 只写 heap，由管理器每
> `managerInterval` 回写一次。

### 改动

| 文件 | 改动 |
| --- | --- |
| `src/domain/remote/op-ledger.ts` | 新增 `RemoteOpLedgerSnapshot` + `toOpLedgerSnapshot` / `fromOpLedgerSnapshot`（整数化 + 非有限值归零） |
| `src/kernel/global-cache.ts` | 新增 `peekRemoteOpLedger` / `setRemoteOpLedger`；`getRemoteOpLedger` 降为模块私有 |
| `src/types/global.d.ts` | `RemoteOp.ledger` 短字段类型（v47+） |
| `src/kernel/memory.ts` | 迁移 **v46 → v47**：`ledger` 畸形自愈（非对象 / 数组 / 字段非有限数 → 删除该条账本） |
| `src/config/index.ts` | `CONFIG.memory.schemaVersion` 46 → **47** |
| `src/systems/remote-mining-manager.ts` | 新增并导出 `syncOpLedger()`：Memory ↔ heap 同步；开点播种；每轮回写 |
| `tests/support/factories.ts` | `resetGlobals` 补 `delete remoteOpLedgers`（防账本跨用例污染） |
| 新增测试 | `tests/unit/remote/op-ledger-sync.test.ts`（5 用例）、`tests/unit/migration/v46-to-v47.test.ts`（7 用例）、`op-ledger.test.ts` 加快照往返 2 用例 |

### 恢复语义（关键设计）

**判定条件不是「heap 缺失」，而是「窗口起点不一致」**：

```
heap 缺失                        → 播种（Memory 有则恢复，无则新建）
heap.windowStart ≠ persisted.w   → 判定为 reset 后重建的空壳 → 用 Memory 恢复
heap.windowStart = persisted.w   → heap 权威（正常运行时不被 Memory 覆盖）
```

只按「heap 缺失」判定是不够的：reset 后首个 tick 若有交付先发生（spawn-manager /
creeps 层先于管理器运行），heap 已被 bump 出一个新条目，永远等不到恢复。
恢复会丢弃该 tick 的零星几笔，远好于整窗观测被清零。

### 踩坑

迁移的畸形自愈**只查 `typeof === "number"` 是不够的**——`typeof NaN === "number"`，
NaN 会溜进账本。已改为 `typeof v === "number" && Number.isFinite(v)`。
（这个漏洞是被自己写的迁移测试抓出来的，见 `v46-to-v47.test.ts` 第 5 个用例。）

### 未做的事（诚实记录）

- **窗口未滚动**：`netRate` 目前是**开点至今的终身均值**，不是「最近 N tick」。
  用于 P3 的滞回开关需要近期窗口，届时再引入滚动 + 上一窗快照。
- **`docs/STATUS.md` 的 schemaVersion 数字未刷新**：该文件自称「现状数字只经其 §7 程序与
  `npm run docs:inventory` 刷新」，但 `package.json` 里**并不存在** `docs:inventory` /
  `check:docs` 脚本（AGENT.md 与 docs/README 引用了未实现的命令）。且该数字在我改动前
  就已过期（文档写 45，代码实为 46）。未手工改写——那会绕过它自己声明的刷新程序。
  建议补齐该脚本后统一刷新。

---

## 附录 E：并发改动与进度校正（重要）

**本仓库在实施期间有另一条会话/作者并行提交，HEAD 发生了移动。** 已落地的远矿相关提交：

| 提交 | 内容 |
| --- | --- |
| `c7c2f4a` | **重构远矿系统：hauler 编制动态计算、收支模型精确化** |
| `158944b` | 修复 hauler 吞吐量模型——道路不改变速度、只影响 body 配比 |
| `4df66bc` | 远矿 harvester sourceSlot 预分配 + defender kiting 战术重设计 |

### 对本方案的影响：**P2 已由该提交完成，不要重复实施**

- `staffing.ts` 的 `remoteHaulerTarget` **已不再忽略距离**（原 D2 已修复）；
- 新增 `computeHaulerNeed(sources, sourceIncomePerSource, haulerCarryParts, pathCost, roadCoverage)`：
  用**当前 body 的 carry 部件数 + pathCost + 道路覆盖**精确算编制，`demand.ts` 已接线；
- `computePerHaulerThroughput` 的第三参数从 `hasRoad: boolean` 改为 `roadCoverage: number`；
- `scoreRemoteCandidate` 的 upkeep 常量改为按实际 body 模板取值（harvester 0.50 / hauler 0.53 /
  reserver 1.08），并补入 **container 摊销 0.2/source**，收入口径改为
  **`min(source 产能, hauler 总运力)`**——即「拉不回来的能量不算盈余」。

### 两者关系：互补，非重复

| 口径 | 归属 | 回答的问题 | 状态 |
| --- | --- | --- | --- |
| **静态/摊销口径** `scoreRemoteCandidate` | 上述提交（已修精） | 「稳态划不划算」→ 开点准入 | ✅ 已落地 |
| **实测/投资回收口径** `op-ledger` + `imported` | 本次实施（P0/P1） | 「这一轮投资回本了吗」→ 续营决策 | ✅ 已落地（观测期） |

已核对：`src/` 中**不存在**第二条「拉回主房能量」的计量路径（`delivered` 仅出现在
`op-ledger` / `global-cache` / `fill` / `helpers` / `accounting`），两者不重复记账。

### 剩余工作

- **P3 实测驱动开关 + 滞回**：这是**唯一**还缺的一环，且**依赖 P0/P1 的实测账本**——
  静态口径永远无法回答「这条线现在还在赚钱吗」。建议下一步做这个。
- **P4 效率优化**：道路优先级、reserver 按需续约、edge link、CPU 账。
- **P5 AgendaItem 收敛**（需 ADR）。

> ⚠️ 协作提示：实施期间工作树同时存在**另一会话的未提交改动**
> （`src/kernel/kernel.ts`、`src/kernel/event-log.ts`、`src/creeps/support/targeting.ts`、
> `AGENT.md`、`compliance.test.ts` 等）。本次实施的改动与它们**无文件重叠**，
> 提交时请勿把它们一起带走。

---

## 附录 F：Phase 3 实施记录（已完成）— 实测驱动开关

**目标**：让**实测**净营收真正接管「这条远矿线还值不值得开」的决策。这是静态口径
永远做不到的事——它看不到 container 溢出衰减、编队被反复击杀、道路迟迟不落地。

### 新增配置（`CONFIG.remote`）

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `closeNetRate` | `0.5` e/tick | 实测净营收下限。低于此值判定「运回来也不划算」，收缩停投 |
| `minDuration` | `5000` tick | **承诺期**：开点后至少运行这么久才允许因实测经济废弃 |
| `econCooldown` | `10000` tick | 实测亏损废弃后的候选冷却，防「开→废」抖动 |

### 决策链（与静态口径的分工）

```
开点准入（静态摊销口径）  scoreRemoteCandidate ≥ minNetScore      ← 已由并发提交修精
续营维持（实测回收口径）  opNetRate ≥ closeNetRate                ← 本次新增
```

### `enforceMeasuredEconomics(remoteOps, homeRoom, tick)`

三道防误杀：

1. **承诺期**：投入在开点瞬间付出、交付要等通勤 + 采集，窗口未满时净营收必然为负——
   不设承诺期会把**每一个新开的点**都误杀（开→废抖动，每来回白烧一整套编队 body）。
2. **从未交付不判经济**（`ledger.delivered <= 0` → 跳过）：那是「运不回来」而非
   「运回来不划算」，归空转止损（`stallAbandonTicks`）管；本门重复处理会把物理受阻
   误记成经济问题。
3. **废弃后打候选冷却**：否则静态门会立刻把同一房重新选回来。冷却复用 `dangerUntil`
   （其既有语义即「冷却期内不作为新远矿/扩张候选」），无需新增 Memory 字段。

**废弃只停投、不杀现役**：编队余命内继续交付仍是净收益，提前回收反而浪费已付的 body
成本。与既有静态废弃路径同语义（`recycleExcessRemoteCreeps` 本就跳过非 active op）。

### 配套修正：账本 GC 口径

原实现按「是否 active」清理账本 → 亏损 op 一被废弃就丢账本，而其现役 creep 在余命内
仍会交付，导致账本被**反复删了又建**（heap 空壳 → 计数丢失）。改为按
**「op 记录是否还存在」**清理：废弃 op 的账本留到记录被删，既保留复盘数据，
也避免 churn。重开同一目标房时由开点播种显式重置，不会继承旧计数。

### 测试

- `tests/unit/remote/measured-economics-gate.test.ts`（10 用例）：承诺期、亏损收缩、
  「白干」也收缩（正但低于下限）、达标保持、回收返还冲销后达标、从未交付跳过、
  无账本跳过、非 active 不改写、多 op 隔离、**废弃后冷却期内不再被评选**（防抖动闭环）。
- `tests/unit/remote/op-ledger-sync.test.ts` 新增 3 用例覆盖 GC 语义。

### 诚实记录的两点局限

1. **窗口未滚动**：`opNetRate` 是**开点至今的终身均值**，不是「最近 N tick」。因此它能
   抓住「从一开始就不赚钱」的线（这正是静态模型最容易看错的场景），但抓不住
   「曾长期赚钱、近期转坏」的线——终身均值衰减很慢。要抓后者需引入滚动窗口 +
   上一窗快照（多一个 Memory 字段 + 迁移）。**当前选择保守**：宁可漏杀，不可误杀。
2. **阈值未经实测校准**：`closeNetRate / minDuration / econCooldown` 是按机制推理取的
   （承诺期覆盖「投入→首笔回本」时延、冷却覆盖道路施工兑现窗口），**不是从线上数据
   拟合的**。P0/P1 的账本正是为了提供这个校准依据——建议先观测一段时间的
   `[remote-ledger]` 输出分布，再回填这三个值。
3. **已知交互**：威胁冷却写入（`dangerCooldown`，2000）会覆盖同房的经济冷却
   （`econCooldown`，10000），因为它在本门之后运行。影响有限（两者都是有效的
   防重开护栏），未做 max 合并以免改动既有行为。

---

## 附录 G：Phase 4 实施记录（已完成）— 效率优化

### 先否决一项原计划：E5「reserver 按需续约」经推导**无收益**

原方案把 E5 列为「省 1 只 creep 的孵化+通勤」。实施前做数学推导，结论是**它省不出任何东西**：

```
维持预约的成本 = 每 tick 需补充的 reserve tick 数 × 单位成本
每次 reserver 寿命内产生的 reserve tick = C × (600 − 2p)      C=CLAIM 数，p=单程 pathCost
每次 reserver 的净成本            = 650 × C                  （回收残值按剩余寿命比例，相互抵消）
→ 每 tick 成本 = 650C / (C(600−2p)) = 650 / (600 − 2p)        C 被约掉
```

**成本与 CLAIM 部件数、与调度方式都无关**——大 CLAIM body 只是「更快填满、更快报废」，
单位成本不变。所以「常驻 vs 按需」不改变成本结构，E5 是伪优化。**未实施。**

（真正被这项推导暴露的是另一件事：静态模型 `RESERVER_UPKEEP = 1.08` 用的是 `650/600`，
**忽略了通勤损耗** `2p`。p=100 时真实成本是 `650/400 = 1.63 e/tick`，模型低估约 50%。
这是**常数标定问题**而非机制问题，留待用账本实测校准。）

### 实际实施：修复 hauler 编制被 harvester 数封顶（真 bug）

`remoteHaulerTarget` 的**注释写着「按就位比例收缩」，代码却是按 harvester 绝对数封顶**：

```ts
// 修复前（注释与实现不符）
return Math.max(1, Math.min(target, harvestersAvailable));   // 绝对数封顶
```

**后果（算术）**：2 源、`pathCost 150`、无路，`selectBody` 选 16 CARRY 档 →
单只吞吐 `800 / (150×2) = 2.67 e/tick`，产出 `2×10 = 20 e/tick`，
`haulerNeed = ceil(20/2.67) = 8 → clamp haulersMax(4)`。
但封顶后实际编制 = `min(4, 2 harvester) = 2` → **运力 5.3 e/tick，只运回产出的 27%**，
其余在 container 溢出、落地衰减 —— 距离越远亏得越多。

**同时它是一处口径分裂（D3）**：回收侧 `markExcess(entry.hauler, op.haulerNeed)` 按 4 判超额，
demand 侧却永远只孵到 2 —— demand 永远够不到回收配额。

**修复**：改为按就位**比例**缩放，保留「爬坡期不配满」的原意：

```ts
const readiness = Math.min(1, Math.max(0, harvestersReady) / sourcesTotal);
return Math.max(1, Math.ceil(need * readiness));
```

满编时编制 = `haulerNeed`（与回收侧口径一致）；半编减半；未就位保底 1。

### 为什么这是安全的（不是简单「放开上限」）

静态模型**本来就把 `haulerNeed` 只数的摊销算进了 upkeep**（`HAULER_UPKEEP × haulerNeed`）。
修复前模型按 4 只收费、实际只跑 2 只 → **预测收入高于真实收入**，是系统性高估。
修复后执行与模型口径一致，**同时提升了开点预测的准确性**。

孵化位占用的新增压力由既有两道门约束：`minNetScore`（已含 4 只的摊销成本）与
`effectiveMaxOperations`（与 `spawnCount` 挂钩）。

### 测试

- 新增 `tests/unit/remote/hauler-staffing.test.ts`（8 用例）：满编不被封顶（回归）、
  与回收侧口径一致（1..4 全覆盖）、半编减半、未就位保底 1、缺失回退、
  超上限收敛、sources 缺失、就位多于 source 不放大。
- 既有 `demand.test.ts` 全部**零修改通过**（就位比例缩放与旧断言兼容）。

### P4 剩余项（未做，附理由）

| 项 | 状态 |
| --- | --- |
| E3 道路 / E4 container 维护 / E7 站桩 / E10 按交通热度铺路 | ✅ 早已实现 |
| E5 reserver 按需续约 | ❌ **推导证明无收益**（见上） |
| E6 edge link | 待办：需 link 网络 + 布局支持，改动面大 |
| E9 CPU 账 | 待办：蓝图 §7 要求，但需先用账本遥测校准 CPU 定价系数 |
| `RESERVER_UPKEEP` 通勤修正 | 待办：属常数标定，需实测数据 |
| P5 AgendaItem 收敛 | 待办：需 ADR |
