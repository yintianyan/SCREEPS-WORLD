# AGENT.md — Agent 行为约束

本文件约束所有在此仓库工作的 agent（以及人类协作者）。**只载规矩，不载索引与历史**。

## 项目信条与自治契约

Screeps: World 的可扩展 TypeScript 框架，设计信条：**稳定内核 + 可插拔业务逻辑**，
生存闭环优先于发展速度。任何昂贵工作必须有 CPU 上限、缓存、失效条件和可降级路径。

本项目演进目标是**完全自治**：零人工干预为常态。房间规模、扩张、远矿、PvP 响应都由
系统自身按运行时 CPU 预算裁决并自我调节——预算充足则扩张/扩建/备战，预算紧张则收缩/
降级/保命。没有任何手动 flag / console 指令是运营的前提；人工只保留发布与灾难接管两条边界。
破坏性人工动作（线上拆墙、核心建筑拆改）**仅限灾难接管状态**且必须审计。

**发布例外**：仓库内的定时 L2 自动化任务（Screeps 自主进化迭代）在质量门禁全绿时获准
自主 commit → push → CI 部署，一轮最多一次正常部署。该例外不扩展到市场、战争、阈值、
付费资源或破坏性操作；灾难接管仍属人。

## 真相源规则（强制）

架构文档已清理移除，**代码与测试是唯一真相源**：

1. 理解现状以代码与内联注释为准；行为契约以测试为准。
2. 已实现模块**不新增「记录已实现功能」的平行 doc**——实现说明写进内联注释与测试，
   注释必须自足（`npm run check:docs` 门禁强制）。
3. 重大结构变更在 commit message 中说明动机与权衡，不另立文档。
4. 仓库根目录只保留 README.md（仓库入口）与 AGENT.md（本章程）；运维工具、临时产物
   一律放 `tmp/`（gitignore），CI 流水线组件放 `.github/scripts/`。

## 注释规范（强制）

代码即文档。注释的作用是帮助读者理解代码无法自表达的意图，而非重复代码已说明的内容。
注释语言用中文；标识符用英文。

### 铁律：注释必须自足

读者只看代码和注释本身，就必须理解全部上下文。**任何指向外部世界的指针都是死指针**——
所指对象（文档、计划、巡检账本）终将消失，指针随之腐烂：

1. **禁止引用文档路径**：`docs/…`、任何 `.md` 文件名。
2. **禁止引用章节条款号**：`§`、`契约表 §6`、`FREEZE §9` 这类条款指针。
3. **禁止任务/阶段/巡检编号**：`A3.3`、`A5.4.1`、`A3-003`、`B1`、`MV-2`、`SP-2`、
   `R274`、`【F1/G-C】` 等。编号**既不能当指针也不能当标签**——「R274 加，成因＝…」
   也要去掉编号，只留成因。例外：扩张门 G1–G15 是系统内活概念，不算任务编号。
4. **禁止把注释当文档**：实现步骤清单、需求条款复述、执行计划——这些属于 commit
   message 与 git 历史，不属于代码。
5. **禁止冗余注释**：不得重复类型签名、变量名或代码逻辑已清晰表达的信息。
6. **禁止注释说谎**：改行为必须同步改注释，陈旧注释按 bug 处理；未实现的计划不得
   写成现在时。

### 允许与鼓励

1. **文件头注释**：一行简述模块职责。例如 `/** 远矿资源实体抽象与评估。 */`
2. **函数注释**：一句话说明做什么、参数含义、返回值；复杂逻辑补关键不变式。
3. **行内注释**：意图不明显时补充，解释「为什么」而非「是什么」。
4. **成因与教训叙述**：多段「什么时候、因为什么事故、为什么这样改」是本仓鼓励的风格
   ——把事故现象、定量归因、决策依据写全，读者不需要任何外部上下文。这与禁止事项 3/4
   的边界：叙述**内容**是鼓励的，叙述**编号索引**是禁止的。
5. **不变式注释**：关键约束（如「不允许写入 Game 对象」「必须幂等」）用自然语言表述。
6. **主题标签**：`【bucket 借用】`这类描述性小节标记可留；括号内必须是词语，不得是编号。
7. **测试标题**：describe/it 描述行为与判据（「核心接近满且 CC 低于半满 ⇒ CC 抬到 96」），
   不带编号前缀。

### P0/P1/P2/P3 例外

`P0`–`P3` 作为优先级枚举值出现在代码和注释中是合法的（它们是类型定义的一部分，
如 `Priority = 0 | 1 | 2 | 3 | 4`）。但注释中不应将 P0/P1/P2/P3 与任务编号并列引用。

## 数字与定义纪律（强制）

同一语义全仓一份定义。历史上 13 组水位、12 处比例、7 处安全储备、4 份账本各自为政
导致过系统性偏差，整改后立此纪律：

