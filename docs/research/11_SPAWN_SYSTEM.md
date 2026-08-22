# 11 · 孵化系统（Spawn System）

> 研究文档 · 结论等级：**设计裁决**（≥6 家 bot 收敛 + 官方机制核算）。
> 机制事实以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)
> §6/§8/§10 为基准；总裁决见 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
> ADR-005。核查日：2026-08-22。

## 1. Problem

孵化是人口的唯一入口，也是「需求」与「物理世界」的汇合点。多来源自由孵化
（角色各自 spawnCreep）必然产生重复订单、能量竞争、超预算人口与互踩命名；
反过来，完全集中但无幂等机制的孵化器会在请求重试时double-spawn。本文裁决：
孵化听谁的、人口如何规划、body 如何设计、队列如何幂等、多 spawn 如何协调、
饥饿如何处理。

## 2. Research Questions

1. 孵化请求的合法生产者是谁？Spawn Manager 的职责边界？
2. 人口规划管道：census（人口普查）→ demand（需求）→ replacement horizon
   （替换视界）如何定义？
3. body 设计：模板 × 能量比例化的具体规则？社区惯例体型有哪些？
4. 优先级车道与紧急车道如何划分？孵化饥饿与请求方误报如何治理？

## 3. Existing Solutions（方法论参照）

empire-architecture 的契约：population planner 从人口普查、需求缺口、
replacement horizon、body 成本、spawn capacity、能量与防御预算推导 spawn
intent；spawn intent 必须有去重键和过期时间；spawn 忙、能量不足、body 不可
用时返回 outcome，不能静默丢单。Great_Filters 把「自动孵化」（人数清点、
部件计数平衡、孵化队列、冷启动恢复）列为第二大发展过滤器——孵化自动化是
社区公认的早期生死线。

## 4. Screeps Community Practice

- **静态矿工体型惯例**：5×WORK 恰好采空 source（5×2×300=3,000），经典
  [5W,1M]（550 能量）；6W 留缓冲；首波变体 5W/1C/3M。—— 2026-08-22
  复核（Reddit 864qy3 理想配比讨论 + 数学推导）CONFIRMED。
- **部件计数平衡**（Great_Filters）：人口规划不只数 creep 数，还数 WORK/
  CARRY/MOVE 总量——「人数够但部件不够」是隐蔽失败。
- **冷启动恢复**：Great_Filters 记录的高频死因——团灭后恢复用 creep 的
  body 不够灵活，找不到或搬不回能量。恢复体型必须按「当下可用能量」
  缩放，而不是按角色模板全配。
- **官方兜底**：spawn+extension 总能量 <300 时每 tick 自回 1（03 §10）——
  存在物理保底但极慢，不能作为恢复策略。
- **孵化时长**：3 tick/part（03 §8），50 part 需 150 tick——replacement
  horizon 必须包含孵化时长+到位路程。

## 5. Existing Bot Analysis

| Bot | 孵化组织 | 关键机制 |
| --- | --- | --- |
| Overmind | hatchery（孵化场） | 请求-满足分离：overlord init 相位登记需求，hatchery run 按优先级队列满足；body 按可用能量动态拼装 |
| TooAngel | 优先级队列 | universal 万能 creep 优先——房间内无 universal 则先孵化一个保能量底线；storage 极低时回退自举模式 |
| The International | spawning + requests | request 驱动：需求先入 request 池，孵化是满足 request 的一种方式 |
| Quorum | spawns 进程 | OS 进程化样例（调度层已被 ADR-002 否决，订单机制可参考） |
| hivemind | spawn-role / spawn-manager 分离 | 「角色定义」与「孵化执行」两个模块，同构于本文裁决 |
| KasamiBot | 每房独立孵化队列 | 模块下订单带优先级，spawn 只管执行——房间级单一写者 |

**收敛（≥6 家）**：孵化与角色解耦、订单进优先级队列、执行侧单一写者。
分歧仅在「队列按房还是按帝国」——KasamiBot 按房也长期存活，说明按房可行，
但帝国级核算（战时抽调、灾后跨房统筹）需要全局视图（§11 讨论）。

## 6. Advantages（唯一写者 + 需求驱动的优势）

1. **零重复孵化**：稳定 key 幂等合并，杜绝多来源同订单。
2. **全局能量核算可行**：孵化是能量最大消费者之一，集中后「孵化预算 vs
   建造 vs 升级 vs 塔」才能在房间层闭环核算（10 号文档 §10.4）。
3. **人口账本一致**：`spawning` 中的 creep 与已提交请求都计入 census，
   杜绝「订单在飞→census 看缺→再下单」的经典超产循环。
