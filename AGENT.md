# AGENT.md — Agent 行为约束

本文件约束所有在此仓库工作的 agent（以及人类协作者）。**只载规矩，不载索引与历史**：
文档导航见 [docs/README.md](docs/README.md)。

## 项目信条与自治契约

Screeps: World 的可扩展 TypeScript 框架，设计信条：**稳定内核 + 可插拔业务逻辑**，
生存闭环优先于发展速度。任何昂贵工作必须有 CPU 上限、缓存、失效条件和可降级路径。

本项目演进目标是**完全自治**：零人工干预为常态。房间规模、扩张、远矿、PvP 响应都由
系统自身按运行时 CPU 预算裁决并自我调节——预算充足则扩张/扩建/备战，预算紧张则收缩/
降级/保命。没有任何手动 flag / console 指令是运营的前提；人工只保留发布与灾难接管两条边界。
破坏性人工动作（线上拆墙、核心建筑拆改）**仅限灾难接管状态**且必须审计；分级动作清单见
[CANARY_SOAK_PROCEDURE.md](docs/implementation/CANARY_SOAK_PROCEDURE.md) §6。

## 文档与代码的裁决规则（强制）

文档分两层（详见 [docs/README.md](docs/README.md)）：`docs/architecture/` 冻结蓝图、
`docs/research/` 调研存档。

1. **蓝图与代码冲突时**：该领域蓝图已冻结 → 以蓝图为目标、代码为待迁移现状，新改动
   必须朝蓝图收敛而非反向迁就现状（迁移路径见
   [IMPLEMENTATION_PHASES.md](docs/architecture/IMPLEMENTATION_PHASES.md)）；
   蓝图未覆盖（如存量 R/G 系列特性）→ 以代码与内联注释为准。
2. 冻结契约的结构性修订必须走 ADR（登记进
   [ARCHITECTURE_FREEZE.md](docs/architecture/ARCHITECTURE_FREEZE.md) §15 修订记录），
   不得静默改契约文档。
3. 已实现模块**不新增「记录已实现功能」的平行 doc**——实现说明写进内联注释与测试，
   新代码必须让注释自足、不引用已删除的文档。
4. 改动任何高风险区域前，**必读**其对应蓝图文档（映射表见 docs/README.md 速查）；
   没读就改视为违规。

## 编码注释约束（强制）

代码即文档。注释的作用是帮助读者理解代码无法自表达的意图，而非重复代码已说明的内容。

### 禁止事项

1. **禁止引用文档路径**：注释中不得出现 `docs/phaseXX/`、`docs/implementation/`、
   `docs/audit-2026-08/`、`tmp/docs-moved/` 等文档路径。代码是自足的，不需要指向外部文件。
2. **禁止引用文档条款编号**：注释中不得出现 `§1.2`、`§18.3`、`§7-15` 等章节编号，
   也不得出现 `合同锚点：XXX_ARCHITECTURE` 这类引用。
3. **禁止使用任务/阶段编号**：注释中不得出现 `A4.0 Phase 3`、`A2 后半·步 6`、
   `A4.6 Task Spec`、`R9`、`SP-2`、`R2-3`、`G-G/R2-3` 等任务编号或阶段标识。
   代码是长期的，任务编号只在开发期间有意义。
4. **禁止设计文档式注释**：不得在文件头或函数头写多段设计意图、背景说明、
   执行链步骤列表。这些属于设计文档，不属于代码。
5. **禁止冗余注释**：注释不得重复类型签名、变量名或代码逻辑已清晰表达的信息。

### 允许与鼓励

1. **文件头注释**：一行简述模块职责即可。例如 `/** 远矿资源实体抽象与评估。 */`
2. **函数注释**：用一句话说明函数做什么、参数含义和返回值。复杂逻辑可补充关键不变式。
3. **行内注释**：仅在代码意图不明显时补充，解释"为什么"而非"是什么"。
4. **不变式注释**：关键约束（如"不允许写入 Game 对象"、"必须幂等"）可保留，
   但用自然语言表述，不引用文档条款。

### P0/P1/P2/P3 例外

`P0`–`P3` 作为优先级枚举值出现在代码和注释中是合法的（它们是类型定义的一部分，
如 `Priority = 0 | 1 | 2 | 3 | 4`）。但注释中不应将 P0/P1/P2/P3 与任务编号、
文档条款并列为"设计约束"式的引用。

## 质量门槛（合并前强制）

执行 `npm run typecheck`、`npm test`、`npm run build` 全绿。命令清单与
package.json scripts 一致：typecheck / check:docs / test / test:unit / test:integration / build / watch。

## 硬约束（不可妥协）

### 内核与调度（`src/kernel/`）

- 内核只维护运行秩序，不感知具体角色或经济策略。→ [KERNEL_ARCHITECTURE.md](docs/architecture/KERNEL_ARCHITECTURE.md)
- 四档 bucket 看门狗（Healthy/Guarded/Conserve/Recovery）：软/硬上限按
  `Game.cpu.limit` 比例化；降级立即生效，恢复需滞回。→ [CPU_EXECUTION_MODEL.md](docs/architecture/CPU_EXECUTION_MODEL.md)
