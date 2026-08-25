# Empire AI Roadmap — From Infrastructure to Intelligence

> **编制日期**: 2026-08-25
> **前置条件**: A5 Military Architecture FREEZE
> **视角**: Screeps 老玩家 + AI 系统架构师 + Autonomous Agent 设计
> **目标**: 从「能反应的帝国」升级为「能学习、能预测、能自适应的帝国」

---

## 一、当前帝国成熟度评估

### 1.1 已达成的自治门槛

| 门槛 | 状态 | 证据 |
|------|------|------|
| 空 Memory / 新房间可自启动 | ✅ | bootstrap.ts → spawn → harvest → upgrade 闭环 |
| 关键产能不依赖人工 | ✅ | spawn-manager 自主人口规划 |
| 异常 creep 可替换 | ✅ | recovery-execution-system + spawn P0 灾后恢复 |
| 能量净流稳定 | ✅ | economy.ts + empire-economy.ts 监控 |
| 运输不长期饥饿 | ✅ | logistics-planner + fairness + backpressure |
| CPU/Memory 有预算 | ✅ | CPU tier 看门狗 + Memory schema version |
| global reset 可重建 | ✅ | globalCache 只存可重建数据 |
| 单房间故障不拖垮帝国 | ✅ | empire-health-system + colonyState |
| 资源分配有优先级 | ✅ | spawn queue + logistics priority |
| 任务不会饥饿 | ✅ | assignment-service + starvation detection |
| 迁移可回滚 | ✅ | Memory schemaVersion + 幂等迁移 |
| 威胁注入安全 | ✅ | posture threatWindow + fortify |
| 失守有恢复 | ✅ | recovery-execution-system |
| 低 bucket 安全 | ✅ | CPU tier → conserve/recovery |
| 多线故障安全 | ✅ | safeRun + circuit breaker |

### 1.2 当前缺失的「智能」层

当前帝国是一个**反应式系统**：感知 → 决策 → 执行 → 反馈。但它缺少：

1. **学习**：不从历史中提取知识
2. **预测**：不预测敌人/市场/经济趋势
3. **自适应**：不根据表现调整策略参数
4. **长期规划**：无多周/多月的战略目标
5. **主动侦察**：不主动采集情报，只被动响应视野内的威胁

---

## 二、A6: Empire Intelligence Phase

### 总体目标

```
当前: Sense → React → Execute → Feedback
目标: Sense → Learn → Predict → Plan → React → Execute → Feedback → Adapt
                                              ↑__________________↓
                                              (Learning Loop)
```

### A6.1 — Combat Learning & Strategy Evaluation

| 维度 | 内容 |
|------|------|
| **目标** | 从 DecisionTrace + evaluateWarOutcome 中提取战斗经验，评估策略效果 |
| **前置** | DecisionTrace (A4.7) ✅, evaluateWarOutcome ✅ |
| **输入** | 历史战争事件、WarPlan hash → outcome 映射、body 配置 → 胜率 |
| **输出** | StrategyEffectivenessReport: { formation, forceComp, tactic, outcome, sampleSize, confidence } |
| **关键设计** | 纯函数统计分析 + RawMemory segment 存储（不写 Memory 主体） |
| **文件估算** | 3-5 文件 (domain/learning/ + system) |
| **Risk** | LOW — 只读分析，不执行任何 Game API |
| **Value** | HIGH — 直接改善军事决策质量 |

**核心产出**:
- 编队配置 vs 敌方配置的胜率统计
- Tactical state 转换频率（是否频繁 REGROUPING → 说明编队不稳）
- FocusFire 目标选择效果（集火 healer 的实际 kill time vs 其他选择）
- WarPosture 升降频率（是否过度反应/反应不足）

### A6.2 — Long-term Memory & Post-War Learning

| 维度 | 内容 |
|------|------|
| **目标** | 跨 tick/跨 war 的经验积累。每次战争结束后产出战后复盘报告，供未来参考 |
| **前置** | A6.1 (Combat Learning) |
| **输入** | 战争历史、经济波动历史、扩张失败/成功记录 |
| **输出** | LongTermMemory: { warOutcomes[], expansionOutcomes[], economicEvents[], strategyAdjustments[] } |
| **关键设计** | RawMemory segment 存储（每 segment 100KB），按类型分 segment。有 TTL 和 GC |
| **文件估算** | 4-6 文件 (domain/learning/ + kernel/long-term-memory.ts) |
| **Risk** | LOW — 只写 RawMemory，不执行 |
| **Value** | HIGH — 让帝国「记住」经验 |