4. **灾后车道可插入**：P0 恢复订单可抢占一切发展订单（09 §10.4）。

## 7. Disadvantages（代价）

- Spawn Manager 成为关键路径：其故障=人口断供。需要熔断（连续失败进冷却
  但 P0 永不冷却）与降级（紧急车道独立于主队列逻辑，逻辑极简保证可用）。
- 集中化损失了房间局部最优（例如房间想为特殊地形定制 body）——用「模板
  ×参数」而不是硬编码 body 表来保留弹性。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 双重下单（重试无幂等键） | 能量浪费+人口超编 | 稳定 key（role+room+missionId）合并；重复请求=提升优先级而非新订单 |
| spawning 不计入 census | 超产螺旋 | census = 存活 + `spawning` + 已提交请求（ADR-005） |
| 请求方误报（目标早消失仍要人） | 孵化出无任务 creep | 请求带过期时间；需求侧每低频 tick 复核；撤销通道 |
| 孵化饥饿（能量断供→队列积压→关键角色断档） | 闭环塌陷 | 紧急车道 ≥200 能量立即 [WORK,CARRY,MOVE]；饥饿计数进报告（09 §10.2 人口闭环） |
| 黑名单滥用（请求方反复下无效单） | 队列被垃圾占满 | 黑名单冷却（SP-2：请求方级冷却，非全局）；冷却期内同 key 拒收 |
| recycle 滥用 | 白白折损能量（返还 ≤125/part vs 成本均价 ~80–100/part，回收有损） | recycle 仅用于角色淘汰通道，不做常规人口调节 |
| body 全配模板在低能量时永远孵不出 | 队列死锁 | body 必须按可用能量比例化降档，而非等待全配 |
| renew 期 boost 清零（03 §10） | 强化人口意外裸奔 | renew 决策必须感知 boost 身份，强化单位默认不 renew 只换代 |

## 9. CPU Implications

- 孵化决策本身低频化：census 用 heap 缓存 + 低频复核（心跳），队列扫描
  每 tick O(请求+spawn) 很小；真正的成本在 census 侧的 creep 遍历——靠
  全局 creep 注册表一次遍历服务全部房（不做每房独立 find）。
- 需求推导是纯函数（census × 策略 → 订单集），可离线单测，无 Game 依赖。
- 人口结构本身决定长期 CPU：静态矿工（5W1M）与补弹工把「移动 CPU」换成
  「结构 CPU」是社区验证过的最划算交易（09 §9、12 号文档）。

## 10. Recommended Design

### 10.1 裁决：唯一写者 + 需求驱动

**只有 Spawn Manager 能调用 `spawnCreep`**（ADR-005）。需求由三处产生：
（a）房间层 census 缺口（09 §10.2 人口闭环）；（b）帝国层 Operation 的
专项订单（扩张殖民、战争波次）；（c）replacement horizon 触发的换代单。
全部汇入统一队列，按稳定 key 幂等合并后按车道出队。

### 10.2 人口规划管道

```text
census（存活+spawning+已提交，按角色×部件双口径清点）
  → demand（角色缺口 = 目标配置 − census；目标配置来自房间 phase 基线
    × 地形/威胁修正）
  → replacement horizon（creep 剩余寿命 < 孵化时长 + 到位路程 + 安全裕度
    时生成换代单，携带继任 key）
  → 订单（稳定 key 幂等合并；重复请求取最高优先级、保留最早下单时间）
```

部件双口径（§4 社区教训）：同时清点「creep 数」与「WORK/CARRY 总量」，
防「人数够部件不够」。

### 10.3 body 设计：模板 × 能量比例化

- 角色给「部件模板 + 比例约束」（如静态矿工 = W 优先到 5–6、M 1、可选
  C 0–1；hauler = C:M 1:1 为主），孵化时按 `spawn+extension 当前可用能量`
  从最大档向下缩放，保证任何能量水位都能出单（防队列死锁）。
- 惯例锚点：静态矿工 [5W,1M]=550（6W=660 缓冲档）；灾后紧急档
  [WORK,CARRY,MOVE]=200；RCL4 孵化预算 1,300（300+20×50）、RCL6 2,300、
  RCL8 12,300（03 §10）——body 上限应随 phase 放开而不是全局顶格。
- boost 前置条件：只有 lab 库存被 mature phase 房间持续维持（10 号文档
  §10.5）时才允许孵化时挂 boost 需求；harvest boost 3/5/7 收益最大
  （03 §7），work 类仅 1.5/1.8/2，升级/建造单位默认不 boost。
