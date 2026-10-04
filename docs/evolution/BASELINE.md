# BASELINE — 帝国基线快照（L0 §7 点名的产物之一）

> **这份文件是什么**：某一拍的全帝国状态锚点，供后续会话做**差分**用（"和基线比，什么变了"）。
> **这份文件不是什么**：不是结论、不是能力清单（那在 `CAPABILITY-MATRIX.md`）、不是问题台账（那在 `EVOLUTION-ROADMAP.md` 的 #1xx 与 `audit/`）。
>
> **快照时刻**：`t = 83429905`（各房 `econ.lastTick` 同值）— 采集于 2026-10-04 19:59Z。
> **码身份**：线上 `dist/main.js 787752B sha=649eb94b9784` == 本地 dist（`tmp/tools/official/check-code.mjs`）⇒ 本快照描述的就是这份二进制。
> **boot 段**：进程自 `83422285` 那次部署起未再换码（20:0xZ 复核 sha 同值）⇒ heap 类累计读数（`roadBuild`/`skip`/事件环）都是**同段累计**，可与未来读数直接差分；换码即归零。
> **取数方式**：`node tmp/tools/official/observe.mjs`（纯只读 API）+ `node tmp/tools/official/peek.mjs <单叶子路径>`。原始输出照抄如下，未做推算。

---

## 1. 领土与人口

| 项 | 值 |
|---|---|
| `Memory.rooms` | `W37S58, W38S56, W38S58` |
| 在途释放 | `[]` |
| 已放弃 | `W37S55`（⚠️该房现场仍留 2 只 `my===true` 的 spawn，见 #118） |
| 失守待清 | `[]` |
| 人口（memory 计数） | 45 ＝ 按 home `{W37S58:25, W38S56:15, W38S58:5}` |

## 2. 逐房（照抄 `observe` 的 `econ` 行）

| 房 | RCL | colonyState | 队列 | ops | site | road | hostileAt | risk | pressure |
|---|---|---|---|---|---|---|---|---|---|
| W37S58 | 8 | normal | 0/0 | 2/2 | 0 | 21 | 83407782 | false | 0 |
| W38S56 | 5 | normal | 0/0 | 1/3 | 0 | 0 | 83427832 | false | 0 |
| W38S58 | 2 | **recovery** | **2/24** | 0/0 | 0 | 0 | — | **true** | 0 |

```
W37S58  {"lastTick":83429905,"netFlowMean_d":-34.5,"storage_se":784972,"roomTotal_rs":814055,
         "energyAvailable_ea":12800,"energyCapacity_ec":12900,"harvesters_hc":3,"sources_sc":2,
         "phase_ph":4,"creepTotal_cte":2010}
W38S56  {"lastTick":83429905,"netFlowMean_d":52.6,"storage_se":123548,"roomTotal_rs":128852,
         "energyAvailable_ea":1800,"energyCapacity_ec":1800,"harvesters_hc":2,"sources_sc":2,
         "phase_ph":1,"creepTotal_cte":1765}
W38S58  {"lastTick":83429905,"netFlowMean_d":9.6,"storage_se":0,"roomTotal_rs":4459,
         "energyAvailable_ea":269,"energyCapacity_ec":300,"harvesters_hc":2,"sources_sc":2,
         "phase_ph":2,"creepTotal_cte":4000}
```

⚠️ 口径提醒（踩过的坑）：`netFlowMean_d` 是**观测器派生量**（段 3 环按房取最近 20 个样本的 `d` 均值，而 `d` 实为 `phase.reserveDelta`），**不是净流**，也不可与扩张闸吃的 `kernel.gateNetFlow` 互换；`roomTotal_rs` **不是** storage 容量（storage 容量本服恒 1,000,000）；`energyCapacity_ec` 是**该拍**可用容量。

## 3. 扩张（执行链与仪表）

```
allowed=false  newRemote=true  state=economic_startup  target=W38S58
Plans: W37S56=WAITING_EXECUTION(sr=W37S58 ready=116421t), W38S58=EXECUTING(sr=W37S58 ready=116421t),
       W39S56=EVALUATED(sr=W38S56 ready=0t), W39S55=EVALUATED(sr=W37S58 ready=0t), W36S58=EVALUATED(sr=W37S58 ready=0t)
Dashboard @83429884 | Pressure=HIGH(0.65) | Readiness=NOT_READY | Blocked=G0+G2+G3+G4+G6
          | Budget=156973/912626 | Candidates=11(Q=2,R=6,U=3) | Plans=4 active, 1 waiting | Top=W37S56(WAITING_EXECUTION)
```

