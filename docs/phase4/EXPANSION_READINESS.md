# EXPANSION_READINESS — 扩张就绪度评估

> 日期：2026-08-24。阶段：A2 后半·步 8。
> 合同锚点：EXPANSION §2 G1–G5、GOAL_POLICY_PLAN §3、ECONOMY §1.2。
> 实现：`src/domain/strategy/readiness.ts`。

## 1. 就绪度枚举

| 状态 | 含义 |
| --- | --- |
| NOT_READY | 当前经济不支持扩张 |
| READY | 满足基本扩张门控 |
| STRONGLY_READY | 经济充裕 + 多核心房 + CPU 余量充足 |

## 2. 门控序列

### 基本门控（全过才 READY）

| 门 | 名称 | 条件 |
| --- | --- | --- |
| G0 | posture 授权 | `expansionAllowed === true` |
| G1 | 无活威胁 | `hasLiveThreat === false` |
| G2 | 无困难房 | `hasStruggling === false` |
| G3 | 经济健康度 | `health ≥ growing` |
| G4 | 帝国净流 | `totalNetFlow ≥ 5` |
| G5 | 核心房数 | `coreRooms ≥ 1` |
| G6 | CPU tier | `tier ≤ comfortable` |
| G7 | 扩张预算 | `budget.expansion ≥ 2000` |

### STRONGLY_READY 额外门控

| 门 | 条件 |
| --- | --- |
| G8 | `health ≥ healthy` |
| G9 | `coreRooms ≥ 2` |
| G10 | `tier ≤ abundant` |
| G11 | `totalNetFlow ≥ 15` |

## 3. Scenario 验证

| Scenario | 预期 | 验证 |
| --- | --- | --- |
| A: Empire Healthy | STRONGLY_READY | ✅ |
| B: Core Room Deficit | NOT_READY | ✅ |
| C: Storage High + Production Low | 不 STRONGLY_READY | ✅ |
| D: 有困难房 | NOT_READY | ✅ |
| E: Core Room Recovery | NOT_READY | ✅ |

## 4. 证据链

每个结果携带 `evidence` 字符串和 `gates` 数组，记录各门控的通过/失败明细。
