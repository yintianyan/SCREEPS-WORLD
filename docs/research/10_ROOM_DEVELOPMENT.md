# 10 · 房间发展（Room Development）

> 研究文档 · 结论等级：**设计裁决**（机制核算 + 社区实践收敛）。
> 机制事实以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)
> §6/§7/§10 为基准；房间职责边界见 [09_ROOM_ARCHITECTURE.md](09_ROOM_ARCHITECTURE.md)。
> 核查日：2026-08-22。

## 1. Problem

RCL1→RCL8 的全程要数千万能量（03 §6：仅 7→8 就需 10,935,000），发展决策
本质是**能量投资序列**：先造什么、先养谁、升级投多少。错误的发展模型有两
种典型死法：均匀分级（解锁什么造什么，能量被摊薄、什么都建不成）与线性
升级执念（能量全喂 controller，没有基础设施积累）。本文裁决 phase 模型的
锚点、每阶段的人口/建造/经济配置。

## 2. Research Questions

1. phase 应该锚定 RCL 数字还是能力相变点？相变点如何映射到 phase？
2. 每阶段的人口结构、建造顺序、能量分配的推荐值是什么（可用 03 数值核算）？
3. 升级策略：多少能量喂 controller？RCL8 之后能量去哪？
4. 新殖民地与灾后房的发展路径与普通发展有何不同？

## 3. Existing Solutions（方法论参照）

strategy-playbook 的 Colony 阶段论：进入 storage/link/terminal/lab 能力后，
关注点从「角色能不能工作」转为「房间吞吐是否稳定」，让升级、建造、生产、
防御竞争同一份能量预算；以净能量流、运输延迟、spawn idle 判断是否值得
扩展。Great_Filters 把采集能力分为「卡尔达肖夫等级」：Type 0 按需采集 →
Type 1 采满本房 → Type 2 采满相邻房 → Type 3 采满扇区——即发展=能量捕获
能力逐级扩张，而不是 RCL 爬树。

## 4. Screeps Community Practice

- **建造优先级共识**：extensions 最优先（孵化预算是人口质量的天花板）→
  RCL3 第一座 tower（首个敌袭防线）→ RCL4 storage（经济相变）；
  RCL8 全程约 3 周（Reddit 6dz3xn、wiki Great_Filters 相关讨论）。——
  LIKELY（3 周数据点依赖玩法与服务器节奏）。
- **静态矿工惯例**：5×WORK 恰好在 300 tick 采空 3,000 能量 source
  （5×2×300=3,000）；社区惯用 6W 留缓冲，经典体型 [5W,1M]（550 能量，
  站定后不再移动）；第一波带移动性变体 5W/1C/3M（Reddit 864qy3）。——
  2026-08-22 复核 CONFIRMED（数学推导 + 多源一致）。
- **本地 vs 远端效率**：本地矿约 70% 利用率、remote 约 40–50%（距离与
  损耗）；reserve 使中立房 source 1,500→3,000；紧邻房起步是共识
  （多来源，LIKELY）。
- **新殖民地**：spawn 需 5000 能量建，靠母房跨房输血 + 建期间 rampart
  保护工地（Reddit lzxzu1，2021）。
- **远端砍单**：shard3 玩家完全砍掉 remote（省 move CPU 超过所得能量）
  —— jonwinsley 同款排序「CPU 效率 > 能源效率」（CONFIRMED，见 09 §4）。

## 5. Existing Bot Analysis

| Bot | 发展驱动方式 | 可迁移点 |
| --- | --- | --- |
| TooAngel | 布局与人口按当前 RCL 自动生成；结构数核对后补 site | 「RCL→应有结构」清单化；发展不单独规划，逐级跟随 |
| Overmind | bunker 布局按 RCL 分级扩展；孵化按请求优先级 | 布局与发展解耦：布局是模板，人口是请求 |
| KasamiBot | 蝴蝶模板按 RCL 推进；RCL7 起 miner overfit、hauler 池化 | 后期 CPU 优化与发展阶段绑定（RCL7 是分界） |
| The International | requests 驱动；fastFiller 专职补弹 | 「补弹」是独立工种，出现在 extension 多的阶段 |
| bonzAI | 经济全 Mission 化（MiningMission/UpgradeMission…） | 发展阶段=激活的 Mission 集合差异 |

收敛：无人做「每 RCL 一档」的均匀分级；行为切换点全部落在结构解锁
（storage/link/terminal）或人口形态（静态矿工、补弹工）上。

## 6. Advantages（能力相变 phase 模型的优势）

1. **决策最小化**：phase 数少（6 个）而相变事实客观（结构存在且运转），
   推导逻辑可单测；避免 RCL1–8 八档配置表的高频调参。
2. **能量核算有锚**：每个相变点对应明确的能量投资需求（见 §10.4 核算表），
   phase 出入口即预算检查点。
