# A3.2 Final Report — Expansion Intelligence

> 日期：2026-08-24。阶段：A3.2 — Expansion Intelligence。
> 基线：A3.1 Empire Resource Network 已完成并提交。
> 质量门禁：Typecheck ✅ + Build ✅ + 49 Tests ✅。

---

## 0. 结论

**A3.2 完成。** Empire 现在能自主判断「是否应该扩张、为什么扩张、扩张到哪里、当前是否承担得起、扩张需要什么」。

核心改造：将 **执行驱动型扩张**（Intel → Evaluator → 直接 Claiming）升级为
**智能驱动型扩张**（Pressure → Readiness → Discovery → Evaluation →
Cost → Risk → Budget → Plan → Approval → WAITING_EXECUTION）。

A3.2 **严格不执行** Claim/Reserve/Bootstrap/Military——只产出 ExpansionPlan
（到 WAITING_EXECUTION 状态），等待 A3.3 执行层接管。

---

## 1. 实施清单

### Phase 1: Model Layer（12 个纯函数模块）

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| Pressure | `src/domain/expansion/pressure.ts` | 7 维饱和度检测 → LOW/MEDIUM/HIGH |
| Candidate | `src/domain/expansion/candidate.ts` | 14+ 字段候选模型 + lifecycle status |
| Discovery | `src/domain/expansion/discovery.ts` | 从 Intel 提取候选 + 去重 + 增量更新 |
| Scoring | `src/domain/expansion/scoring.ts` | 蓝图 §1.2 七因子评分 |
| Ranking | `src/domain/expansion/ranking.ts` | 多候选排序 + 可解释 |
| Cost Model | `src/domain/expansion/cost-model.ts` | Bootstrap/Travel/Spawn/Infra 成本估算 |
| Payback | `src/domain/expansion/payback.ts` | Cost vs Benefit 比较 + ROI |
| Risk | `src/domain/expansion/risk.ts` | 五维风险评估 (Economic/Operational/Distance/Recovery/Defense) |
| Budget | `src/domain/expansion/budget.ts` | Tiered Budget (Emergency→Core→Operational→Available) |
| Plan | `src/domain/expansion/plan.ts` | PlanId/Candidate/Reason/Priority/Cost/Benefit/Risk/Status |
| Plan Lifecycle | `src/domain/expansion/plan-lifecycle.ts` | 去重 + 清理 + 防抖 + 重评 |
| Explanation | `src/domain/expansion/explanation.ts` | 人类可读决策理由 (APPROVE/HOLD/REJECT/...) |
| Dashboard | `src/domain/expansion/dashboard.ts` | Pressure/Readiness/Budget/Candidates/Plan 汇总 |

### Phase 2: Memory Schema

| 变更 | 位置 | 说明 |
| --- | --- | --- |
| `expansionPlans` | `KernelMemory` | Plan 列表瘦结构 (ExpansionPlanMemory) |
| `expansionCandidates` | `KernelMemory` | 候选 Registry 瘦结构 (ExpansionCandidateMemory) |
| `expansionDashboard` | `KernelMemory` | Dashboard 摘要快照 |
| `ExpansionPlanMemory` | `global.d.ts` | 16 字段瘦结构 |
| `ExpansionCandidateMemory` | `global.d.ts` | 15 字段瘦结构 |
| `expansionPressure` | `planner-input.ts` | EmpirePlannerInput 可选字段 |

### Phase 3: System Integration

| 变更 | 位置 | 说明 |
| --- | --- | --- |
| G12–G15 | `readiness.ts` | 候选/成本/风险/保护层扩展 Gate |
| `evaluateExpansionReadinessExtended` | `readiness.ts` | 纯函数，返回 4 个 Gate |
| `expansionDashboard` | `global-cache.ts` | heap 缓存字段 |
| `expansion-planner` System | `src/systems/expansion-planner.ts` | P1 低频薄壳，组装 Intelligence 链 |
| bootstrap 注册 | `src/bootstrap.ts` | P3 priority，在 expansion-manager 之后 |

### Phase 4: Testing

