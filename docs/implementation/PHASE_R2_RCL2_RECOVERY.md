# Phase R2 — RCL2 Early Development Recovery 根因报告与验收

> 状态：**PASS**（mockup 1500t + 私服隔离 canary 5200t 验收全过，详见 §6/§7/§10/§11；
> 验收加固批次已收紧为 rcl === 2 精确窗口并复验通过）。
> 日期：2026-08-27（修复）/ 2026-08-28（验收加固终验）。

## 1. 根因（三层叠加，互为掩盖）

复现环境：mockup 集成测试（`tests/integration/scenarios/rcl2-stall-repro.test.ts`，
真实 `kernel.run()` 驱动）+ skip-reason 结构化观测（§4）。生产症状「buildQueue 大量
堆积、site=0、直到 RCL3 tower emergency 才自愈」由以下三层共同构成：

### 根因 A（主）：extension 无受保护通道 + 门禁可永久拉闸

`developmentGate` 的任一门禁在 RCL2 长期置位即冻结全部非紧急建造：

- `claimSecure`（RCL<4 + ttd<15000 置位，退出需 ttd≥20000 ≈ 持续升级）——**自增强
  死锁**：extension 建不成 → 孵化容量上不去 → 经济弱 → 升级慢 → ttd 长期低于退出阈；
- `conserve/recovery` tier（私服 bucket 低位时长期滞留）；
- 能量地板（`min(容量×60%, 400)`——RCL2 无 extension 时容量仅 300，阈值 180）；
- P0 spawn 请求持续在队。

而 emergency 豁免清单（`assessEmergencyRebuild`）中 tower 需 RCL≥3、storage 需 RCL≥4
才判定——**RCL2 阶段没有任何 emergency 通道可以救 development**。这就是「到 RCL3
才自愈」的机制本质。

### 根因 B：emergency/normal tick 槽位互斥分支饿死 normal 槽位

旧结构 `if (emergency && canEmergency) else if (canNormal)`：2 source 房只要有一处
source container 缺失/在 critical 配额（1/房）下排队，`needsSourceContainerRebuild`
恒真 → emergency 长期激活 → **normal 槽位（唯一能建 extension 的通道）被 else-if
永久短路**。复现数据：2 source 房全程恰好只有 1 个 container site + 0 extension site。

### 根因 C：emergency 槽位「搭车」放行普通任务

emergency 槽位的 `tryCreateSite` 排序把紧急任务排前但**不过滤**——紧急状态激活时
extension 等普通任务也走 emergency 槽位创建，绕过能量地板。旧代码靠这个 bug 意外
掩盖根因 B（部分 extension 偶尔能建出来）；但在 conserve/低能量窗口它又把普通任务
放进「无门禁」通道，是能量危机期乱建的根源。两个 bug 方向相反、互相掩盖，导致症状
时隐时现、极难归因。

### 并发发现（继承 bug，非本 Phase 引入）

- v40→v41 迁移步骤 3 误删新字段 `oe`（应为删旧字段 `overflowEvicted`），在途未提交
  工作区引入，导致 OutcomeChannel 压缩字段在双向存在时被误删。已修复并有测试锁定。
- `.gitignore` 忽略整个 `.catpaw/`（与建造无关，另行决策）。

## 2. RCL2 关键发展通道设计（任务书第二步）

`evaluateDevelopmentLane`（domain 纯函数，`src/domain/construction/queue.ts`）：
当严格发展门禁拒绝时，满足**全部**生存前提则允许为关键发展结构创建 site：

| 条件 | 语义 |
| --- | --- |
| `2 ≤ rcl ≤ developmentLaneMaxRcl(3)` | 仅早期发展窗口；RCL4+ 由 storage/emergency 通道接管 |
| tier ≠ recovery | 与内核 maxPriority=1（P2 系统不跑）语义一致；**conserve 明确放行** |
| 无威胁 creep | 敌人脚下不建工地（与门禁同源，双路径生效） |
| 无 P0 孵化请求 | 生存孵化缺口优先 |
| 无生存级紧急缺口（spawn/tower/storage 缺失） | source container 缺失是经济效率缺口而非生存缺口——由 emergency 槽位并行处理，不冻结发展通道 |
| `energy ≥ developmentLaneEnergyFloor(150)` | 绝对能量地板（conserve/recovery 下同样生效——保留能量底线） |
| 全局 site 未满额 | 不绕过全局配额 |
| 队列存在可立即创建的发展任务 | 无任务不空转 |

