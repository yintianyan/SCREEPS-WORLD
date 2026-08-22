# CONSTRUCTION_ARCHITECTURE · 建造与布局架构（冻结蓝图）

> 本文件是**建造与布局契约**：布局三流派裁决、八个概念、site 唯一写者与配额、
> 建造优先序、冲突处理、min-cut 固化与 phase 接口以此为准。结构性修订必须走
> ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，
> 不得静默修改。依据：research/13（核心裁决）、research/03 §6/§8（RCL 门禁 /
> 战斗数值）；权力归属见 [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md)
> §1「建造签发」行；模块八项见 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.8。

## 1. 总裁决：布局是版本化数据，不是计算结果

| 条款 | 内容 |
| --- | --- |
| 裁决 | 布局 = **静态版本化数据**（模板 + Stamp 组合 + 锚点），**不是**任何运行时组件的输出——系统不存在 Planner 组件（[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §1）。静态蓝图**仅当**通过约束适配校验（§2 Constraint 行）后才允许落位。 |
| 论据 | 存活证据不对称：模板阵营（KasamiBot/Overmind/TooAngel）长期存活、纯算法生成阵营（Quorum/bonzAI）停更或实验化（research/13 §5）；可审计可迁移、防御可预期、CPU 恒定（research/13 §6）。 |
| 动态保留 | 动态成分**仅**两处：道路（交通热度）与局部让位（blocked 标记）——「主结构定、道路活」（research/13 §10.1）。 |
| 禁止 | 在线逐房算法生成主布局；在线运行 min-cut 图算法；预铺全房道路；「RCL 解锁即全放 site」（research/13 §11，全数否决）。 |

## 2. 八概念合同

| 概念 | 是什么（必须语义） | 禁止 |
| --- | --- | --- |
| **Blueprint（蓝图）** | 静态版本化数据：模板 + Stamp 组合 + 锚点（controller/storage）+ 版本对（`templateId` + `layout.version`）；**必须**通过约束适配校验（地形 / 资源位 / 冲突检测，domain 纯函数）才可落位；版本化与迁移义务见 §2.1 | 作为 Planner 输出存在；无版本号的布局数据；跳过适配校验落位 |
| **Terrain（地形）** | 适配**输入**：沼泽权重、出口分布、墙；静态全量数据（`getRoomTerrain` 无需房间可见，research/14 §4），TTL=∞，可离线 dump | 为地形建立持续刷新通道；把地形计入 intel 采集预算 |
| **Constraint（约束）** | 不可违反边界清单：RCL 门禁（结构解锁表，research/03 §6）、结构间距、source–controller 距离、防御覆盖（tower ≤5 格满效，research/03 §8）；适配校验 = Blueprint×Terrain×Constraint → 可落位判定（纯函数，禁止 Game/Memory 引用） | 签发违反约束清单的 site；约束规则散落在执行层各处 |
| **Stamp（图章）** | 模块化建筑组：核心区（bunker 核心）、能源点（source 位/container/link）、防御圈（tower/rampart 位，含离线 min-cut 部件）；支持旋转 / 平移 / 变体的**有限枚举**组合 | Stamp 内嵌运行时逻辑；无变体枚举的死模板（冲突时只能硬砸或放弃） |
| **Road（道路）** | **交通热度驱动**：实测通行计数达阈值**逐段**添加；热度计数寄生 RoomSnapshot 增量（heap）+ 周期聚合落 segment（§2.2） | 预铺全房；按蓝图预设路网；热度不达标段签发 |
| **Structure（结构）** | 建造优先序表（§4.1）承载的排序语义；结构世界对象的建造侧动作由唯一写者封装（§3） | 角色层 / 房间层直接 `createConstructionSite` |
| **ConstructionPlan（建造计划）** | phase 驱动的推进队列：RCL 相变事件触发**增量**规划；队列化执行（完成一个再放一个——工地可被敌意 creep 踩毁，research/13 §4）；建造 Demand 由房间稳态与 AgendaItem 共同声明，无独立 Plan 对象（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §1.3） | 一次性放出全量 site；每 tick 重算队列；Plan 独立实例化 |
| **ConstructionTask（建造任务）** | builder 认领的 Task 租约形态（六态：offered→claimed→succeeded/failed/expired/cancelled）；工地年龄监控，超龄回收重排（research/13 §8） | 无租约的「顺手建造」；烂尾工地永久占配额 |

### 2.1 Blueprint 版本化与迁移义务

| 条款 | 内容 |
| --- | --- |
| 版本递增 | 模板任何改动（Stamp 变体 / 锚点规则 / min-cut 部件 / 参数）**必须**递增 `templateId`（结构性变更）或 `layout.version`（参数性变更），并写迁移用例与离线渲染断言（tower 覆盖 / rampart 连续性 / spawn 出口，research/13 §6、§10.2）。 |
| 老房迁移 | **不重构**：已建成结构一律不动；新版本只对「未建且新版本有变化」的位置生效；与既成事实冲突的新规划标 `blocked` 等待裁决（research/13 §10.2）。 |
| 评审红线 | 改模板不递增版本 = 蓝图漂移（research/13 §8），立即否决。 |

### 2.2 Road 热度合同

| 条款 | 内容 |
| --- | --- |
| 签发条件 | 每格实测通行计数 ≥ 阈值才允许放 road site，**逐段**添加，绝不预铺（research/13 §10.5）。 |
| 阈值初值 | 主干 200 / 支线 500 次通行——SPECULATION 初值，soak 校准（research/13 §12；[RESEARCH_SYNTHESIS.md](RESEARCH_SYNTHESIS.md) §2）。 |
| 持久化 | 热度周期聚合落 segment，global reset 不丢长期热度（research/13 §10.5）。 |
| 回收 | 不在实测路径上的存量道路低频分批回收；拆除期**必须**保证不断主干（research/13 §10.5，LIKELY 先例）。 |

## 3. site 唯一写者合同

| 条款 | 内容 |
| --- | --- |
| 唯二写者 | `createConstructionSite` 全系统**仅**两个合法调用点：ConstructionManager（自有房）+ RemoteMiningManager（远矿房）（research/13 §10.3；AGENTS.md）。 |
| 角色层 | 角色**只**写申请标记（如 `needContainer`）；申请标记的唯一消费者是 ConstructionManager（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.8）。 |
| 全局上限 | 官方硬上限 100 site/玩家（ERR_FULL，research/13 §4）；自治 `CONFIG.construction.maxGlobalSites` **必须**留安全余量（初值 ≤80，SPECULATION）。 |
| 每房配额 | 每房至多 3 normal + 2 road + 1 critical（research/13 §10.4）。 |
| 跨房优先序 | 自有房 emergency site **优先于**远矿 site；配额竞争时远矿让路（research/13 §10.3）。 |
| 节奏 | 常规推进每 10–50 tick（P2 档：Guarded 降频、Conserve 暂停）；emergency site 事件式签发，不受分频约束（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.8；[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2.2）。 |

## 4. 建造优先序与 phase 接口

### 4.1 Structure 建造优先序表

| 序 | 类别 | 例 | 配额类 |
| --- | --- | --- | --- |
| 1 | emergency（灾后恢复） | storage/tower/spawn 重建 | critical（≤1/房） |
| 2 | 核心结构 | storage/link/terminal/tower/spawn | normal（≤3/房） |
| 3 | 配套 | extension/container/lab/factory 等 | normal |
| 4 | 道路 | 热度达标段 | road（≤2/房） |

优先序为 emergency > 核心结构 > 配套 > 道路（research/13 §10.4 的裁决方向；
配套类为其枚举展开）。

### 4.2 建造与 phase 推进的接口

| 条款 | 内容 |
| --- | --- |
| 触发 | phase 判定归 World Model（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.2）；RCL 相变（新结构解锁，research/03 §6）= 事件，触发 ConstructionManager 对该房做**增量**规划（只规划新增解锁位，正常 tick 零规划成本，research/13 §9）。 |
| 门禁 | 解锁 ≠ 开建：site 签发还须过房间建造预算与全局 / 每房配额（「解锁即建」被否决，research/13 §11）。 |
| 上游 | 建造 Demand 由房间稳态缺口与 AgendaItem（殖民自举 / 重建）共同声明；builder 人口缺口走 SpawnManager 车道（[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §2）。 |
| 下游 | 完工 / 烂尾 outcome 必有回执，禁止静默丢单（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §2 环节 7）。 |

## 5. 冲突处理合同

| 条款 | 内容 |
| --- | --- |
| 适配次序 | 冲突时依次尝试：旋转 → 平移 → 换 Stamp 变体（research/13 §10.6）。 |
| blocked | 适配仍冲突 → 标 `blocked`（Memory 短记录），**不静默丢弃、不自动拆改已建成核心结构**（research/13 §10.6）。 |
| 拆改例外 | 拆解仅限人工或 AgendaItem 显式授权；敌方 blocker 的 structurer 型拆除走显式任务（预算 + 期限），与战争授权链一致（research/13 §10.6；[MILITARY_ARCHITECTURE.md](MILITARY_ARCHITECTURE.md) §1）。 |
| 上浮 | blocked 清单进房间 Report，由帝国层或人工裁决消化（research/13 §10.6）。 |
| 新房适配 | 新房进场先跑全套适配校验；失败记入扩张评分扣分（喂 [EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §2 的 layoutFitness 因子，research/13 §10.2）。 |

## 6. min-cut rampart 离线固化

| 条款 | 内容 |
| --- | --- |
| 固化 | 防线位置由 min-cut（最大流最小割）工具**离线**对模板生成，作为 Stamp/Blueprint 部件版本化固化；**禁止**在线运行图算法（research/15 §10.6/§11；research/13 §11）。 |
| 线上职责 | 仅维护（修复 / 加固批处理）与冲突标记；加固目标值按威胁态分级（归 [DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) §6）。 |
| 分层 | 外圈 min-cut rampart + 关键结构内圈的双层纵深（KasamiBot 先例，research/15 §5）。 |
| 换版 | 防线调整 = 模板改动，走 §2.1 版本递增与迁移义务。 |

## 7. 失败模式防线表

| 失败模式 | 后果 | 防线（本蓝图条款） |
| --- | --- | --- |
| site 配额被道路占满 | 紧急建造放不出 | 全局上限 + 每房分类限额 + 道路最低优先序（§3/§4.1；research/13 §8） |
| 敌意 creep 踩毁工地 | 进度清零、能量损失 | 队列化执行（§2 ConstructionPlan）；战区房建期 rampart（[EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) §4） |
| 模板与地形冲突硬砸 | 核心结构缺位 | 适配次序旋转→平移→换变体，仍冲突标 blocked 不静默丢弃（§5） |
| 新旧蓝图漂移 | 老房半新半旧不可推理 | 版本强制递增 + 迁移用例（§2.1，评审红线） |
| 自动拆改既有结构 | 战时自毁防线 / 经济中断 | 核心结构建成后只标 blocked，拆改仅限显式授权（§5） |
| 建造无人施工 | 工地占配额烂尾 | ConstructionTask 租约 + 工地年龄监控超龄回收（§2） |
| 敌方 blocker 压住规划位 | 布局永久缺口 | structurer 型拆除走显式任务（预算 + 期限），与战争授权链一致（§5） |

## 8. 与其他契约的关系

| 契约 | 分工 |
| --- | --- |
| [DEFENSE_ARCHITECTURE.md](DEFENSE_ARCHITECTURE.md) | 威胁态驱动的加固目标值、建期 rampart 护工地、威胁期暂停非关键 site |
| [EXPANSION_ARCHITECTURE.md](EXPANSION_ARCHITECTURE.md) | layoutFitness 因子消费、殖民建期 rampart 需求 |
| [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.8 / [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) | 模块八项、建造队列 / 热度计数所有权 |
| [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2.2 | P2 档位与降级行为（Guarded 降频 / Conserve 暂停） |