**核心产出**:
- 玩家 X 的上次进攻 body 配置 → 下次遇到时预判
- 扩张到房间 Y 的失败原因 → 避免重蹈覆辙
- 市场价格历史趋势 → 优化买卖时机
- 战争经济消耗模式 → 更准确的 warCost 估计

### A6.3 — Enemy Learning (Cross-tick Memory)

| 维度 | 内容 |
|------|------|
| **目标** | 积累 per-player 历史 body 配置和战术偏好 |
| **前置** | PlayerIntel (A5.2) ✅, CombatCapability (A5.1) ✅ |
| **输入** | 每次交战时的敌方 body 解析、boost tier、战术行为 |
| **输出** | EnemyProfile: { username, bodyHistory[], preferredTactics[], boostTierEstimate, threatIndex, lastEncountered } |
| **关键设计** | 扩展 PlayerIntelRecord，添加 bodyHistory 数组（限长 10）。用 RawMemory 存储 |
| **文件估算** | 2-3 文件 (扩展 player-intel.ts + 新系统) |
| **Risk** | LOW — 只读 + 只写 RawMemory |
| **Value** | MEDIUM — 加速 threat 评估，更准确的 force requirement |

### A6.4 — Player Modeling & Active Reconnaissance

| 维度 | 内容 |
|------|------|
| **目标** | 从被动情报到主动侦察。建模玩家行为模式 |
| **前置** | A6.3 (Enemy Learning) |
| **输入** | Scout 采集的房间历史、player profile、leaderboard |
| **输出** | PlayerModel: { activityPattern, preferredAttackTime, preferredTactics, economicLevel, threatLevel, confidence } |
| **关键设计** | Scout role 已有 skeleton。新增 recon-mission-system 生成侦察任务 |
| **文件估算** | 5-8 文件 (domain/intelligence/ + systems/recon-system.ts + scout role 扩展) |
| **Risk** | MEDIUM — 主动侦察有 PvP 暴露风险（scout 被发现 → 被反侦察） |
| **Value** | HIGH — 预测比反应更有价值 |

### A6.5 — Multi-room Resource Optimization

| 维度 | 内容 |
|------|------|
| **目标** | 在现有 logistics-planner 上增加全局优化层，求解跨房资源最优分配 |
| **前置** | logistics-planner ✅, empire-economy ✅ |
| **输入** | 全房 supply/demand、距离矩阵、运输能力、优先级 |
| **输出** | GlobalAllocationPlan: { room → resource → amount → route → priority } |
| **关键设计** | 贪心 + 局部优化（非 LP 求解 — LP 在 Screeps tick 内太贵）。interval=100 低频 |
| **文件估算** | 3-5 文件 (domain/optimization/ + system) |
| **Risk** | LOW — 优化层只产出建议，执行走现有 logistics |
| **Value** | MEDIUM — 减少跨房资源浪费 |

### A6.6 — CPU-aware Strategic Planning

| 维度 | 内容 |
|------|------|
| **目标** | 策略层根据 CPU 预算主动裁剪非关键工作（不只是降频，是策略级选择） |
| **前置** | CPU tier 看门狗 ✅, empire-health ✅ |
| **输入** | CPU tier, bucket trend, creep CPU overhead, task backlog |
| **输出** | CpuBudgetPlan: { tier, allowedTasks[], deferredTasks[], deferredUntil, reason } |
| **关键设计** | 在 empire-strategy.ts 中增加 CPU budget 评估，posture 受 CPU 影响 |
| **文件估算** | 2-3 文件 (扩展 strategy/ + 新 domain) |
| **Risk** | LOW — 降级路径已有，只是策略层更主动 |
| **Value** | MEDIUM — CPU 紧张时更智能的降级 |

### A6.7 — Risk-aware Economic Planning

| 维度 | 内容 |
|------|------|
| **目标** | 在扩张/经济决策中引入量化风险评估 |
| **前置** | empire-health ✅, expansion risk-model ✅ |
| **输入** | 经济波动历史、扩张失败率、远矿损失率 |
| **输出** | EconomicRiskAssessment: { expansionRisk, remoteRisk, warEconomicRisk, recommendedReserve } |
| **关键设计** | 纯函数风险评估，注入 posture 和 expansion-planner |
| **文件估算** | 2-4 文件 (domain/strategy/risk.ts + 扩展) |
| **Risk** | LOW — 只读分析 |
| **Value** | MEDIUM — 更稳健的扩张/经济决策 |

### A6.8 — Market Strategy (Advanced Trading)