通道任务类 = extension + controller 邻接 container（`isCriticalDevelopmentTask`）；
source 邻接 container 归 emergency 车道。

**不绕过清单**（任务书 2.5，逐项落实）：Game API（仍经 `room.createConstructionSite`）、
每房 site 配额（3 normal + 2 road + 1 critical，含分类计额）、全局 site 上限
（7，含远矿账本）、occupied/terrain/dependency 校验（入队侧 validateBuildCell）、
construction-manager 唯一写者。限速：创建消耗 normal tick 槽位（全局每 tick 1 个）。

## 3. 队列治理修复（任务书第三步）

| 机制 | 实现 |
| --- | --- |
| 背景任务硬上限 | `CONFIG.construction.maxBackgroundQueuedPerRoom = 16`：priority≥2（道路/防御）非终端任务达上限后拒绝入队；P0/P1（生存+发展）不受限。layout-planner 全部入队路径（tryAddTask + 道路直达 push）接入，拒绝计数 `capRejected` 每规划周期日志 |
| 年龄可观测 | BuildTask 新增 `queuedAt`（schema **v42**：存量任务回填当前 tick，幂等）；skip 结构化日志输出最老 queued 任务年龄 |
| 超龄清除 | queued 且 `priority>0` 任务年龄 > `maxQueuedTaskAge(3000)` 清除（**不进黑名单**——超龄≠永久无效，规划器下周期可重入队）；priority 0 永不清除 |
| 幂等 | 既有 key+position+segment 黑名单三重去重保持；重复规划场景回归锁定（场景 5） |
| RCL 门禁 | 入队侧 `phaseAllowed(cell.phase, rcl)` 只生成当前 RCL 允许的 phase；`typeSaturated` 清理已达 RCL 上限的幽灵任务（既有机制，回归覆盖） |
| 等待原因可观测 | skip 计数按「类型 × 原因」粒度（含 `per-room-site-cap:extension` 等），见 §4 |

## 4. skip-reason 结构化观测（任务书交付物 2）

`construction-manager` 全部跳过路径接入 L1 计数（heap，不上 Memory——
STATE_OWNERSHIP §3.10），每 `skipReportInterval(100t)` 输出一条聚合日志后清零：

```
[construction-skip] t=<tick> room=<r> window=100t <reason>=<n> ... queue=<总长>(q<queued>/s<site>/b<blocked>) sites=<n>
```

原因全集：门禁 7 类（`pressure` / `cpu-tier` / `claim-secure` / `threat` /
`p0-spawn` / `energy-floor` / `global-site-cap`）+ 通道 9 类（`lane:*`）+
创建期（`per-room-site-cap:<type>` / `invalid-target` / `rcl-not-enough` /
`err-full` / `unknown-error` / `no-eligible-task` / `tick-quota` / `stale-evict`）。

## 5. 测试矩阵（任务书第四步，8/8 落地）

| # | 场景 | 断言 | 文件 |
| --- | --- | --- | --- |
| 1 | RCL2 正常 | extension site ≤300 tick 出现 | integration rcl2-development-recovery 场景1 |
| 2 | RCL2 conserve | 能量地板满足→放行；不足→阻止 | 场景2a/2b |
| 3 | P0 spawn 缺口 | 发展 site 零新增 | 场景3 |
| 4 | hostile 在场 | 不创建 extension site | 场景4 |
| 5 | 重复规划 | key 幂等、队列有界 | 场景5 |
| 6 | 创建失败状态机 | ERR_RCL_NOT_ENOUGH→queued+retryAt；ERR_INVALID_TARGET→blocked+attempts；ERR_FULL→短冷却+终止；OK→site | 场景6（直测 tryCreateSite） |
| 7 | RCL2→RCL3 | extension site 先于 RCL3 | 场景7 |
| 8 | 1500t 长跑 | 队列有界、状态一致、全程 RCL2（不依赖 tower emergency） | 场景8 |

单元：`tests/unit/construction/rcl2-development-lane.test.ts`（30 测试：门禁原因码、
通道真值表、任务分类、超龄清除、admission control）；
`tests/unit/migration/v41-to-v42.test.ts`（5 测试）。

## 6. mockup 1500 tick 报告（干净 RCL2，修复后）

