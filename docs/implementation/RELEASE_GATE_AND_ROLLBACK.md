# 发布门禁与回滚规程

> Post-A5 Release Hardening 阶段建立的正式发布门禁。
> 适用范围：所有面向 MMO 正式环境的部署。

## 1. 发布前门禁清单（全部必须通过）

| # | 检查项 | 命令 / 证据 | 通过标准 |
| --- | --- | --- | --- |
| 1 | TypeScript 类型检查 | `npm run typecheck` | 零错误 |
| 2 | 单元 + 集成测试 | `npm test` | 全绿（0 failures, 0 skipped, 0 todo） |
| 3 | 构建 | `npm run build` | `dist/main.js` 成功生成 |
| 4 | E2E 全套 | `npx vitest run --config vitest.e2e.config.ts` | 17/17 suite 全绿，45/45 tests 全绿 |
| 5 | 私服 Canary Soak | 私服 ≥10000 tick 连续运行报告 | 无事件丢失、无重复终态、无 Memory 增长、无 CPU 失控、global reset 可恢复 |
| 6 | 工作区干净 | `git status` | nothing to commit, working tree clean |
| 7 | 文档与测试数量一致 | 人工核对 | TECH_DEBT_LEDGER.md 条目与实际代码变更一致 |

**门禁纪律：** 任何一项未通过即 BLOCKED，不得以"先上线后修复"为由绕过。

## 2. Node 版本要求

- **使用 `.nvmrc` 指定的 Node 版本**（当前 24.18.0）。
- `isolated-vm` ABI 兼容问题已通过 `tests/e2e/setup.ts` 自动检测和重建解决。
- E2E setup 会自动检测 V8 snapshot 和 ABI 不匹配并重新编译，无需手动操作。
- 切换方法：`source ~/.nvm/nvm.sh && nvm use`（自动读取 `.nvmrc`）。

## 2.1 E2E 基础设施约束

| 约束 | 根因 | 解法 |
| --- | --- | --- |
| **mockup addBot 重置 controller** | `world.addBot()` 把 controller 强制设为 `level=1, progress=0`（mockup world.js:216），fixture 预设的 RCL 和 `sendConsole('controller.level=4')` 均无效 | `ScenarioRunner.setup({controllerLevel: N})` 在 addBot 后、server 启动前通过 DB 直接修正 |
| **controller.level getter-only** | runtime 中 `StructureController.level` 是 getter-only，`sendConsole` 赋值在严格模式抛 TypeError、非严格模式静默失败 | 同上 — 只能用 DB 更新 |
| **vitest v2 无 --forceExit 且挂起** | screeps-server-mockup storage 无法优雅关闭；`@screeps/common` storage.js 断连后 `setTimeout(_connect, 1000)` 无限重连 hold 住 worker 事件循环；vitest v2.1.9 正常结束走 `ctx.close()`（无 teardownTimeout 兑底），`pool.close()` 等待 worker 永久挂起 | 三层：① `ServerHarness.dispose()` 对子进程 SIGKILL + disconnect IPC；② `tests/e2e/global-setup.ts`（globalSetup teardown，主进程）设置 unref'd 强退 timer 兑底（5s，`process.exit(process.exitCode ?? 0)` 保退出码）；③ `setup.ts` 注册 `process.on('disconnect')` 防孤儿 worker |
| **process.exit 被 vitest patch** | vitest v2 在 worker runtime 中把 `process.exit` 替换为抛错函数（execute.js:600） | 只能在主进程（globalSetup）调用 process.exit；worker 内需要退出时用 `process.reallyExit`（未被 patch） |

## 3. 回滚规程

### 3.1 已提交改动（已 git commit）

**方法：`git revert`**

```bash
# 确认要回滚的 commit
git log --oneline -5

# 创建 revert commit（不改写历史）
git revert <commit-hash>
```

- revert 会创建新的反向 commit，不改写历史。
- revert 后仍需通过门禁清单（至少 1-4 项）。
- 如果 revert 涉及 schema 变更，必须确认降版保护机制生效
  （`runMigrations` 会输出 `[schema] WARNING` 告警）。

### 3.2 未提交改动（仅工作区修改）

**方法：生成补丁后清理**

```bash
# 保存当前工作区为补丁
git diff > /tmp/wip-changes.patch

# 确认补丁内容
cat /tmp/wip-changes.patch | head -50

# 清理工作区
git checkout -- .
git clean -fd

# 如需恢复
git apply /tmp/wip-changes.patch
```

### 3.3 禁止的方法

| 禁止方法 | 原因 |
| --- | --- |
| `git checkout HEAD~1` 覆盖工作区 | 丢弃未提交修改且不可恢复；不创建审计记录 |
| `git reset --hard` 回退已推送的 commit | 破坏远程历史，导致协作者冲突 |
| `git push --force` 到共享分支 | 破坏远程历史 |

### 3.4 Memory Schema 降级保护

如果回滚导致代码 `schemaVersion` 低于 Memory 中的值：
- `runMigrations` 会检测到降版并输出告警（每次 global reset 告警一次）。
- 旧版代码只读不写新 schema 字段，不会破坏数据。
- 但新字段数据会被旧代码忽略（不影响运行，但不消费）。
- 重新前滚后 `getOutcomeChannel` 的惰性迁移会自动恢复。

