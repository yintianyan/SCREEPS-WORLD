# CPU_BENCHMARKS — CPU 仪表口径、门槛阶梯与已核标定（L0 §7 点名的产物之一）

> **本文件的定位**：把"CPU 到底怎么量、门槛怎么算、哪个数能拿去做决定"固定下来，避免每个新会话重犯同一类错（静态审计排序错过约 1000 倍、把 `cpuAvg10` 当真值、把减法残差当漏账）。
> **本轮状态**：门槛阶梯与线上读数都是**现读**（`capacity.ts` + `peek` 叶子路径，2026-10-04 20:1xZ）；标定斜率是**早前记录的，本轮未复测**——两类在下方分开标注。

---

## 1. 门槛阶梯（现读 `src/domain/strategy/capacity.ts`，不是记忆）

```ts
DEFAULT_CAPACITY_OPTIONS = { abundantRatio: 0.35, tightRatio: 0.6, constrainedRatio: 0.8, upgradeWindowTicks: 300 }
const limit  = Math.max(1, Math.min(input.cpuLimit, input.tickLimit));   // :103
const headroom = 1 - usage / limit;                                      // :105
// headroom ≥ 1−0.35 → abundant ；≥ 1−0.6 → comfortable ；≥ 1−0.8 → tight ；否则 constrained   // :108-111
```

⇒ 以本服 `cpuLimit=20`、`tickLimit=500`（取小者 **20**）为条件，**用率 `usage/20` 的分段是**：

| 档位 | 用率区间 | 每拍用量（CPU/t） |
|---|---|---|
| abundant | ≤ 0.35 | ≤ 7.00 |
| comfortable | 0.35 – 0.60 | 7.00 – 12.00 |
| tight | 0.60 – 0.80 | 12.00 – 16.00 |
| constrained | **> 0.80** | **> 16.00** |

**闭合自检（线上 20:1xZ）**：`cpuRate.total = 16.25` ⇒ `16.25/20 = 0.8125 > 0.8` ⇒ **应判 constrained**；实测 `kernel.capacity.tier = "constrained"`（`since=83425106`，已连续约 4,900 拍）。**算式与状态机一致** ⇒ 这台仪器的两个独立出口互证，没有"读数与档位打架"的中间态。

### ⚠️ 这一条直接改变 #50 的问法（原记录只给了一个目标位）
- **只要退出 `constrained`**（回到 tight，恢复常规雄心）：`usage ≤ 16.00` ⇒ **砍 0.25/t 就够**。
- **要回到 `comfortable`**（扩张闸 G6 吃的那条线）：`usage ≤ 12.00` ⇒ **要砍 4.25/t**。
⇒ 这是两个差 17 倍的动作量。早前台账记的"缺 2.44~2.48/拍"用的是**当时**的 `total≈14.5`，方法一样、输入变了 ⇒ **别把旧缺口数字当现值**，引用前重采一次。
⇒ 升档另有 300 拍滞回（`upgradeWindowTicks`），且 `upgradeTicks` 在 `target===prevTier` 时恒 0 是**设计**（判"档位会不会自己翻"只看 `tier`+`since`）。

---

## 2. 四台同名不同物的 CPU 仪器（口径表）

| 仪器 | 位置 | 口径 | 偏差方向 | 消费者 |
|---|---|---|---|---|
| **`cpuRate.total`** | `Memory.kernel.stats.cpuRate` | 每拍拍尾均值；`windowTicks=7823`、`sampledTicks=7823`、`unsampledTicks=0` | 最接近真值 | 档位判定（现输入） |
| **`cpuAvg10`（10 拍一采样）** | `Game.cpu` 相关 | 每 10 拍采一次，**采到的恰是跑 flush 的重活拍** | **稳定偏高**——本仓代码注释里就有实测：`capacity.ts:43`「同一帝国 avg10=13.2 vs 逐拍=10.6，偏高约 2.6/t」 | 别再拿它当档位输入（已改） |
| **`cpuRate.bySystem` / `byRole` / `byPhase`** | 同上，三张分表 | 同一分母（每拍）下的三种切法 | 各表内部自洽 | 归因、优化排序 |
| **`stats.cpuBySystem` / `cpuPerTickBySystem`** | `Memory.kernel.stats` | **另一台**仪器（累计/窗口成分不同） | 与 `cpuRate.bySystem` 数值不同（例：`traffic-manager` 3.71 vs 3.48） | **不相加、不互校** |

