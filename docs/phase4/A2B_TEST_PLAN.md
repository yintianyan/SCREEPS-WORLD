# A2B_TEST_PLAN — A2 后半测试计划

> 日期：2026-08-24。阶段：A2 后半。
> 测试文件：`tests/unit/strategy/empire-economy.test.ts` +
> `tests/unit/economy/room-profile.test.ts` +
> `tests/unit/economy/capacity-profile.test.ts`。

## 1. 单元测试

| ID | 场景 | 文件 | 状态 |
| --- | --- | --- | --- |
| A2B-001 | 单房 Economic Profile 组装 | room-profile.test.ts | ✅ |
| A2B-002 | 多房 Resource View 聚合 | capacity-profile.test.ts | ✅ |
| A2B-003 | Resource 聚合一致性 | empire-economy.test.ts | ✅ |
| A2B-004 | 房 deficit 检测 | empire-economy.test.ts | ✅ |
| A2B-005 | 房 surplus 检测 | empire-economy.test.ts | ✅ |
| A2B-006 | Empire Economic Health 判定 | empire-economy.test.ts | ✅ |
| A2B-007 | Expansion Readiness 各场景 | empire-economy.test.ts | ✅ |
| A2B-008 | Reserve 保护 | empire-economy.test.ts | ✅ |
| A2B-009 | Request Scope 标记 | empire-economy.test.ts | ✅ |
| A2B-010 | Empire Request Routing 检测 | empire-economy.test.ts | ✅ |
| A2B-011 | Capacity 计算 | capacity-profile.test.ts | ✅ |
| A2B-012 | Economic Trend（非库存排名） | empire-economy.test.ts | ✅ |

## 2. Scenario 测试

| ID | 场景 | 测试 |
| --- | --- | --- |
| A2B-S1 | Multi-Room Simulation (3 房) | ✅ |
| A2B-S2A | Empire Healthy → STRONGLY_READY | ✅ |
| A2B-S2B | Core Room Deficit → NOT READY | ✅ |
| A2B-S2C | Storage High + Production Low → 不 STRONGLY_READY | ✅ |
| A2B-S2D | 有困难房 → NOT_READY | ✅ |
| A2B-S2E | Core Room Recovery → 禁止扩张 | ✅ |

## 3. 质量门槛

| 门槛 | 结果 |
| --- | --- |
| typecheck | ✅ |
| test (2728 项) | ✅ 全绿 |
| build | ✅ |

## 4. 待执行（A2B 后续阶段）

| ID | 场景 | 类型 |
| --- | --- | --- |
| A2B-S3 | 1k/5k/10k tick stability | soak |
| A2B-S4 | CPU 1/5/10/20/50 房趋势 | stress |
