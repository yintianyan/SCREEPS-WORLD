# Phase 37 Closure Audit — Phantom Transporter 修复真实性审计

> Phase 37 · 审计文档 1/6
> 日期: 2026-08-26
> 审计范围: 全 repo transport role 语义 + 修复真实性 + 架构退化检查
> 状态: TD-37-3 已修复，本文档审计结论不变

---

## PHASE37-ROOT-CAUSE-CLOSURE

### 裁决: **CLOSED**

---

## 1. 全 repo Transport Role 语义搜索

### 1.1 搜索范围

对 `src/` 目录全文搜索以下关键词：
- `"transporter"` — 幽灵角色名
- `"hauler"` — 实际运输角色（源→sink）
- `"distributor"` — 实际分发角色（storage→sink）
- `CONFIG.roles` — 角色配置表
- `bootstrap.ts` — 角色注册表

### 1.2 搜索结果

#### `"transporter"` 出现位置（修复后）

| 文件 | 行号 | 上下文 | 性质 |
|------|------|--------|------|
| `expansion-manager.ts` L416 | `transporterActive: false` | CP2 检查中硬编码 false（CP2 不需要物流） | **无害** — CP2 只检查 spawn |
| `expansion-manager.ts` L511 | `transporterActive: logisticsActive` | CP3 传入修复后的 `logisticsActive`（hauler‖distributor） | **已修复** |
| `expansion-manager.ts` L541 | `transporterActive: logisticsActive` | CP4 同上 | **已修复** |
| `expansion-manager.ts` L643 | `transporterActive: economicInput.hasTransporter` | CP5 传入修复后的值 | **已修复** |
| `checkpoint.ts` L68 | `transporterActive: boolean` | 接口字段名保留 | **TD-37-1 兼容保留** |
| `checkpoint.ts` L169-174 | CP3 判定逻辑使用 `transporterActive` | 纯函数消费字段名 | **语义已变更** |
| `economic-activation.ts` L30 | `hasTransporter: boolean` | 接口字段名保留 | **TD-37-2 兼容保留** |
| `economic-activation.ts` L86 | evidence 字符串 `transporter=` | 纯函数消费字段名 | **语义已变更** |

#### `"hauler"` 和 `"distributor"` 在 expansion-manager 中的修复点

| 位置 | 修复前 | 修复后 | 验证 |
|------|--------|--------|------|
| L493-499 (advanceEconomicStartup) | `c.memory.role === "transporter"` | `c.memory.role === "hauler" \|\| c.memory.role === "distributor"` | ✅ |
| L596-604 (advanceIntegrating) | `c.memory.role === "transporter"` | `c.memory.role === "hauler" \|\| c.memory.role === "distributor"` | ✅ |

### 1.3 角色注册一致性验证

| 验证项 | 结果 | 证据 |
|--------|------|------|
| `CONFIG.roles` 包含 `hauler` | ✅ | `config/index.ts` L529: `hauler: { minCount: 2, maxCount: 6 }` |
| `CONFIG.roles` 包含 `distributor` | ✅ | `config/index.ts` L530: `distributor: { minCount: 1, maxCount: 3 }` |
| `CONFIG.roles` 不包含 `transporter` | ✅ | grep 无命中 |
| `bootstrap.ts` 注册 `haulerRole` | ✅ | L205: `.registerRole(haulerRole)` |
| `bootstrap.ts` 注册 `distributorRole` | ✅ | L207: `.registerRole(distributorRole)` |
| `bootstrap.ts` 未注册 `transporterRole` | ✅ | grep 无命中 |
| `TUNABLE_ROLES` 包含 `hauler` | ✅ | `config/tuned.ts` L23 |
| `TUNABLE_ROLES` 包含 `distributor` | ✅ | `config/tuned.ts` L30 |
| `TUNABLE_ROLES` 不包含 `transporter` | ✅ | grep 无命中 |

### 1.4 Spawn Manager 角色孵化链路验证

hauler 的孵化链路（从 demand 到 spawn）：

```
demand.ts (L485-492)
  → haulerTarget = dynamicHaulerTarget (基于 container 数量 + 能量状况)
  → if (haulerTotal < haulerTarget && hasLogistics)
    → createRequest("hauler", home, i, key, 1, ...)
      → submitRequest(queue, { role: "hauler", ... })
        → spawn-manager 消费 queue → spawnCreep()
```

distributor 的孵化链路：

```
demand.ts (L494+)
  → if (hasStorage) { distTarget = ... }
  → if (distTotal < distTarget)
    → createRequest("distributor", ...)
      → submitRequest(queue, { role: "distributor", ... })
        → spawn-manager 消费 queue → spawnCreep()
```

**结论**：hauler 和 distributor 在 demand → spawn 链路中完整存在，是系统实际使用的运输角色。

---

## 2. 修复真实性判断

### 2.1 hauler 是否真的承担原 transporter 的职责？

**是。** 证据：

1. **hauler 角色定义**（`creeps/roles/hauler.ts`）：从 source container → storage/spawn/extension 搬运能量。这是经典的 "transporter" 职责。
2. **kernel.ts L170-175**：预构建 `haulerRooms` 集合，供 `isLogisticsContainer` 判定 container 是否有物流消费者。
3. **assignment/service.ts L101-104**：注释明确 "hauler 永不从 storage 取能" — hauler 是源→sink 方向。
4. **CONFIG.roles.hauler**：`minCount: 2, maxCount: 6` — 与运输职责匹配的编制。

