# A3.1 Empire Resource Network — 最终实施报告

## 概述

A3.1 将 A3.0 的点对点（A→B）可靠执行骨架升级为多房间、多请求、多操作的 **Resource Graph** 资源网络。系统现在支持多对多分配、事件驱动重平衡、抢占策略和防抖机制。

## 实施清单

### Phase 1 — Model Layer（8 个纯函数模块）

| 模块 | 文件 | 描述 |
|------|------|------|
| Supply Node | `src/domain/operation/supply-node.ts` | 房间级资源富余的网络投影，含 health 评分 + priority 推导 |
| Demand Node | `src/domain/operation/demand-node.ts` | 房间级资源缺口的网络投影，含 criticality 分级 + starvation aging |
| Network Snapshot | `src/domain/operation/network-snapshot.ts` | 全局供需快照，含 gap 计算 + rebalance 触发判定 |
| Allocation Policy v2 | `src/domain/operation/allocation-policy.ts` | 7 因子可解释多对多分配，TOCTOU 防护 + Operation Storm 防护 |
| Preemption Policy | `src/domain/operation/preemption.ts` | 四分类抢占（critical/committed/preemptable/conditional） |
| Plan Stability | `src/domain/operation/stability.ts` | 防抖四防线（hysteresis + commitment + threshold + cooldown） |
| Network Health | `src/domain/operation/network-health.ts` | 四档健康度（healthy/constrained/degraded/critical） |
| Network Rebalance | `src/domain/operation/rebalance.ts` | 事件驱动 + debounce + cooldown 状态机 |

### Phase 2 — Integration（agenda-manager 全面重构）

**TOCTOU 修复**：
- Operation 创建循环中使用本地 `sourceTransferable` Map 递减可用量，不再依赖外部 `registry.transferable` 快照
- 每创建一个 Reservation 后立即递减，确保同 tick 内不超卖

**Baseline 污染修复**：
- 移除 `verifyTransfer`（storage delta 验证）的依赖
- 改用 carrier 的 `store.getCapacity(RESOURCE_ENERGY)` 作为实际送达量
- Carrier 空载 = 已卸完 → 用 carry 容量更新 `deliveredAmount`
- 多 Operation 并发向同一 target 送能时不再互相干扰

**Allocation Policy v2 接入**：
- `allocateMultiRoom` → `allocateNetwork`（7 因子可解释排序）
- 支持 Multi-Source Fulfillment（一个 Demand Node 可被多个 Supply Node 共同满足）
- 支持 Partial Allocation（Supply < Demand 时产出部分分配而非跳过）

**Operation Storm 防护**：
- 全局上限 `MAX_GLOBAL_OPERATIONS = 20`
- Per-source 上限 `MAX_TARGETS_PER_SOURCE = 3`
- Per-target 上限 `MAX_SOURCES_PER_TARGET = 3`

**Network Health + Rebalance 接入**：
- 每 100 tick 构建 NetworkSnapshot + 计算 NetworkHealth
- RebalanceState 事件缓冲 + debounce（50 tick）+ cooldown（200 tick）
- `globalCache.networkSnapshot` + `globalCache.networkHealth` 供其他系统消费

### Phase 3 — Scheduler

- `safeRun` 单点错误隔离已有（kernel.ts 包裹每个 system.run）
- 事件驱动 rebalance 已在 agenda-manager 中实现
- Replan 事件通道保留（`queueReplanEvent` + `queueRebalanceEvent`）

### Phase 4 — Testing（53 个测试全通过）

| 测试文件 | 测试数 | 范围 |
|---------|--------|------|
| `a3-1-contract.test.ts` | 43 | Supply/Demand Node + Network Snapshot + Allocation v2 + Preemption + Stability + Rebalance |
| `a3-1-simulation.test.ts` | 10 | 4 Room Simulation + Scale Test (30 demand) + 10k Tick Stability + Network Health E2E |

### Phase 5 — 验收

- `npm run typecheck` ✅ 零错误
- `npm test` ✅ 2876/2876 全通过（含 53 个 A3.1 新测试）
- `npm run build` ✅ 5.8s 编译成功

## 架构裁决实施状态

| Architecture Review 裁决 | 状态 | 实施 |
|-------------------------|------|------|
| Supply/Demand Node 抽象 | ✅ | `supply-node.ts` + `demand-node.ts` |
| 7 因子可解释分配 | ✅ | `allocation-policy.ts` scoreDemand + scoreSupplyForDemand |
| TOCTOU 防护 | ✅ | agenda-manager Step 13 本地 Map 递减 |
| Baseline 污染 → Carrier 行为证据 | ✅ | agenda-manager Step 15 用 carrier carry capacity |
| Operation Storm 防护 | ✅ | allocation-policy.ts 全局/per-source/per-target 上限 |
| 四分类抢占 | ✅ | `preemption.ts` classifyPreemption + attemptPreemption |
| 防抖四防线 | ✅ | `stability.ts` hysteresis + commitment + threshold + cooldown |
| 四档健康度 | ✅ | `network-health.ts` computeNetworkHealth |
| 事件驱动增量重平衡 | ✅ | `rebalance.ts` RebalanceState + decideRebalance |
| Network Snapshot 可观测性 | ✅ | `network-snapshot.ts` + globalCache 集成 |

## 新增文件清单

```
src/domain/operation/supply-node.ts         (120 行)
src/domain/operation/demand-node.ts         (180 行)
src/domain/operation/network-snapshot.ts    (95 行)
src/domain/operation/allocation-policy.ts   (195 行)
src/domain/operation/preemption.ts          (150 行)
src/domain/operation/stability.ts            (90 行)
src/domain/operation/network-health.ts       (120 行)
src/domain/operation/rebalance.ts           (115 行)
tests/unit/operation/a3-1-contract.test.ts (300 行)
tests/unit/operation/a3-1-simulation.test.ts (200 行)
docs/phase5/A3_1_FINAL_REPORT.md            (本文件)
```

## 修改文件清单

```
src/systems/agenda-manager.ts               (全面重构 A3.1 集成)
src/kernel/global-cache.ts                  (新增 networkSnapshot + networkHealth 字段)
```

## 后续 A3.2 待办

- Terminal-based Resource Network（当 terminal 可用时走 terminal 传输替代 carrier）
- 非 energy 资源类型扩展（mineral / compound / power）
- Demand Node 的 `firstSeen` 持久化（跨 global reset 保留 starvation 历史）
- Preemption 实际触发路径（当前 `attemptPreemption` 已实现但未在 agenda-manager 主循环中调用）