---

## 3. 线上切面（20:1xZ 照抄；`total=16.25`，未记录项见 §5）

```
byPhase : creeps 7.20 | post 3.50 | systems 2.65 | snapshots 1.77 | segments-flush 0.07
          | observability 0.03 | flush-skips 0.01   （Σ = 15.23）
byRole  : harvester 2.20 | remoteHarvester 1.55 | remoteHauler 0.87 | hauler 0.63
          | distributor 0.41 | reserver 0.22 | upgrader 0.22 | carrier 0.20 | builder 0.14 | worker 0.08
          （Σ 前十 = 6.52）
bySystem: traffic-manager 3.48 | snapshots 1.76 | spawn-manager 0.61 | remote-mining-manager 0.32
          | tower-defense 0.32 | construction-manager 0.17 | expectations 0.17 | link-system 0.14
          | room-state 0.14 | empire-strategy 0.12
残差列  : unexplained 1.49 | unphased 1.02 | tail 0.47
```

**三条读数纪律（都错过）**：
1. **`byPhase` 之和 + 三个残差 ≠ `total`**（15.23 + 2.98 = 18.21 vs `total` 16.25）⇒ **不要拿这个差当"漏账"**。它们是不同分母/不同归属规则的切法；早前"其余 4.4/t 未归因"就是这类**减法产物**，`byPhase` 自己能闭合时更不该追。
2. `byRole` 之和（6.52）与 `byPhase.creeps`（7.20）差 0.68 ⇒ 同量不同切法的正常差，**别据此说角色表漏了谁**。
3. `traffic-manager + snapshots ≈ 5.24/t` 是既有的**结构性成本**（早前五条"能省"嫌疑全部被实读否掉；`snapshots` 被 role-runner 每拍读、parking 跨拍缓存按算子只占 1~2%）⇒ **低于总负载 5% 的可省项不立案**。

---

## 4. 已核标定（**本轮未复测**，引用时按"历史标定"处理）

- 夹具主单价：**≈0.21 CPU / 一次签发**（`tests` 侧标定夹具）。
- 第四次标定是**线上做的**：变量项与相位对到 4% 以内，但**固定项实测 ≈6.7/t**，而夹具截距只有 2.94 ⇒ **夹具低估截距约 2.3 倍**。
  ⇒ 结论：**用夹具排优化顺序会错**（历史事故：静态审计排序错过约 1000 倍，`getTerrain` 实测 0.0026 又是一次）；要排序只能在真负载上做差分。
- 负载模型可用的经验式：`负载 ≈ 0.2 × 动作数 + 固定项`（在固定项被实测填对之后才成立）；**当斜率对得上时不要改代码去"省"**。

---

## 5. 这份文件还**没有**的东西（下次要补的）

- **同窗标定的拍长**（换算"几点"必须用；历史实测 2.32 / 3.77 / 4.52 秒/拍都出现过）。
- **每房 CPU 现值**（`stats.cpuPerTickByRoom` 有这张表，但本文件未采；且它给候选房/远矿房也记数 ⇒ 别当帝国房成本读）。
- **动作数 ↔ CPU 的同时钟斜率复测**（§4 是历史值）。
- **bucket 借用规则对档位的污染检查**：扩张 G6 用 `min(limit, tickLimit)` ⇒ **借 bucket 洗不绿扩张闸**（这条已核，但没做现值演示）。

## 6. 复采命令（全部只读）