- 所有系统与 creep 走 `safeRun`，单点错误不得中断整 tick；非关键连续失败 3 次进入
  50–200 tick 冷却（P0 永不冷却）；相同错误每 25 tick 限流。→ [FAILURE_RECOVERY_ARCHITECTURE.md](docs/architecture/FAILURE_RECOVERY_ARCHITECTURE.md)

### 内存与迁移（`src/kernel/memory.ts`）

- Memory 只存 ID、枚举、少量数字和短 key；禁止写入完整路径/历史/运行时索引。
  → [MEMORY_ARCHITECTURE.md](docs/architecture/MEMORY_ARCHITECTURE.md) · [STATE_OWNERSHIP_MODEL.md](docs/architecture/STATE_OWNERSHIP_MODEL.md)
- **迁移规范**：每次结构变更升版本；迁移必须幂等；先写新字段验证后删旧字段；所有
  步骤成功才更新 `schemaVersion`；大迁移按 cursor 分 tick。新增 Memory 字段须同时
  更新类型与迁移（以 `CONFIG.memory` 为单一真相源；数字仅为快照）。冷数据走
  RawMemory segment。

### 插件注册（`src/bootstrap.ts`）

- `bootstrap.ts` 是唯一组合根；新增角色/系统只改此文件与新模块，**不改 Kernel**。
- 名称全局唯一 kebab-case，重复注册启动即失败；模块顶层禁止访问 `Game`/`Memory`。
  → [SYSTEM_BOUNDARIES.md](docs/architecture/SYSTEM_BOUNDARIES.md)

### Creep 行为（`src/creeps/`）

- 角色是声明式 `RolePolicy`（gate/acquire/work/onFlee/hold/park/combat），由
  engine/role-runner 统一驱动；共享 FSM 只在背包空/满、任务完成或威胁解除时切状态，
  防抖动。`hold` 钩子在 ensureHome 导航之前执行。
- 角色**禁止**全房 `find`、全局扫描、创建 Spawn 请求、调 `createConstructionSite`、
  每 tick 调 `PathFinder.search`；优先复用 RoomSnapshot 与 kernel 预构建索引，
  缓存 `targetId`。
- 移动默认走 traffic-manager 后置系统：角色登记意图，tick 末按房仲裁统一签发
  `move`（意图仲裁仅覆盖移动，非移动动作由角色相位直发）；寻路带三档限频，
  本地 `maxRooms: 1`。→ [DATA_FLOW.md](docs/architecture/DATA_FLOW.md)

### Spawn（`src/systems/spawn-manager.ts`）

- Spawn Manager 是**唯一**能调用 `spawnCreep` 的模块，角色不得自行孵化。
- 请求按稳定 key 幂等合并，`spawning` 与已提交请求须计入人口；P0 灾后恢复优先，
  可用能量达 200 立即生成 `[WORK,CARRY,MOVE]`；队列带黑名单冷却、
  请求撤销通道与 `recycle` 回收通道。→ [SPAWN_ARCHITECTURE.md](docs/architecture/SPAWN_ARCHITECTURE.md)

### 建造与布局（`src/systems/construction-manager.ts`、`src/systems/remote-mining-manager.ts`、`src/domain/layout/`、`src/systems/layout-planner.ts`）

- site 创建仅两个写者：construction-manager（自有房）+ remote-mining-manager
  （远矿房）；角色层只写 `needContainer` 申请标记。
- 全局存量上限 `CONFIG.construction.maxGlobalSites`；每房最多 3 normal + 2 road +
  1 critical；自有房 emergency site 优先于远矿 site。道路依据实测交通热度逐段添加，
  绝不预铺全房。
- 布局是版本化蓝图 + 低频局部适配 + 队列化执行；核心结构建成后冲突只标 `blocked`，
  不自动拆改。模板改动须递增 `templateId`/`layout.version` 并写迁移。
  → [CONSTRUCTION_ARCHITECTURE.md](docs/architecture/CONSTRUCTION_ARCHITECTURE.md)

### 战争（`src/systems/war-planner.ts`、`src/domain/war/planning.ts`、`src/domain/strategy/posture.ts`）

- `war` 姿态是进攻的唯一授权来源（持续被打 + 打得起）；war-planner 是唯一进攻执行
  决策者，attacker 仅由它孵化。代码存在不等于战争开始。
- 止损链不可绕过：spawned 超 `squadSize × casualtyMultiplier` 收摊；失败/unknown
  目标进 `warBlacklist` 冷却；war 姿态下经济压力持续超标经 `warPressureTicks` 退
  fortify。波次集结：attacker 在 build 相位经 hold 钩子归建待命，满编才 advance。
- 战后核验只信新鲜 intel（evaluateWarOutcome 纯函数），结论记录 WarOutcome 事件。
  → [MILITARY_ARCHITECTURE.md](docs/architecture/MILITARY_ARCHITECTURE.md) · [DEFENSE_ARCHITECTURE.md](docs/architecture/DEFENSE_ARCHITECTURE.md)

### LLM 与外部服务边界

- LLM/外部控制平面不得进入 tick 执行路径；若引入，必须异步化、可超时、可降级，
  且外部服务不可用时帝国仍能安全运行。→ [LLM_BOUNDARY.md](docs/architecture/LLM_BOUNDARY.md)