| 测试 | 数量 | 覆盖 |
| --- | --- | --- |
| Pressure | 3 | LOW/HIGH/evidence |
| Candidate | 6 | build/reject/UNKNOWN/isEvaluable/isQualified |
| Discovery | 2 | 新发现/增量更新 |
| Scoring | 4 | 2>1 source/distance/rival/batch |
| Ranking | 3 | 排序/过滤/getTop |
| Cost | 2 | total>0/farther=more |
| Payback | 3 | finite/infinite/worthwhile |
| Risk | 3 | LOW/higher/evidence |
| Tiered Budget | 4 | available/invaded/isWithinBudget/coreInvaded |
| Plan | 4 | create/derivePriority/update |
| Plan Lifecycle | 7 | dedup/prune/active/rebuildBlock/hysteresis×2/reeval |
| Explanation | 3 | APPROVE/NOT_READY/explainShort |
| Dashboard | 1 | all sections |
| Readiness Extended | 4 | all pass/G12 fail/G13 fail/G15 fail |
| **Total** | **49** | **全链路覆盖** |

---

## 2. 架构裁决状态

| 裁决 | 状态 | 说明 |
| --- | --- | --- |
| 立项权在 Empire | ✅ 遵守 | Intelligence 层只做评估与建议 |
| 七因子评分 | ✅ 实现 | scoring.ts 完整实现蓝图 §1.2 |
| G1–G5 门控 | ✅ 扩展 | 新增 G12–G15（候选/成本/风险/保护层） |
| 先 remote 尽调后 colonize | ⚠️ 标注 | A3.2 只评估，Plan 标注「需尽调」 |
| 无 Planner 组件 | ✅ 遵守 | Plan 是数据模型不是运行时组件 |
| 防振荡三防线 | ✅ 实现 | Hysteresis + minDuration + 重建冷却 |
| Core Protection | ✅ 实现 | Tiered Budget 递进 + coreInvaded 标记 |
| Memory 瘦结构 | ✅ 遵守 | 只存 ID/枚举/数字/短 key |
| 不执行 Claim/Reserve | ✅ 遵守 | 严格到 WAITING_EXECUTION |
| R9 System 上限 | ✅ 检查 | 新增 1 个 System，总 15+3 内 |

**无结构性冲突**。A3.2 在冻结蓝图框架内实施，不需要 ADR。

---

## 3. 新增/修改文件

### 新增（14 文件）

| 文件 | 类型 |
| --- | --- |
| `src/domain/expansion/pressure.ts` | Model |
| `src/domain/expansion/candidate.ts` | Model |
| `src/domain/expansion/discovery.ts` | Model |
| `src/domain/expansion/scoring.ts` | Model |
| `src/domain/expansion/ranking.ts` | Model |
| `src/domain/expansion/cost-model.ts` | Model |
| `src/domain/expansion/payback.ts` | Model |
| `src/domain/expansion/risk.ts` | Model |
| `src/domain/expansion/budget.ts` | Model |
| `src/domain/expansion/plan.ts` | Model |
| `src/domain/expansion/plan-lifecycle.ts` | Model |
| `src/domain/expansion/explanation.ts` | Model |
| `src/domain/expansion/dashboard.ts` | Model |
| `src/systems/expansion-planner.ts` | System |

### 修改（4 文件）

| 文件 | 变更 |
| --- | --- |
| `src/types/global.d.ts` | +3 KernelMemory 字段 +2 Memory interface |
| `src/domain/strategy/planner-input.ts` | +1 import +1 可选字段 |
| `src/domain/strategy/readiness.ts` | +4 import +2 options +1 扩展函数 |
| `src/kernel/global-cache.ts` | +1 heap 缓存字段 |
| `src/bootstrap.ts` | +1 import +1 注册 |
| `tests/unit/expansion/a3-2-contract.test.ts` | 新增 49 测试 |

---

## 4. A3.3 延迟项

| 延迟项 | 原因 |
| --- | --- |
| Expansion Operation 类型 | A3.2 只到 WAITING_EXECUTION |
| Claim / Reserve 执行 | 明确禁止 |
| Pioneer 编队派遣 | 明确禁止 |
| Spawn Construction | 明确禁止 |
| Bootstrap Execution | 明确禁止 |
| Military Escort | 明确禁止 |
| Defense Risk 详细评估 | 先标 UNKNOWN |
| Terminal / Market 扩展 | 明确禁止 |

---

## 5. 质量门禁

```
npm run typecheck  ✅ (0 errors)
npm run build      ✅ (dist/main.js created)
npm test            ✅ (49/49 passed)
```

**A3.2 — Expansion Intelligence 实施完成。**
