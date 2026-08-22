# DECISION_AUTHORITY_MODEL · 决策权模型

> Phase 1 §6：谁拥有最终决策权。依据 [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md)
> 与 [ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md)（§1/§7/§10）。

## 1. 权力总表

| 决策域 | 最终决策者 | 执行者 | 不可越权项 |
| --- | --- | --- | --- |
| 帝国方向（posture/预算） | **Policy 纯函数**（帝国战略层） | 各系统按预算行事 | 任何系统不得改 posture；切换带滞回+minDuration |
| 扩张/远矿立项 | 帝国（AgendaItem + G1–G5 门控） | 母房（属地执行） | 房间不得自行 claim/立项 |
| 战争授权 | **war posture 唯一授权链** | war-planner（唯一进攻执行者） | attacker 孵化仅经 war-planner；止损链不可绕过 |
| 本地六闭环 | 房间（phase 驱动） | RolePolicy+本地系统 | 不得越过预算消耗共享资源 |
| Spawn 排产 | **SpawnManager（全局唯一写者）** | 物理 spawn | 车道制 P0>P1>P2>P3 + 饥饿老化；先来先得非法 |
| 建造签发 | ConstructionManager（自有房）/ RemoteMiningManager（远矿） | builder | 角色层只写申请标记 |
| 移动签发 | TrafficResolver（tick 末按房仲裁） | creep | 角色只登记意图 |
| 市场下单 | MarketManager（唯一写者） | terminal | 幂等键；getAllOrders 低频缓存 |
| 跨房调拨 | 帝国（terminal 网络 + 门控） | hauler/terminal | 本土净流为正是前置；异常房例外策略 |
| 能量使用权 | **Room（所有权）** | 本地预算分配 | 帝国只有调拨权，且受门控 |
| 紧急灾后孵化 | P0 车道 + 内核级直通路径（≥200 能量最小单元） | SpawnManager | 直通不依赖 P1+ 系统健康（红队 A5） |
| Memory schema | 迁移器（版本化幂等） | — | 任何系统不得绕过迁移写新字段 |

## 2. 四个裁决问题（任务书 §6 的考题）

### Q1：Empire 想扩张，Room 想升级，谁赢？

**帝国赢，但有保底线。** 扩张是 AgendaItem（帝国垄断立项权），殖民输血优先级
由车道与预算决定；但房间的 P0/P1 生存需求（spawn 恢复、能量净流转正的最低维持）
**不可被任何 Agenda 抽调**——门控本身（G1–G5 含「本土净流为正」）在制度上保证
扩张只能消耗余量。极限情况（本土濒死）下 Policy 会拒绝/收缩 Agenda，不需要房间
「抗争」：房间没有否决权，但有受宪法保护的生存底线。

### Q2：Economy 想省能量，Military 想造 boosted creep，谁赢？

**posture 裁决，预算执行。** 和平期：军事需求走 P3 车道且受 boost SLA 库存约束
（预生产、非战时暴兵）——经济赢是常态。war 授权后：战争基金预算线（预期损失
≤基金）被 Policy 划出，军事消耗在基金内**不再与经济发展竞争**；基金耗尽或经济
压力持续超标 → 止损链强制退 fortify——经济底线最终不可被军事击穿（ADR-009）。
两者不是「谁赢」关系，是预算分账关系。

### Q3：Defense 认为需要紧急 spawn，普通队列必须让路吗？

**必须，但不绕路。** 防御孵化走 P0 车道（队列内最高优先级），同 tick 即可抢占
P1–P3 的排队位；若 SpawnManager 本身异常（熔断——虽然 P0 永不熔断，红队 A5），
内核级紧急直通路径（≥200 能量 [WORK,CARRY,MOVE]）保证灾后下限。**不存在队列
外的第二个 spawnCreep 调用者**——绕过=破坏幂等与全局核算。

### Q4：两个 Operation 争抢同一个 spawn，谁有优先权？

**车道 → Agenda 优先级序 → 饥饿老化，三级仲裁，无先来先得。** ① 不同车道
P0>P1>P2>P3（防御/灾后 > 生存维持 > 发展 > 增长）；② 同车道内按 AgendaItem 的
战略优先级（Policy 赋权：war 波次 > 殖民自举 > 远矿恢复…）；③ 任何等待者带
饥饿年龄，超龄强制提级（防 P3 永久饥饿，19 号）。仲裁发生在 SpawnManager 合并
请求时（幂等 key 去重后排序），一次裁决全局生效。

## 3. 冲突升级路径（低层解决不了的才上浮）

```text
creep/RolePolicy 层冲突（目标争抢）→ 分配服务仲裁（本 tick 解决）
房间层资源冲突（本地预算）→ 房间 phase+预算规则（本 tick 解决）
跨房资源冲突（调拨/征调）→ 帝国 Agenda 复核（低频，≤N tick 解决）
战略冲突（打不打/扩不扩）→ Policy 求值（态势刷新 tick 解决）
Policy 参数本身的冲突（调参震荡）→ 演化闭环护栏（窗口+canary+回滚）
护栏解决不了 → 人工接管信号（21 号 TAKEOVER 级告警）
```

## 4. 决策可解释性要求（所有决策者的共同义务）

每次关键裁决必须留下可追溯记录：posture 切换（触发事实+置信度+预算快照）、
Agenda 立项/取消（评分+门控快照）、war 授权（账本）、safemode（决策表命中项）。
记录走遥测管线（低频聚合进 segment），不进 Memory 热路径（21 号）。
