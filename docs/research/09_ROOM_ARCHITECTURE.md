# 09 · 房间架构（Room Architecture）

> 研究文档 · 结论等级：**设计裁决**（社区证据收敛 + 机制推导）。
> 机制事实以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) 为基准，
> 总裁决索引见 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)（ADR-001）。
> 核查日：2026-08-22。

## 1. Problem

帝国由房间组成，但「房间作为软件单元」的边界没有被游戏定义，必须自行裁决：

- 房间层拥有哪些决策权，哪些必须上交帝国层？
- 房间要不要「角色分类」（farm 房 / 军事前哨 / 经济房）？还是按能力分
  phase（阶段）？
- 房间对帝国报告什么、请求什么，两级决策（ADR-001）才可运转？
- Respawn（重生）、creep 团灭、结构被拆后，房间如何自识别为「灾后状态」并恢复？

房间是最大的故障域（failure domain）：单房崩溃不应拖垮帝国；但房间也是最贵
的状态载体——结构、布局、库存都是慢变量，不能像 creep 一样随便重建。

## 2. Research Questions

1. 顶级 bot 如何抽象「房间」？房间层职责清单是什么？
2. 房间分类用静态 role 标签还是派生 phase？各自的状态维护代价？
3. 房间↔帝国的最小接口（报告/请求）应该包含什么，才能支撑预算门控？
4. 灾后恢复有没有官方机制兜底？恢复路径如何分阶段？

## 3. Existing Solutions（方法论参照）

empire-architecture 参考给出殖民分工契约：colony 对自己的 source、population、
物流、建造、升级和本地防御负责，向帝国报告需求、产能和风险；帝国管跨房资源
平衡、扩张、市场、军事与全局优先级；帝国不逐 creep 指挥，下发带预算与期限的
mission。strategy-playbook 把 Colony 阶段的关注点从「角色能不能工作」转为
「房间吞吐是否稳定」，并要求房间布局是可验证的约束问题而非硬编码。

两个参照共同指向：房间 = 本地经济闭环 + 向上的标准化报告，而不是「一堆
creep 的容器」。

## 4. Screeps Community Practice

- **CPU 账本以房间为单位**：社区数据点为普通房约 3–5 CPU/房、remote 房约
  1 CPU（forum 2381、Reddit 5l1nvz 等）。→ 房间天然是 CPU 预算的记账单元。
- **房间规划模块化**：jonwinsley 的房间规划把房间拆成每 source 一个
  Franchise（spawn+link+container）+ controller 处 HQ（spawn+link+terminal+
  storage+全塔），并按「CPU 效率 > 能源效率 > 防御力」排序（shard3 经验：
  砍 remote、限制移动）。—— 2026-08-22 复核原文 CONFIRMED。
- **成熟度阶梯以房间为单位推进**：tutorial → drop mining → container mining →
  remote → SK mining（wiki Maturity Matrix）；发展过滤器（Great_Filters）
  把「自动孵化、自动防守、采集升级、多房管理」列为房间的阶段性门槛。
- **每房 5 座 container 任意 RCL 可用**（03 §6）：早期闭环（container mining）
  不依赖 RCL，恢复路径因此可以极简。

## 5. Existing Bot Analysis

| Bot | 房间抽象 | 职责范围 | 备注 |
| --- | --- | --- | --- |
| Overmind | Colony（房 + 其 outposts） | Colony 内 source 采集、孵化（hatchery）、建造、物流 | outpost 归属 Colony，帝国不直接管远矿房 |
| TooAngel | 房间对象 + 预计算路径 | 布局按 RCL 自动生成；universal creep 保能量底线 | 布局与 CPU 策略（shard3 限移动）都是房间本地决策 |
| The International | roomManager 命名空间 | requests 驱动本地经济；fastFiller 补弹 | 房间是 request 的生产者 |
| Quorum | city 进程组 | layout/mine/chemistry/fortify 分进程 | OS 化样例（ADR-002 已否决其调度层，但 city 职责切分可参考） |
| KasamiBot | 房间模块 + 每房孵化队列 | 蝴蝶模板、房间订单、labmanager | 房间自治度高，帝国层管扩张/战争 |
| hivemind | room managers + empire 层 | bay/link-network 房间内自动化 | 房间结构与帝国结构分离的同构证据 |

**收敛点（≥5 家）**：房间拥有本地经济闭环；远矿/扩张/战争归上层。没有一家
用「静态 role 标签」管理房间——全部按 RCL/结构派生状态驱动行为。

## 6. Advantages（推荐模型的优势）

1. **故障域隔离**：单房经济崩溃被封闭在房间层，帝国只看到报告恶化并收缩
   该房预算，不会级联到其他房。
