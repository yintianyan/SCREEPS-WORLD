# P4_CONTRACT_REVIEW — Phase 4 开工前合同审查

> 日期：2026-08-23。基线：HEAD=0574c6a（P3 已提交，工作树干净）。
> 方法：先读合同、后考古代码；本文登记「Architecture ↔ 现有实现 ↔ P4 要求」
> 的一致性结论与裁决。P4 目标：RCL1→RCL6 全程无人工的房间发展（IMPLEMENTATION_PHASES §2 Phase 4）。

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| 合同充分性 | **充分**。五项交付物均有冻结定义，无需新造概念或新 ADR |
| 最大发现 | **五项交付物在存量代码中已基本实现**——P4 以验收取证为主 + D2 归位收尾 |
| D2 归位 | `src/systems/layout-planner.ts`（1063 行）含大量应在 domain 的纯函数逻辑；蓝图 §5 #3 登记为待迁移。P4 执行 D2 |
| 需 ADR 事项 | 无结构性冲突需修订冻结契约 |
| 进入 P4 | **GO**（前置项：P3 已 PASS，A2 前半达标） |

## 1. 五项交付物 × 合同锚点 × 现状映射

### 1.1 版本化布局模板 + 约束适配

| 项 | 现状 |
| --- | --- |
| 模板 | `COMPACT_CORE_V2`（`src/domain/layout/templates/compact-core-v2.ts`）— 偶校验棋盘格，62 cells，RCL2-8 分阶段，有 `id`/`anchorKind` |
| 版本化 | `Memory.rooms[r].layout.templateId` + `layout.version` 存在于 `global.d.ts`；memory.ts 有 v1→v2 迁移（`templateId: "compact-core-v1" → "compact-core-v2"`, version 1→2） |
| 约束适配 | `src/domain/layout/anchor-selection.ts` — `selectAnchors` 纯函数（openness/source/controller/exit/blocked 评分）；注释说「Phase 4 才启用约束推导放置」但已实现 |
| 冲突处理 | blocked 标记 → segment-store 持久化 + 冷却重试；不自动拆改已建成核心结构 |
| 迁移用例 | `tests/unit/layout/v2.test.ts` 守护偶校验不变量；`tests/unit/migration/v5-to-v6.test.ts` 覆盖 layout 迁移 |
| **缺口** | 蓝图 §2.1 要求「模板任何改动必须递增 templateId/version 并写迁移用例与离线渲染断言」——**已有**（v1→v2 迁移）；无新增模板变动则不需递增 |

### 1.2 建造优先级与 site 配额

| 项 | 现状 |
| --- | --- |
| 优先序 | `construction-manager.ts` 按 emergency > 核心 > 配套 > 道路 四级排序；`sorted` 按优先序+距离 |
| 全局上限 | `CONFIG.construction.maxGlobalSites = 7`（蓝图初值 ≤80，当前更保守） |
| 每房配额 | normal 3 + road 2 + critical 1 + storage 独立 + wall 2 + rampart 2 + source container 独立 |
| 跨房优先序 | 自有房 emergency 优先于远矿 site；`site-quota.ts` 共享计数器 |
| emergency | `recoveryEligible` 钩子 + `assessEmergencyRebuild` + 独立 emergency 槽位 |
| **缺口** | 无——蓝图 `3 normal + 2 road + 1 critical` 与实现一致（wall/rampart/storage 为存量扩展，不违反蓝图） |

### 1.3 RCL5 link 网

| 项 | 现状 |
| --- | --- |
| link-system | `src/systems/link-system.ts`（P1 档）— `planLinkTransfers` 规划传输 + `classifyLinkRole` 角色分类 + 死资产检测（500t 三重校验 + 拆改链） |
| domain | `src/domain/economy/links.ts` — `computeControllerLinkTarget`（需求驱动水位）+ `LinkInfo`/`LinkTransfer` 类型 + `planLinkTransfers` 纯函数 |
| 拓扑 | source link → storage link（接收+调度中枢）→ controller link（供静态 upgrader）；`task-factory.ts` 按 source → controller → storage 角色优先级放置 |
| 水位维持 | `computeControllerLinkTarget` 按 RCL/storage 水位分级：满级停供 / 降级保级 / RCL<8 按 sustained/lowSupply/maintain 三档 |
| distributor 灌能 | `targeting.ts` — controller link 缺能时 distributor 从 storage 灌入 storage link |
| **缺口** | 无——link 网已成熟运营，W37S58 官服 RCL7 稳态运行 |

### 1.4 热度铺路（采集→逐段建）