⚠️ 两把同名仪器别混：dashboard 的 `Pressure=HIGH(0.65)` 是帝国级，房级 `pressure=0` 是另一台；`Blocked=` 那串属于"新提案能否晋升"，**不是**执行门禁（执行只认 `expansionAllowed`）。`ready=116421t` 的口径是"还要等的拍数"。

## 4. 贸易与国库（`runs` 为累计）

```
{"runs":24,"lastTick":83429892,"gatedBy":"","credits":16584154.425,"bucket":10000,"roomsWithTerminal":1,
 "roomsOnCooldown":0,"myOrders":1,"terminalEnergy":6373,"storageEnergy":785772,"demandsLive":0,"demandTop":"",
 "demandsPublished":0,"publishedAt":0,"demandsComputed":0,"attemptedAt":83429861,"buyBlockedBy":"",
 "buyNoMatch":0,"buyGatePrice":0,"buyBestAsk":0,"buyTried":0,"buyOk":0,"buyDeficitPriority":20}
```

⚠️ `credits` 是**余额含 escrow**，不是盈亏；`demandsPublished=0` 与 `buyTried=0` 并存是工业线"按正 ROI 才发单"的当前合闸态（见 `industry-feedstock-vein-exhausted`）。

## 5. 远矿修路账本（heap，本 boot 段累计；`roadBuild` 逐房）

| 房 | calls | noEnergy | noEnergyInRange | noWork | built | pending | progSum | roadsBuilt |
|---|---|---|---|---|---|---|---|---|
| W36S58 | 4,911 | 2,799 | **1,077** | 0 | **311** | 18 | 760 | 4（早前值） |
| W37S57 | ↑段内 | ↑ | **2,379** | 0 | — | 18（早前） | 505（早前） | 13（早前） |
| W38S56 | 488（早前） | 0 | 0（口径失明） | 488 | 0 | 0 | 0 | 0 |
| W39S56 | 1,347→2,001 | 882→1,318 | 0（口径失明） | 465→683 | 0 | 0 | 0 | 2 |

⚠️ 三条口径：**两列 `noEnergyInRange`/`noWorkInRange` 互斥可相加，各自是父桶子集、不可与父桶相加**；0-WORK 档（W38S56/W39S56）里 `noEnergyInRange` 恒 0 是**仪器失明**不是"没机会"（`noWorkInRange` 尚未上线）；`roadsBuilt` 才是"这条路有没有了"，`progSum` 会因路衰减而骗人。

## 6. 调度与产能（`skip` 直方图，500 拍窗）

```
creep/upgrader/colony-state=1174  creep/spawning=1028  creep/distributor/idle-cadence=334
creep/upgrader/idle-cadence=329   creep/reserver/budget=301  creep/labTender/idle-cadence=299
creep/hauler/idle-cadence=205     traffic/shove:anchor=175   creep/upgrader/budget=167
system/construction-manager/budget=100
hotspot=(空)  skipHotspot=creep/upgrader/colony-state
```

⚠️ `skipHotspot` 第一名是 **creep 层的 colony-state 冻结**，这与对端在查的 #127（spawn 层为保级孵出的 upgrader 被 creep 层冻掉）同一条；本文件只记读数不做归因。

## 7. 期望自检与事件（同一 boot 段）

```
kernel.expectations.tick = 83429971   violations = 非空(7+ 条 siteStaleWorkerIdle)
recent[0] = {"id":"siteStaleWorkerIdle:W36S58:6aa86a54…","seenAt":83427283,"lastAt":83429970,"count":2688}
事件环 83428320→83429905（500 条容量 ⇒ 只回溯约 1,000–1,600 拍）：
  AssignmentAssigned=230  AssignmentExpired=195  CreepDeath=47  PhaseTransition=14
  AccountingDrift=5  ExpectationViolation=6  L2Intake=2  ControllerDowngradeRisk=1
```