3. **与 03 §6 裁决一致**：RCL4/5/6/7 是经济/物流/矿物/产能相变点，phase
   模型直接复用该事实基准。

## 7. Disadvantages（代价）

- 相变点之间仍有长尾（RCL6→7 要 3,645,000 能量），phase 内部仍需次要
  节奏（tower 数量、extension 批次）——这些下沉到建造队列优先级而非
  新 phase。
- phase 出口条件若写成「结构存在」而非「结构运转」，会出现 storage 空转
  的假 mature——出口必须含运转指标（如 storage 水位趋势为正）。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 提前造 lab/terminal（RCL6 解锁即建） | 能量被非核心结构吸干，孵化/塔断粮 | phase 门：terminal 属 mature，入口条件=能量净流连续为正 |
| 均匀升级（能量全喂 controller） | 基础设施赤字，RCL 升了产能没升 | 升级预算 = 净流盈余的函数（§10.5），非默认消费者 |
| phase 抖动（storage 被拆→降级→重建→再降级） | 反复重建消耗 | phase 切换滞回 + 结构损失走恢复路径（09 §10.4） |
| 殖民地断血 | 新房死在 bootstrap | 输血是帝国 Agenda 带止损线（ADR-008）；本地 universal 自举兜底 |
| RCL8 后能量堆积 | 资源闲置 + 无 GCL 增长 | §10.5 能量去 sink 清单 |

## 9. CPU Implications

- 发展期房间 CPU 高于成熟期（建造扫描、物流在建、人口流动大）；phase
  是 CPU 配额的输入之一（发展期房间预算上调，成熟房间靠 link/静态化
  降载——每房 3–5 CPU 的社区数据点主要是「动得多」的房间）。
- 升级执念的 CPU 代价被低估：upgrader 是永久往返工种，RCL 越高往返越长；
  controller link（RCL5+）是降低该项的标准解（社区 link mining 模式）。
- 静态矿工（5W1M）是最大的单项 CPU 节约：矿工永久站定，零 move intent、
  零寻路（每个 intent 调用固定 0.2 CPU 且失败也收费，03 §3 同源社区口径
  见 wiki.screepspl.us/CPU）。

## 10. Recommended Design

### 10.1 phase 模型（锚定能力相变点）

| Phase | 解锁能力（03 §6） | 入口门（能力运转，非 RCL 数字） | 核心目标 |
| --- | --- | --- | --- |
| bootstrap | container×5、extension 逐步 | spawn 落地 | 活下来：采集→孵化→基础循环 |
| early-economy | **storage（RCL4）** | storage 存在且净流 ≥0 | 能量银行：hauler 化、库存积累 |
| infrastructure | **link×2（RCL5）** | source link↔storage link 链路运转 | 物流相变：静态矿工+link |
| mature | **extractor+terminal+lab（RCL6）** | terminal 存在且能量净流为正 | 矿物经济+帝国市场接入 |
| advanced | **factory+第二 spawn（RCL7）** | 双 spawn 同时可用 | 商品生产+孵化吞吐翻倍 |
| peak | tower×6、observer/powerSpawn/nuker（RCL8） | 军事结构就位 | 能量去 sink：GCL/power/军事 |

出口统一为「下一相变结构已运转」+ 闭环健康（09 §10.2），并带滞回。

### 10.2 每阶段人口结构（基线，可被 census 修正）

| Phase | 人口基线 | 说明 |
| --- | --- | --- |
| bootstrap | 2×通用采集搬运（或 5W/1C/3M 矿工+兼职 hauler）×2 source、1 builder、1 upgrader | TooAngel universal 型自举；第一优先是孵化预算（extensions） |
| early-economy | 2×静态矿工（5W1M）+ hauler×2–3 + builder + upgrader + 塔工（tower 出现后并入 hauler 顺路） | 静态矿工是本相变核心（§4 数学） |
| infrastructure | 矿工不变；hauler 减配（source→storage 由 link 承担）；+补弹工（fastFiller 型，RCL7 容量翻倍后专职化） | TI fastFiller/TooAngel 顺路投递二选一（见 12 号文档） |
| mature | + extractor 矿工（按矿物密度配 WORK）、labtech、terminal 管家（帝国系统兼任则免） | 矿物种类的 empire 需求决定优先级 |
| advanced | + factory 工、第二 spawn 车道并行孵化；KasamiBot 式 hauler 池化可选 | RCL7 起孵化吞吐与 CPU 优化并行 |
| peak | + power 处理链、军事人口（仅 war posture 授权，ADR-009） | 军事人口不算发展人口 |

### 10.3 建造顺序（phase 内优先级）

1. **extensions 永远第一**：孵化预算即人口质量。容量序列 RCL≤6=50 /
   RCL7=100 / RCL8=200；RCL8 单 spawn 孵化预算 12,300（03 §10）。