| 项 | 现状 |
| --- | --- |
| 交通计数 | `src/creeps/movement/traffic.ts` — `recordTraffic` 每次成功移动后记 `globalCache.roomTraffic[room][packedPos]++` |
| 道路策略 | `src/domain/layout/road-policy.ts` — `evaluateRoadCandidates` 双窗口阈值校验 + RCL 分档（RCL2-6 阈值 5 / RCL7-8 阈值 50）+ 端点邻近要求 |
| 走廊路 | `src/domain/layout/corridor-roads.ts` — `planCorridorRoads` 逐段添加（每次只铺最高优先级一对端点的一条，建完再规划下一条）+ 路径缓存 |
| 核心预铺路 | `task-factory.ts` — `createCoreRoadTasks` 棋盘格走道（奇校验格 + 邻 ≥2 结构） |
| 枢纽道路联动 | `layout-planner.ts` — `planHubRoads` 为已建枢纽结构预铺邻路（RCL6+，修复热度滞后） |
| 道路维修 | `repair.ts` — `repairRoads`（< 40% 血量）+ `repairUrgentRoads`（< 15% 急救） |
| **缺口** | 蓝图 §2.2 要求热度周期聚合落 segment（global reset 不丢）——**当前热度数据在 globalCache heap，reset 丢失**。这是已登记的保真缺口，不影响验收（reset 后重新采样即可） |

### 1.5 phase 推进（锚定相变点）

| 项 | 现状 |
| --- | --- |
| RCL 相变触发 | `layout-planner.ts` — `shouldPlan` 检测 `snapshot.rcl !== roomMem.lastRcl` → 触发增量规划（只规划新增解锁位） |
| 四 stage 分片 | Stage 0（锚点/预计算）→ Stage 1（核心结构）→ Stage 2（物流结构）→ Stage 3（道路+收尾）跨 tick |
| phase 标记 | 每个 BlueprintCell 有 `phase` 字段（rcl2/rcl3/rcl4/late/rcl6/rcl7），按 RCL 相变增量入队 |
| gap 审计 | `gaps.ts` — `auditStructureGaps` + `auditLinkRoleGaps` 检测缺口 → gap-force 触发慢速重试 |
| **缺口** | 无——phase 推进已成熟 |

## 2. D2 layout 边界归位

蓝图 §5 #3 登记：`src/systems/layout-planner.ts` 与 `src/domain/layout/` 并存，待收敛。
当前 `layout-planner.ts`（1063 行）含大量应在 domain 的逻辑：

| 待归位 | 当前位置 | 目标位置 |
| --- | --- | --- |
| `planStage0-3` 各函数 | `src/systems/layout-planner.ts` | 纯逻辑提取到 `src/domain/layout/planner.ts`（新）；系统侧只留 `planRoom` 入口 + Game API 调用 |
| `planHubRoads`/`planRoads` 包装 | 同上 | 归 domain |
| `shouldPlan` 判定 | 同上 | 归 domain（纯函数） |

**裁决**：D2 是 P4 的主要新增工作。归位遵循蓝图 §3.3：
- domain 纯函数不触 Game/Memory
- 系统侧只留队列推进与 site 签发
- 范围同 P3 的 D1 归位先例

## 3. 验收门槛映射

| 冻结验收门槛（IMPLEMENTATION_PHASES P4 行） | 落实 |
| --- | --- |
| RCL1→RCL6 无人工干预且模板冲突只标 `blocked` | 存量已实现（e2e-002 RCL1→RCL2 + a1-bootstrap-tower RCL2→RCL3 + rcl4-automation RCL4+）；P4 补 RCL5→RCL6 链路验证 |
| link 自动维持 storage 水位 | link-system 已实现（source→storage→controller 固定路由 + 水位阈值）；P4 验证 RCL5 切换点 |
| 道路只出现在实测热路径（Scenario A） | road-policy 双窗口阈值 + corridor-roads 逐段；P4 验证 Scenario A |

## 4. P4 执行计划

1. **D2 归位**：layout-planner 纯函数提取到 `src/domain/layout/planner.ts`，系统侧薄壳
2. **RCL5→RCL6 链路验证**：补充集成测试覆盖 link 网切换 + terminal/lab 解锁
3. **Scenario A 道路验证**：集成测试验证道路只出现在热路径
4. **验收报告**：P4_FINAL_REPORT 按 §5 出口=指标裁决

## 5. P4 执行边界

- 只动：`src/domain/layout/planner.ts`（新）、`src/systems/layout-planner.ts`（薄壳化）、相关测试
- 不动：construction-manager / link-system / road-policy / corridor-roads 的行为（已成熟）
- 不动：Kernel / 布局模板内容 / remote / war / market
- Memory：无 schema 变更（layout 版本化已在 v36 中）
