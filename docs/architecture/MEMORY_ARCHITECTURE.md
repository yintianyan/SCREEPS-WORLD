# MEMORY_ARCHITECTURE · 存储架构（冻结蓝图）

> 本文件是**存储契约**：三级存储准入、Memory schema 规范、幂等迁移五步、heap 缓存、
> segment 分配、体积预算与禁止清单以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15，不得静默修改。依据：
> research/18（核心）、research/03 §4、红队 A6；状态字段级所有权（谁写谁读）以
> [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3 总表为准，本文管**层**的
> 纪律；迁移的触发与 kernel 启动序关系见 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md)
> §1/§7。

## 1. 三级存储合同

准入判据与 [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §2 完全一致
（依据 research/18 §10.1）：

| 层 | 准入（仅当满足才允许进入） | 禁止进入 | 失效条件 |
| --- | --- | --- | --- |
| **Memory**（版本化真相） | 跨 tick 必须存活的**决策状态**：ID、枚举、少量数字、短 key | 完整路径、运行时索引、历史日志、对象引用、长字符串 | 显式删除或迁移；**永不被 heap 依赖** |
| **heap/global**（可重建缓存） | 丢失后可从 Memory + Game 重建的派生索引、快照、路径、累加器 | 任何「丢了就无法重建」的状态 | TTL 到期 / 结构版本变化 / global reset（随时发生） |
| **RawMemory segment**（冷数据） | 低频写、低频读的档案：intel、遥测聚合、战争账本、市场档案 | 生存决策的当前值；高频写数据 | 各类自带 TTL + 容量上限；分页轮换 |

一句话判据：**Memory 答「帝国决定过什么」，heap 答「帝国这 tick 算得快不快」，
segment 答「帝国记住了什么」**（research/18 §10.1）。

硬条款：

1. 生存链路（P0）只依赖 Memory + Game 对象，heap 仅加速——reset 后第一 tick 帝国
   可运行（慢）是设计不变量（research/22 §10.4）。
2. 一个字段进哪一层由准入判据唯一裁决；两个系统对同一字段归属有分歧时走 ADR，
   **禁止**「两边都存一份」的双写调和。
3. 机制事实约束：Memory 每 tick 付 parse/stringify 线性税；global「会被相当规律地
   重置」；segment 100 段 ×100KB、每 tick 激活上限 10 段、异步（本 tick 请求下 tick
   可读）、foreign segment 同时仅 1 个（research/03 §4）。

## 2. Memory schema 规范

| 条款 | 内容 |
| --- | --- |
| 单一真相源 | TypeScript 类型 + `schemaVersion` 常量同处一文件；运行时以 `CONFIG.memory` 为单一真相源，本文任何数字仅为快照（AGENTS.md）。 |
| 三件套纪律 | 新增字段必须同时改三处：类型定义、默认值工厂、迁移步骤——缺一即视为未完成，不予合并。 |
| 值类型白名单 | 短 string / number / boolean / 枚举 / ID 引用 / 浅层数组。深层嵌套对象与路径结构一律拒绝；RoomPosition 拍平为 `roomName+x+y` 复合短 key（research/18 §10.2）。 |
| 字段纪律 | 每个字段的 Owner/Reader/Lifecycle/Persistence/Frequency 六列登记入 [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3；未登记字段不得写入。 |

## 3. 幂等迁移五步合同

每次结构变更升 `schemaVersion`；迁移函数注册为 `n → n+1` 链，**禁止**跨版本跳跃
（v1→v5 必须依次执行 4 步）。五步缺一即违规（research/18 §10.3；红队 A6）：

| # | 步骤 | 合同 |
| --- | --- | --- |
| 1 | **先写新、验证、后删旧** | 顺序铁律：写新字段 → 读到有效值 → 才删旧字段；任何一步失败保持旧 `schemaVersion`，下 tick 重试。禁止先删后写（中断即永久丢数据）。 |
| 2 | **游标入 Memory** | 大迁移（估计成本 > 单 tick 迁移预算）按 cursor 分 tick；游标与完成标记 `{cursor, done}` 必须存 **Memory（非 heap）**——防分 tick 半途 global reset 后重入即半迁移状态。 |
| 3 | **分 tick** | 每 tick 迁一批实体；迁移期间新旧字段并存，读侧优先新字段；迁移期间 P0 生存链路照常运行（迁移不是停机理由）。 |
| 4 | **全步骤成功才升版本** | `schemaVersion` 仅在全部步骤成功后更新；每步幂等（先检查目标态再动手，重放无副作用）。 |
| 5 | **回退语义** | 旧版代码遇到更高 `schemaVersion`：只读、不写、输出告警（防部署回滚后新旧代码互相破坏）；迁移中断由下 tick 从 cursor 续跑，无「回滚数据」语义——回退 = 停在旧版本字段并存的中间态。 |

## 4. heap 缓存合同

| 条款 | 内容 |
| --- | --- |
| build/refresh 双路径 | **build**（全量重建）：reset 后或 TTL 过期，成本高，须在预算内分摊（按房间分 tick 错开）；**refresh**（廉价更新）：TTL 未过期时仅原地刷新变化字段（research/20 §10.3）。 |
| 缓存条目契约 | `{ value, seed(结构版本), created, ttl }`；结构版本变化（新建筑 / 拆除）**立即失效**，不等 TTL。 |
| TTL 写在 get 侧 | 失效判定集中于读取路径（set 侧只登账）；无视野房间 CostMatrix TTL=Infinity、恢复视野后缩短（research/18 §3）。 |
| 惰性重建 | reset 后**禁止**集中全量重建（tick 1 重建风暴）；消费者先读先建，按使用顺序分摊成本；首 tick 预留重建预算，超额度顺延（research/20 §10.3）。 |
| 禁止抢救 | **禁止**把 heap 状态「抢救」进 Memory——那是把缓存升级成持久层，违反 §1 分层（research/22 §11）。 |
| heap 不是免费的 | 大量数据驻留 heap 加重 GC、吃 CPU；heap 条目同样受体积预算（§6）约束（research/18 §3）。 |

## 5. segment 分配合同

**分段布局表**（编号段位进 `CONFIG.memory.segments`，仅当容量关系变化才走 ADR）：

| 数据族 | 布局 | TTL / 容量策略 | 激活频率 |
| --- | --- | --- | --- |
| intel 四域（房间 / 玩家 / 资源 / 市场） | 分页哈希（roomName → 页） | 置信度随龄降级（fact→stale→inferred），超 TTL 清「未知」；环形覆盖 | 写事件式；读决策前（research/18 §10.5） |
| 威胁记忆（玩家级） | 独立 1–2 段 | 月级长 TTL，被攻击刷新 | 战略层低频 |
| 市场订单档案 | 环形窗口段 | 滚动窗口（如 5k tick） | 交易决策前 |
| 遥测聚合（L3） | 按指标分页 | 滚动窗口 + 降采样（新密旧疏） | 每 N×M tick 写一次（research/21 §10.2） |
| tuning 样本 | 单段 | 窗口累计，评估后清 | 评估周期 |

合同条款：

1. **每 tick ≤10 段激活**是硬上限；激活预算由**单一 segment-store 写者集中管理**
   （kernel 部件），业务模块禁止直呼 `RawMemory.setActiveSegments`——超限静默丢段
   是已登记失败模式（research/18 §8）。
2. 轮转策略：常驻段（遥测当前页、威胁记忆）+ 按需段（intel 页、市场档案）+
   LRU 回收；读请求与写 flush 统一排队。
3. 异步语义：本 tick 请求、下 tick 可读；**禁止**把 segment 读放进生存链路或
   同 tick 决策路径（research/18 §7）。
4. 写侧统一 lzstring 压缩，解压结果进 heap 本 tick 复用（research/18 §10.5）。
5. foreign segment 同时仅 1 个：外交 / 外部观察按轮换读。

## 6. 体积预算与孤儿清理

**上限公式**（research/26 §7）：

```text
|Memory| = O(rooms)（每房固定小节） + O(active agendas) + O(spawn queue)
         + O(creep identity)（每角色固定契约） + O(常量枚举/版本头)
```

任何使该项退出对应数量级的改动（如 creep 字段自由生长）即违反本合同。

| 条款 | 内容 |
| --- | --- |
| 孤儿清理责任 | 死 creep 残留、已注销房间键、过期任务字段由**低频清理钩子**（每 100 tick）删除；删除走两阶段（标记→复核→物理删除）；清理钩子经注册表进入内核（R9 例外与 3 个重构触发器，KERNEL §8）。 |
| 体积遥测 | 每 N tick 采样 `RawMemory.get().length` 进 segment 遥测；环比增长超阈值 → WARN（这是验收项「无 Memory 单调膨胀」的数据源，research/18 §10.4；research/21 §10.1）。 |
| 瘦税目标 | Memory 税计入预算公式 F 项（[CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md) §3），量级目标 L 的 5–10% 内。 |

## 7. 禁止清单（进 Memory 即违规）

| # | 禁止项 | 依据 / 反例 |
| --- | --- | --- |
| 1 | 完整路径 / 路径序列（业务数据） | TooAngel 存 route 反例——十年能活但社区公认缺陷；路径的家是 heap + created 时间戳（research/18 §5/§11） |
| 2 | 历史日志 / 曲线 / 事件流 | 历史归遥测 segment（L3），热路径零历史 |
| 3 | 运行时索引（find 结果、目标池） | 可重建派生物，归 heap |
| 4 | 完整对象引用 / 深层嵌套 | stringify 后是死 ID + GC 压力 + 语义漂移（research/18 §8） |
| 5 | Demand / 瞬时请求池持久化 | Demand 每 tick 重推导；持久化例外仅「触发立项的转译字段」（调和 §2；[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §2） |
| 6 | 长字符串 / 未压缩大块 | 超出值类型白名单（§2） |
| 7 | 生存决策当前值放 segment / heap | 三级准入反转（§1） |

## 8. MemHack 极端形态否决声明

以「低频序列化 + 手动 RawMemory 解析」绕开引擎 Memory 税的 MemHack 式极端形态
**永久否决**（research/18 否决记录，[RESEARCH_INDEX.md](RESEARCH_INDEX.md) §18 行）：

1. 引擎在任意 tick 末仍会 stringify `Memory` 对象——低频序列化意味着**跳过的
   tick 里 heap→Memory 的写入丢失**，与「半 tick 幂等 / 随时被切断」合同直接冲突。
2. 其收益被瘦 Memory 契约（§1–§2）覆盖：体积压到 O(rooms) 瘦字段后，税已在
   预算 F 项内，无需冒险绕机制。
3. 任何以 CPU 优化名义重新引入该形态的提案，默认按本节否决，须 ADR 推翻。

## 9. 一致性声明

本文件与 [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §2（准入表）/§4（迁移
引用）/§5（重建语义）、[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §1 职能 4 /
§7（reset 与半 tick 幂等）、[TICK_LIFECYCLE.md](TICK_LIFECYCLE.md) 相位 ①/⑩、
[INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) §3（segment 分片）同一
时刻必须一致；任何一处修订必须同步其余各处并走 ADR。