⚠️ **环内为 0 不等于"没发生"**（我在这条上错过三次）；要判"整个 boot 段有没有"只能靠持续性计数器，不能靠环。

## 8. 如何用这份基线做差分（下一步的取数命令，全部只读）

```sh
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
node tmp/tools/official/check-code.mjs                      # 先确认二进制没换（换了 heap 类全部归零）
node tmp/tools/official/observe.mjs                         # 本文件的 §2/§3/§4/§6/§7 同一形状复采
node tmp/tools/official/peek.mjs kernel.stats.roadBuild.W36S58.built     # 逐叶子读（整行会被截到 ~700 字符）
```

差分规则：**累计量必须差分**（`calls`/`built`/`noProg`/`roadProgressSum`）；`ea`/`storage_se` 是水位不是流量；判"某段有没有推进"用两次 `Game.time` 自己标定拍长（今天实测约 3.9 秒/拍，别用心算的 2 拍/秒）。

## 9. CPU 面（同拍补采，20:1xZ，t≈83430000）

```
kernel.capacity.tier   = "constrained"     since = 83425106   （⇒ 已持续约 4,900 拍）
kernel.stats.cpuRate   = {"windowTicks":7823,"sampledTicks":7823,"unsampledTicks":0,
                          "total":16.25,"unexplained":1.49,"unphased":1.02,"tail":0.47,
                          "bySystem":{"traffic-manager":3.48,"snapshots":1.76,"spawn-manager":0.61,
                            "remote-mining-manager":0.32,"tower-defense":0.32,"construction-manager":0.17,
                            "expectations":0.17,"link-system":0.14,"room-state":0.14,"empire-strategy":0.12}}
kernel.stats.cpuBySystem = {"terminal-manager":7.20,"remote-mining-manager":6.14,"traffic-manager":3.71,
                             "expansion-planner":2.90,"empire-economy":2.83,"tuning-engine":2.65,
                             "empire-health":2.56,"agenda-manager":2.56,"expansion-manager":1.33,"spawn-manager":0.63}
```

**要用的时候必须记住的四条口径**（都是踩过的）：
1. **`cpuRate.total` 才是接近真值的每拍均值**（拍尾采样、`unsampledTicks=0`）；`cpuAvg10` 每 10 拍采一次且采到的恰是跑 flush 的重活拍 ⇒ **偏高**，两者不可互校。
2. **`cpuRate.total` 与 `cpuBySystem` 是两台口径不同的仪器**（前者是每拍均值、后者含累计/窗口成分）⇒ **不要相加、不要拿一个去校另一个**；`traffic-manager` 在两处分别是 3.48 与 3.71 就是这个差别的表现，不是谁读错了。
3. 扩张闸的 `comfortable` 门槛是 **`0.6 × min(cpuLimit 20, tickLimit 500) = 12.00` 定值** ⇒ 现读 **16.25 ⇒ 缺 4.25/拍**。这条比本仓早前记录的"缺 2.44~2.48"**恶化了约 1.7 倍**，且 `tier` 已连续 constrained 约 4,900 拍。⚠️判"档位翻没翻"只看 `tier`+`since`（`upgradeTicks` 在 `target===prevTier` 时恒 0 是设计）。
4. `kernel.bootTick = 82414952` 是**跨部署存活**的 ⇒ 不能用来定"这次换码发生在何时"；本段的起点只能认 `83422285`（`energyLedger.tick` 归零那一拍）＋ sha 未变。定日只认功能签名，不认 `bootTick`。

## 10. 这份基线**还答不了**的问题（别把它当全量）

- **拍长未在本快照同窗标定**：只有今天早些时候实测的约 3.9 秒/拍（历史值 2.32/3.77/4.52 都出现过）⇒ 任何"多少拍＝多少小时"的换算都要写成区间。
- **防御工事与库存结构**：wall/rampart 血量、tower 存弹、storage 里非能量资源，都没采。
- **`CPU_BENCHMARKS.md` 仍是缺件**：本节是**水位快照**，不是标定（标定要的是"动作数 vs CPU"的斜率，见记忆 `cpu-calibration-harness`）。
- 因此 `BASELINE` 目前是**近全量但非完备**：领土/经济/扩张/贸易/远矿施工/调度/期望/CPU 八面有锚，防御面与资源面没有。

