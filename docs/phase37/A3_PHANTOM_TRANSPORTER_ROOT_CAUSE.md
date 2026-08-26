# A3 Phantom Transporter Bug — 根因分析报告

> Phase 37 · 审计文档 1/4
> 日期: 2026-08-26
> 裁决: **ROOT CAUSE IDENTIFIED & FIXED**

---

## 1. 事故现象

扩张状态机在 `economic_startup` 阶段永远无法推进到 `integrating`，导致所有新殖民地
在超时后被回收。具体表现：

- CP3 (Energy Loop) 永远不通过
- Economic Activation 永远不激活
- 扩张必然超时 → `abortExpansion` → 殖民地丢失

---

## 2. 根因定位

### 2.1 幽灵角色 `"transporter"`

系统在以下位置硬编码检查 `"transporter"` 角色：

| 文件 | 位置 | 原代码 |
|------|------|--------|
| `src/systems/expansion-manager.ts` | `advanceEconomicStartup()` L490 | `c.memory.role === "transporter"` |
| `src/systems/expansion-manager.ts` | `advanceIntegrating()` L601 | `c.memory.role === "transporter"` |
| `src/domain/expansion/execution-operation.ts` | `completionCriteria` L94 | `"transporter deployed"` |

**但 `"transporter"` 角色在系统中不存在：**

- `CONFIG.roles` — 无 `transporter` 定义
- `spawn-manager` — 无 `transporter` 注册
- `demand.ts` — 无 `transporter` demand 产生
- `bootstrap.ts` — 无 `transporter` 注册

### 2.2 实际运输角色

实际承担运输任务的角色是：

| 角色 | 适用 RCL | 职责 |
|------|---------|------|
| `hauler` | RCL 1-4 | Source → Spawn/Extension/Container |
| `distributor` | RCL 4+ | Storage → Sink（含 terminal/factory） |

两者在 `CONFIG.roles` 中均有定义且由 `spawn-manager` 正常孵化。

### 2.3 影响链

```
expansion-manager 检查 "transporter" 角色
  ↓ 角色不存在
logisticsActive = false
  ↓
CP3_ENERGY_LOOP 检查 transporterActive = false → 不通过
  ↓
economic_startup 阶段永远无法推进到 integrating
  ↓
pioneerTimeout × 2 超时
  ↓
abortExpansion() → 殖民地回收
```

---

## 3. 修复方案

### 3.1 expansion-manager.ts 修复

将 `"transporter"` 角色检查替换为 `"hauler" || "distributor"`：

```typescript
// 修复前（advanceEconomicStartup / advanceIntegrating）:
const logisticsActive = Object.values(Game.creeps).some(
  c => c.memory.home === expansion.target &&
    c.memory.role === "transporter",  // ← 幽灵角色
);

// 修复后:
const logisticsActive = Object.values(Game.creeps).some(
  c => c.memory.home === expansion.target &&
    (c.memory.role === "hauler" || c.memory.role === "distributor"),
);
```

### 3.2 execution-operation.ts 修复

将 colonize 操作的完成准则从 `"transporter deployed"` 改为 `"hauler or distributor deployed"`。

### 3.3 checkpoint.ts 与 economic-activation.ts — 无需修改

这两个纯函数模块的 `transporterActive` / `hasTransporter` 参数是通用接口参数，
由调用方（expansion-manager）传入值。修复在调用方完成：调用方现在传入真实的
`logisticsActive`（hauler 或 distributor 存在时为 true）作为 `transporterActive` 参数值。

接口参数名 `transporterActive` 保留向后兼容，语义已从"phantom transporter角色存在"
变为"物流活跃（hauler或distributor存在）"。

---

## 4. 验证

### 4.1 测试覆盖

| 测试文件 | 测试数 | 状态 |
|----------|--------|------|
| `a3-phantom-transporter-reproduction.test.ts` | 12 | ✅ 全通过 |
| `a3-phantom-transporter-counterfactual.test.ts` | 19 | ✅ 全通过 |
| `a3-3-e2e.test.ts` | 25 | ✅ 全通过 |
| `a3-4-e2e.test.ts` | 21 | ✅ 全通过 |
| **合计** | **77** | **✅ 全通过** |

### 4.2 类型检查

```
npm run typecheck → ✅ 全绿
```

### 4.3 闭环验证

完整链路验证：

```
Demand → Spawn → Transport(hauler/distributor) → Bootstrap → Economy → Integration
```

- Demand: `evaluateDemand` 产生 hauler/distributor 需求 ✅
- Spawn: `spawn-manager` 孵化 hauler/distributor ✅
- Transport: hauler/distributor 存活时 `logisticsActive = true` ✅
- Bootstrap: CP3 在 logisticsActive=true 时通过 ✅
- Economy: Economic Activation 在 hasTransporter=true 时激活 ✅
- Integration: 进入 integrating → completed ✅

---

## 5. 技术债登记

| 编号 | 描述 | 严重度 | 状态 |
|------|------|--------|------|
| TD-37-1 | checkpoint.ts 接口参数名 `transporterActive` 语义已变为"物流活跃" | Low | 保留兼容，内联注释说明 |
| TD-37-2 | economic-activation.ts 接口参数名 `hasTransporter` 同上 | Low | 保留兼容，内联注释说明 |

---

## 6. 结论

**根因**: expansion-manager 硬编码检查不存在的 `"transporter"` 角色，导致 CP3 和
Economic Activation 永远不可通过。

**修复**: 将角色检查改为 `"hauler" || "distributor"`，与 `CONFIG.roles` 和
`spawn-manager` 的实际定义对齐。

**验证**: 77 个测试全通过，类型检查全绿，完整闭环链路验证通过。
