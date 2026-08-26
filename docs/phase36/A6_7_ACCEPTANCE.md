# A6.7 Acceptance Criteria — 验收标准

> **Phase**: 36
> **Date**: 2026-08-26
> **Status**: RESEARCH / NO IMPLEMENTATION
> **前提**: A6.1–A6.6 全部 FROZEN + A5 Decision Authority Matrix FROZEN

---

## 一、功能验收

### 1.1 MUST HAVE

| ID | 验收条件 | 验证方法 |
|----|----------|----------|
| AC-001 | `getRecommendationSummary()` 返回正确统计 | 单元测试：空 buffer、满 buffer、混合 lifecycle |
| AC-002 | `getConflictSummary()` 返回正确冲突分布 | 单元测试：无冲突、3 类冲突混合 |
| AC-003 | `formatDashboardOutput()` 返回格式化字符串 | 单元测试：空输出、完整输出 |
| AC-004 | System 层在 `tick % 5000 === 0` 输出 Dashboard | 集成测试 |
| AC-005 | `printFullDashboard()` 控制台函数返回完整摘要 | 手动调用验证 |

### 1.2 SHOULD HAVE

| ID | 验收条件 | 验证方法 |
|----|----------|----------|
| AC-006 | `getIntelligenceStateSummary()` 返回正确摘要 | 单元测试（需要 mock IntelligenceState） |
| AC-007 | `getRecommendationHistory()` 返回 supersede 链 | 单元测试：3 条 supersede 链 |

### 1.3 NICE TO HAVE

| ID | 验收条件 | 验证方法 |
|----|----------|----------|
| AC-008 | Dashboard 集成 IntelligenceState 摘要 | 手动调用验证 |

---

## 二、安全验收

| ID | 验收条件 | 验证方法 |
|----|----------|----------|
| AC-100 | 无执行系统 import A6.7 Domain 模块 | `grep -r "from.*consumption" src/systems/ src/creeps/ src/domain/strategy/ src/domain/military/` |
| AC-101 | A6.7 Domain 函数不引用 Game/Memory | grep `Game\|Memory\|globalThis` in `src/domain/intelligence/consumption/` |
| AC-102 | A6.7 System 不调用 Game API | grep `Game.creeps\|Game.rooms\|spawnCreep\|createConstructionSite` |
| AC-103 | A6.7 不写入任何 globalCache 字段 | 代码审查：无 `g.xxx =` 赋值 |
| AC-104 | A6.7 不修改 Memory | grep `Memory` in consumption 模块 |
| AC-105 | `shadowOnly: true` / `autoApply: false` 不变 | A6.6 类型不变 |
| AC-106 | 无 Math.random / Date.now / new Date() | grep |
| AC-107 | A6.7 完全停止时帝国安全运行 | 从 bootstrap 移除，验证不影响其他系统 |

---

## 三、确定性验收

| ID | 验收条件 | 验证方法 |
|----|----------|----------|
| AC-200 | `getRecommendationSummary()` 1000× replay 一致 | 单元测试 |
| AC-201 | `getConflictSummary()` 1000× replay 一致 | 单元测试 |
| AC-202 | `formatDashboardOutput()` 1000× replay 一致 | 单元测试 |
| AC-203 | 所有迭代按 sorted key | 代码审查 |

---

## 四、有界性验收

| ID | 验收条件 | 验证方法 |
|----|----------|----------|
| AC-300 | A6.7 不新增 RingBuffer | 代码审查 |
| AC-301 | A6.7 不新增 heap 存储字段 | globalCache 接口不变 |
| AC-302 | console.log 输出有长度上限（≤ 2000 字符） | 代码审查 |

---

## 五、质量门禁

| Gate | Command | Expected |
|------|---------|----------|
| TypeScript | `npm run typecheck` | 0 errors |
| Unit Tests | `npm test` | All pass (existing + new) |
| Build | `npm run build` | dist/main.js created |

---

## 六、回归验收

| ID | 验收条件 | 验证方法 |
|----|----------|----------|
| AC-400 | A6.1–A6.6 测试全绿不回归 | `npx vitest run a6-*` |
| AC-401 | A5 测试全绿不回归 | `npx vitest run a5-*` |
| AC-402 | 全量测试全绿 | `npm test` |
| AC-403 | A6.6 REC-001~014 守卫全绿 | A6.6 测试不回归 |

---

## 七、反事实验收

| ID | 反事实场景 | 预期行为 | 验证 |
|----|-----------|----------|------|
| AC-500 | A6.7 完全停止 | 帝国照常运行 | 从 bootstrap 移除 |
| AC-501 | A6.7 输出被误用 | 类型系统阻止（不产出执行接口） | 代码审查 |
| AC-502 | A6.7 内存泄漏 | 不可能（不新增存储） | 代码审查 |

---

## 八、验收条件汇总

### MUST HAVE（全部通过才可进入下一阶段）

- [ ] AC-001 ~ AC-005（功能）
- [ ] AC-100 ~ AC-107（安全）
- [ ] AC-200 ~ AC-203（确定性）
- [ ] AC-300 ~ AC-302（有界性）
- [ ] AC-400 ~ AC-403（回归）
- [ ] Quality Gates 全绿

### SHOULD HAVE

- [ ] AC-006 ~ AC-007

### NICE TO HAVE

- [ ] AC-008

---

## 九、实施条件裁决

| 条件 | 满足 |
|------|:----:|
| A6.1–A6.6 冻结契约完好 | ✅ |
| 确定性基础设施可复用 | ✅ |
| 无 BLOCKER | ✅ |
| 无 Decision Authority 冲突 | ✅ |
| globalCache 不修改 | ✅ |
| bootstrap 修改量极小（+1 行注册） | ✅ |
| 测试基础设施就绪 | ✅ |

## 裁决：CAN_START_IMPLEMENTATION（在 A6.7 Gap Analysis 审批通过后）
