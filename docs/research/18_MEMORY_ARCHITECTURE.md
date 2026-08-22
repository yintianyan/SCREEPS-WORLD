# 18 · Memory 架构：三级存储与版本化迁移

> 研究文档 · 结论等级：**设计裁决**（证据充分，含硬性机制约束）。
> 本文回答：状态放哪里、谁拥有、如何失效、如何安全演化。机制数值以
> [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §4 为准。

## 1. Problem

Screeps 的持久化环境极不友好：`Memory` 每 tick 都要付 `JSON.parse`/`JSON.stringify`
的 CPU 税；`global`（heap）会被「相当规律地重置」；`RawMemory` segment 每秒只能激活
10 段且异步可用。新手 bot 的典型死法不是被打死，而是 Memory 单调膨胀拖垮 CPU，或一次
schema 变更把所有旧状态变成脏数据。状态存储设计是帝国能否长期自治的第一块基石。

## 2. Research Questions

- 三级存储（Memory / heap / segment）各自的准入判据是什么？
- Memory 的真实成本模型与膨胀失败模式是什么？
- schema 如何安全演化（迁移规范）？
- 冷数据（intel / 市场历史 / 遥测）的 TTL 与压缩怎么设计？
- 成熟 bot 在存储上的正反例是什么？

## 3. Existing Solutions（机制事实基准）

全部引自 03 号文档核查（docs.screeps.com + 引擎常量交叉核对）：

| 机制 | 事实 | 架构含义 |
| --- | --- | --- |
| Memory 解析 | `JSON.parse(RawMemory.get())` 惰性解析、tick 末 stringify，计入 CPU | Memory 体积 = 每 tick 线性税 |
| Memory 容量 | 官方核心文档无硬上限；贡献文档 caching-overview 写 2048KB（社区来源，LIKELY） | 不赌上限，按「越小越好」设计 |
| segment | 100 段 × 100KB，每 tick 激活上限 10 段，异步（本 tick 请求下 tick 可读） | 冷数据分页 + 激活预算 |
| foreign segment | 同时仅 1 个 | 外交/情报按轮换读 |
| global/heap | 官方明言「会被相当规律地重置，不可持久」；require 缓存同清；重置频率无官方数字 | 必须容忍任意 tick 丢失 |
| heap 代价 | 大量数据放 heap 会加重 GC、吃 CPU（caching-overview 原文） | heap 也不是免费的 |

官方 caching-overview 的实操建议（本次核查，CONFIRMED）：Memory 里对象比字符串贵，
RoomPosition 应拍平成字符串再存；CostMatrix 等大重复结构用 lzstring 压缩进
Memory、解压结果放 heap；TTL 写在 get 侧而非 set 侧（例：无视野房间的 CostMatrix
TTL 设 Infinity，恢复视野后缩短）；**必须有 stale entry 清理，否则 Memory 会慢性膨胀**。

## 4. Screeps Community Practice

- **准入判据共识**：只有「跨 tick 必须活着的决策状态」才进 Memory；可重建的进
  heap；大而冷的进 segment。—— wiki.screepspl.us Caching 页 + 官方 caching-overview
  （CONFIRMED，两源一致）。
- **cache + TTL + 版本**：社区缓存库（如 screepers/snippets 的 LRU/TTL 代码段）把
  「缓存条目 = 值 + 种子 + 版本 + 失效原因」作为标准形态。
- **迁移实践**：Overmind（专用版本迁移模块）与 The International（migration.ts）都
  把迁移做成显式阶段而非散落的 `if (!Memory.x)`。—— 源码级调研，CONFIRMED。
- **反例警告**：社区大量「把路径/对象引用塞进 creep memory」的代码；`_move` 的
  路径序列化是引擎强加的，不代表业务数据也该这么存。

## 5. Existing Bot Analysis

| Bot | 存储设计 | 评价 |
| --- | --- | --- |
| **Quorum** | sos_lib 的 **vram**（虚拟内存）：segment 之上的缓存抽象，显式管理 segment 激活与分页 | 唯一把 segment 当一等公民做成库的先例；证明 segment 可承载热-冷混合负载。但 2021 停更，抽象层较重 |
| **Overmind** | **heap build/refresh 双路径**：`global.Overmind` 大对象 + 到期时间戳；未过期走廉价 refresh（原地更新字段），过期才全量重建；另有版本迁移模块 | 三相位（build→init→run）与缓存设计的教科书案例；代价是 OO 实例化本身有 CPU/GC 成本（作者博客承认需 profile） |
| **TooAngel** | `global.data` heap 缓存 + Memory 存少量统计；**反例：Memory 里存整条 route/path**（Design.md 与源码确认，路径缓存带 created 时间戳挂在 memory 上） | 十年无人值守证明「瘦 Memory + heap 缓存」可行；但存路径直接违反「Memory 只存 ID/枚举/数字」，是其架构中被社区批评的部分 |
| **The International** | migration.ts + request 驱动状态（请求队列进 Memory） | 迁移显式化的正例 |
| **hivemind** | process/dispatcher 框架自带 heap 缓存与 player-intel 持久化（威胁记忆独立于视野） | 情报冷数据独立存储的正例 |

**收敛结论（≥3 家一致）**：Memory 瘦身 + heap 可重建缓存 + 显式迁移，是成熟 bot 的
共同形态；分歧只在「segment 用不用」（Quorum 用满，多数 bot 几乎不用——因为 segment
异步语义增加复杂度）。

## 6. Advantages（三级存储设计的收益）

1. **CPU 可预算**：Memory 体积小 → parse/stringify 税固定且可测。
2. **抗 global reset**：heap 全丢只损失重建成本（一 tick 内可重建的索引），不损失
   决策状态。
3. **容量天花板高**：segment 10MB 是 Memory 实用容量的数倍，够装全部 intel 历史 +
   遥测 + 市场档案。
4. **可演化**：版本化 + 幂等迁移让 schema 变更从「灾难」变成「 routine」。

## 7. Disadvantages（代价）

- 三级语义增加心智负担：写者必须每次回答「这个字段放哪、谁能读、何时失效」。
- segment 异步性（本 tick 请求下 tick 读）使「读冷数据做本 tick 决策」不可能——冷数据
  只能作为低频决策（扩张、市场、复盘）的输入，不能进生存链路。
- heap 重建代码是额外维护面；重建耗时本身要纳入 CPU 预算（见
  [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md)）。

## 8. Failure Modes

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| Memory 单调膨胀 | 每 tick CPU 税线性上涨，最终拖垮 bucket | 「只存 ID/枚举/少量数字/短 key」准入审查 + 孤儿清理钩子（见 §10.4） |
| 对象引用进 Memory | stringify 后是死对象 ID，GC 压力大、语义漂移 | lint 级禁令：Memory 值类型白名单 |
| 大迁移一 tick 做完 | CPU 爆炸/超时中断留下半迁移状态 | cursor 分 tick + 幂等（见 §10.3） |
| 先删旧字段后写新字段 | 中断后数据永久丢失 | 强制「先写新、验证、后删旧」 |
| 迁移互相破坏 | 新版写回的字段被旧版代码误读 | schemaVersion 单向门：旧版读到更高版本必须拒绝写入并安全降级 |
| 把生存决策寄托在 heap | global reset 后第一 tick 帝国瘫痪 | 生存链路只依赖 Memory + Game 对象，heap 仅加速 |
| segment 激活超 10 段 | 静默丢段 | 激活预算集中管理（单一 segment-store 写者） |
| creep memory 累积脏 key | 死 creep 残留、role 换代残留旧字段 | 角色 memory 契约固定 + 死 creep 清理钩子 |
| 冷数据无 TTL | intel/遥测无限增长挤爆 segment | 每类冷数据定义 TTL 与容量上限（见 §10.5） |

## 9. CPU Implications

- **Memory 税是全文档最明确的线性成本**：parse+stringify 与主字符串字节数成正比。
  经验量级（社区口径，LIKELY）：瘦 Memory（<100KB）税在零点几 CPU 级；MB 级 Memory
  可吃掉小账户 1/3 以上的每 tick 预算。
- heap 重建成本：Overmind 模式下 refresh 路径远低于 rebuild；rebuild 集中在 reset 后
  第一 tick，必须给该 tick 预留重建预算（否则 reset 后立即触发 CPU 降级，形成
  「reset → 降级 → 更慢」的恶性循环）。
- segment 读写本身有 API 成本 + 激活管理成本；只对「低频写、低频读」的数据合算。
- 所有结论汇入 [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md) 的预算模型。

## 10. Recommended Design

### 10.1 三级存储契约（准入判据）

| 层 | 存什么 | 不存什么 | owner | 失效条件 |
| --- | --- | --- | --- | --- |
| **Memory**（版本化真相） | schemaVersion；房间/creep ID 注册表；枚举（posture、phase）；少量数字（能量水位、冷却计时、统计快照）；短 key 索引 | 完整路径、运行时索引、历史日志、对象引用、长字符串 | 各 State/Repository 单一写者 | 显式删除或迁移；永不被 heap 依赖 |
| **heap/global**（可重建缓存） | RoomPosition 拍平索引、CostMatrix、find 结果、路径、对象缓存包装、逐 tick 累加器 | 任何「丢了就无法重建」的状态 | Cache owner（TTL + 版本种子） | TTL 到期 / 结构版本变化 / global reset（随时） |
| **RawMemory segment**（冷数据） | intel 历史、威胁记忆、市场订单档案、遥测聚合、tuning 样本 | 生存决策的当前值；高频写数据 | 单一 segment-store 写者 | 每类数据自带 TTL + 容量上限；分页轮换 |

判据一句话：**Memory 答「帝国决定过什么」，heap 答「帝国这 tick 算得快不快」，
segment 答「帝国记住了什么」。**

### 10.2 schema 版本与字段纪律

- 单一真相源：TypeScript 类型 + `schemaVersion` 常量同处一文件，数字只作快照不作文档。
- 新增字段必须同时改：类型、默认值工厂、迁移步骤——三者缺一视为未完成。
- Memory 值类型白名单：`string（短）/ number / boolean / 枚举 / ID 引用 / 浅层数组`。
  深层嵌套对象与路径结构一律拒绝（RoomPosition 存 `roomName+x+y` 复合短 key）。

### 10.3 迁移规范（幂等、分 tick、可回退）

1. 每次结构变更升 `schemaVersion`；迁移函数注册成 `n → n+1` 链，禁止跨版本跳跃
   （v1→v5 = 依次执行 4 个步骤）。
2. 每步幂等：重放不产生副作用（先检查目标态再动手）。
3. 顺序铁律：**先写新字段 → 读到有效值 → 才删旧字段**；任何一步失败保持旧版
   `schemaVersion`，下 tick 重试。
4. 大迁移（估计成本 > 单 tick 迁移预算）按 cursor 分 tick：Memory 里记
   `{cursor, done}`，每 tick 迁一批实体；迁移期间新旧字段并存，读侧优先新字段。
5. 旧版代码遇到更高 `schemaVersion`：只读、不写、输出告警（防部署回滚后互相破坏）。
6. 迁移期间生存链路（P0 系统）照常运行——迁移不是停机理由。

### 10.4 防膨胀机制

- **低频清理钩子**（如每 100 tick）：删死 creep 残留、删已不存在的房间/ID 键、删
  过期任务。清理本身走注册表钩子，防止写死在内核（钩子超过 3 个必须提取机制）。
- **体积遥测**：每 N tick 采样 `RawMemory.get().length` 进 segment 遥测；体积环比
  增长超阈值 → 告警（这是 A5「无 Memory 单调膨胀」验收项的数据源，见
  [21_OBSERVABILITY.md](21_OBSERVABILITY.md)）。

### 10.5 冷数据 TTL 设计（segment 侧）

| 数据类别 | TTL | 容量策略 | 激活频率 |
| --- | --- | --- | --- |
| 房间 intel（owner/RCL/防御快照） | 降级老化：无视野越久置信度越低，>N 天清为「未知」 | 分页哈希（roomName → segment 页） | 写：事件触发；读：扩张/战争决策前 |
| 威胁记忆（玩家级，hivemind 先例） | 长 TTL（月级），被再次攻击刷新 | 独立 1–2 段 | 战略层低频 |
| 市场订单档案 | 滚动窗口（如 5k tick） | 环形覆盖 | 交易决策前 |
| 遥测聚合 | 永久（容量换趋势） | 按指标分页，降采样（新→密、旧→疏） | 每 N tick 写一次 |
| tuning 样本 | 窗口累计，评估后清 | 单段 | 评估周期 |

写侧统一 lzstring 压缩（caching-overview 建议），解压结果进 heap 本 tick 复用。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| Memory 存路径/运行时索引（TooAngel 式） | 直接违反成本模型；十年无人值守证明了 bot 能带着这个缺陷活，但也证明了它不需要存在——路径的正确归属是 heap + created 时间戳 |
| Quorum 式 vram 全量虚拟内存 | segment 异步语义迫使所有读者处理「下 tick 才有数据」；对瘦 Memory 架构收益不成比例，抽象层维护成本高。采纳其「segment 集中管理」思想，否决其「一切皆虚拟内存」 |
| 把 heap 当持久层（global 永驻大状态机） | 官方明言 reset 规律发生；任何依赖都会周期性瘫痪 |
| 无版本迁移（读写时惰性补默认值） | 迁移逻辑散落、不可测试、无法保证「先验证后删除」；Overmind/TI 的显式迁移是更强先例 |
| creep memory 自由生长 | role 换代残留 + 死 creep 残留 = 最常见的膨胀源；必须契约化 |

## 12. Open Questions

1. Memory 2048KB 上限：仅见贡献文档（LIKELY），按「不赌上限」设计已足够，但若实证
   存在硬上限，遥测告警阈值可直接锚定它（待一次刻意超限实验，优先级低）。
2. segment 激活调度的最优策略：固定轮换 vs 按需请求 + LRU？Quorum vram 的策略值得
   源码级再考古一次。
3. 遥测降采样的具体档位（如 1k tick 粒度保多久、10k 粒度保多久）——需要与 21 号
   文档的仪表盘消费需求联合定标。
4. global reset 的实际频率分布（不同 shard/负载）：无官方数字；可通过「reset 计数
   遥测」自行积累经验数据（开工后在遥测里加一个 `globalResetCount` 即可）。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://docs.screeps.com/contributed/caching-overview.html | 官方贡献文档 | global 规律性重置；2048KB 上限表述；拍平对象/压缩/TTL-get 侧/清理建议（2026-08-22 核查） | CONFIRMED（上限数字为贡献文档口径，LIKELY） |
| [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §4 | 本套件事实基准 | Memory/segment/global 机制数值 | CONFIRMED |
| https://github.com/ScreepsQuorum/screeps-quorum | 源码 | sos_lib vram：segment 虚拟内存抽象 | CONFIRMED |
| https://github.com/bencbartlett/Overmind + https://bencbartlett.com/blog/screeps-6-verifiably-refreshed/ | 源码+博客 | build/refresh 双路径缓存、版本迁移模块 | CONFIRMED |
| https://github.com/TooAngel/screeps + http://tooangel.github.io/screeps/doc/Design.html | 源码+文档 | 瘦 Memory+global.data 可行十年；Memory 存 route/path 反例（2026-08-22 核查 Design 页） | CONFIRMED |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source | 源码 | migration.ts 显式迁移 | CONFIRMED |
| https://wiki.screepspl.us/Caching/ | 社区 wiki | 三级准入共识、LRU/TTL 模式 | LIKELY（页面本次超时，结论由 caching-overview + 调研摘要双源支撑） |
| https://github.com/Mirroar/hivemind | 源码 | player-intel 持久威胁记忆（冷数据独立存储先例） | CONFIRMED |
