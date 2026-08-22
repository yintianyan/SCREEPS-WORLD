# 21 · 可观测性：帝国仪表盘、遥测预算与告警分级

> 研究文档 · 结论等级：**设计裁决**。
> 核心立场：可观测性是自治帝国的「感知闭环」——没有度量的自治是盲飞；但度量本身
> 也在 tick 内烧 CPU、占存储，必须先给自己立预算。指标与验收门槛的领域基准见
> autonomy-acceptance 参考文档；存储分层见
> [18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md)。

## 1. Problem

「完全自治」的隐含代价是没有人盯着。当帝国无人值守时，唯一能发现「它正在慢慢死」
的东西是遥测。观测要回答四类问题：

1. **健康度**：CPU/bucket/Memory 还剩多少余量？趋势是升是降？
2. **闭环完整性**：能量收支、spawn 利用率、物流负载是否在正常区间？
3. **进度**：建造/扩张/军事目标推进到哪了？
4. **故障**：哪里在持续出错、什么错误被熔断了、是否需要人工接管？

同时遥测是 tuning 引擎与预算驱动自治的数据源（[20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md)
的三指标门控、[22_SELF_HEALING.md](22_SELF_HEALING.md) 的异常检测都消费它）。

## 2. Research Questions

- 仪表盘最小完备清单是什么（既够裁决又不至于观测成本压垮本体）？
- 采集/存储/导出的预算如何设计（tick 内零成本目标）？
- Grafana/体外导出的先例与通路是什么？
- 告警如何分级？什么信号构成「人工接管」？

## 3. Existing Solutions（通路事实）

Screeps 数据出游戏的通路只有（机制见 03 号文档 §4）：

| 通路 | 语义 | 适用 |
| --- | --- | --- |
| Memory / segment 经官方 REST API | 体外进程轮询读取 | Grafana 类外部仪表盘的数据面 |
| 游戏内 console（`console.log`） | 人工查看，每 tick 输出有限 | 实时告警文本 |
| RoomVisual / MapVisual | 游戏客户端内渲染 | 人巡检时的可视化 |

体外工具链（本次核查）：**screeps-grafana**（官方 third-party 文档收录的原始统计
程序：Docker 起 Grafana + agent 连 Screeps API 拉数）、screeps-stats、社区 node-agent
方案（Reddit 讨论：自托管或 hosted agent）。官方 third-party 文档 CONFIRMED。

## 4. Screeps Community Practice

- **Overmind**：内置 profiler + Grafana 统计模块——「把 Grafana 当开发依赖」的
  先例（作者长期用曲线驱动优化决策）。CONFIRMED。
- **The International**：Grafana 遥测托管在 pandascreeps.com 公开可见；release 说明
  明确提及用 Grafana 展示指标图表。GCL 18.2 亿规模下遥测与本体共存。CONFIRMED
  （2026-08-22 核查 releases 页与检索）。
- **Quorum**：内存/segment/钱包全公开在 quorum.tedivm.com；sos_lib 的 **stormtracker**
  监控 tick 率（服务器卡顿检测）——把「平台性能波动」本身当一等指标。CONFIRMED。
- **screepers/screeps-profiler**：函数级 CPU profile 的社区标配（见
  [20_CPU_OPTIMIZATION.md](20_CPU_OPTIMIZATION.md) §4）。
- 社区惯例：`console.log` 高频刷屏被普遍视为反模式（占用游戏输出、淹没人读）；
  长期数据一律走 Memory/segment 供 API 拉取。

## 5. Existing Bot Analysis

| Bot | 观测形态 | 可迁移点 |
| --- | --- |---|
| Overmind | 内置 profiler + Grafana | 开发期函数级 profile 与运营期指标分离 |
| TI | 托管 Grafana（pandascreeps.com） | 大规模长期存活的观测面参照；request 驱动架构的指标天然按「请求满足率」组织 |
| Quorum | 全公开仪表盘 + stormtracker | 「平台本身也是被观测对象」（tick 率波动影响自身预算判断） |
| TooAngel | 遥测极简但支撑自治：三指标平滑值既驱动扩张又可体外查看 | 指标「一鱼两吃」：自治输入与人类观测共用同一份聚合，避免专门为观测再造一套 |

**收敛**：成熟 bot 的观测 = **游戏内聚合（低频写 segment）+ 体外展示（API 轮询
Grafana）**，且指标同时服务自治算法与人类巡检。

## 6. Advantages

1. **自治闭环的数据面**：三指标门控、tuning、异常检测全部吃同一份遥测——观测不是
   附属品而是感知闭环本体。