```sh
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
node tmp/tools/official/peek.mjs kernel.stats.cpuRate.total      # 单叶子路径！整行会被截到 ~700 字符
node tmp/tools/official/peek.mjs kernel.capacity.tier
node tmp/tools/official/peek.mjs kernel.capacity.since
node tmp/tools/official/check-code.mjs                          # 先确认二进制没换（换了窗口就重开）
```
差分规则：`cpuRate.total` 是**窗口均值**（不是累计），但窗口起点随换码重置 ⇒ 跨段比较要先 `check-code` 证明没换码。

---

## 7. 第二个切面（10-06 00:0xZ，R350）——**结构没变，但这次把 #50 的算法闭合了**

同窗实测（`sha=649eb94b9784`，`check-code` 前后各一次同值 ⇒ 窗口内没人换码）：

| 项 | 10-04 20:1xZ | **10-06 00:0xZ** | 差 |
|---|---|---|---|
| `cpuRate.total` | 16.25 | **16.14** | −0.11 |
| byPhase `creeps` | 7.20 | **7.18** | −0.02 |
| byPhase `post` | 3.50 | **3.34** | −0.16 |
| byPhase `systems`（main 相位） | 2.65 | **2.92** | +0.27 |
| byPhase `snapshots` | 1.77 | **1.56** | −0.21 |
| Σ(byPhase) / 残差 | 15.23 / ≈1.0 | **15.11 / 1.03** | — |
| `cpuSystemTotal`（不截断全量） | 未采 | **6.03** | — |

**§5 那两项欠账本轮补上**：
- **同窗拍长**：`stats.lastSample` 两次读数 83,455,585 → 83,455,595（42 秒）⇒ **4.2 秒/拍**；跨 26 小时的平均是 24,390 拍 / 93,300 s ⇒ **3.83 秒/拍**。换算一律写成区间（3.8–4.2 s/拍），别再用心算。
- **每房 CPU 现值**（`stats.cpuPerTickByRoom`，文档已注明它是**下界**，单意图快路径不在跨度内）：W37S58 **1.201** / W38S56 **0.921** / W36S58 0.418 / W37S57 0.277 / W38S58 **0.214** ⇒ 自有房合计 ≈3.03/t。

### 相位归属核到底：`post` 就是 traffic-manager
`traffic-manager.ts:40` 声明 `phase:"post"`，且 `grep -rln 'phase: "post"' src/systems/` **只命中它一个**。
⇒ `post 3.34` ≈ traffic-manager `2.81`（+0.53 未归因），而 `systems 2.92` 是 **main 相位**、**不含** traffic-manager。
两边各自闭合：main 榜去掉 traffic 后 0.53+0.52+0.48+0.39+0.31+0.21+0.13+0.10+0.09 = **2.76 ≈ 2.92（差 0.16）**。

### ⚠️ 本轮自抓的口径误判（差点定罪一个"新大户"，值一条纪律）
我先读 `stats.cpuBySystem`，看到 `remote-mining-manager = 4.78`（10-04 同键是 0.32），当场写下"它成了最大消费者"。
**读代码才发现 `cpuBySystem` 是 `systemBudgetEma`**（`telemetry-collector.ts:402`），而它自己的注释就写着
「**EMA 排出来的榜会把低频系统错当成大户**」。真口径是 `cpuPerTickBySystem`：`remote-mining-manager = **0.48**/拍`。
⇒ 一个低频系统的 EMA 值可以是它 per-tick 值的 **~10 倍**。定罪前必须问的不是"这个数大不大"，而是**"这个键是哪台仪器、什么口径"**——
这台仓里同名的 CPU 仪器已有四份（§2），这次的 15 倍差就是它们之间的间距。

### #50 的算术（把"差多少"变成"从哪来才可能够"）
档位按本文档 §1：`constrained` 是 **>16.00/t**；现场 `since=83,425,106`、现 `t≈83,455,595` ⇒ **已钉在 constrained 30,489 拍**（按同窗拍长 3.8–4.2 s/拍折算 ≈ **32–36 小时**）。
- **两个目标位要分开说**（这是 #50 一直混着的地方）：**脱离 constrained 只需 ≤16.00 ⇒ −0.14/t**（几乎在噪声里，下一拍就可能自己翻）；
  而**进到 comfortable 才需 ≤12.00 ⇒ −4.14/t**（扩张闸按 #10 认的是后者）。10-04 记的 4.25 是 total=16.25 时的同一算法。