1. **定义归巢**：阈值、水位、储备、比例、配额、TTL、退避时间全部定义在 `CONFIG`，
   按数据族分组并写明语义与单位；域代码只引用 `CONFIG.x`，禁止散落魔法数字复制品。
2. **同名守卫**：bootstrap 注册名全局唯一 kebab-case，重复注册启动即失败。新增任何
   阈值/账本前先搜全仓是否已有同语义定义；发现第二处立即收敛到一处，不并存。
3. **镜像钉死**：需要 Memory 侧快照/镜像的数据，镜像值必须由源定义推导（内联进源
   定义或由源生成），禁止手工维护平行副本。
4. **尺度原语**：迟滞（flipLatch）、EMA（emaSample）等复用 `src/core/scale.ts` 的
   共享原语实现；需要新尺度行为时先立原语再使用，禁止就地重写第 N 份。
5. **序列化边界**：数值进 Memory 前的单位/缩放换算只在序列化边界做一次，域内数值
   保持单一表单。

## 事件与类型纪律（强制）

事件系统在 `src/kernel/event-log.ts`，形态是「数值枚举判别 + 映射类型约束 + 紧凑编码」：

1. **kind 枚举判别**：`EventKind` 是数值枚举（每个成员的语义与载荷编码写在成员
   注释里）；存储结构 `GameEvent` 是紧凑定形 `{t, k, r, d: number[]}`，`d` 按 kind
   解释——禁在结构上随手挂自由字段。
2. **映射类型约束发射面**：新增事件必须新增 `EventKind` 成员并在 `EventPayloadMap`
   中给出 payload 类型，经唯一发射口 `recordTyped(kind, room, payload)` 发射——
   payload 形状由 `EventPayloadMap[K]` 编译期强制。禁止绕过 `recordTyped`
   直接调 `recordEvent`/`packEventPayload` 旁路发射。
3. **消费端按 k 判别解包**：消费侧从 segment 读出事件后按 kind 分派；新增 kind
   时同步补齐消费语义，不允许「发了没人读」的哑事件长期存在。

## Commit Message（强制）

1. 格式：`type(scope): 中文标题`（type 用 feat/fix/refactor/chore/test/docs；scope
   用主域，多域用逗号）。标题一行内讲清做了什么。
2. 正文必须写**动机与权衡**（为什么改、放弃过什么方案），重大结构变更尤其如此——
   commit message 是唯一随代码永生的变更说明载体。
3. 临时上调（如预算 CAP 临时放宽）必须在正文留痕并写明回调条件。

## 质量门槛（合并前强制）

执行 `npm run typecheck`、`npm run check:docs`、`npm test`、`npm run build` 全绿。命令清单与
package.json scripts 一致：typecheck / check:docs / test / test:unit / test:integration / test:e2e / test:e2e:smoke / test:all / build / watch。
（e2e 冒烟 = `test:e2e:smoke`，为 CI 门禁成员；`test:e2e` 全套件与 `test:all` 为本地全量验收入口。）

## 硬约束（不可妥协）

### 内核与调度（`src/kernel/`）

- 内核只维护运行秩序，不感知具体角色或经济策略。
- CPU 档位 `CpuTier` 四档（`healthy/guarded/conserve/recovery`）：档位阈值与软/硬
  上限比例定义在 `CONFIG.cpu.tiers` / `CONFIG.cpu.limits`，软/硬上限按 `Game.cpu.limit`
  比例化；降级立即生效，恢复需滞回（recoveryHysteresis + recoveryTicks）。
- 所有系统与 creep 走 `safeRun`，单点错误不得中断整 tick；非关键插件连续失败 3 次
  进入冷却，时长随计数真递增（80→90→…→200 tick 封顶，计数不清零，成功一次才归零）；
  P0 只限流不冷却；相同错误每 label 每 25 tick 限流。

### 内存与迁移（`src/kernel/memory.ts`）

- Memory 只存 ID、枚举、少量数字和短 key；禁止写入完整路径/历史/运行时索引。
- **迁移规范**：每次结构变更升版本；迁移必须幂等；先写新字段验证后删旧字段
  （必要时用迁移的 `ready()` 前置门）。迁移链逐步推进 `Memory.schemaVersion`（每步
  成功即写），并以 `Memory.kernel.migrationCheckpoint` 记录已到达版本——checkpoint
  只前进不后退，配合幂等迁移保证回滚代码重跑不破坏状态。新增 Memory 字段须同时
  更新类型与迁移（以 `CONFIG.memory` 为单一真相源；数字仅为快照）。冷数据走
  RawMemory segment。

### 插件注册（`src/bootstrap.ts`）

- `bootstrap.ts` 是唯一组合根；新增角色/系统只改此文件与新模块，**不改 Kernel**。
- 名称全局唯一 kebab-case，重复注册启动即失败；模块顶层禁止访问 `Game`/`Memory`。

### Creep 行为（`src/creeps/`）

