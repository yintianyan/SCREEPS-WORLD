# 20 · CPU 优化：预算模型、节奏分层与缓存策略

> 研究文档 · 结论等级：**设计裁决**（社区数据 + bot 实证充分）。
> 本文是「预算驱动自治」的核心依据：帝国扩张/收缩由运行时 CPU 富余度裁决。
> 机制基准见 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §3/§5；
> 调度框架见 [19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md)。

## 1. Problem

Screeps 的 CPU 是唯一真正的硬稀缺资源：能量可以再生产、creep 可以重生、房间可以
夺回，超预算被切断的 tick 却永远回不来。设计要回答三个问题：

1. 哪些工作该每 tick 做、哪些该摊薄、哪些该事件驱动？
2. 最贵的三类操作（寻路、扫描、Memory 税）各用什么模式压成本？
3. 帝国规模如何随 CPU 预算自动伸缩（预算驱动自治的判据）？

## 2. Research Questions

- 各 API 的真实成本量级是多少（intent 固定税、寻路 ops、find/look）？
- 三档工作节奏的判据如何形式化？
- 寻路限频与 CostMatrix 缓存的最优设计？
- 每房 CPU 预算如何公式化分配？
- pixel 生成与 bucket 管理策略？
- TooAngel 三指标门控如何证明「预算驱动自治」可行？

## 3. Existing Solutions（成本事实基准）

综合 03 号文档核查与本次补充核查（wiki.screepspl.us/CPU/、官方博客、社区实测）：

| 事实 | 数值/机制 | 来源与置信度 |
| --- | --- | --- |
| intent 固定税 | 每个动作类方法（move/attack/harvest 等）固定 ≈0.2 CPU | wiki.screepspl.us/CPU/ + 官方博客 2015 变更公告，CONFIRMED |
| 纯移动 creep 实测 | ≈0.25 CPU/creep（0.2 为 moveTo 开销）；带寻路 ≈0.5 | Reddit 实测口径，LIKELY |
| 寻路成本 | PathFinder 1 op ≈ 0.001 CPU，默认 maxOps 2000（≈2 CPU 上限/次）；maxRooms 默认 16 | 官方 API 文档，CONFIRMED |
| Memory 税 | JSON.parse/stringify 随主字符串体积线性 | 官方文档，CONFIRMED（详见 [18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md) §9） |
| moveTo 缓存 | `reusePath` 默认 5，路径序列化进 `_move`；调大可摊薄 | 官方 API，CONFIRMED |
| bucket | 上限 10,000；单 tick 最多透支 500；`tickLimit` 永不低于 limit | 官方文档，CONFIRMED |
| pixel | 桶满 10,000 时 10,000 bucket → 1 pixel | 官方 API，CONFIRMED |
| CPU 与 GCL | 订阅 30 起步 + 10/GCL；非订阅固定 20；私服默认 100 | wiki.screepspl.us/CPU/，CONFIRMED |

**关键推论**：creep 数量 × 0.2 的 intent 税是**不可优化地板**（除非减少 creep）；
一切优化的对象是税之上的「思考成本」（寻路、扫描、决策重算）。100 creep 的帝国仅
移动就 ≈20 CPU——这就是为什么优化必须在「思考侧」而非「动作侧」。

## 4. Screeps Community Practice

- **Profile 先行**：screepers/screeps-profiler（monkey-patch 函数级计时）是社区
  标配；共识是「先测量再优化」，反对凭感觉重构。—— CONFIRMED。
- **reusePath 调大**：社区常用 10–50+；但 wiki 提醒路径复用有代价（creep 对环境
  变化反应迟钝、可能反复撞墙），需配合卡位检测。—— CONFIRMED（含已知副作用）。
- **消灭「OK 但无效」的 intent**：对墙 move、已满血 tower 继续治疗、满 HP 修复——
  每个都白交 0.2 税；社区惯例是发 intent 前自查前置条件。—— wiki.screepspl.us/CPU/。
