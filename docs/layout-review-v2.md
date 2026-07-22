# 布局审查报告与修复记录（compact-core-v1 → v2）

> 审查问题：当前布局是否合理？是否会形成建筑孤岛？
> 结论：**会，且是 P0 级致命缺陷**。v1 模板全建成后 29/68 个结构被完全密封。
> 本文件记录分析过程、修复方案与永久守卫。修复已实施并通过全部质量门槛。

## 1. 问题：v1 是全密封实心块

将 v1 的 68 个 cell + 锚点 spawn 渲染（S=spawn O=storage T=tower L=link e=extension）：

```
...........
...eeeeee..
..eeeeeee..
.eeTeeeT.e.
.eeeeSeeee.
.eeeSSLeee.
.eeeeOeeee.
.e..eeeTee.
..eeeeeLe..
..eeeeeee..
...........
```

**引擎硬约束**：`transfer` / `spawnCreep` / `repair` 射程均为 1。
任何障碍结构（spawn/extension/tower/storage/link）若没有 ≥1 个相邻可站格，
就永远无法被填充、维修或吐出 creep —— 即「建筑孤岛」。

检测结果（8 邻居全被障碍堵死 = 密封）：

| 结构 | 密封数 | 后果 |
| --- | ---: | --- |
| spawn ×3 | 3 | RCL8 全部无法孵化（RCL7 起仅剩 1 出生格） |
| storage | 1 | 经济心脏停跳，hauler 无法存取 |
| tower | 2/3 | 防御弹药补不进，入侵时失效 |
| extension | 22/60 | 幽灵容量，永远填不满 |
| link | 1/2 | hub 无法手动补能 |
| **合计** | **29/68** | 殖民地慢性自杀 |

**窒息时间线**：RCL4（storage 落位）开始勒紧 → RCL5（link/塔周围填满）部分封死 →
RCL7（spawn2）主 spawn 仅剩 1 格 → RCL8（spawn3）全部锁死。
集成测试未暴露的原因：mock 不模拟真实射程与寻路阻挡。

**根因**：
1. 模板手排实心块，无任何几何约束；
2. `validateBuildCell` 只查边界/RCL/地形/占用/依赖，从不检查「服务格」；
3. 无几何不变量测试兜底。

## 2. 修复方案（已实施）

### 2.1 compact-core-v2：偶校验棋盘格

所有结构只落在 `(dx+dy) % 2 === 0` 的格子上，奇数格永远留作走道。
每个结构天然拥有 4 个正交可站格，**从几何上不可能密封**：

```
○·○·○·○·○·○·○·○      ○=偶校验空槽(未来可用)
·○·○·○·e·e·○·○·      ·=奇校验走道格
○·e·e·e·○·e·e·○      e=extension（各有 4 个走道邻居）
·○·e·e·e·e·e·○·
○·e·e·e·e·e·e·○      S=spawn（4 个出生格）
·○·e·T·S·T·e·e·      T=tower O=storage L=link
○·○·e·e·e·e·e·○
·e·e·S·S·e·e·e·
○·e·e·e·L·e·e·○
·e·e·L·O·T·e·e·
○·e·e·e·e·e·e·○
·○·e·e·e·e·e·○·
○·e·e·e·e·e·e·○
·○·○·e·e·e·○·○·
○·○·○·○·○·○·○·○
```

验证结果：69 个结构（60 ext + 3 spawn + 3 tower + 1 storage + 2 link），
**密封 0，每个 spawn 4 个出生格**。
extension 批次 5/10/20/30/40/50/60 与 CONTROLLER_STRUCTURES 完全一致；
RCL8 环扩到 ±6（棋盘格密度 ~50%，69 个结构需要更大占地）。

### 2.2 校验器密封守卫（`src/domain/layout/validation.ts`）

`validateBuildCell` 新增第 4.5 步（返回码 `"seal"`）：
- 候选位置出生即密封 → 拒绝；
- 候选夺走相邻障碍结构的最后一个可站格 → 拒绝；
- road/container/rampart（可通行）不检查；
- 动态 source/controller link 任务同样接入（task-factory）。

配套：`buildObstaclePositionSet()` 每规划周期预计算一次，O(1) 查询。

### 2.3 迁移 v5 → v6（`src/kernel/memory.ts`）

- `templateId` → `compact-core-v2`、`layout.version` → 2；
- 清理 buildQueue 中未开工的 `core.*` 任务（queued/blocked），
  已开工/已建（site/done）保留——不拆不改已建成结构（plan §5.6.1 原则）；
- `revision + 1`、`nextPlanTick = 0` 触发重规划；幂等（已是 v2 则跳过）。

### 2.4 永久守卫测试

| 文件 | 守护内容 |
| --- | --- |
| `tests/layout-v2.test.ts` | 偶校验、零密封、spawn ≥2 出生格、ext 批次数量、占地 ≤±6、优先级语义 |
| `tests/seal-guard.test.ts` | wouldSeal 三种情形、工地计入障碍、container/road 豁免、validateBuildCell 接入与向后兼容 |
| `tests/migration-v6.test.ts` | v5→v6 升级、任务清理范围、幂等、无 layout 房间 |

任何未来的 cell 修改若制造密封，`layout-v2.test.ts` 立即失败。

## 3. 影响面与遗留事项

- `src/domain/layout/templates/compact-core-v1.ts` 已删除；
  `layout-planner` / `layout.test.ts` 全部切换到 v2。
- `docs/plan.md`（§3.4 版本、§5.6.3 算法、§5.6.4 验证器签名）、
  `docs/creep-behavior-constraints.md`（R2-B-02）已同步。
- 质量门槛：typecheck ✅ / 389 tests ✅（新增 18）/ build ✅。
- 遗留（非本次范围）：v1 时代已按 v1 坐标建成的既有房间，
  迁移后 v2 蓝图与实际结构错位 —— 按 plan §5.6.1「不自动拆改」原则，
  冲突 cell 会被标记 blocked，需人工确认或 `layout.state = "manual"` 接管。
  官服当前若已有建成房间，建议部署后人工巡检一次布局。

## 4. 补充：cell 落在墙/不可修建格的处理（fallback relocation）

**问题**：v2 锚点跟随既有 spawn，地形不可控 —— cell 落在墙上怎么办？

**回答（已实现）**：
1. `validateBuildCell` 返回 `terrain`/`occupied`/`seal` 的候选不会入队，
   每个规划周期（50 tick）重新评估，无错误刷屏、无状态损坏；
2. **extension 属可移动结构**：永久失败时按同 parity（偶校验）的
   Chebyshev-2 fallback 偏移依次试位，第一个通过完整验证（含密封守卫）
   的替代格胜出，替代坐标持久化到 segment `overrides`——
   后续周期 `blueprintToTasks` 直接使用替代坐标，不再重复搜索；
   fallback 偏移全部保持偶校验，新位置的 4 个正交邻居仍是走道格，
   **重定位不可能制造新密封**；
3. **不可移动核心结构**（spawn/storage/tower/link）不搬家，维持跳过
   （blocked 语义）——它们的位置是防御/物流几何的一部分，
   挪一格可能毁掉整个核心；
4. 禁止落子集合（全部蓝图 cell 绝对坐标 + 队列任务坐标）防止两个
   cell 被搬到同一格。

测试：`tests/layout-relocate.test.ts`（6 项：落墙重定位、parity 保持、
禁止落子、密封守卫在 fallback 中生效、不可移动类型、全失败安全跳过、
overrides 应用）。