2. tower 于 RCL3（首塔）、RCL5/7/8 递增到 6；storage RCL4；link RCL5；
   terminal+extractor+lab RCL6；factory+spawn2 RCL7；observer/powerSpawn/
   nuker RCL8。
3. 道路不预铺：按实测交通热度逐段添加（TooAngel 沿实测路径证据，见
   [13_CONSTRUCTION_SYSTEM.md](13_CONSTRUCTION_SYSTEM.md)）。
4. 殖民地特殊项：建期间 rampart 保护工地（社区实践 §4）。

### 10.4 经济核算（用 03 数值）

- 产能上界：自有房 2 source × 3,000 / 300 tick = **20 能量/tick**；本地
  利用率约 70% → 实际 ~14/tick；remote 每房 40–50% → +4–8/tick。
- 升级成本（纯升级能量，不含采集损耗）：2→3 45k；3→4 135k；4→5 405k；
  5→6 1.215M；6→7 3.645M；7→8 10.935M。以 10×WORK upgrader（150/tick
  上限，3 §6：15×WORK/tick 封顶）持续运转：4→5 需 ≥2,700 tick；7→8 需
  ≥72,900 tick（≈3 天连续纯升）——**「RCL8 全程约 3 周」与该量级吻合**
  （能量还需分流建造/孵化/防御，LIKELY）。
- 阶段预算建议：升级吃「净流盈余」：early-economy ≤30% 产能；storage
  水位安全线以下再降；peak 期由帝国 GCL Agenda 定（§10.5）。

### 10.5 RCL8 后能量去 sink（发展终局）

1. **GCL farm**：保持高 upgradeRate 刷 GCL（GCL≈1e6×L^2.4，03 §9），为
   扩张解锁房位——是帝国层 Agenda，指定某 peak 房承担。
2. **Power 处理**：power spawn 1 power+50 energy→50 energy 净产出（03
   §7），power creep 带来的运营增益（OPERATE_SPAWN/LAB/TOWER）。
3. **商品/boost 生产**：factory 商品与 T3 boost 库存（KasamiBot
   labmanager 维持 T3 库存的先例）。
4. **军事储备与重建基金**：war posture 与战后恢复的能量池。

### 10.6 特殊发展路径

- **新殖民地**：claim → 母房输血建 spawn（5,000 能量）→ bootstrap；
  失败降级为 remote mining 或放弃（ADR-008 的独立降级路径）。
- **灾后房**：走恢复 phase（09 §10.4），不进本模型的发展序列；恢复完成
  后按现存结构重新判 phase。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| RCL1–8 均匀八档 | 忽略相变点；03 §6 与社区实践双重否定；配置表维护成本高 |
| 解锁即建（每 RCL 清空建造单） | energy 摊薄死法（§8 第一行）；建造必须过预算门 |
| 能量全喂 controller 的线性升级 | 无基础设施积累的 RCL 是纸面数字；社区 3 周全程含大量非升级投资 |
| 固定人口表驱动 | 忽视 source 位置/地形/威胁差异；人口必须 census+缺口推导（11 号文档） |

## 12. Open Questions

1. phase 内部的次级节奏（tower 批次、extension 位置批次）放建造队列还是
   phase 配置？倾向前者，需 soak 验证。
2. GCL farm 房是否值得 boost upgrader（work 类 boost 仅 1.5/1.8/2，03 §7）？
   初步判断收益低，倾向不 boost。
3. 「本地 70%/remote 40–50%」的利用率系数应改为按实测净流校准的自适应
   参数，初值用社区数。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://wiki.screepspl.us/Great_Filters | 社区 wiki | 卡尔达肖夫采集分级；发展过滤器顺序；工地上限 100 | CONFIRMED（2026-08-22 复核） |
| https://www.reddit.com/r/screeps/comments/864qy3/（ideal ratios 讨论） | 社区 | 5W 采空 3,000 source 的数学；6W 缓冲惯例；[5W,1M] 经典体型 | CONFIRMED（数学可推导） |
| https://www.reddit.com/r/screeps/comments/6dz3xn/ | 社区 | RCL8 全程约 3 周 | LIKELY |
| https://www.reddit.com/r/screeps/comments/lzxzu1/ | 社区 | 殖民 5000 能量+rampart 护工地 | LIKELY |
| https://jonwinsley.com/notes/screeps-room-planning | 开发者笔记 | CPU>能源>防御；砍 remote 的 shard3 实证 | CONFIRMED |
| 03_SCREEPS_GAME_CONSTRAINTS.md §6/§7/§9/§10 | 官方事实 | RCL 门禁与进度、产能与升级上限、GCL 公式、孵化预算 | CONFIRMED |
| Bot 调研摘要 2026-08-22（TooAngel/Overmind/KasamiBot/TI/bonzAI） | 源码 | 发展驱动=结构解锁/请求激活，非均匀 RCL 分级 | CONFIRMED |
