# INTELLIGENCE_ARCHITECTURE · 情报架构（冻结蓝图）

> 本文件是**情报契约**：六个概念、TTL 分档、segment 分片、Information value per
> CPU、多源新鲜度硬门槛与情报欺骗缓解以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，不得静默修改。
> 依据：research/14（核心裁决）、research/03 §4/§9（segment / 世界结构）、
> research/16 §10.4 与 research/17 §8（新鲜度硬门槛的消费方）；状态所有权见
> [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.8；模块八项见
> [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.12。

## 0. 当前生产状态（R14 裁决 · 必读）

**本文件全部章节是冻结蓝图合同；下表区分「已实现」与「历史/待清理」。**

| 项 | 状态 |
| --- | --- |
| 本文件 §1–§8 概念合同（Observation/Intel/Knowledge/Threat/Prediction/History、TTL、置信度、硬门槛） | **已实现核心（R14，2026-08-29）**：`intelligence` 系统（P2/10t）为 IntelState 唯一写者——三分置信度（来源信任 × 时效窗读侧派生）、TTL 分档 + expiry jitter、房间域 heap 活跃层（256 环形覆盖）、玩家域威胁记忆 segment 5 冷存（月级）、§5 硬门槛查询（`intelActionUsable`/`intelNeedsRescout`） |
| 观察采集 | legacy `Memory.rooms[].intel` 只读输入桥采用（room-observer 写侧保持运行）+ 快照被动威胁信号；消费者迁移 IntelQuery 为 war 轨前置 |
| segment 分片（§3） | 玩家域 segment 5 已落地；房间域 `intel-rooms-{hash}` 分片按规模触发（10+ 房）后启用（当前 heap 环形覆盖语义等价）；静态域由 `classifyRoomByName` 派生（inferred），市场域数据归市场系统所有 |
| `intelligence-pipeline`（A6 智能层）、`decision-trace`、`evaluation-system` | **已按 R11 裁决清理（2026-08-29，B5）**：`src/domain/intelligence/` 与 `src/domain/strategy/decision-trace.ts` 已删除（设计源码测试 24 文件同步移除）；R14 不恢复之，恢复须走新 ADR |
| 测试验证层级 | `tests/unit/intel/*` 验证 IntelState 领域模型（生产路径）；原 `tests/unit/intelligence/*` 等设计源码测试已随 B5 清理删除；E2E-011 冲突项见 backlog B3 |

**测试验证层级（防误读）**：

- 原 Shadow-Only 设计源码测试（`tests/unit/intelligence/*`、
  `tests/unit/strategy/a4-7-decision-trace.test.ts` 等 24 文件）已随 B5 清理删除
  （2026-08-29）；A6 智能层无生产实现亦无测试；
- `tests/e2e/scenarios/11-decision-trace.test.ts`——断言生产运行日志中出现
  decision-trace 输出。R11 后生产 bundle 已无 decision-trace 模块与日志发射点，
  **该 E2E 与 R11 冲突**，在按新 ADR 重定向或移除前不得作为生产行为证据引用
  （backlog B3）。


## 1. 六概念合同

| 概念 | 是什么（必须语义） | 禁止 |
| --- | --- | --- |
| **Observation（观察）** | 三通道采集：①**被动可见**（自有 / 远矿房 RoomSnapshot 顺手沉淀——零边际成本，永远在线含 Recovery 档）；②**scout 巡访**（低频环路 + 目标导向任务；身体极简，损失按耗材计）；③**observer 定点**（RCL8、每房 1 座、射程 10 房的静态巡检网，research/03；无 cooldown 常量已核、散文未确认——P1 私服复核，[RESEARCH_SYNTHESIS.md](RESEARCH_SYNTHESIS.md) §5） | 无消费者的采集通道；多 observer 重复观察同一房（帝国层汇总去重生成统一巡检表） |
| **Intel（情报）** | 四域冷存记录：**房间**（归属/RO/RCL/威胁快照/防御估值/source 数/矿物）、**玩家**（威胁指数/攻击历史/胜率估计/黑名单/最后活动房/宿敌距离）、**资源与地形**（资源估值字段 + 地形矩阵 + 世界结构先验）、**市场**（订单簿/价格历史——市场系统所有，本系统只读缓存，research/14 §10.7）；载体为 IntelEntry（§2） | 情报写主 Memory（序列化税，research/14 §11）；充当市场订单的采集写者（归 TerminalManager） |
| **Knowledge（知识）** | 三分置信度：**fact**（本源直接观测且在新鲜度窗内）/ **stale**（曾观测、超窗未复核）/ **inferred**（先验推导：世界结构坐标推导、行为模式假设、盟友转述）；三分**禁止混用**（§5） | stale / inferred 冒充 fact；置信度二元化（逼消费方自行猜测，research/14 §11） |
| **Threat（威胁）** | 四级威胁评估的 intel 输入接口：向 Defense 供给可见敌情（body/数量/boost/补给距离）与 PlayerIntel 威胁记忆；置信度随新鲜度衰减（分级消费归 [DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) §3） | 情报系统直接触发军事 / 防御动作（开战权在战略层，research/14 §11） |
| **Prediction（预测）** | **仅限显式模型**：威胁到达时间估计、敌方可持续时间区间（Economic estimate 类）；一切预测值**必须**标注 inferred（§5 使用规则） | 隐式预测（外推值当观测值存储）；预测值进入 fact 通道 |
| **History（历史）** | segment 冷存：市场历史**自记**（引擎 `Game.market.getHistory` 仅返回约 14 天日线，更长期价格史必须自记）；玩家行为档案（交互计数 / 可观测军力上限 / 黑名单——hivemind player-intel 先例，research/14 §10.5） | 历史数据进 Memory；无 source/evidence 的历史断言 |

## 2. IntelEntry 契约与 TTL 分档

### 2.1 IntelEntry 字段

`subject`（room/player id）、`observedAt`、`source`（passive/scout/observer/ally/derived）、
`confidence`、`expiry`、`payload`（按域 schema）（research/14 §10.2）。

### 2.2 TTL 分档（初值 SPECULATION，soak 校准——research/14 §12）

| 字段类 | TTL | 依据 |
| --- | --- | --- |
| 敌编队 / 威胁事实 | 可见期结束即降级 | 行情瞬变（research/14 §10.2） |
| 房间归属 / RO / RCL | ~5,000–20,000 tick | 归属是慢变量；KasamiBot 20k 先例 |
| 资源 / 估值字段 | ~20,000 tick | 与估值刷新同频 |
| 玩家威胁记忆 | 衰减权重而非删除 | hivemind 先例；黑名单 TTL 由止损链定（[MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md) §3） |
| 地形 / 世界结构 | ∞ | 官方静态事实（research/14 §4） |

### 2.3 刷新责任合同

| 条款 | 内容 |
| --- | --- |
| 唯一写者 | IntelState 唯一写者 = Intelligence 系统（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.8）；一切消费者只读，**无刷新权**——发现情报过期只能发侦察任务，不得直写。 |
| 降级链 | 无视野随龄单调降级 fact→stale→inferred；超 TTL 清为「未知」；超容量环形覆盖。 |
| 防过期风暴 | 到期时间戳加 jitter；老化低频批处理（research/14 §8）。 |
| 任务闭环 | scout 巡检任务带完成确认，超期未回报即重派（租约同构，research/14 §8）。 |

## 3. segment 分片 schema 与容量预算

| 分片 | 内容 | 预算 |
| --- | --- | --- |
| `intel-rooms-{hash}` | 房间条目按房名哈希分片 | 常态激活 ≤2 段（活跃窗 + 按需加载） |
| `intel-players` | 玩家域单片（量小、读频低） | 独立 1–2 段（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.8），月级长 TTL |
| `intel-static` | 地形索引 + 世界结构推导结果 | 写一次基本不动 |

| 条款 | 内容 |
| --- | --- |
| 写纪律 | 每片头部带 `epoch`（最后落盘 tick）与脏标记；脏数据低频批量写，**禁止**每 tick 全量重写（research/14 §8、§10.6）。 |
| 异步语义 | 本 tick 请求、下 tick 可读；heap 活跃层遮蔽——消费者永远读 heap，未命中才发起 segment 加载并返回 stale 占位（research/14 §10.6）。 |
| 激活预算 | 情报常态占用 ≤2 个激活段，与遥测共享每 tick 10 段上限且不争用（100 段 ×100KB 上限为引擎事实，research/03 §4）。 |
| 链路禁区 | 查询**禁止**进 P0 生存链路（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.8；[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.12）。 |

## 4. Information value per CPU 合同

| 条款 | 内容 |
| --- | --- |
| 消费者列名 | 每个 intel 字段**必须**有列名消费者（防御分级 / 扩张评分 / 战争授权 / 远矿 ROI）；没有消费者的字段不采集（research/14 §9）。 |
| 通道分级 | 被动零成本永远在线；scout 数量是 posture 的函数（peace 1–2 只低频环路，fortify/war 目标导向加密——威胁驱动而非全图广播）；observer 每 tick 至多一次 `observeRoom` + 轻记账（research/14 §9、§10.4）。 |
| 低价值不占高位 | 低价值情报不得占用高优先级 CPU；侦察任务按价值排序进低优先级车道（research/14 §9）。 |
| 预算目标 | 情报系统整体 ≤ 帝国 CPU 的 2–3%（SPECULATION 初值，soak 校准）；Recovery 档只保留被动采集（research/14 §9）。 |
| 路线规划 | 侦察路线按「价值密度 × 新鲜度缺口」排序；全图常驻 scout 网络被否决（research/14 §11）。 |

## 5. 多源新鲜度硬门槛合同

> 三分置信度的使用规则**落成类型系统约束**（结构化，不靠自觉，research/14 §10.3）：
> stale/inferred 不得作为 fact 参与任何硬门槛。

| 行动 | 硬门槛 | 依据 |
| --- | --- | --- |
| 进攻 / 占领 / 大额调拨 | 只接受 fact 级 | research/14 §10.3 |
| 战争授权与目标选择 | fact 级 ∧ 观察年龄 < 阈值；超龄 → 先派 scout 两段式核实 | research/16 §10.4 |
| 扩张尽调评分 | fact/stale 级；未知按最保守分计 | research/17 §8 |
| 战后核验 | 只信战后新鲜观察（fact 级复核），战前情报与传闻一律不算数 | research/16 §10.8 |
| stale 合法用途 | 仅触发「先侦察后行动」的两段式任务 | research/14 §10.3 |
| inferred 合法用途 | 仅触发侦察任务与保守评分（未知风险按最保守计），永不直接驱动动作 | research/14 §10.3 |

## 6. 情报欺骗缓解合同与残余风险声明

| 风险 | 缓解合同 |
| --- | --- |
| 盲区当安全区 | 未知 ≠ 安全：无情报的候选按最保守分计，并驱动侦察任务生成（research/14 §8）。 |
| PlayerIntel 诽谤（误记宿敌） | 记忆写 source 与 evidence 字段；黑名单带 TTL 冷却而非永久（research/14 §8）。 |
| 外部转述污染 | 盟友 / 第三方转述一律标 inferred（simpleAllies 类协议暂不引入，引入时适用，research/14 §10.7/§12）。 |
| 过期风暴 | TTL 到期时间戳 jitter + 老化低频（§2.3）。 |

**残余风险声明（不可消除，仅可约束）**：对手对己方可见性拥有部分控制权（示形、
伪装安全、诱饵），任何置信度模型都是先验而非保证。本架构的立场是把残余风险
关进「不可逆行动只认 fact + 超龄两段式核实」的门框内——欺骗最多骗到侦察预算，
骗不到战争授权（与 research/16 §8 诱饵防线同源）。确定性消费策略可被对手摸透
的对抗性警告（research/16 §5/§7）同样适用于情报消费侧，是已声明并接受的残余
风险。

## 7. 失败模式防线表

| 失败模式 | 后果 | 防线（本蓝图条款） |
| --- | --- | --- |
| 陈旧情报触发进攻 | 打空目标 / 踩进换防后的堡垒 | 进攻只接受 fact 级 + 观察年龄 < 阈值（§5；research/14 §8） |
| 盲区当安全区 | 扩张评分把未知记 0 分风险 | 未知 ≠ 安全，按最保守分计并驱动侦察（§6） |
| player-intel 诽谤 | 错误敌对 / 错误黑名单 | source + evidence 字段；黑名单 TTL 冷却（§6） |
| TTL 同时到期（过期风暴） | 一批侦察任务冲击预算 | 到期 jitter + 低价值低车道（§2.3/§4；research/14 §8） |
| segment 写放大 | CPU 与段容量双超 | 脏标记增量写 + 低频聚合落盘（§3） |
| observer 目标非法 | 抛错进熔断 | 房名合法性校验 + 返回码检查（intent 税纪律，research/14 §8） |
| scout 被杀路线空洞 | 覆盖缺口无人补 | 巡检任务完成确认 + 超期重派（§2.3） |

## 8. 与其他契约的关系

| 契约 | 分工 |
| --- | --- |
| [DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) / [MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md) | Threat 输入接口、目标新鲜度硬门槛、PlayerIntel 威胁记忆与黑名单 TTL |
| [EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) | 尽调评分输入（fact/stale 级）、宿敌距离因子、远矿 ROI 骚扰损失 |
| [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.8 | IntelState 所有权（唯一写者 / 生命周期 / segment） |
| [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2.2 | P2 档位（事件式写、低频老化、Recovery 只留被动） |