2. **趋势可见**：单 tick 数字无意义，A5 验收（无 Memory 单调膨胀/无 bucket 枯竭）只
   能靠长期曲线裁决。
3. **事故取证**：故障发生前的遥测切片是诊断 self-healing 失效的唯一材料。
4. **自治度诚实分级**：milestone 验收（A0–A5）逐项有数据支撑，不靠体感宣称。

## 7. Disadvantages

- 采集有成本：每 tick 全量统计会反噬预算（自治的地基变成负担）。
- 指标过多 → 维护面与告警疲劳；过少 → 盲区。
- 体外通路（REST API + Grafana）是额外基础设施，且它挂掉不能影响帝国（观测平面
  与控制平面解耦的纪律）。

## 8. Failure Modes

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| 每 tick 写 console 刷屏 | 输出淹没 + CPU 浪费 | console 只输出告警级；聚合数据走 segment |
| 遥测无 TTL 无限累积 | segment 挤爆、冷数据失效 | 降采样 + 滚动窗口（[18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md) §10.5） |
| 指标采集超观测预算 | 「度量系统」成为 CPU 大户 | 观测预算上限（见 §10.2）+ 采集频率分档 |
| 体外仪表盘故障误判为帝国故障 | 错误告警 | 数据新鲜度戳：segment 记 `lastWritten`，仪表盘对超龄数据降置信显示 |
| 指标定义漂移（改字段无版本） | 曲线断裂、tuning 误读 | 遥测 schema 版本化（与 Memory 迁移同规范） |
| 告警全靠人来发现 | 无人值守时告警形同虚设 | 告警同时写 game console（登录即见）与体外通道（email/webhook 由体外 agent 负责）；帝国侧只保证「信号被写出」 |
| 平台卡顿误读为自身退化 | 错误降级 | tick 率/时长监控（stormtracker 先例）：先归因平台再归因自己 |

## 9. CPU Implications

- 采集预算上限：目标 **≤ Game.cpu.limit 的 3%**（每 tick 均摊）；超限即砍采集频率
  而非砍本体。
- 采集手段从廉价到昂贵：计数器累加（近零）→ 定期采样 CPU/体积（每 N tick 数次
  API）→ 结构枚举（只在事件 tick 做）。
- 写入：聚合值批量进 segment（每 N tick 一次 stringify），禁止每 tick 写 segment。
- console.log 限量：仅 P0 告警，且相同告警限流（复用错误限流的 25 tick 窗口）。

## 10. Recommended Design

### 10.1 仪表盘清单（最小完备集）

| 域 | 指标 | 采集频率 |
| --- | --- | --- |
| CPU | 每 tick 用量（p50/p95/p99 按窗口聚合）、bucket 水位、看门狗档位、降级/跳过次数、global reset 计数与重建耗时 | 采样 N=1–10，聚合 N=100 |
| 存储 | Memory 字节数、segment 占用、孤儿条目数、迁移耗时 | N=100 |
| 房间 | 存活房间数、RCL 分布、controller downgrade 风险（剩余计时）、energy 出入净流 | N=10–100 |
| 能量收支 | source 产量、消费分解（spawn/建造/升级/维修/tower）、storage/link 水位、净流符号 | N=10–100 |
| 人口/spawn | 人口 vs 需求缺口、spawn 利用率（busy/idle tick 比）、孵化队列深度与等待时长、replacement 提前量、关键角色空缺时长 | N=1–10 |
| 物流 | 运输空载率/满载率、任务年龄分布、断链次数（供体有货无人取/消费者缺货无人送） | N=10–100 |
| 建造 | site 数、进度速率、blocked 数、全局 site 上限占用 | N=100 |
| 扩张/远矿 | 候选评估数、远矿净收益、三指标门控当前判定（cpuIdle/heapFree/memoryFree 平滑值） | N=100+ |
| 军事/威胁 | 姿态分布、war 进展（spawned/损失/止损触发）、被袭次数、威胁发现延迟、warBlacklist 命中数 | 事件 + N=100 |
| 自愈 | 熔断/冷却次数、恢复动作计数与结果、MTTR（故障注入实验测） | 事件 + N=100 |

### 10.2 遥测管线（三级预算）

```text
L1 计数器（每 tick，近零成本）：累加器挂在 heap，reset 即丢（可接受）
L2 采样聚合（每 N tick）：heap 累加器 → 快照 → 计算分位数/平滑值 → 清零
L3 持久化（每 N×M tick）：聚合结果压缩写 segment（滚动窗口 + 降采样）；
    体外 agent 经 REST API 轮询 segment → Grafana/告警通道
```