- 系统侧天花板：`cpuSystemTotal` 全量只有 **6.03**，其中 traffic-manager 2.81 已被判为**结构性成本**（#45：五条"能省"嫌疑全部被实读否掉），snapshots 1.56 同理。
  ⇒ **就算把 main 相位那 2.76 全砍光，也够不到 4.14**；差额必须来自 `creeps 7.18`（动作数/编制）或 `post`，或接受档位 stays。
- 这就是 #50 的实际形状：**这不是"找一个大户"的问题，是"要不要缩活动量"的问题**。属人不变，但现在有数了。

---

## 8. creep 侧单价标定（10-06 08:3xZ，R355）——**这一条把 #50 的一个选项算掉了**

一次性现场样本（`console-eval`，mark=`R355P2` 回读一致 ⇒ 不是撞键取回别人的结果）：
`t=83,456,134`、`Game.cpu.getUsed()=18.55`、`limit=20`、`tickLimit=500`、`bucket=9982`、**人口 `n=42`**，
角色前十二：`remoteHauler 6 / remoteHarvester 5 / hauler 5 / harvester 4 / distributor 4 / carrier 4 / attacker 4 / reserver 3 / upgrader 2 / healer 2 / remoteDefender 1 / labTender 1`（合计 40，另 2 只在长尾）。

**算法与口径限制（先说限制再给数）**：分母是**瞬时快照**，分子 `byPhase.creeps=7.18` 是**窗口均值**——两条采样时间不同、
而编制会随 respawn 波动 ⇒ 下面所有"每只"的数只能当 **数量级**，不能当报价。
- 帝国级：**7.18 ÷ 42 ≈ 0.171 CPU/只·拍**（creep 相位全部摊到每只）。
- 与历史夹具价对照：夹具是 **≈0.21 CPU/一次签发**（单位=动作，不是creep）。两者同数量级 ⇒ **相互印证但不是同一口径**，别写成"复现了 0.21"。
- 分角色（同样受上面的时间错位限制）：`harvester 2.07÷4≈0.52`、`remoteHarvester 1.58÷5≈0.32`、`remoteHauler 0.71÷6≈0.12`、`hauler 0.59÷5≈0.12`、`reserver 0.53÷3≈0.18`。
  ⇒ **采集端（harvester 系）每只贵 3–4 倍于搬运端**：要省 CPU，动采集端的收益最高，但采集端就是收入的来源。

**对 #50 的硬结论（这是本节的全部目的）**：目标是 `comfortable ≤12.00`，现值 `16.14` ⇒ 需 **−4.14/t**。
- 系统侧天花板：`cpuSystemTotal=6.03`，其中 traffic-manager 2.81 与 snapshots 1.56 已判结构性（§G6）⇒ **整榜砍光也不够**（§7 已算）。
- creep 侧：按 0.171 CPU/只·拍，−4.14/t ≈ **削掉 24 只 = 现编制的 57%**。
⇒ **两个名义上"可做"的杠杆都被算掉了**：一个不够，一个要先砍一半产能。所以 #50 的真实选项不是"调哪个参数"，
而是三选一：**(a) 接受 constrained 档**（并把扩张闸的 CPU 判据从 comfortable 改成 constrained-exit——注意这是**改判据不是降门槛**，需要 owner 明确认）；
**(b) 抬 `limit`**（`Game.cpu.limit` 是 20 而 `tickLimit` 已到 500 ⇒ 借 bucket 不改变档位算法里的 `min(limit,tickLimit)=20`，所以这条只能靠订阅/算力来源，不是代码能改的）；
**(c) 降"固定项"**（§4 标定过：固定项实测 ≈6.7/t，与 `cpuSystemTotal 6.03` 同量级 ⇒ 所谓"固定"基本就是系统榜本身，回到 (a)）。
**这一节没有改任何代码、没有动任何阈值**；它只是把一个看起来"还有一条路"的问题算成"只剩一个真选择"。