### 2.2 distributor 是否在特定阶段承担运输职责？

**是。** 证据：

1. **distributor 角色定义**（`creeps/roles/distributor.ts`）：从 storage → spawn/extension/tower/lab 分发能量。
2. **kernel.ts L170**：预构建 `distributorRooms` 供 hauler 的 `fillStorage` 泵断供兜底。
3. **CONFIG.roles.distributor**：`minCount: 1, maxCount: 3` — RCL4+ 有 storage 时分发。
4. **recovery-execution-system.ts L367-414**：灾后恢复时直接提交 distributor 请求以加速能量分发。

### 2.3 是否存在其他地方仍然硬编码 transporter？

**不存在。** 全 repo grep `"transporter"` 结果：
- `expansion-manager.ts`：已修复（传入 `logisticsActive` 而非硬编码 false）
- `checkpoint.ts` / `economic-activation.ts`：接口字段名 `transporterActive` / `hasTransporter` 保留兼容（TD-37-1/2），但调用方传入的是基于 `hauler‖distributor` 的真实检查结果

### 2.4 字符串角色名漂移检查

| 检查项 | 结果 |
|--------|------|
| spawn role 与 runtime role 一致 | ✅ demand.ts 产出的 role 与 bootstrap.ts 注册的 role 一致 |
| bootstrap role expectation 与 spawn-manager 一致 | ✅ spawn-manager 消费 queue 中的 role 字段 |
| CONFIG.roles 与 TUNABLE_ROLES 一致 | ✅ role-config-parity 测试断言 |
| 无第二套 role mapping | ✅ 见架构退化审查（§5） |

---

## 3. 架构退化审查

### 3.1 expansion-manager 是否变成第二个 Spawn Manager？

**否。** 证据：

1. **expansion-manager 不直接调用 `spawnCreep`**：grep `spawnCreep` 在 `expansion-manager.ts` 中无命中。
2. **通过 spawn queue 提交请求**：`submitClaimer()` 和 `submitPioneers()` 都通过 `submitRequest(queue, ...)` 提交到 sponsor 房间的 `spawnQueue`，由 spawn-manager 统一消费。
3. **不直接修改 Empire state**：`Memory.kernel.expansion` 是扩张状态机的自有字段，不覆盖其他系统的状态。
4. **不绕过 Demand/Spawn pipeline**：pioneer 的 worker/builder 通过 spawn queue 提交，hauler/distributor/harvester 由 demand.ts 自动评估产生。

### 3.2 是否引入第二套 role mapping？

**否。** expansion-manager 只在两处检查 logistics 活跃度（L496-499, L601-604），使用的是 inline 检查 `c.memory.role === "hauler" || c.memory.role === "distributor"`，没有定义新的角色枚举或映射表。这属于系统层的运行时状态检查，不是角色定义。

### 3.3 是否绕过 Operation state machine？

**否。** expansion-manager 有自己的状态机（`validating → preparing → claiming → claimed → bootstrapping → economic_startup → integrating → completed`），不修改 Operation 的状态。`ExecutionOperation` 类型定义在 `execution-operation.ts` 中，是纯数据模型，不与 expansion-manager 的 Memory 状态冲突。

### 3.4 硬编码角色检查的架构合规性

expansion-manager 中 inline 检查 `c.memory.role === "hauler" || c.memory.role === "distributor"` 是否违反架构约束？

**不违反。** AGENTS.md 规定"角色禁止全房 find、全局扫描"——但 expansion-manager 的检查是 `Object.values(Game.creeps).some(c => c.memory.home === expansion.target && ...)`，这是按 home 房过滤的，不是全房 find。检查的是已存活 creep 的 role 字段，不是创建新的 spawn 请求或角色定义。

**但存在轻微技术债**：如果未来新增第三个运输角色（如 `sherpa`），需要同步修改 expansion-manager。建议未来提取为 `isLogisticsRole(role)` 工具函数。当前只有两个角色，inline 检查可接受。

---

## 4. 修复证据汇总

| 修复点 | 文件 | 行号 | 修复前 | 修复后 | 验证方法 |
|--------|------|------|--------|--------|----------|
| CP3 logistics check | expansion-manager.ts | 496-499 | `role === "transporter"` | `role === "hauler" \|\| "distributor"` | grep + 代码审查 |
| Economic Activation logistics check | expansion-manager.ts | 601-604 | `role === "transporter"` | `role === "hauler" \|\| "distributor"` | grep + 代码审查 |
| execution-operation.ts completion criteria | execution-operation.ts | L94 | `"transporter deployed"` | `"hauler or distributor deployed"` | 代码审查 |
| CP3 evidence string | checkpoint.ts | L174 | `missing.push("transporter")` | 保留（接口字段名兼容） | TD-37-1 |
| Economic evidence string | economic-activation.ts | L86 | `transporter=` | 保留（接口字段名兼容） | TD-37-2 |

---

## 5. 最终裁决

```
═══════════════════════════════════════════════════
          PHASE37-ROOT-CAUSE-CLOSURE: CLOSED
═══════════════════════════════════════════════════

  Phantom Transporter Bug:    FIXED & VERIFIED
  Role semantic drift:        NONE
  Architecture degradation:   NONE
  Second Spawn Manager:       NONE
  Hardcoded transporter:       NONE (only compat field names)

═══════════════════════════════════════════════════
```