- **减少冗余检查**：同 tick 多处 `find`/`lookFor` 合并进一次快照共享。—— 同上。
- **Grafana 长期观测**：CPU 曲线趋势比单 tick 数字更重要（见
  [21_OBSERVABILITY.md](21_OBSERVABILITY.md)）。

## 5. Existing Bot Analysis

| Bot | CPU 策略 | 关键证据 |
| --- | --- | --- |
| **TooAngel** | **指数平滑 cpuIdle / heapFree / memoryFree 三指标门控一切扩张**（CPU 富余、heap 余量、Memory 余量同时健康才允许扩张/升级房间）；tick 末空闲自动 `generatePixel`；路径缓存带 created 时间戳 | Design.md（2026-08-22 核查）——**预算驱动自治的十年级实证**：帝国规模不是目标而是 CPU 富余度的函数 |
| **Overmind** | heap build/refresh 双路径缓存（未过期走廉价原地 refresh，过期全量重建）；三相位 tick 减少重复扫描；内置 profiler + Grafana 统计 | 「缓存本身也要省 CPU」的教科书：refresh 路径避免了 reset 后的昂贵重建 |
| **Quorum** | QoS 分层调度 + stormtracker 监控 tick 玮（服务器卡顿检测，自适应降载） | 第一个把「服务器性能波动」当输入的 bot |
| **The International** | request 驱动经济天然摊薄决策频率；Grafana 遥测托管 | 大规模（GCL 18.2 亿）下 CPU 存活的实证 |

**收敛**：顶级 bot 的 CPU 策略 = **摊薄频率 × 缓存复用 × 富余度门控** 三件套，
没有一家靠「把算法写得更聪明」取胜。

## 6. Advantages（分层预算设计的收益）

1. **规模自动适配**：CPU 富余度门控使帝国在预算紧时自动收缩、松时自动扩张——
   无需人工设定「该有几个房」。
2. **地板可控**：intent 税之外的成本全部可摊薄可缓存 → 每 tick 成本逼近
   `creep 数 × 0.2 + 瘦 Memory 税` 的理论地板。
3. **可回归**：预算与节奏是声明式配置，soak 测试可断言 p95 CPU 不随时间漂移。

## 7. Disadvantages（代价）

- 低频化引入**决策延迟**：每 50 tick 跑一次的建造规划对突发损毁反应慢——必须由
  事件触发通道兜底，形成两套节奏的维护成本。
- 缓存一致性是新的 bug 面：TTL 定错 → 用陈旧数据决策（详见
  [18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md) §8）。
- 三指标门控的平滑系数需要标定：太敏感 → 扩张抖动；太迟钝 → 超载后才发现。

## 8. Failure Modes

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| 每 tick 全量 `find` 扫描 | 房间越多 CPU 越线性爆炸 | 全房 find 禁令：角色层复用 RoomSnapshot 与预构建索引 |
| 每 creep 独立寻路 | 200 creep × 0.5 CPU = 崩溃 | 移动走意图仲裁 + 寻路三档限频（见 §10.2） |
| maxRooms 不设限的跨房搜索 | 单次搜索吃满 2000 ops | 本地搜索强制 `maxRooms: 1`；跨房走 findRoute 两级 |
| 无效 intent 刷税 | 「什么都没干却很忙」 | 发前自查前置条件；交通仲裁统一签发天然去重 |
| global reset 后全量重建撞预算 | reset 后第一 tick 超时 → 降级 → 恶性循环 | 重建预算预留 + Overmind 式 refresh 惰性化（见 §10.3） |
| pixel 抽干 bucket | 突发战事无储备 | 仅在 Healthy 档且桶满时生成；战争姿态熔断（见 §10.5） |
| 低频任务与事件触发互相踩踏 | 重复建任务/重复下单 | 任务带幂等 key + 过期时间 |
| bucket 长期贴地运行 | 随时被切断 | 看门狗四档提前降级（[19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md) §10.3） |

## 9. CPU Implications（本文即预算模型本体，见 §10.4）

## 10. Recommended Design

### 10.1 三档工作节奏判据

