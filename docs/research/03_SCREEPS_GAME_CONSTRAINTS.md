# 03 · Screeps 游戏机制约束（官方事实核查）

> 研究文档 · 结论等级：**事实基准**（本套件其他文档引用的机制数字以本文为准）。
> 核查方法：官方文档（docs.screeps.com）与引擎常量源码
> （github.com/screeps/common/blob/master/lib/constants.js）双重交叉核对，
> 核查日 2026-08-22。冲突时以引擎常量为准（§13 列出全部发现的文档/社区错误）。

## 1. Problem

Screeps 的架构设计错误大多源于对机制的错误假设（错误的 boost 倍率、错误的 tower
衰减、错误的 Memory 成本模型）。本文把对 AI 架构有约束力的官方事实钉死，并给出
「文档散文 vs 引擎常量」的裁决先例。

## 2. Research Questions

- CPU/Memory/寻路的真实成本模型是什么？
- RCL 进阶门禁与经济/战斗数值如何约束房间发展与军事设计？
- 哪些社区流传数字是错的？

## 3. CPU 模型（约束：调度与看门狗设计）

| 事实 | 数值 | 来源 |
| --- | --- | --- |
| 免订阅 CPU limit | 固定 20 | docs/cpu-limit.html |
| Bucket | 未用 CPU 累积，上限 10,000 | 同上 |
| tickLimit | limit + 最多 500 bucket CPU；永不低于 limit | 同上 |
| Pixel | `Game.cpu.generatePixel()`：桶满 10,000 时，10,000 bucket → 1 pixel | api/#Game.cpu |
| CPU Unlock | 1 个 cpuUnlock 账户资源 → 24h 全量 CPU | 同上 |
| 跨 shard 配额 | `setShardLimits` 每 12h 只能改一次 | 同上 |
| Memory 成本 | `JSON.parse`（首次访问）与 tick 末 `JSON.stringify` 计入 CPU | docs/global-objects.html |
| Tick 时长 | 无官方定值（全玩家执行完即结束）；shard0 ≈4.5–5.5s、shard1/2 ≈3.5–4s、shard3 ≈2.5–3s（开发者口径，LIKELY） | docs/architecture.html |

**架构推论**：CPU 预算必须按 `Game.cpu.limit` 运行时比例化（不写死账户数值）；
降级立即生效、恢复需滞回；Memory 体积直接是每 tick 税。

## 4. Memory 模型（约束：状态分层存储）

- 默认 `Memory` = `JSON.parse(RawMemory.get())` 惰性解析；主字符串体积**无正式 API
  文档上限**；官方贡献文档 caching-overview 写有 2048KB 口径（LIKELY——贡献文档非
  契约，设计不赌上限，按「越小越好 + segment 分流」执行）。—— docs/global-objects.html
  + docs/contributed/caching-overview.html
- RawMemory segments：共 100 段 × 100KB，**每 tick 最多激活 10 段**；异步（本 tick
  请求、下 tick 可读）；总计约 10MB 额外存储。—— api/#RawMemory
- Foreign segment：同时仅 1 个，需对方公开。InterShardMemory：每 shard 100KB，
  本 shard 可写他 shard 只读。—— 同上
- Global/heap：官方明言「会被相当规律地重置，不可视为持久存储」，require 缓存同时
  清空；**无官方频率数字**（社区「~30 分钟」说法无依据，UNCERTAIN）。
  —— docs/contributed/caching-overview.html

**架构推论**：三层存储成立——Memory 只存 ID/枚举/少量数字；heap 存可重建缓存
（必须容忍随时丢失）；segment 存冷数据（intel/市场历史/遥测）。

## 5. 寻路（约束：移动子系统成本）

- `PathFinder.search` 默认 maxOps 2000（官方换算 **1 op ≈ 0.001 CPU**）、maxRooms 16
  （上限 64）、plain 1 / swamp 5、heuristicWeight 1.2。—— api/#PathFinder
- `moveTo`：`reusePath` 默认 5，路径序列化进 creep memory `_move`。—— api/#Creep
- `Game.map.findRoute`：房间级路由，官方示例即「findRoute 限定房间走廊 + 房内
  PathFinder」的两级模式。—— api/#Game.map
- CostMatrix 可缓存复用（官方建议同 tick 共享）。—— PathFinder 页

**架构推论**：跨房移动必须 findRoute 两级寻路；房内搜索 maxRooms:1；寻路按
角色/距离三档限频；CostMatrix 带 TTL 缓存。

## 6. RCL 门禁（约束：房间发展阶段设计）

- 每 tick 升级上限 = 15 × WORK 数（CONTROLLER_MAX_UPGRADE_PER_TICK）。
- 升级进度：RCL1→2 200；2→3 45,000；3→4 135,000；4→5 405,000；5→6 1,215,000；
  6→7 3,645,000；7→8 10,935,000。—— 引擎常量 CONTROLLER_LEVELS