| 维度 | 内容 |
|------|------|
| **目标** | 在现有动态定价上增加套利、趋势分析、库存管理 |
| **前置** | terminal-manager ✅, market-pricing ✅ |
| **输入** | 市场行情历史、库存水平、需求预测 |
| **输出** | MarketStrategy: { buyOpportunities[], sellOpportunities[], trendAnalysis, recommendedActions[] } |
| **关键设计** | 纯函数分析，interval=200 低频。不改变 terminal-manager 执行逻辑 |
| **文件估算** | 3-4 文件 (domain/industry/market-strategy.ts + system) |
| **Risk** | LOW — 只读分析，执行走现有 terminal-manager |
| **Value** | MEDIUM — 更聪明的市场操作 |

---

## 三、A6 实施路线图

```
A6.1 Combat Learning ─────────────────────┐
                                          │
A6.2 Long-term Memory ────────────────────┤
                                          │
A6.3 Enemy Learning ──────────────────────┤
                                          │
A6.4 Player Modeling + Recon ─────────────┤── 需要前置完成
                                          │
A6.5 Multi-room Resource Optimization ────┤
                                          │
A6.6 CPU-aware Planning ──────────────────┤
                                          │
A6.7 Risk-aware Economic Planning ────────┤
                                          │
A6.8 Market Strategy ─────────────────────┘
```

### 推荐实施顺序

| 阶段 | 内容 | 预计工作量 | 依赖 |
|------|------|-----------|------|
| Phase 1 | A6.1 Combat Learning | 3-5 文件 | 无 |
| Phase 1 | A6.2 Long-term Memory | 4-6 文件 | A6.1 |
| Phase 1 | A6.3 Enemy Learning | 2-3 文件 | 无 |
| Phase 2 | A6.4 Player Modeling | 5-8 文件 | A6.3 |
| Phase 2 | A6.5 Resource Optimization | 3-5 文件 | 无 |
| Phase 2 | A6.6 CPU-aware Planning | 2-3 文件 | 无 |
| Phase 3 | A6.7 Risk-aware Planning | 2-4 文件 | A6.2 |
| Phase 3 | A6.8 Market Strategy | 3-4 文件 | A6.2 |

### Phase 1 核心：建立学习闭环

**目标**: 让帝国能从自己的决策结果中学习。

**验收标准**:
1. 每次战争结束后自动产出战后分析报告
2. 编队配置 × 敌方配置 → 胜率统计可查
3. 玩家档案可跨 tick 记忆
4. RawMemory segment 有 GC 和 TTL
5. 学习结果可被 war-planning / posture 消费

### Phase 2 核心：主动情报 + 全局优化

**目标**: 从被动反应升级为主动预测。

**验收标准**:
1. Scout 主动侦察周边玩家房间
2. 玩家行为模式可建模
3. 跨房资源分配有全局优化
4. CPU 紧张时策略层主动裁剪

### Phase 3 核心：风险感知 + 市场智能

**目标**: 让帝国在长期运营中更稳健、更高效。

**验收标准**:
1. 扩张决策有量化风险评估
2. 市场交易有趋势分析和套利识别
3. 长期记忆可反馈到策略参数调整

---

## 四、长期愿景 (A7+)

### A7: Diplomacy & Multi-player Interaction

- 盟友系统（如果目标服务器允许）
- 贸易协定
- 非侵略协定
- 联合作战

### A8: Multi-squad Warfare

- 多战线协调
- 多目标同时进攻/防守
- 战略欺骗（声东击西）

### A9: Self-improving Empire

- 策略参数自动调优（基于 A6 学习结果）
- A/B 测试框架
- 策略效果对比
- 长周期自适应

### A10: Cross-shard Strategy

- 跨 shard 资源调度
- 跨 shard 军事行动
- Seasonal shard 策略

---

## 五、架构约束（不可违反）

在实施 A6 时，必须遵守以下约束：

1. **不破坏 A4/A5**: 学习层只读消费已有系统的输出，不修改执行路径
2. **不创建第二套决策**: 学习结果以「建议」形式注入，不绕过 Canonical 路径
3. **Domain 纯函数律**: 学习 Domain 不 import Game/Memory/Runtime
4. **RawMemory for long-term**: 长期记忆走 RawMemory segment，不膨胀 Memory
5. **CPU budget**: 学习系统是低优先级，interval ≥ 100，CPU 紧张时最先降级
6. **可观测**: 学习结果写入 DecisionTrace，可审计
7. **幂等**: 学习系统重复运行不产生重复记录
8. **GC**: RawMemory segment 有 TTL 和 GC，不无限增长
