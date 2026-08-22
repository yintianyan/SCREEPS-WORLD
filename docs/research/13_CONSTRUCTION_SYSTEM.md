# 13 · 建造系统（Construction System）

> 研究文档 · 结论等级：**设计裁决**（三流派对照 + 官方限额核查 + 存活 bot
> 证据）。机制事实以
> [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §6 为基准；
> 总裁决见 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-007。
> 核查日：2026-08-22。

## 1. Problem

布局（layout）是房间的物理形态：一旦核心结构落地，改动成本极高（拆解慢、
阻断经济、战时暴露）。同时 site（工地）是稀缺资源——全局每玩家 100 个上限
（官方确认，见 §4），错误地铺路可以饿死紧急建造。本文裁决：布局生成三流派
（固定模板 / 算法生成 / 模板+适配）的选择、蓝图的版本化与迁移、site 配额
与优先级、道路的证据化铺设、冲突处理。

## 2. Research Questions

1. 固定模板、逐房算法生成、模板+局部适配三流派各自的存活证据与代价？
2. 蓝图如何版本化？老房间如何迁移而不停摆？
3. 全局 100 site 上限下，配额与优先级如何分配？
4. 道路什么时候铺？「绝不预铺全房」的证据是什么？
5. 结构冲突（地形/既有建筑/敌对障碍）如何处理？

## 3. Existing Solutions（方法论参照）

ADR-007 裁决总纲（本文以独立论证呈现）：版本化蓝图模板（stamp 组合）+
低频局部适配 + 队列化执行；模板改动必须递增版本并写迁移；核心结构建成后
冲突只标 blocked 不自动拆改；道路依据实测交通热度逐段添加；site 创建仅两
个写者。strategy-playbook 补充约束：布局是约束问题——地形、source、
controller、矿物、spawn 出口、道路、储存、未来结构、防御与重建成本一起
评分；模板只能提供候选，不可绕过验证。

## 4. Screeps Community Practice

- **全局 site 上限 = 每玩家 100**（超限返回 ERR_FULL「The maximum number
  of construction sites per player is 100」，官方 API 文档；forum 2177 讨论
  「自动化放置后 100 够用」）。—— 2026-08-22 复核 CONFIRMED。
- **工地会被敌意 creep 踩毁**（screeps.fandom Construction site 词条）：
  社区因此普遍采用队列化——规划先存 Memory，完成一个再放一个。这也解释
  了新殖民地建期间用 rampart 保护工地的实践（Reddit lzxzu1）。
- **道路沿实测路径**：TooAngel 明确「寻路时忽略沼泽，因为道路会随 creep
  实际行走自动生成」，且不在实测路径上的道路会被拆除（调研摘要；
  BaseBuilding.md 复核确认道路自动生成部分 CONFIRMED，拆除细节源自源码
  调研摘要 LIKELY）。
- **建筑位置预规划**：社区主流把全部结构位置离线/一次性规划好缓存（如
  jonwinsley 的 Architect 压缩表示进 Memory，每 n tick 检查缺口提交
  BuildRequest）——与「解锁即现场找位置」相对。

## 5. Existing Bot Analysis

| Bot | 布局流派 | 机制细节 | 存活状态 |
| --- | --- | --- | --- |
| KasamiBot | 固定模板 | 蝴蝶形 7×7 核心+双翼；模板按 RCL 推进 | 长期存活、文档详尽 |
| Overmind | 固定模板（bunker 系） | wiki 专文「Bunkers」；紧凑半径换取 tower 满效覆盖（≤5 格，03 §8） | 顶级战绩 |
| TooAngel | 半动态 | 锚链定位（controller 旁 upgrader→storage→filler→pathStart）+沿最长路径摆结构+道路随行走生成；预计算路径内位置改 rampart | 十年无人值守 |
| The International | 算法辅助 | neuralNetwork 按交通流规划道路 | 现役 |
| Quorum | 算法生成 | city 进程 layout；距离变换类算法 | 停更（2021） |
| bonzAI | 算法生成 | AutoOperation 自动基地规划 | 实验性质 |

**裁决性对照**：固定/半动态阵营全部长期存活且防御可预期；纯算法生成阵营
（Quorum/bonzAI）停更或实验化。但 TooAngel/TI 也证明「纯死模板」并非上限
——它们保留动态成分（路径/交通），只是不在线上重算主布局。

## 6. Advantages（模板+适配的优势）

1. **可审计可迁移**：布局=版本化数据（templateId/layout.version），diff
   可读、变更可评审、老房间可写迁移——算法生成的布局每次不同，无法回归。
2. **防御可预期**：bunker 式紧凑布局的 tower 覆盖（≤5 格满效、5→20 格线性
   衰减至 25%，03 §8）与 rampart 包覆是已知抗性；战斗验证可复用。
3. **CPU 恒定**：适配只在低频事件（新房进场、RCL 相变、blocked 出现）触发，
   每 tick 建造成本只剩队列维护。
4. **保留地形弹性**：stamp（图章）+旋转+平移+局部让位（blocked 标记）
   处理沼泽/墙皮/source 位置差异，不至于死模板硬砸。

## 7. Disadvantages（代价）

- 极端地形（双 source 贴边、controller 居角落）适配质量低于算法生成：
  接受损失（这类房间本来价值也低，扩张评分时扣分——ADR-008）。
- 模板版本化纪律是长期税：每次改动必须递增版本+写迁移+测试，否则老房间
  蓝图漂移。
- 局部适配逻辑（让位/旋转选择）本身是要测试的状态机。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| site 配额被道路占满 | 紧急建造（灾后 storage/tower）放不出 | 全局 maxGlobalSites 上限 + 每房分类限额 + 道路低优先级（§10.4） |
| 敌意 creep 踩毁工地 | 建造进度清零、能量损失 | 战区房建期间 rampart 保护（殖民先例）；威胁期暂停非关键 site |
| 模板与地形冲突硬砸 | 核心结构缺位 | 适配校验：stamp 摆不下→旋转/平移→仍冲突标 blocked，不静默丢弃 |
| 新旧蓝图漂移（改模板不改版本） | 老房间半新半旧不可推理 | templateId/version 强制递增+迁移测试（ADR-007 纪律） |
| 自动拆改既有结构 | 战时自毁防线/经济中断 | 核心结构建成后只标 blocked，拆解仅限人工/Agenda 显式授权 |
| 建造无人施工（builder 缺位或能量断） | 工地占着配额烂尾 | 工地年龄监控进房间建造闭环（09 §10.2）；超龄回收重排 |
| 敌方 blocker 压住规划位 | 布局永久缺口 | structurer 型拆除走显式任务（TooAngel 同款），带预算与期限 |

## 9. CPU Implications

- 布局规划低频事件化：新房进场一次适配、RCL 相变一次增量、blocked 一次
  重试——正常 tick 零规划成本（jonwinsley「每 n tick 检查缺口」同构）。
- **交通热度统计是增量累计**：RoomSnapshot 内每格计数器累加（可放 heap，
  周期性聚合），不做独立扫描。
- 队列执行每 tick O(工地数)，配合每房 3+2+1 限额后很小；全局上限与 100
  官方上限之间留安全余量（§10.4）。

## 10. Recommended Design

### 10.1 三流派裁决：版本化模板 + 约束适配（拒绝纯算法生成主布局）

论证（独立于 ADR-007 的证据链）：

1. **存活证据不对称**（§5）：模板阵营（KasamiBot/Overmind/TooAngel）全部
   长期存活；算法阵营（Quorum/bonzAI）停更或实验。自治框架的第一目标是
   「长期不出错」，布局是慢变量、错一次伤一房——可审计性压倒最优性。
2. **测试性**：模板=数据可离线渲染断言（tower 覆盖、rampart 连续性、
   spawn 出口）；算法布局需要场景回放才能验证，回归成本高一个量级。
3. **动态部分保留给真正受益动态的地方**：道路（交通热度）与局部让位
   （blocked）——这正是 TooAngel/TI 的实践形态：主结构定、道路活。

### 10.2 版本化蓝图与迁移

- 蓝图 = stamp 组合 + 锚点（controller/storage 为锚）+ 版本号
  （templateId + layout.version）。改动必须递增版本并写迁移用例。
- 老房间迁移不重构：已建成结构不动，只对「未建且新版本有变化」的位置
   生效；与旧版本冲突的新规划标 blocked 等待人工/Agenda 决策。
- 新房进场先跑适配校验（旋转/平移枚举 + 地形评分），失败则扩张评分
   扣分（喂给 ADR-008 的候选评估）。

### 10.3 两写者与角色层边界

- site 创建仅两个写者：自有房 construction-manager + 远矿房
  remote-mining-manager；角色层只写申请标记（如 needContainer）。
- 自有房 emergency site 优先于远矿 site（配额竞争时远矿让路）。

### 10.4 site 配额与优先级

- 官方硬上限：全局每玩家 100（ERR_FULL）。自治配置：全局
  `maxGlobalSites` 留安全余量（如 ≤80），每房最多 3 normal + 2 road +
  1 critical。
- 优先级：emergency（灾后恢复结构）> 核心结构（storage/link/terminal/
  tower/spawn）> 道路（热度达标段）。TooAngel 式限流先例：全局 100、
  每房同时 1 个非道路 site、一次只造 1 个 spawn——本设计限额更宽但同向。

### 10.5 交通热度铺路

- 每格热度累计（RoomSnapshot 增量），超过阈值（N 次通行）才放 road site，
  逐段添加，绝不预铺全房；TooAngel「道路随实测行走生成」与 TI
  neuralNetwork 按交通流规划同源。
- 热度数据周期聚合落 segment（ADR-010），重启不丢长期热度。
- 不在实测路径上的存量道路可回收（TooAngel 行为，LIKELY）：低频评估、
  分批拆除，拆除期保证不断主干。

### 10.6 冲突处理

- 地形/既有建筑冲突：先适配（旋转/平移/换 stamp 变体），仍冲突标
  `blocked`（写 Memory 短记录），**不自动拆改已建成核心结构**。
- 敌方 blocker：structurer 型拆除走显式任务（预算+期限），与战争授权链
  一致（ADR-009：军事目标由 war-planner 唯一授权）。
- blocked 清单进房间报告（09 §10.3），由帝国层或人工裁决消化。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 逐房算法生成主布局 | 存活证据反差（§5）；不可审计、回归成本高；Quorum/bonzAI 双双停更/实验化 |
| 预铺全房道路 | 饿死 site 配额（100 全局上限）；社区队列化实践反向证明；热量证据不支持 |
| 自动拆改重建（对齐新模板） | 战时自毁+经济中断；ADR-007 明令；只标 blocked |
| 解锁即建（RCL 一到全放 site） | 能量摊薄（10 号文档 §8）；必须过 phase 门+预算 |
| 角色层/房间层自由 createConstructionSite | 多写者竞态+配额失控；两写者纪律（AGENTS 硬约束同源） |

## 12. Open Questions

1. 道路热度阈值 N 的取值与分档（主干 vs 支线）需 soak 校准；初值建议
   主干 200 次通行、支线 500 次（纯经验初值，SPECULATION）。
2. stamp 变体集要覆盖多少类地形（source 贴边/居中、controller 角落）
   才能让适配成功率 >95%？需要离线统计真实地图样本。
3. 存量坏路回收的节奏与断主干风险：倾向「拆一段验证一段」，具体窗口
   待定。
4. remote 房的布局（container/road/rampart）是否复用同一蓝图机制还是独立
   轻量模板？倾向后者（无 controller 闭环），与远矿文档联合裁决。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://docs.screeps.com/api/（createConstructionSite 错误码） | 官方 | 全局每玩家 100 site 上限（ERR_FULL） | CONFIRMED（2026-08-22 复核） |
| http://screeps.com/forum/topic/2177/up-the-construction-site-cap | 论坛 | 社区确认 100 上限与队列化实践 | CONFIRMED |
| https://screeps.fandom.com/wiki/Construction_site | 社区 wiki | 敌意 creep 踩毁工地→玩家普遍队列化 | LIKELY |
| https://github.com/TooAngel/screeps/blob/master/doc/BaseBuilding.md | 源码文档 | 锚链定位、预计算路径、沿路径摆结构、沼泽忽略因道路随行走生成、路径位改 rampart | CONFIRMED（2026-08-22 复核） |
| https://www.reddit.com/r/screeps/comments/lzxzu1/ | 社区 | 新殖民地 rampart 保护工地 | LIKELY |
| https://github.com/bencbartlett/Overmind（wiki「Bunkers」） | 源码/wiki | bunker 布局与 tower 覆盖设计 | CONFIRMED |
| Bot 调研摘要 2026-08-22（KasamiBot 蝴蝶模板/TI neuralNetwork 道路/Quorum 距离变换/bonzAI AutoOperation） | 源码 | 三流派存活状态不对称 | CONFIRMED |
| 03_SCREEPS_GAME_CONSTRAINTS.md §6/§8 | 官方事实 | RCL 结构解锁表；tower 衰减（防御布局依据） | CONFIRMED |