## 4. OutcomeChannel 实现隔离边界

### 4.1 两套实现的职责

| 实现 | 路径 | 用途 | 容量 | 字段名 | 写入 Memory |
| --- | --- | --- | --- | --- | --- |
| **生产** | `src/kernel/outcome-channel.ts` | 帝国运行时唯一 OutcomeChannel | cap=16 | q/s/dr/oe | ✅ 直接操作 |
| **reference** | `src/domain/intelligence/uoem/channel.ts` | 纯 Domain 层理论证明 | cap=32 | entries/seq/seen | ❌ 纯函数 |

### 4.2 不可混用规则

- **生产代码（`src/`）只允许导入 `src/kernel/outcome-channel.ts`**。
- `src/domain/intelligence/uoem/channel.ts` 标注 `⚠️ REFERENCE IMPLEMENTATION — NOT FOR PRODUCTION USE`，只允许 `tests/` 目录导入。
- 隔离测试 `tests/unit/phase38/uoem-channel-isolation.test.ts` 验证：
  - 两者容量不同（16 vs 32）；
  - 字段名不重叠（q/s/dr/oe vs entries/seq/seen）；
  - 生产实现不创建 reference 字段；
  - reference 实现不写入 Memory；
  - bootstrap.ts 不导入 reference 实现。

### 4.3 Schema 回滚风险

当新代码（schemaVersion=41）产生 v41 Memory 后，如果回滚到旧代码（schemaVersion=40）：

1. **旧代码遇到 schemaVersion=41 时**：
   - `runMigrations` 检测到 `current > CONFIG.memory.schemaVersion`，输出 `[schema] WARNING` 告警。
   - 旧代码**只读不写**新字段（不破坏数据）。
   - 新字段（q/s/dr/oe）会被旧代码忽略（不影响运行，但不消费）。
   - 旧代码的 `getOutcomeChannel` 惰性迁移会自动恢复旧字段名作为安全网。

2. **重新前滚到新代码时**：
   - v41 迁移会重新执行（幂等），将残留旧字段迁移到新字段。
   - 如果旧代码已创建了旧字段（queue/seen/...），迁移会将其转换为新字段并删除旧字段。
   - 如果旧代码没有创建 outcomeEvents（全新环境），迁移安全跳过。

3. **禁止事项**：
   - 不得手动修改 `Memory.schemaVersion`。
   - 不得在旧代码中写入或删除 v41 新字段。
   - 不得让两套 OutcomeChannel 实现同时写入 Memory。

## 5. Canary 失败降级

### 5.1 自动降级

当 canary 环境检测到以下情况时，系统**自动降级**（无需人工干预）：

| 触发条件 | 降级行为 |
| --- | --- |
| CPU bucket < Guarded 阈值 | P3 系统暂停，P2 降频 |
| CPU bucket < Conserve 阈值 | P2 系统暂停，仅 P0/P1 运行 |
| CPU bucket < Recovery 阈值 | 仅 P0 生存链路运行 |
| 单系统连续失败 3 次 | 该系统进入 50-200 tick 冷却（P0 永不冷却） |
| Memory 体积超阈值 | 低频清理钩子加速执行 |

### 5.2 人工灾难接管

当自动降级无法恢复时（如 spawn 全毁、Memory 不可恢复损坏）：

1. **判定灾难等级**：
   - P0 灾难：spawn 全毁 + 无兄弟房可 claim → 人工接管
   - P1 灾难：Memory 不可恢复损坏 → 从 `git revert` 回滚后重启
   - P2 灾难：CPU 持续枯竭 → 缩减帝国规模（拆除远矿/降级发展）

2. **接管步骤**：
   ```bash
   # 1. 确认当前版本
   git log --oneline -3

   # 2. 回滚到最后一个稳定版本
   git revert <bad-commit>

   # 3. 验证回滚后代码可运行
   npm run typecheck && npm test && npm run build

   # 4. 部署到 MMO
   # 使用你的部署工具上传 dist/main.js
   ```

3. **接管后验证**：
   - 观察至少 500 tick 确认系统稳定
   - 确认 `Memory.schemaVersion` 正确
   - 确认 CPU bucket 恢复到 Healthy 阈值以上

## 6. 发布说明分类

每次发布说明必须使用以下分类：

| 分类 | 含义 | 示例 |
| --- | --- | --- |
| **VERIFIED** | 已被测试或运行证据证明 | "E2E 17/17 全绿" |
| **ASSUMPTION** | 基于架构推断但未验证 | "Memory 应在 10000 tick 内不增长" |
| **BLOCKED** | 被外部环境限制无法验证 | "私服 soak 未完成（环境不可用）" |
| **REMAINING RISK** | 已知但未消除的风险 | "MMO 真实 PvP 场景未验证" |

## 7. 发布说明模板

```
## Release vX.Y.Z (YYYY-MM-DD)

### VERIFIED
- [具体验证项，附带测试名/指标]

### ASSUMPTION
- [基于架构的推断，说明推断依据]

### BLOCKED
- [被阻塞的验证项，说明阻塞原因和消除条件]

### REMAINING RISK
- [残留风险，说明影响范围和监控方法]
```