- 角色是声明式 `RolePolicy`（gate/acquire/work/onFlee/hold/park/combat），由
  engine/role-runner 统一驱动；共享 FSM 只在背包空/满、任务完成或威胁解除时切状态，
  防抖动。`hold` 钩子在 ensureHome 导航之前执行。
- 角色**禁止**全房 `find`、全局扫描、创建 Spawn 请求、调 `createConstructionSite`、
  每 tick 调 `PathFinder.search`；优先复用 RoomSnapshot 与 kernel 预构建索引，
  缓存 `targetId`。
- 移动默认走 traffic-manager 后置系统：角色登记意图，tick 末按房仲裁统一签发
  `move`（意图仲裁仅覆盖移动，非移动动作由角色相位直发）；寻路带三档限频，
  本地 `maxRooms: 1`。

### Spawn（`src/systems/room/spawn-manager.ts`）

- Spawn Manager 是**唯一**能调用 `spawnCreep` 的模块，角色不得自行孵化。
- 请求按稳定 key 幂等合并，`spawning` 与已提交请求须计入人口；P0 灾后恢复优先，
  recovery 档 body 始终为 `[WORK,CARRY,MOVE]`（成本 200，见 `CONFIG` bodies 的
  recovery 定义）；队列带黑名单冷却（按 TTL 窗口）、请求撤销通道（需求前提消失
  立即出队）与 `recycle` 回收通道。

### 建造与布局（`src/systems/room/construction-manager.ts`、`src/systems/remote/remote-mining-manager.ts`、`src/domain/layout/`、`src/systems/room/layout-planner.ts`）

- site 创建仅两个写者：construction-manager（自有房）+ road-planner（远矿 road 与
  container）；角色层禁止调 `createConstructionSite`，远矿 container 需求只写
  `needContainer` 申请标记。
- `CONFIG.construction.maxNormalLaneSites`（7）是 normal / development 车道的名额，
  **不是帝国 site 总量**：critical / storage / container / road / wall / rampart 走每房
  配额，emergency 重建道不查此值（理由见 config 注释）。每房最多 3 normal + 2 road +
  1 critical；自有房 emergency site 优先于远矿 site。道路依据实测交通热度逐段添加，
  绝不预铺全房。
- 布局是版本化蓝图 + 低频局部适配 + 队列化执行；核心结构建成后冲突只标 `blocked`，
  不自动拆改。模板改动须递增 `templateId`/`layout.version` 并写迁移。

### 战争（`src/systems/military/war-planner.ts`、`src/domain/war/planning.ts`、`src/domain/strategy/posture.ts`）

- `war` 姿态是进攻的唯一授权来源（持续被打 + 打得起）；war-planner 是唯一战争进攻执行
  决策者，attacker 仅由它孵化。代码存在不等于战争开始。
  **例外（第二孵化权威源）**：`power-farm-manager` 的 powerBank 野采编队（attacker/healer/pbCollector）
  由它向 spawnQueue 直接提交，不经过 war-planner → 不落入 war 止损链（warBlacklist/casualtyMultiplier）。
  该例外是既定设计（上线已久），审计止损条款时必须把 power-farm 视作独立编队路径，不能假设
  "attacker 全部经 war-planner"。
- 止损链不可绕过：spawned 超 `squadSize × casualtyMultiplier` 收摊；失败/unknown
  目标进 `warBlacklist` 冷却；war 姿态下经济压力持续超标经 `warPressureTicks` 退
  fortify。波次集结：attacker 在 build 相位经 hold 钩子归建待命，满编才 advance。
- 战后核验只信新鲜 intel（evaluateWarOutcome 纯函数），结论记录 WarOutcome 事件。

### 测试分层（`tests/`）

- 三层职责不可混：unit 守逻辑与边界；integration（TestWorld 内存模拟，全套约 50s）
  守 kernel 状态机与调度决策，断言可白盒读 `world` 内部；e2e（screeps-server-mockup
  真实引擎）守引擎物理敏感行为（寻路、结构衰减、schema 迁移、市场、存储进程）与长程 soak。
- 场景放层标准：断言依赖真实引擎物理 → e2e；断言 kernel 内部决策 → integration；
  事故复现放能最快复现的层——每个线上事故必须沉淀一个复现测试。
- 房间布局唯一源：`tests/support/room-blueprints.ts` 的 `STANDARD_ROOM_LAYOUT`；
  场景变体基于它派生（结构紧贴其服务对象），禁止重新发明一套绝对坐标。修改布局
  常量必须 `npm run test:integration` 与 `npm run test:e2e:smoke` 双绿。
- 依赖 `dist/main.js` 的测试（如 bundle parity）放 e2e 层——`test:e2e` 自带 build
  前置，integration 无。

### LLM 与外部服务边界

- LLM/外部控制平面不得进入 tick 执行路径；若引入，必须异步化、可超时、可降级，
  且外部服务不可用时帝国仍能安全运行。