2. **CPU 可记账**：3–5 CPU/房的社区数据点让「按房分频 + 按房预算」有依据；
   room snapshot 一房一缓存，失效条件清晰。
3. **测试单元自然**：房间闭环 = 可注入的测试场景（给定 source/结构/威胁
   快照，验证闭环是否收敛）。
4. **派生 phase 零迁移债**：phase 由结构/RCL 实时推导（derived state），
   不写入 Memory 长期保存，结构被拆即自动降级，无状态漂移。

## 7. Disadvantages（代价）

- 房间↔帝国接口是新增契约：报告口径错了（如虚报产能），帝国决策被污染。
- 两级边界要持续维护：terminal 调拨、spawn、site 创建都必须明确 owner，
  否则出现「房间绕过帝国拿共享资源」的漏洞。
- 派生 phase 要求感知可靠：RoomSnapshot 缺结构（如房间不可见）时 phase
  判定必须保守，这需要额外的新鲜度标记。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 报告撒谎（产能虚高/风险漏报） | 帝国错误扩张/调拨 | 报告字段由实测统计（净能量流）而非意愿值生成；帝国层交叉核验 |
| 单房死亡螺旋（能量见底→孵化不出→更没能量） | 房间永久失能 | 紧急孵化车道（≥200 能量即 [WORK,CARRY,MOVE]，官方 <300 自回 1/tick 兜底，见 03 §10）；帝国输血通道 |
| phase 与现实漂移（标签说 mature，storage 已被拆） | 行为错配 | 裁决：phase 必须派生，见 §10.1 |
| 房间独占帝国资源（terminal 被本地抽干） | 帝国级物流失衡 | 跨房调拨只有帝国层写者（ADR-001/ADR-006） |
| 团灭后人口账本仍记存活 | census 失真→不补位 | census 每低频 tick 以 Game.creeps 实测重建（empire-architecture 心跳） |
| 灾后房按发展逻辑跑（先造 extension 后恢复采集） | 恢复期被拉长 | 恢复是独立 phase，出口条件=闭环健康，非 RCL |

## 9. CPU Implications

- 房间是分频（cadence）单位：快照/报告低频（如每 5–10 tick），闭环执行
  每 tick；3–5 CPU/房 × 房间数即预算下界，看门狗按此比例化（ADR-002）。
- 报告走瘦身数据（ID/枚举/少量数字），符合三级存储（ADR-010）：统计进
  heap 缓存，历史进 segment，Memory 只留 phase 枚举与关键 ID。
- 房间数增长时，唯一允许线性增长的是 per-room 系统循环；帝国层系统必须
  保持低频 + 增量（只处理有事件的房）。

## 10. Recommended Design

### 10.1 裁决：能力门槛 phase，而非静态 role 标签

**结论：房间分类用派生的能力 phase（bootstrap→…→peak，锚定 RCL 能力相变
点，细化见 [10_ROOM_DEVELOPMENT.md](10_ROOM_DEVELOPMENT.md)）；「GCL farm 房
/ 军事前哨」这类语义不是房间属性，而是帝国层 Agenda/Operation 的投资决策。**

论证：

1. **本体论**：房间的真实约束是「当前具备什么能力」（storage 有无、link 网
   有无、terminal 有无——03 §6 的相变点），而不是「帝国想让它当什么」。
   phase 由结构派生，与事实同源；role 标签是外部意图，需要单独维护一致性。
2. **状态维护代价**：role 标签写入 Memory 后必然漂移（结构被拆、灾后重生
   都让标签失真），漂移标签比没有标签更危险（行为错配）。派生 phase 每次
   从 RoomSnapshot 重算，结构损失即自动降级——**恢复路径不需要专门的标签
   迁移代码**。
3. **社区证据**：全部调研对象（§5）按 RCL/结构驱动房间行为，无一使用静态
   房间 role；「farm/temple 房」语义在社区里是玩家后期手动安排的投资选择，
   属于帝国层带预算与期限的承诺（ADR-003 的 Agenda），不该内化进房间。
4. **与 spine 一致**：ADR-001 要求帝国层拥有目标选择权——房间「将来当什么
   用」正是目标选择，收归帝国 Agenda；房间只如实报告「现在能什么」。

### 10.2 房间闭环清单（六个闭环，phase 出口=闭环健康）

| 闭环 | 核心指标 | 失效信号 |
| --- | --- | --- |
| 能量 | source 采空率、净能量流（产出−消耗） | source 满格未采、库存持续下降 |
| 人口 | census vs demand 缺口、关键角色空位 | 孵化队列饥饿、关键角色断档 |
| 物流 | 请求积压年龄、空载率（[12_LOGISTICS_SYSTEM.md](12_LOGISTICS_SYSTEM.md)） | source container 满、consumer 空 |
| 建造 | 队列进度、site 配额占用（[13_CONSTRUCTION_SYSTEM.md](13_CONSTRUCTION_SYSTEM.md)） | 工地长期无人施工 |
| 升级 | upgradeRate、controller.downgradeTime | downgrade 计时逼近 |
| 防御 | 威胁新鲜度、tower 能量、rampart 完整度 | 塔能量低于阈值无补给 |

