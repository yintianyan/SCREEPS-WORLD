# SPAWN_ARCHITECTURE · 孵化架构（冻结蓝图）

> 本文件是**孵化域契约**：`spawnCreep` 最终权力、七概念、census→demand→
> replacement horizon 管道、治理通道与失败语义以此为准。结构性修订必须走 ADR
> 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，不得
> 静默修改。依据：research/11（核心）、research/10 §10.2–10.4（人口基线与预算
> 锚点）、research/20 §10.1（census 节奏）、research/30（红队 A5/A11）；架构侧
> [ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md) §10.3–§10.4、
> [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1/§2、
> [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §6、
> [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.5、
> [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.7。

## 1. 最终权力合同

| 条款 | 内容 |
| --- | --- |
| 唯一写者 | **SpawnManager 是全局唯一 `spawnCreep` 调用者**（ADR-005）。全系统不存在第二个写者——包括内核（紧急直通也经 SpawnManager 执行，[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §6）与帝国（帝国只提交请求）。 |
| 输入 | SpawnIntent（各系统提交，必带幂等 key＋deadline，[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.7）。 |
| 输出 | `spawnCreep` 调用＋孵化/失败 outcome（**禁止静默丢单**）。 |
| P 级与豁免 | P0；**永不熔断、永不冷却**（红队 A5）；O(queue)/tick，每 tick 消化队列。 |
| 提交方义务 | 只经 Public Interface `submit(intent)` / `cancel(key)`；不得轮询队列内部状态（查询自身请求状态除外）。 |

## 2. 七概念合同

### 2.1 SpawnDemand（孵化需求）

产生者**仅四类**（research/11 §10.1；防御单见 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.9）：

| 产生者 | 例 | 默认车道 |
| --- | --- | --- |
| 房间 census 缺口 | 矿工/hauler/builder/upgrader | P1/P2 |
| 帝国 Operation 专项单 | 扩张先遣、殖民自举、战争波次 | P3（war 授权后 Policy 赋权升 P1，§2.2） |
| replacement horizon 换代单 | 携继任 key | P2 |
| 防御应答单 | defender 补位 | 常态 P1；威胁应答 P0（§2.2） |

格式合同：每单必带**角色 / 数量 / 期限（deadline）/ 理由（reason code）**＋
幂等 key；无期限订单一律拒收。

### 2.2 Priority（车道制）

| 车道 | 内容 | 抢占 |
| --- | --- | --- |
| P0 灾后恢复＋防御应答 | 恢复 phase 最小闭环单元＋威胁应答 defender | 抢占一切 |
| P1 生存维持 | 能量链关键位（矿工/hauler）＋常态防御位 | 抢占 P2/P3 |
| P2 稳定 | 换代单、建造/升级工种 | — |
| P3 增长 | Operation 专项（扩张先遣、波次前置） | 可被压缩 |

| 条款 | 内容 |
| --- | --- |
| 同车道序 | 按 **Agenda 优先级序**（Policy 赋权：war 波次 > 殖民自举 > 远矿恢复…，[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §2 Q4）。 |
| 战时提级 | war posture 授权后，波次订单由 Policy 赋权**升至 P1**（战争基金预算线内不与经济发展竞争，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3；research/11 §12 OQ2 之联冻裁决）。attacker 仍仅由 war-planner 提交。 |
| 饥饿老化 | 任何等待者带饥饿年龄，超龄强制提级（防 P3 永久饥饿，[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §5 同构）。 |
| 非法 | **先来先得非法**（调和 §10.3；红队 A11）。仲裁发生在合并请求时（幂等 key 去重后排序），一次裁决全局生效。 |

### 2.3 Queue（幂等队列）

| 条款 | 内容 |
| --- | --- |
| 幂等 key | key ＝ role ＋ room ＋ (missionId \| generation)（research/11 §10.6）。 |
| 合并规则 | 同 key 重复请求＝合并：**取最高优先级＋保留最早下单时间戳**——重复请求是提升优先级，不是新订单（research/11 §8）。 |
| 人口口径 | `spawning` 中的 creep 与已提交请求**计入 census**（防「订单在飞→census 看缺→再下单」超产螺旋，research/11 §6）。 |
| TTL | 订单带 TTL，过期未执行自动清理并回报请求方（§5）。 |

### 2.4 BodyPlan（体型计划）

| 条款 | 内容 |
| --- | --- |
| 形态 | 角色＝「部件模板＋比例约束」（静态矿工 W 优先 5–6、M 1、C 可选 0–1；hauler C:M≈1:1）；孵化时按 spawn+extension 当前可用能量**从最大档向下缩放**——任何能量水位都能出单（防队列死锁，research/11 §8）。 |
| 5W 数学锚点 | 5×WORK×2×300＝3,000 恰好采空一个 source：经典 [5W,1M]＝550、6W＝660 缓冲档（research/11 §10.3）。 |
| 预算锚点 | body 上限随 phase 放开而非全局顶格：RCL4＝1,300 / RCL6＝2,300 / RCL8＝12,300（research/11 §10.3）；extensions 永远最先建（孵化预算＝人口质量天花板，research/10 §10.3）。 |
| boost 前置 | 仅当 mature phase 房持续维持 lab 库存（SLA）才允许挂 boost 需求；harvest 类收益最大、work 类默认不 boost；**boost 决策挂换代/专项单（一次性），禁止孵化时反复查 lab 库存**（research/11 §10.3、§12 OQ3 之联冻裁决）。 |
| 顺序与 renew | tough 在前、关键 part 靠后（模板必须声明部件顺序）；renew 清 boost——强化单位默认不 renew 只换代（research/11 §8）。 |

### 2.5 EnergyBudget（孵化能量预算）

| 条款 | 内容 |
| --- | --- |
| 预算来源 | 孵化是 P0/P1 能量消费的第一优先项（[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §2.2）；已提交订单的能量占用＝经济域 Reservation 的 **spawn 排产预留**实例（[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §2.1 #7）。 |
| 收紧 | 人口域关闭条件：spawn 队列深度＋孵化能量占用超限→收紧非 P0 孵化（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4 人口域）。 |
| 禁止 | 为等全配 body 让关键位断档（降档出单优先于体型完美）；孵化占用不入能量账。 |

### 2.6 EmergencySpawn（内核级紧急直通）

| 条款 | 内容 |
| --- | --- |
| 触发 | 灾后/防御孵化需求成立 ∧ 可用能量 ≥200 ∧ 普通 P0 车道通道不可用（SpawnManager 异常/人口断档）；**不依赖任何 P1+ 系统健康**（[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §6；红队 A5）。 |
| 动作 | 立即孵化最小单元 `[WORK, CARRY, MOVE]`（200 能量）；不等 body 缩放计算与队列仲裁。 |
| 车道语义 | P0 车道内最高优先级**直通位**，不是队列外绕过——`spawnCreep` 仍唯一经 SpawnManager，内核仅负责触发判定与放行（调和 §10.4；[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §2 Q3）。 |
| 物理兜底 | spawn+extension 总能量 <300 时每 tick 自回 1 能量——200 档在物理上总可达（research/11 §4）。 |
| 记录 | 每次直通必须记录越权原因进遥测。 |

### 2.7 SpawnAllocation（多 spawn 排产）

| 条款 | 内容 |
| --- | --- |
| 口径 | **全局口径＋属地执行**：队列是帝国级单一队列（全局核算与仲裁），执行落属地 spawn（RCL7 第二 spawn、RCL8 第三，research/11 §10.5）。 |
| 排产 | 空闲 spawn 按车道取单；**一个订单只在一处执行**（幂等键锁）。 |
| 命名 | creep 名全局唯一且可追溯到订单 key（防跨 shard 同名即死，research/11 §10.5）。 |
| 跨房 | 帝国层订单指定目标房执行；跨房「借 spawn」由帝国仲裁，**房间不得私自承接**（research/11 §10.5）。 |

## 3. census→demand→replacement horizon 管道合同

```text
census（存活＋spawning＋已提交；角色×部件双口径清点）
  → demand（缺口＝目标配置−census；目标配置＝房间 phase 基线×地形/威胁修正）
  → replacement horizon（剩余寿命 < 孵化时长＋到位路程＋安全裕度 → 换代单，携继任 key）
  → 订单（稳定 key 幂等合并入队）
```

| 条款 | 内容 |
| --- | --- |
| 双口径 | 同时清点 **creep 数**与 **WORK/CARRY 部件总量**——「人数够但部件不够」是隐蔽失败（research/11 §10.2）。 |
| horizon 推导 | 孵化时长＝3 tick/part（03 §8，转引自 research/11 §4）＋到位路程＋安全裕度（初值 100–200 tick，soak 校准，research/11 §12）。 |
| census 节奏 | heap 缓存＋低频复核（心跳）；全局 creep 注册表一次遍历服务全部房（禁止每房独立 find，research/11 §9）；N＝1–3（research/20 §10.1）。 |
| 纯函数 | census×策略→订单集是纯函数，可离线单测（research/11 §9；research/28 纯函数律）。 |

## 4. 治理通道合同（黑名单 / 撤销 / recycle）

| 通道 | 合同 |
| --- | --- |
| 黑名单冷却（SP-2） | **请求方级**冷却，非全局：某请求方订单连续失败（孵出即死/目标消失/逻辑拒绝）→该请求方进冷却；冷却期内拒收同 key 新单；**到期必须复评**自动放行；黑名单事件进遥测（research/11 §10.6）。 |
| 撤销通道 | 需求消失走 `cancel(key)` 撤销，不占队列；撤销有回执。 |
| recycle 回收 | 仅用于**角色结构性淘汰**（phase 迁移）；回收残值 ≤125/part（有损：部件成本均价 80–100/part）——**禁止**用 recycle 做常规人口调节（research/11 §8/§10.6）。 |

## 5. 失败语义合同（不静默丢单）

| 情形 | 语义 |
| --- | --- |
| 能量不足 | 排队等待＋按 §2.4 降档出单；饥饿计数上报（人口闭环失效信号→房间层能量再分配，research/11 §10.6）；**禁止静默丢弃**。 |
| body 不可用 | 降档到可用档位出单；无任何可用档＝rejected 回执＋理由。 |
| deadline/TTL 过期 | 自动撤销（expired）＋回执请求方；请求方低频复核自身需求（防目标早消失仍要人，research/11 §8）。 |
| 回执义务 | 一切 Intent 必有 accepted/rejected/completed/failed/expired 回执，拒绝也落遥测（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §2 环节 7）。 |

## 6. 与 DECISION_AUTHORITY 的一致性声明

1. **Q3（Defense 紧急 spawn 让路）**：必须让路，但不绕路——威胁应答单走
   P0 车道，同 tick 抢占 P1–P3 排队位；SpawnManager 异常时启用内核级直通
   （§2.6）；**不存在队列外第二个 `spawnCreep` 调用者**（绕过＝破坏幂等与
   全局核算）。
2. **Q4（两个 Operation 争同一 spawn）**：车道→Agenda 优先级序→饥饿老化
   三级仲裁，无先来先得；仲裁在合并请求时一次裁决全局生效。
3. 本文件与 [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.5
   （SpawnState Owner＝SpawnManager）、[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md)
   §1.7（Spawn 八项）、[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §6
   （紧急直通）同一时刻必须一致；任何一处修订必须同步其余各处并走 ADR。

## 7. 评审红线（负结果引用）

| # | 红线 | 否决依据 |
| --- | --- | --- |
| 1 | 任何模块出现第二个 `spawnCreep` 调用点（含「紧急绕过队列」） | ADR-005；[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §2 Q3 |
| 2 | `spawning`/已提交请求不计入 census | 超产螺旋（research/11 §8） |
| 3 | 重试无幂等 key、重复请求当新单 | double-spawn（research/11 §8） |
| 4 | 固定 body 表不按可用能量降档 | 低能量队列死锁＋灾后无法自举（research/11 §11） |
| 5 | 先来先得出队 | 调和 §10.3；红队 A11 |
| 6 | 静默丢单（Intent 无回执） | [GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §2 环节 7 |
| 7 | recycle 当常规人口调节 / renew 清 boost 不感知 | research/11 §8 |
| 8 | 房间私自承接跨房代孵订单 | research/11 §10.5 |
