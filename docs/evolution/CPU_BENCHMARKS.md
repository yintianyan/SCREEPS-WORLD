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
