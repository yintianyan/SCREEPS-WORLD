# ENERGY_ACCOUNTING_MODEL — 能量核算模型（P3 设计）

> 合同锚点：ECONOMY_ARCHITECTURE §2.1/§2.3/§3；STATE_OWNERSHIP §3.6；SYSTEM_BOUNDARIES §1.5；
> FREEZE R1/R6。任务书映射：§9–16（三指标/时间窗/收支/净流/对账/不变量）。裁决依据：
> P3_A2_CONTRACT_REVIEW §4 C6/C7。

## 1. 双层口径（C7 裁决落地）

| 层 | 内容 | 用途 | 存储 |
| --- | --- | --- | --- |
| **L1 实测计数器** | 动作层实收实付累加（下表 8 项） | 对账恒等式、漂移检测、效率系数校准的唯一真相 | heap（globalCache.energyLedger），每核算窗滚动清零 |
| **L2 核算指标** | 三指标（净流/储备/风险缓冲）+ 收支分解 | 门控输入、phase 出入口、调参靶子 | heap 派生 + Memory 瘦快照 + 遥测 segment |

## 2. L1 计数器目录（埋点位置）

| 计数器 | 方向 | 埋点 | 说明 |
| --- | --- | --- | --- |
| harvested | 收入 | creeps/engine/actions/harvest.ts | 从 source 实采能量（work 部件数） |
| pickedUp | 收入 | creeps/engine/actions/pickup.ts | 掉落/墓碑/废墟回收（真实经济流入，非搬运） |
| spawned | 消费 | systems/spawn-manager.ts | spawnCreep 成功即全额计费（gross） |
| recycledRefund | 冲销 | 同上（recycle 通道） | 回收返还按寿命比例冲销，防消费高估 |
| upgraded | 消费 | creeps/engine/actions/upgrade.ts | controller 入账能量 |
| built | 消费 | creeps/engine/actions/build.ts | site progress 点数（=能量） |
| repaired | 消费 | creeps/engine/actions/repair.ts | 修复命中耗能 |
| towerSpent | 消费 | domain/defense/tower-engagement.ts | 塔 attack/heal/repair 每次 10 |

资源移动（withdraw/transfer/fill/dump/link 传输/distributor 分发）**一律不计数**——它们是
relocation 不是经济消费（任务书 §12）。塔与 spawn 是仅有的非 creep 消费者，必须覆盖，
否则恒等式系统性漏账。

## 3. 池划分与对账恒等式

```text
trackedPools   = spawnExt + containers + storage + terminal + links + creepCarry
loosePools     = dropped + tombstones + ruins          # 衰减性资产，单独列差值
otherPools     = factory + powerSpawn                   # 工业池，单房期允许未分账

# creepCarry 必须在踪：否则「采集（入账）→ 次窗入仓」的时序错位会产生 ±在途量的振荡假漂移。
# 实测（TestWorld 冷启动 600t ×11 窗）：纳入后 drift 恒为 0；排除时 dr 在 ±150 间振荡。
# creep 死亡携带能量转入墓碑（loose）表现为一次性负 drift，可由 CreepDeath 事件解释。

income         = harvested + pickedUp
consumption    = spawned + upgraded + built + repaired + towerSpent
flowBalance    = income - consumption + recycledRefund

drift = ΔtrackedPools - flowBalance - ΔotherPools      # ΔloosePools 单独报告不进等式
```

- 恒等式：**Start + Income − Consumption + Refunds ± Transfers = End**，其中 Transfers
  在池划分内自相抵消（搬进=搬出），故不出现在公式中——这正是「区分 relocation 与消费」的
  机械保证。
- 不变量：income ≥ 0、consumption ≥ 0（计数器只增）；drift 超容差连续 2 窗 → AccountingDrift
  事件（先修核算，禁带病进入下一阶段——任务书 §16）。
- drift 容差：max(20, 吞吐×2%)，衰减性 loose 资产的捡拾已计入 income（pickedUp），其自然衰减
  表现为 ΔloosePools<0 且不产生 drift。

## 4. 三指标定义（ECONOMY §3 的可计算化）

| 指标 | 公式 | 窗口/刷新 | 消费者 |
| --- | --- | --- | --- |
| 净流 net flow | 每 50 tick 窗的 flowBalance/ticks → EMA（α=CONFIG.netFlowAlpha，默认 0.3，等效半衰 ~110 tick） | 每 50 tick，房间错峰（roomName hash % 50） | 能量域门控、phase 出入参考、调拨门控前置 |
| 储备 reserve(contractReserve) | storage + terminal + links 折算能量水位（阈值区间制阈值后续接 tuning） | 同上 | Reservation 扣除基数、围城会计库存项 |
| 风险缓冲 riskBuffer | contractReserve ÷ max(ε, P0P1 速率)，P0P1 速率=(spawned+towerSpent+repaired)/ticks | 同上 | 降级预警、援助上限输入、evacuate 判据 |

补充产出（非三指标但同窗计算）：estimatedIncome = Σsource 名义产能(3000/300) × 效率系数；
效率系数初值 0.7，按实测 harvested/nominal EMA 校准（C7 校准义务闭环）。roomReserve
（相位机用总储备口径）保留于 room-state，并补上 link 漏项（C6 修正）。

## 5. 存储布局（STATE_OWNERSHIP §3.6 合规）

```text
heap/globalCache.energyLedger = { tick, rooms: Record<room, EnergyLedger> }   # L1 累加，reset 可重建
Memory.rooms[r].economy = {                                                   # schema v37 新增，瘦快照
  t: tick,                                                                    # 全部整数化
  nf: netFlowEma*100 | cr: contractReserve | rb: riskBuffer*10 |
  dr: lastDrift | ei: estimatedIncome*10 | ef: effFactor*100
}
segment economy ring（既有 id=3）：EconomySample 扩展可选字段 i/c/nf/rb           # 一鱼两吃
```

- Owner=Economy 系统（唯一写者）；Reader=任意只读。迁移：v36→v37 仅登记新可选字段，
  缺省惰性初始化（幂等 no-op 步骤），符合迁移五步之「先写新」。
- R6 合规：L1 计数为每 tick 近零成本累加；聚合档位=economy ring（50 tick）；核心指标集
  扩展项在此声明成本≈0。

## 6. Public Interface（SYSTEM_BOUNDARIES §1.5）

```ts
// src/systems/economy.ts — System（priority 1，interval 50，房间错峰内联）
computeEconomy(roomStates): EconomyState        // 纯函数在 domain/economy/accounting.ts
queryEconomy(roomName): EconomySnapshot | undefined  // Storage-aware Spawn/Request 消费入口
```

禁止：Economy 执行调拨/下单（红线 4）；每 tick 全量重算；未平滑值进门控。

## 7. 明确不做（本阶段边界）

- mineral/power/commodity 分账（ResourceAccount 抽象预留 resource 字段，energy 先行）。
- Empire 级预算五域下钻与调拨令（P6+）。
- link 能量计入 contractReserve 但 link 传输效率损耗不单列（RCL5 前 link 空）。
- 围城 siege 态储备线（Reservation ②）挂 defense-domain 既有 siegeMemory，本阶段只读不动。