```
t=50   energy=50/300  queue=12(site:1)  sites=1(container:1)                              skips=no-eligible-task:4 p0-spawn:23 lane:p0-spawn:23 per-room-site-cap:container:46 energy-floor:26
t=200  energy=100/300 queue=13(site:5)  sites=5(container:1, extension:3, road:1)          skips=p0-spawn:1 lane:p0-spawn:1
t=400  energy=150/300 queue=14(site:6)  sites=6(container:1, extension:3, road:2) siteProg=400
t=800  energy=300/300 queue=14(site:6)  sites=6  siteProg=1300  roles={worker:1,harvester:2,builder:1,upgrader:2}
t=1200 energy=300/300 queue=14(site:6)  sites=6  siteProg=2150
t=1500 energy=300/300 queue=14(site:6)  sites=6  siteProg=2800  pressure=0 tier=healthy
```

- **extension site t≤200 出现**（修复前：1450 tick 全程 0，per-room-site-cap:extension
  每 100t 窗口 ~400 次）；配额推进正常（1→5→6 site）；builder 自动孵化；
  RCL1→RCL2 迁移场景 builder 爬坡至 4、siteProg 稳步推进（0→6540）。
- 配额焊死段（site=6 顶满 3 类配额）伴随 `per-room-site-cap:*` 计数——这是配额
  正确工作的证明而非故障；builder 建成后配额释放、队列自然消化。

## 7. 私服 canary（隔离世界，不触碰正式数据）

环境：in-process screeps private server（ScenarioRunner/ServerHarness），W0N1
standardRoom（2 source，RCL1 冷启动 300 能量），5200 tick 连续运行，每 50 tick 采样
（104 样本，数据落 `/tmp/rcl2-canary.json`）。**验收 7/7 通过。**

| 指标 | 实测 | 验收标准 | 判定 |
| --- | --- | --- | --- |
| RCL1→RCL2 自然过渡 | t=1052 | 发生 | ✅ |
| RCL2 阶段有效发展 site | 83/83 样本均有（进入 RCL2 首个采样即 extension×3 + container×1） | ≥1 个 | ✅ |
| 「发展任务 queued 而 site=0」最长窗口 | **0 tick** | ≤100 tick | ✅ |
| buildQueue 总量上限 | max 23（背景任务恰好顶在 16 = admission control 生效） | 有硬上限 | ✅ |
| 不依赖 RCL3 emergency | extension site 在 RCL2 阶段全程存在；**claimSecure 83/83 样本置位中**（生产死锁前提全程在场）仍正常建设 | 不依赖 | ✅ |
| 经济无死亡螺旋 | creeps 1→12（末段 9），pressure=0，无中断 | 存活 | ✅ |
| 连续运行 | 5152 tick 自然完成（≥3000–5000t 回归要求） | ≥5000 | ✅ |

**关键证据**：canary 全程 `claimSecure=true`（RCL<4 + 新房升级压力，生产事故的
死锁前提），修复前该状态会冻结一切 extension 建设；修复后经关键发展通道在 conserve
兼容语义下正常放行——生产症状在受控环境完整复现并被修复验证。

## 8. 禁令核对（任务书「明确禁止」逐项）

| 禁令 | 核对 |
| --- | --- |
| 全局取消 conserve/recovery 门禁 | ❌ 未取消——conserve 仅对**关键发展任务类**放行（通道条件表），普通任务照旧拦截；recovery 完全不放行 |
| 角色直接调 createConstructionSite | ❌ 未引入——唯一写者不变，角色层零改动 |
| 删 buildQueue 伪造恢复 | ❌ 无任何删除队列的捷径；超龄清除按年龄规则逐任务执行且不进黑名单 |
| 只提高 tick 上限不解释等待 | ❌ 每个等待都有原因码计数 + 聚合日志；1500t 断言不依赖任何超时放宽 |
| 把 RCL3 tower emergency 误当修复 | ❌ 场景 8 显式断言全程 RCL2；场景 7 断言 extension site 先于 RCL3 |

## 9. 变更清单

- `src/domain/construction/queue.ts`：`evaluateDevelopmentGate`（原因码纯函数）、
  `evaluateDevelopmentLane`、`isCriticalDevelopmentTask`、`cleanTasks` 超龄清除
  （返回 `{blacklistedKeys, staleKeys}`）
