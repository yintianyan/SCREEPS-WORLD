# REQUEST_SCOPE_MODEL — 请求归属域模型

> 日期：2026-08-24。阶段：A2 后半·步 11。
> 合同锚点：DATA_FLOW §2 Demand 语义、LOGISTICS §2.1-2。
> 实现：`src/domain/assignment/request-pool.ts`（scope 字段扩展）、
> `src/domain/strategy/imbalance.ts`（candidatesToEmpireRequests）。

## 1. Scope 枚举

```typescript
type RequestScope = "room" | "empire" | "operation";
```

| Scope | 含义 | 生成者 | 执行者 |
| --- | --- | --- | --- |
| room | 房内请求（现有行为） | logistics 系统 | 本房 hauler |
| empire | 帝国级请求（跨房调拨候选） | Imbalance 检测 | A3 阶段 logistics 消费 |
| operation | 操作级请求（未来扩展） | 远矿/军事系统 | A3+ 阶段 |

## 2. 非破坏性扩展

`scope` 为可选字段——缺省 = `"room"`，不破坏：
- 现有 key 语义（`"collect:<room>:<containerId>"`）
- 幂等合并（稳定 key 去重）
- TTL/老化/收缩等现有行为

## 3. 帝国级请求生成

```typescript
// imbalance.ts: candidatesToEmpireRequests()
// 将 TransferCandidate 转为 scope="empire" 的 TransportRequest
{
  key: `empire:${fromRoom}:${toRoom}:energy`,
  resource: "energy",
  amount: candidate.amount,
  priority: 1,
  scope: "empire",
  targetRoom: candidate.toRoom,
}
```

## 4. 请求路由流程

```
Room Request (scope=room)
    ↓ logistics 系统本 tick 生成 → 本房 hauler 认领

Empire Request (scope=empire)
    ↓ Imbalance 检测每 N tick 生成候选
    ↓ A3 阶段 logistics 系统消费 → 跨房 hauler/terminal 执行
    （A2 后半只生成候选，不执行运输）
```

## 5. 边界验证

| 边界 | 验证 |
| --- | --- |
| Empire 不绕过 Request Pool | Imbalance 只产出 TransferCandidate → 转为 TransportRequest 候选 |
| Empire 不直接控制 Creep | 候选请求不含 creep 指令 |
| Empire 不修改 Room Memory | scope 字段在 TransportRequest 上，不在 Room Memory |