| 节奏 | 判据 | 例 |
| --- | --- | --- |
| **每 tick** | 决策窗口 = 1 tick（晚了就有不可逆损失）或成本近零 | 防御应答、交通仲裁、spawn 队列消化、FSM 状态机步进 |
| **每 N tick** | 状态变化慢于 N tick 且晚 N tick 无不可逆损失；N ≈ 变化时间尺度 ÷ 4（采样定理式裕量） | 人口普查 N=1–3（死亡时间尺度 ~百 tick，但 replacement 提前量敏感）；建造规划 N=10–50；扩张评估 N=100+；遥测聚合 N=10–100 |
| **事件触发** | 工作只与离散事件相关，与时间无关 | controller 升级→布局推进；结构损毁→维修任务；敌情→防御状态机 |

摊薄实现统一用 `(Game.time + 偏移) % N === 0` 的错峰散列（偏移 = 房间/系统 hash），
避免「第 0 tick 全部齐跑」的脉冲。

### 10.2 寻路限频设计（三档）

| 档 | 触发条件 | 行为 |
| --- | --- | --- |
| 全频 | 距离目标 >5 格 或 跨房任务 | 正常 search（本地 `maxRooms:1`） |
| 限频 | 距离 ≤5 格 | 每 N tick 最多一次 search，间隔回放缓存路径（heap，带 created 时间戳） |
| 复用 | 路径未失效（结构版本未变、无卡位） | 只 move 不 search |

配套：跨房移动 = `Game.map.findRoute` 房间级路由（结果缓存进 heap）+ 房内
PathFinder 两级模式；CostMatrix 按房间缓存（TTL 写在 get 侧：无视野房间 Infinity，
有视野缩短——官方 caching-overview 建议）；卡位检测触发强制重算（自愈联动见
[22_SELF_HEALING.md](22_SELF_HEALING.md)）。

### 10.3 heap 缓存模式（build/refresh 双路径）

- **build**（全量重建）：reset 后或 TTL 过期，重建索引/矩阵，成本高，须在预算内
  分摊（可按房间分 tick 错开）。
- **refresh**（廉价更新）：TTL 未过期时仅原地刷新变化字段（如对象存活校验）。
- 缓存条目契约：`{value, seed（结构版本）, created, ttl}`；结构版本变化（新建筑/
  拆除）立即失效——不等 TTL。
- 重建预算：reset 后第一 tick 预留固定额度给重建；超额度则按「使用顺序惰性重建」
  （谁先读谁先建），把重建成本摊到实际消费者头上。

### 10.4 每房 CPU 预算分配模型

设 `L = Game.cpu.limit`，`bucketRatio = Game.cpu.bucket / 10000`，
目标稳态用量 `U = L × f(bucketRatio)`（Healthy 档 f≈0.8，Guarded 档 f≈0.6…看门档位
决定）。分配：

```text
固定开销 F = 瘦 Memory 税 + 内核调度税 + 遥测税（量级目标：L 的 5–10%）
人口地板 C = creep 数 × 0.2（intent 税，近似不可优化）
可分配预算 B = U − F − C
B 按 P1:P2:P3 ≈ 60:30:10 切分，房间数 R 的份额与「房均复杂度权重」成正比：
  w_room = 1 + 远矿数×0.5 + 军事任务×1.5 + 新房（<RCL4）×0.5
  roomBudget = B × w_room / Σw
扩张门控（TooAngel 三指标形式化）：
  允许扩张 ⟺ cpuIdle 平滑值 > 阈值 AND heapFree > 阈值 AND memoryFree > 阈值
  （cpuIdle = L − 实测 p95 用量的指数平滑；三者任一恶化 → 冻结扩张并按
  [19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md) 看门狗降档）
```

公式中的权重是初始常数，交给 tuning 引擎按 soak 数据调整（见
[21_OBSERVABILITY.md](21_OBSERVABILITY.md) 的调参闭环）。

### 10.5 pixel 与 bucket 管理