- `src/systems/construction-manager.ts`：双槽位独立化（emergency-only 语义）、
  通道分支、strict/legacy 双门禁判定、skip 观测
- `src/systems/layout-planner.ts`：入队 `queuedAt` 盖戳、背景任务 admission control、
  `capRejected` 日志
- `src/domain/layout/planner.ts`：`makeTryAddTask` opts（上限/nowTick/stats）
- `src/domain/layout/task-factory.ts`：`candidateToBuildTask(candidate, queuedAt)`
- `src/kernel/memory.ts` + `src/config/index.ts`：schema v42 迁移 + 版本号
- `src/config/index.ts`：`maxBackgroundQueuedPerRoom=16` / `maxQueuedTaskAge=3000` /
  `developmentLaneEnergyFloor=150` / `developmentLaneMaxRcl=3` / `skipReportInterval=100`
- 测试：integration `rcl2-development-recovery.test.ts`（9）、integration
  `rcl2-stall-repro.test.ts`（2，诊断采样保留）、unit `rcl2-development-lane.test.ts`（30）、
  unit `v41-to-v42.test.ts`（5）、e2e `rcl2-recovery.test.ts`（canary）

## 10. 验收加固批次（R2 Acceptance Hardening — 2026-08-28）

针对首版验收的漏洞收口（只收口、不加功能）：

### 10.1 Canary 口径收紧（一）

- 「RCL2 阶段」断言全部改为 **`rcl === 2` 精确窗口**（旧 `rcl >= 2` 会把 RCL3/4
  的 site 误算为 RCL2 成功）；采样按 rcl === 1 / === 2 / >= 3 三分区记账；
- 新增断言：首个 development site 的 tick **早于**首次进入 RCL3 的 tick；若 RCL2
  窗口无 site 而 RCL3+ 后才出现 → 测试失败（附诊断输出）；
- 新增 queued→site 转移证明：按 per-key 追踪 extension/container 任务，必须存在
  同一 key 先 queued 后 site 的真实转移（防「site 从未入队」的假阳性）；
- stall 断言改用全队列口径：`queued > 0 && siteCount === 0` 连续 ≤100t（rcl===2）。

### 10.2 stall repro 可判定化（二）

`rcl2-stall-repro.test.ts` 双场景接入 `assertRcl2Closure` 硬断言（精确窗口 stall
≤100t + development site 必现），失败时输出最后 20 个采样点全维度数据（含 skip
reason）。保留全部采样字段作为时间序列数据源。

### 10.3 发展通道公平性审查（三）

- 优先级确认：extension = controller container = priority 1（模板与 task-factory
  一致），高于 road(3)/防御(2)；source container = priority 1 + emergency 车道；
- **emergency 长期激活下 normal lane 仍放行 extension**：新增集成场景 9——s2 八邻域
  筑墙使 source container 永不可放 → emergency 恒真 + conserve tier，extension site
  仍经通道出现（≤500t 断言）；
- **多房公平性**：新增单元测试直接驱动 `constructionManagerSystem.run()` 双房间——
  房 A 连建 3 个 extension 后被每房配额拒绝、立即让位 normal 槽位，房 B 下一 tick
  获得 slot；全局 cap 由 lane/门禁双路检查（既有 global-site-cap 用例锁定）；
- `consumedNormal` 死变量已删除；
- **lane RCL 守卫**：lane 过滤器新增 `CONTROLLER_STRUCTURES[type][rcl] > 0` 检查——
  controller 降级后残留的过期任务不得借通道提前签发（降级场景归 ERR_RCL_NOT_ENOUGH
  瞬态重试链路）。入队侧 `phaseAllowed(cell.phase, rcl)` 本就只生成当前 RCL 允许的
  phase，此为 belt-and-braces。

### 10.4 任务状态机补全（四）

`task-state-machine.test.ts`（14 测试）：OK / ERR_FULL / ERR_RCL_NOT_ENOUGH /
ERR_INVALID_TARGET / 未知错误（指数退避封顶 200t）/ site 消失回退 queued /
位置建成转 done 并清除 / 类型不匹配不误收 / 超龄清除 / 旧数据 queuedAt 缺省安全 /
同 key 重规划去重 / lane RCL 守卫双向。

### 10.5 验收加固批次的门禁结果