- 结构解锁：storage RCL4；link 5:2→8:6；extractor+terminal RCL6；lab 6:3→8:10；
  factory RCL7；第二 spawn RCL7（第三 RCL8）；observer/powerSpawn/nuker RCL8；
  tower 3:1/5:2/7:3/8:6；extension 2:5→8:60；container 任意 RCL ×5。
- Downgrade 计时（引擎常量）：{1:20000, 2:10000, 3:20000, 4:40000, 5:80000,
  6:120000, 7:150000, 8:200000}（docs 散文数值与之冲突，见 §13）。
- Safemode：持续 20,000 tick / 冷却 50,000 tick / 每升 1 级充能 1 次 / 1000 ghodium
  可补 / **每 shard 同时只能一房开启** / attackController 与 nuke 落点会取消。
- Reserve：每 CLAIM part 每 tick +1，上限 5,000 tick；预约使中立房 source 满容量
  （3,000）。claim creep 寿命 600 tick。

**架构推论**：RCL4（storage）与 RCL6（terminal/extractor/lab）是两个经济相变点；
RCL5（link）是物流相变点；RCL7-8 是军事/产能相变点。房间 phase 模型应锚定在
这些能力门槛上，而非均匀分级。

## 7. 经济数值（约束：物流与市场设计）

- Source：自有房 3,000 / 中立与 highway 1,500 / SK 房 4,000 能量，300 tick 再生。
- 矿物：每房 1 种，密度 15k/35k/70k/100k（概率 .1/.5/.9/1.0），枯竭后 50,000 tick
  再生（≥35k）。
- Terminal 运输能量成本 = `ceil(amount × (1 − e^(−distance/30)))`（指数衰减公式）；
  冷却 10 tick、单次 ≥100 资源、容量 300k。
- 市场：挂单费 5%（取消失不退）；每 tick 最多 10 笔 deal；订单上限引擎常量 300
  （docs 写 50，冲突见 §13）。
- Lab：两输入 lab 距离 ≤2，每次产 5 单位，cooldown 5–160 tick（按产物）；boost
  消耗 30 矿物 + 20 能量 / part。
- Boost 倍率（t1/t2/t3）≠统一 2/3/4：attack/ranged/heal/dismantle/carry/move =
  2/3/4；**harvest = 3/5/7；build/repair/upgrade = 1.5/1.8/2**；tough 减伤
  ×0.7/0.5/0.3。
- Factory：RCL7、容量 50k、按商品 cooldown；Power：1 power + 50 energy → 50 energy
  净能量（power spawn 每tick 1 个）；power bank 500–5,000 power、2M hits、50% 反击。
- Power creep：25 级封顶、寿命 5,000 tick、OPERATE_* 门槛 [0,2,7,14,22] 级
  （OPERATE_SPAWN 孵化加速 ×0.9→×0.2、OPERATE_TOWER 伤害 ×1.1→×1.5、
  OPERATE_LAB cooldown ÷2→÷10）。

**架构推论**：boost 经济必须按真实倍率表核算（harvest boost 3/5/7 使矿工产能
质变）；terminal 运费的指数公式意味着近距离调拨近乎免费、远距离昂贵。

## 8. 战斗数值（约束：防御与军事设计）

- 每 part：ATTACK 30 / RANGED 10 / HEAL 12（远程 4）/ REPAIR 100 / DISMANTLE 50
  （不产能量）/ HARVEST 2 / BUILD 5。
- Tower：攻击 600 / 治疗 400 / 修理 800，每次 10 能量；≤5 格满效，5→20 格线性
  衰减至 **25%**（TOWER_FALLOFF 0.75，社区「最低 20%」说法错误）。
- Wall 上限 300M；rampart 上限按 RCL（30 万→3 亿），衰减 300 hits/100 tick。
- 孵化 3 tick/part（50 part = 150 tick）；寿命 1,500 tick；每 part 100 hits 前排先损。
- Fatigue = 体重（非 MOVE 数，空 CARRY 不计）× 地形（路 1/平原 2/沼泽 10），每 MOVE
  每 tick 减 2。
- Nuke：射程 10 房、飞行 50,000 tick、中心 10M / ≥2 格 5M 伤害、装填 300k 能量 +
  5k ghodium、冷却 100,000 tick；**落地立即取消 safemode 且充能冷却清零**。

**架构推论**：quadratic tower 衰减 → 防御纵深重要；dismantle 不产能量 → 拆家
攻防是纯消耗战；nuke 的「取消 safemode」效果是其战略价值核心。

## 9. 世界结构（约束：帝国与扩张设计）

- 房间 50×50；sector 10×10；highway = 坐标 mod 10 == 0；sector 中心房有 SK lair
  （source + power bank）。
- GCL = 可 claim 房间数；升级 ≈ 1e6 × L^2.4 控制点（常量 GCL_POW=2.4、
  GCL_MULTIPLY=1e6）；GCL 永不丢失。
