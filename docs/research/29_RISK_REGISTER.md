# 29 · 风险登记册（RISK REGISTER）

> 研究文档 · 结论等级：**决策已定**。概率/影响为研究判断（SPECULATION 级），缓解
> 措施均有证据或先例支撑。评审节奏：每次红队/阶段验收后更新。

## 1. 风险总览

| ID | 类别 | 风险 | 概率 | 影响 | 预警信号 |
| --- | --- | --- | --- | --- | --- |
| R-01 | 经济 | CPU 死亡循环：超限→吸干 bucket→停机→creep 全灭 | 高 | 致命 | bucket 连续下滑、Recovery 档频繁 |
| R-02 | 经济 | 能量饥饿：物流断链→spawn 停摆→人口崩塌 | 中 | 致命 | spawn idle、能量净流转负、hauler 空载率异常 |
| R-03 | 经济 | 过度扩张掏空本土（远矿/殖民输血过量） | 中 | 高 | 本土净流转负、扩张门控指标红灯 |
| R-04 | 规划 | 姿态抖动：peace/war 快速振荡 | 中 | 高 | posture 切换频率遥测 |
| R-05 | 规划 | 议程饥饿：低优先级 Agenda 永不执行 | 中 | 中 | Agenda 年龄分布 |
| R-06 | 执行 | creep 卡死/重复无效 intent（0.2 CPU/次白费） | 高 | 中 | 卡位告警、失败 intent 计数 |
| R-07 | 执行 | spawn 队列死锁（黑名单+能量不足叠加） | 低 | 高 | 队列深度、P0 车道延迟 |
| R-08 | 帝国 | 围城耗能破防（社区头号破防手段） | 中 | 高 | tower/storage 能量曲线、威胁分级持续 siege |
| R-09 | 帝国 | safemode 误用（每 shard 限一房+拦不住 nuke） | 低 | 高 | safemode 决策日志 |
| R-10 | 架构 | Memory 膨胀（体积即每 tick 税） | 中 | 高 | Memory 体积趋势、stringify 耗时 |
| R-11 | 架构 | global reset 后 heap 重建风暴（一次性高 CPU） | 高 | 中 | reset 后首 tick CPU 峰值 |
| R-12 | 架构 | 写者越权（角色层直发 spawn/site 请求） | 中 | 高 | 静态检查 + 运行时断言 |
| R-13 | 架构 | 模块耦合回潮（系统间运行时 import） | 中 | 中 | 依赖图审查 |
| R-14 | 外部 | 游戏机制变更（官方改常量/API） | 低 | 中 | 引擎常量 diff 监测 |
| R-15 | 外部 | 恶意 PvP（宿敌针对性打法、诱饵 exploiting） | 中 | 高 | 战争账本异常、黑名单命中 |
| R-16 | 规划 | 冷启动失败：代码只会运营不会拓荒 | 中 | 高 | 新殖民地自举超时 |
| R-17 | 经济 | 市场误操作（重复订单/运费倒挂） | 低 | 中 | 订单幂等审计、套利净利核算 |
| R-18 | 规划 | 调参震荡（演化闭环参数来回改） | 中 | 中 | 参数变更频率遥测 |

## 2. 高风险详解与缓解

### R-01 CPU 死亡循环（帝国头号死因，社区多起 CONFIRMED 案例）
- **缓解链**：四档看门狗比例化降级（P3 远矿/建造先砍→P2 发展限流→P1 只保核心
  经济→P0 spawn 恢复与防御永不砍）；恢复走滞回防抖动；bucket 保底不用于 pixel。
- **兜底**：官方事实——房间 spawn+extension 总能量 <300 时每 tick 自回 1 能量，
  灾后最小重建在数学上总是可行；紧急车道 ≥200 能量 [WORK,CARRY,MOVE]。
- **验证**：故障注入——人工把 bucket 压到 Recovery，观察降级顺序与恢复 MTTR。

### R-02 能量饥饿
- **缓解**：能量收支核算（净流/储备/预算三指标）先于一切发展决策（A2 门槛）；
  container 缓冲兜底断链；低能量注入场景纳入验收（见 [27_IMPLEMENTATION_ROADMAP.md](27_IMPLEMENTATION_ROADMAP.md) P3）。

### R-03 过度扩张
- **缓解**：扩张 = 投资决策（ADR-008）：评分 + 资源门控（指数平滑 CPU/heap/memory
  指标 + 本土净流为正 + 运输余量 + 可撤离）；TooAngel 十年无人值守先例。

### R-08 围城耗能
- **缓解**：能量会计进防御状态机（siege 姿态下能量配给优先 tower 与 spawn）；
  min-cut rampart 降低受击面；safemode 触发惯例（spawn<50% 血量/敌贴建筑）；
  nuke 语义（厚 rampart + 50k tick 内移走资产）。

### R-11 global reset 重建风暴
- **缓解**：heap 缓存全部带 TTL 与「懒重建」语义（首个使用者重建，不用 tick 1
  全量重建）；重建路径有单测；reset 后首 tick 允许超均值 CPU（tickLimit 有 500
  bucket 余量，官方事实）。

### R-15 恶意 PvP
- **缓解**：止损链不可绕过（ADR-009）+ 黑名单冷却 + 战后只信新鲜 intel；
  「代码存在≠战争开始」的授权链防诱饵消耗。

### R-16 冷启动失败
- **缓解**：殖民自举是一等公民车道（P7）：殖民 creep 落地自续命（bonzAI/KasamiBot
  先例）+ 母房 5000 能量输血计划 + 工地 rampart 保护 + 失败降级为 remote/放弃。

## 3. 风险 ↔ 架构防线映射

| 防线 | 覆盖风险 |
| --- | --- |
| 四档看门狗 + 降级链 | R-01 R-03 R-11 |
| 唯一写者 + 幂等键 | R-07 R-12 R-17 |
| 能量收支核算 | R-02 R-03 R-08 |
| posture 滞回 + 止损链 | R-04 R-15 |
| Agenda 饥饿老化 | R-05 |
| 交通仲裁 + 卡位自愈 | R-06 |
| 三级存储 + 体积预算 | R-10 |
| 静态依赖审查 + 断言 | R-12 R-13 |
| 引擎常量 diff 监测 | R-14 |
| 殖民自举车道 | R-16 |
| 演化闭环调参护栏（窗口+canary+回滚） | R-18 |

## 4. 残余风险声明（研究诚实的边界）

- 概率/影响评级是 SPECULATION 级判断，需首个长期 soak 用真实数据回填（A5）。
- 「宿敌针对性打法」的对抗演化无法靠静态防线穷尽——依赖战争账本的事后复盘闭环。
- 官方机制变更（R-14）无法预防，只能缩短检测-适配周期（常量 diff + 版本化迁移）。

## 5. Evidence / Sources

| 来源 | 用途 | 置信度 |
| --- | --- | --- |
| 社区 overnight collapse 案例（reddit 8mowvu、forum 1405） | R-01 | CONFIRMED |
| 围城耗能战例（reddit 55aapi） | R-08 | CONFIRMED |
| safemode 约束（官方常量 + wiki/StructureController） | R-09 | CONFIRMED |
| 0.2 CPU/intent 失败也收费（wiki/CPU） | R-06 | CONFIRMED |
| respawn/bootstrap 失败共性（多帖归纳） | R-16 | LIKELY |
| 其余评级 | 研究判断 | SPECULATION |