指标定义一鱼两吃：L2 平滑值同时是自治算法输入（三指标门控/tuning）与仪表盘数据，
不为观测单独造第二套。

### 10.3 体外平面契约

- 体外 agent（screeps-grafana 式）**只读不写**：读 segment/Memory，写 Grafana 与
  告警通道；帝国侧不依赖其存在（挂掉不影响任何 tick 决策）。
- 与 LLM 体外顾问的关系：该 segment 也是 L2 顾问的候选数据面，但建议通道的护栏
  归 [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md) 管。

### 10.4 告警分级与人工接管信号

| 级别 | 定义 | 通道 | 期望响应 |
| --- | --- | --- | --- |
| INFO | 状态变迁（升档/降档、里程碑达成、war 结束） | segment（仪表盘可见） | 无 |
| WARN | 可自愈但需关注（系统熔断、Memory 环比增长超阈值、spawn 持续忙、远矿收益转负） | segment + 限流 console | 自愈闭环处理（[22_SELF_HEALING.md](22_SELF_HEALING.md)），趋势恶化才升级 |
| TAKEOVER | 人工接管信号：自愈边界被突破 | console 醒目输出 + segment 标记位 | 人工授权的灾难接管 |

TAKEOVER 触发清单（超出 self-healing 有界动作边界的全部情形）：Recovery 档持续
超阈值；关键房间 controller 进入 downgrade 倒计时且防御持续失败；Memory 迁移反复
失败；战争止损链失效（spawned 超限仍不收摊）；同一异常每 tick 复发且冷却无效。

### 10.5 指标质量门槛

- 每个指标必须定义：正常区间、WARN 阈值、采样频率、TTL——四缺一不进清单
  （防「指标墓地」）。
- 仪表盘默认显示趋势而非瞬时值；告警基于平滑值（防单 tick 毛刺误报）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 每 tick console.log 输出状态 | 刷屏 + CPU 税 + 无人时无消费者；console 只留给告警 |
| 观测数据全部进 Memory | 违反瘦 Memory 契约；遥测是最典型的冷数据，归 segment |
| 体外 agent 直接写游戏内状态（双向通道） | 观测平面获得写权 = 控制平面风险（见 23 号文档 L2 护栏）；观测只读 |
| 全量原始事件日志（每 tick 落盘） | 存储与 CPU 双爆炸；采样 + 聚合 + 事件表（仅异常事件）已满足取证 |
| 先上全套 APM 再说 | 观测预算倒挂；从 10.1 最小集起步，指标随 milestone 增量添加 |

## 12. Open Questions

1. Grafana 面板的具体 JSON/图表选型——实施期课题，不阻塞架构。
2. 降采样档位（新密旧疏的边界）与 segment 页分配——需与 18 号文档 §12.3 联合定标。
3. 体外告警通道（email/webhook）选型与自治契约的边界：帝国只保证「信号写出」，
   送达责任在体外——这个契约是否需要 SLA 定义（当前裁决：不需要，保持最简）。
4. MTTR 的测量方法：故障注入只能在私服/测试环境做，官服 soak 只能测「检测延迟」
   而非完整恢复时间。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source（releases） | 源码/发布说明 | Grafana 遥测、pandascreeps.com 托管先例（2026-08-22 核查） | CONFIRMED |
| https://github.com/ScreepsQuorum/screeps-quorum + https://www.reddit.com/r/screeps/comments/710p9n/quorum_a_screeps_social_experiment_in_bot/ | 源码/社区 | quorum.tedivm.com 全公开仪表盘、stormtracker tick 率监控（2026-08-22 核查） | CONFIRMED |
| http://docs.screeps.com/third-party.html | 官方文档 | screeps-grafana 为社区原始统计方案（Docker + API 轮询） | CONFIRMED |
| https://jonwinsley.com/notes/screeps-data-driven-development | 博客 | screeps-grafana 数据驱动开发实践 | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/bu59il/how_to_set_up_grafana_for_screeps/ | 社区讨论 | node-agent 自托管/托管两种形态 | LIKELY |
| https://github.com/bencbartlett/Overmind | 源码 | 内置 profiler + Grafana 统计 | CONFIRMED |
| [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md) | 本套件 | 体外只读通道与 L2 顾问护栏 | CONFIRMED |
| autonomy-acceptance 参考文档（skills/screeps-grandmaster-perspective） | 领域经验 | A0–A5 指标与门槛清单（本文 10.1 的域骨架来源） | LIKELY |