- typecheck ✅ 零错误
- unit + integration（Node 24.18.0）✅ 5138/5138 全过（含加固后新增断言）
- build ✅ | e2e canary 9/9 ✅（见 §11 终稿）

### 10.6 集成测试场景 7 rcl>=2 漏洞修复

**漏洞**：场景 7「RCL2→RCL3 迁移」原断言 `expect(level).toBeGreaterThanOrEqual(2)`，
未验证 extension site 出现时的精确 RCL。若 extension 在 RCL3 才出现，旧测试仍通过。

**修复**：
- 新增 `firstExtensionSiteRcl` 追踪——记录 extension site 首次出现时的 RCL；
- 断言 `expect(firstExtensionSiteRcl).toBe(2)`——必须 RCL2 窗口内出现；
- 新增 `rcl2Tick` 追踪——断言确实进入了 RCL2 窗口。

### 10.7 stall repro 增强断言

在 `assertRcl2Closure` 中新增两条断言：
- **首个 dev site tick ≤ 首次进入 RCL3 的 tick**：RCL2 无 site 但 RCL3+ 后才出现 → 失败；
- **RCL3+ 有 dev site 但 RCL2 无**：显式失败诊断输出；
- 第二场景新增「队列不持续增长」断言——RCL2 末值 ≤ 首值 + 10。

## 11. 终验报告（2026-08-28）

### 11.1 门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | ✅ 零错误 |
| `npm test` | ✅ 5138/5138 全过（336 文件） |
| `npm run build` | ✅ 8.5s 完成 |
| E2E canary（`rcl2-recovery.test.ts`） | ✅ 9/9 全过 |

### 11.2 R2 单元/集成测试明细

| 测试文件 | 测试数 | 结果 |
| --- | --- | --- |
| `tests/unit/construction/rcl2-development-lane.test.ts` | 30 | ✅ |
| `tests/unit/construction/task-state-machine.test.ts` | 14 | ✅ |
| `tests/unit/construction/multi-room-fairness.test.ts` | 1 | ✅ |
| `tests/unit/migration/v41-to-v42.test.ts` | 5 | ✅ |
| `tests/integration/scenarios/rcl2-development-recovery.test.ts` | 9 | ✅ |
| `tests/integration/scenarios/rcl2-stall-repro.test.ts` | 2 | ✅ |
| **合计** | **61** | **全过** |

### 11.3 私服 canary 时间序列（`/tmp/rcl2-canary.json`）

**分区**：rcl1=19 样本 / rcl2=85 样本 / rcl>=3=0 样本（未达 RCL3，全程 RCL2 验收）。

关键时间点：
```
t=52    rcl=1  sites={container:1}                        # source container 建成
t=952   rcl=2  sites={extension:3, container:1}           # RCL2 首个采样即有 extension
t=5152  rcl=2  sites={extension:3}  q=10  pres=0          # 末段稳定
```

关键指标：
- **首个 extension site 在 rcl===2 窗口内出现**：t=952（RCL2 首个采样 tick） ✅
- **queued→site 转移证明**：`constraint.extension.24.24` 与 `constraint.extension.23.25`
  先 queued 后 site ✅
- **`queued>0 && site=0` 连续窗口**：0 tick（RCL2 全程有 site） ✅
- **buildQueue 总量上限**：max 22（背景恰好顶在 16 = admission control 生效） ✅
- **claimSecure**：全程 true（生产死锁前提在场），extension 仍正常建设 ✅
- **经济无死亡螺旋**：末段 creeps ≥ 1，pressure 峰值 0.79 后回落 0 ✅
- **≥5000 tick 连续运行**：5152 tick 自然完成 ✅

### 11.4 交付物清单

1. ✅ 修正后的 RCL2 Canary 测试（`tests/e2e/scenarios/rcl2-recovery.test.ts`）——
   全部断言使用 `rcl === 2` 精确窗口
2. ✅ 可判定的 stall regression 测试（`tests/integration/scenarios/rcl2-stall-repro.test.ts`）——
   全维度采样 + 硬断言 + 失败诊断输出
3. ✅ queue/site/skip reason 时间序列——`/tmp/rcl2-canary.json`（104 样本 × 全字段）
4. ✅ R2 单元 50 / 集成 11 / E2E 9 结果全过
5. ✅ 私服 Canary 报告——§11.3
6. ✅ 干净工作区（git status 仅 R2 相关文件改动）
7. **最终结论：PASS**