- 身体排序：tough 在前、关键 part 靠后（每 part 100 hits 前排先损，03 §8）
  ——模板需声明部件顺序。

### 10.4 优先级车道与紧急车道

| 车道 | 内容 | 抢占 |
| --- | --- | --- |
| P0 灾后恢复 | 恢复 phase 的最小闭环单元（09 §10.4） | 抢占一切 |
| P1 生存 | 能量链关键位（矿工/hauler）、防御位 | 抢占 P2/P3 |
| P2 稳定 | 换代单、建造/升级工种 | — |
| P3 增长 | Operation 专项（扩张先遣、战争波次前置） | 可被压缩 |

紧急车道独立于主队列逻辑：**可用能量 ≥200 即立即生成 [WORK,CARRY,MOVE]**，
不等 body 缩放计算与队列仲裁——官方 <300 自回 1/tick 兜底意味着 200 档
在物理上总是可达的。

### 10.5 多 spawn 协调

- RCL7 第二 spawn、RCL8 第三 spawn（03 §6）后，同一 Manager 对房内全部
  spawn 排产：空闲 spawn 按车道取单；一个订单只在一处执行（幂等键锁）。
- creep 命名全局唯一且可追溯到订单 key（命名纪律防跨 shard 同名即死的
  社区陷阱，Great_Filters §4 复核）。
- 帝国层订单（殖民/战争）指定目标房执行；跨房「借 spawn」由帝国层仲裁，
  房间不得私自承接。

### 10.6 孵化队列幂等、饥饿与黑名单

- 幂等：key = role + room + (missionId | generation)；合并规则=max 优先级
  + 最早时间戳；订单带 TTL，过期未执行自动清理并回报请求方。
- 饥饿治理：订单等待能量超阈值→上报人口闭环失效信号（09 §10.2）→触发
  房间层能量再分配；紧急车道兜底关键位。
- 黑名单（SP-2）：请求方（某角色/系统）的订单连续失败（孵出即死/目标
  消失/逻辑拒绝）→ 该请求方进冷却，冷却期内拒收同 key 新单，冷却期满
  自动放行；黑名单事件进遥测。
- 撤销与回收：需求消失走撤销通道（不占用队列）；角色结构性淘汰（phase
  迁移）走 recycle 通道，回收残值（≤125/part）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 角色自行 spawnCreep | 重复/竞争/超预算三重失控；社区零存活先例（§5 全部解耦） |
| 固定 body 表（不分能量档） | 低能量时队列死锁；灾后无法自举（Great_Filters 冷启动教训） |
| 每房完全独立队列、无帝国视图 | KasamiBot 证明中期可行，但帝国级核算（战争抽调、灾后统筹、GCL 投资房）缺全局口径；作为规模化自治框架选择全局队列+房间记账 |
| 每 tick 重算全部需求 | CPU 浪费；需求是慢变量，census 低频+事件驱动足够 |
| 用 renew 做人口调节 | renew 清 boost、成本结构不利；换代单是正道（§8） |

## 12. Open Questions

1. replacement horizon 的安全裕度取值（孵化时长+路程之外再留多少？）需
   soak 数据校准；初值建议 100–200 tick。
2. 战争波次的「满编才 advance」（ADR-009）与孵化车道 P3 可被压缩之间的
   交互：war posture 是否把波次订单升 P1？倾向是，待战略文档联冻。
3. boost 需求挂订单还是挂换代：倾向换代（一次性决策），避免孵化时反复
   查 lab 库存。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://www.reddit.com/r/screeps/comments/864qy3/（ideal ratios） | 社区 | 5W 数学、6W 缓冲、[5W,1M] 经典矿工 | CONFIRMED（2026-08-22 复核） |
| https://wiki.screepspl.us/Great_Filters | 社区 wiki | 部件计数平衡；冷启动恢复失败为高频死因；跨 shard 同名即死 | CONFIRMED |
| Bot 调研摘要 2026-08-22（Overmind hatchery / TooAngel universal / TI requests / Quorum spawns / hivemind spawn-role / KasamiBot 每房队列 / bonzAI SpawnGroup） | 源码 | 孵化-角色解耦 + 优先级队列 ≥6 家收敛 | CONFIRMED |
| 03_SCREEPS_GAME_CONSTRAINTS.md §6/§8/§10 | 官方事实 | 孵化 3 tick/part；<300 自回 1/tick；recycle ≤125/part；renew 清 boost；extension 容量与孵化预算 | CONFIRMED |
| https://github.com/TooAngel/screeps/blob/master/doc/Design.md | 源码文档 | universal 优先孵化与自举回退 | CONFIRMED（2026-08-22 复核） |