- 唯一策略：**Healthy 档且桶满（10,000）时 tick 末空闲自动 `generatePixel()`**
  （TooAngel 先例）；任何非 Healthy 档、任何战争/恢复姿态 → 熔断生成。
- bucket 是防御与灾后恢复的战略储备，不是「不用白不用」的余量：Guarded 档以下
  一切消费型系统让位于桶回升。

### 10.6 扫描开销惯例（find/look/filter）

- 角色**禁止**全房 `find`/全局扫描：统一消费每房一次的 RoomSnapshot（build 于
  room-state 系统，众角色共享）。
- `lookFor`/`lookAt` 只允许小范围（≤3×3 或已知坐标）；大范围感知进 snapshot 低频档。
- 数组 filter/map 链在数百元素级即值得手动展平或索引化——JS 引擎内部优化不可假设，
  以 profiler 数据为准（社区教训：不要过早微优化，先测）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 每 creep 独立 moveTo + 默认参数 | 0.5 CPU/creep 的账单 + 不可控 PathFinder 上限；意图仲裁 + 限频是结构性答案 |
| 跨房单次 PathFinder（maxRooms 16） | ops 上限浪费在房间间试探；findRoute 两级是官方示例模式 |
| 把缓存全部塞进 creep memory（reusePath 极大化） | Memory 膨胀（[18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md) 反例）+ 路径陈旧风险；heap 才是路径的家 |
| 固定房间数上限（人为设定帝国规模） | 违反预算驱动自治：TooAngel 实证规模应是 CPU 富余度的函数，不是常量 |
| 用 CPU unlock/加订阅解决预算 | 运营手段而非架构手段；架构必须在 20 CPU 假设下可存活 |
| 过早微优化（手写内联、位运算技巧） | 社区共识：无 profile 数据支撑的微优化收益不可复现，且伤可读性 |

## 12. Open Questions

1. 三指标平滑系数（TooAngel 未公开标定过程）：初始半衰期取多少个 tick？需 soak
   数据（遥测里同时记录原始值与平滑值便于回溯标定）。
2. `f(bucketRatio)` 的档位系数与「房均复杂度权重」的初值——同上，tuning 引擎课题。
3. 意图仲裁本身的成本上限：200+ creep 同房极端场景下 tick 末仲裁是否成为新热点？
   （交通文献与 Overmind hauling 分析提示这是规模化的下一道墙，先监控后优化。）
4. 私服（100 CPU）与官服（20–300+ CPU）的行为差异是否需要双份参数档——倾向
   「全部按 limit 比例化」自动适配，但 GCL 高段位的分布未经验证。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://wiki.screepspl.us/CPU/ | 社区 wiki | intent ≈0.2 CPU、reusePath 与副作用、OK-intent 浪费、CPU/GCL 公式（2026-08-22 核查） | CONFIRMED |
| https://blog.screeps.com/2015/10/Important-change-CPU-cost-of-API-methods/ | 官方博客 | intent 固定税引入；100 creep 移动 ≈20 CPU 量级 | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/6pg2q6/randomly_hitting_cpu_limit_hard_reset/ | 实测 | 纯移动 ≈0.25、寻路 ≈0.5 CPU/creep | LIKELY |
| https://github.com/screepers/screeps-profiler | 工具 | 函数级 CPU profiling 是社区标配 | CONFIRMED |
| http://tooangel.github.io/screeps/doc/Design.html + https://github.com/TooAngel/screeps | 源码/文档 | 三指标指数平滑门控、tick 末空闲 generatePixel、路径 created 时间戳（2026-08-22 核查 Design 页） | CONFIRMED |
| https://github.com/bencbartlett/Overmind + https://bencbartlett.com/blog/screeps-6-verifiably-refreshed/ | 源码/博客 | build/refresh 双路径缓存 | CONFIRMED |
| https://docs.screeps.com/contributed/caching-overview.html | 官方贡献文档 | TTL-get 侧、压缩、清理（2026-08-22 核查） | CONFIRMED |
| [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §3/§5 | 本套件事实基准 | bucket/tickLimit/pixel、PathFinder ops、findRoute 模式 | CONFIRMED |