### 10.3 房间↔帝国接口（Report / Request 契约）

- **报告（上行，低频聚合）**：phase 枚举、净能量流、source 利用率、人口
  缺口、库存水位（storage/terminal）、威胁等级与新鲜度、CPU 消耗、闭环
  健康位。全部为实测统计，不允许「意愿值」。
- **请求（上行，事件驱动）**：spawn 需求经唯一 Spawn Manager（
  [11_SPAWN_SYSTEM.md](11_SPAWN_SYSTEM.md)）；建造经两写者；资源缺口经
  terminal 均衡系统（[12_LOGISTICS_SYSTEM.md](12_LOGISTICS_SYSTEM.md)）；
  军事支援经 war-planner。房间不得直连任何跨房写路径。
- **下达（下行）**：帝国只下发带预算与期限的 Agenda/Operation（扩张、
  战争、GCL 投入）与 posture 允许集；不逐 creep 指令（ADR-001/003）。

### 10.4 Respawn 与灾后恢复路径

1. **官方兜底事实**（03 §10）：房间 spawn+extension 总能量 <300 时每 tick
   自回 1 能量——纯靠兜底回到 300 要 300+ tick，只能当最后保险，不能当
   恢复策略。
2. **恢复 = 独立 phase**：入口条件=闭环健康度低于阈值（人口 0 关键位、
   净流为负、结构缺失任一）；出口条件=六个闭环全部回到绿色并滞回确认，
   而非「RCL 够高」。恢复期：P0 车道优先孵化最小工作单元（≥200 能量即
   [WORK,CARRY,MOVE]），跳过一切发展性建造。
3. **借鉴 TooAngel universal 自举**：灾后若人口清零，第一只 creep 必须
   是「不依赖 storage/link/其他 creep 的全能采集-搬运单元」，保证能量
   底线后再分化角色。
4. **帝国侧联动**：恢复中的房间冻结对外输出（不被 terminal 均衡抽干），
   必要时母房跨房输血；输血是帝国 Agenda 决策，带止损线。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 静态房间 role 标签（farm/military/economic） | 与事实解耦必漂移；无人维护的标签比没有更危险；把帝国投资决策错放进房间层（§10.1） |
| 房间全自治（各自 terminal 交易、各自扩张） | 无仲裁者的共享资源竞争死锁；ADR-001 裁决的 A 选项，社区零先例 |
| 无房间层（帝国平铺管全部 creep） | CPU 与信息带宽不可承受；3–5 CPU/房的记账单元消失 |
| 以 GCL/RCL 数字均匀分级驱动行为 | 忽略能力相变点（storage RCL4、link RCL5、terminal RCL6），03 §6 已裁决 |

## 12. Open Questions

1. 房间报告的聚合窗口多长（5/10/20 tick）才能同时满足帝国决策新鲜度与
   CPU 预算？需 soak 数据。
2. remote 矿房是否算「房间」？（当前裁决：不算——远矿房是母房 Operation
   的属地，无 controller 闭环，不进房间层；是否需要独立 RemoteRoomState
   留待远矿文档裁决。）
3. 房间 phase 与 posture 的交互矩阵（war posture 下 mature 房间的升级预算
   让位规则）需要与战略文档联合冻结。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://jonwinsley.com/notes/screeps-room-planning | 开发者笔记 | Franchise+HQ 模块化房间规划；「CPU>能源>防御」排序；Architect 低频生成布局 | CONFIRMED（2026-08-22 复核） |
| https://wiki.screepspl.us/Great_Filters | 社区 wiki | 发展过滤器阶梯；工地全局上限 100；冷启动失败为高频死因 | CONFIRMED |
| https://wiki.screepspl.us/Maturity_Matrix | 社区 wiki | 房间成熟度阶梯（drop→container→remote→SK） | CONFIRMED |
| Bot 源码调研摘要 2026-08-22（Overmind/TooAngel/TI/Quorum/KasamiBot/hivemind，见 RESEARCH_SOURCES.md） | 源码 | ≥5 家房间/帝国两级收敛；零静态房间 role | CONFIRMED |
| 03_SCREEPS_GAME_CONSTRAINTS.md §6/§10 | 官方事实 | RCL 相变点；能量 <300 自回 1/tick；container 任意 RCL | CONFIRMED |
| CPU/房数据点（screeps forum 2381、Reddit 5l1nvz） | 社区 | 普通房 3–5 CPU、remote 房 ~1 CPU | LIKELY |