- Novice Area：GCL≤3 限定、限 claim 3 房、safemode 无冷却、禁 nuker，可由系统签名
  常量探测（SIGN_NOVICE_AREA 等）。
- Shard0–3（shard3 定位非订阅服，LIKELY）；跨 shard 走 portal + InterShardMemory。

## 10. 其他关键事实

- Spawn：容量 300；房间 spawn+extension 总能量 <300 时每 tick 自回 1（灾后兜底）；
  recycle 返还 ≤125 能量/part；renew 清除全部 boost。
- 容量：storage 1M / terminal 300k / lab（能量 2k、矿 3k）/ link 800 / container 2k
  （每 5,000 tick 衰减）；link 传输损耗 3%（接收侧 `ceil` 扣除）、**冷却 = 1 tick ×
  两 link 切比雪夫距离**（引擎 intents/links/transfer.js，仅发送侧冷却）。
- Extension 容量：RCL≤6=50、RCL7=100、RCL8=200（RCL8 单 spawn 理论单次孵化预算
  300+60×200=12,300 能量）。
- 身体价格：move/carry 50、work 100、attack 80、ranged 150、heal 250、claim 600、
  tough 10。尸体掉落 = 成本 × 0.2。

## 11. Recommended Design（事实驱动的架构裁决）

1. **CPU 看门狗按运行时比例化**：软/硬上限随 `Game.cpu.limit` 缩放；四档降级
   （Healthy/Guarded/Conserve/Recovery）+ 滞回恢复。
2. **三级存储**：Memory（瘦、版本化、迁移）/ heap（TTL 缓存、随时可丢）/ segment
   （冷数据、低频）。
3. **两级寻路 + 限频 + CostMatrix 缓存**；本地搜索 maxRooms:1。
4. **房间 phase 锚定能力相变点**（storage/link/terminal/factory/双 spawn）。
5. **经济核算用引擎常量**（boost 倍率、terminal 运费指数公式、tower 衰减）。
6. **Safemode 当战略资源管理**（每 shard 一房上限 + nuke 反制语义）。

## 12. Alternatives Rejected

- 「按固定账户 CPU 数字写死阈值」——违反 CPU limit 运行时语义。
- 「Memory 上限按社区 2MB 传说设计」——无官方依据，应按「越小越好 + segment 分流」
  设计而不赌上限。
- 「均匀 RCL 分级驱动发展」——忽略相变点，导致在错误时机建 lab/终端。

## 13. 文档/社区错误清单（裁决记录）

| # | 冲突 | 裁决 |
| --- | --- | --- |
| 1 | control.html 散文 downgrade 计时 vs 引擎常量 | 以引擎常量为准 |
| 2 | market.html 运费示例（线性 10%/房）vs calcTransactionCost 指数公式 | 以指数公式为准 |
| 3 | Boost「统一 2/3/4 倍」说法 | 仅部分 part 成立；harvest 3/5/7、work 类 1.5/1.8/2 |
| 4 | 订单上限 docs 50 vs 引擎 300 | 以引擎 300 为准 |
| 5 | Tower 最低 20% vs 引擎 25% | 以引擎为准 |
| 6 | global 重置「每 ~30 分钟」 | 无官方依据；设计必须假设任意时刻重置 |
| 7 | tick「固定 3 秒」 | 2.5–5.5s 随 shard/负载；禁止固定换算 |
| 8 | pixel 成本「5000 bucket」（论坛旧帖 forum/3099）vs 引擎常量 | `PIXEL_CPU_COST = 10000`，以引擎为准（论坛帖本身记录的就是这次调价） |
| 9 | 本文早期版本「link 冷却固定 1 tick」 | 引擎源码：冷却 = 1 × 切比雪夫距离（发送侧）；损耗 3% 接收侧 ceil 扣（W-B 撰写期源码复核） |
| 10 | power bank「500–10,000」（wiki/Power）vs 引擎常量 | `POWER_BANK_POWER_MAX = 5000`，以引擎为准（W-C 撰写期复核；raw fetch 超时，经常量页与搜索摘要确认） |

## 14. Evidence / Sources

| 来源 | 用途 | 置信度 |
| --- | --- | --- |
| https://docs.screeps.com/api/constants.html + https://github.com/screeps/common/blob/master/lib/constants.js | 全部数值（交叉核对） | CONFIRMED |
| https://docs.screeps.com/cpu-limit.html · global-objects.html · api/（PathFinder/Creep/RawMemory/Game.market/StructureTerminal 等） · control.html · defense.html · power.html · start-areas.html · resources.html · creeps.html | 各节事实 | CONFIRMED |
| https://docs.screeps.com/architecture.html + Steam 社区讨论 | tick 时长 | LIKELY |
| https://wiki.screepspl.us/Shard/ | shard 列表 | LIKELY |

（本文为全套研究文档的机制事实单一真相源；后续文档引用数值时不再重复贴 URL。）
