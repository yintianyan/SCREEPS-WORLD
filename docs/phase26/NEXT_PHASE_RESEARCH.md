# Next Phase Research — Empire Gap Analysis

> **审计日期**: 2026-08-25
> **视角**: Screeps 老玩家 + AI 系统架构师 + RTS/Autonomous Agent 架构
> **方法**: 从真实代码出发，分析当前帝国系统距离「真正的 Screeps AI 帝国」还缺什么
> **约束**: 不直接决定全部都做；建立 Value × Dependency × Risk × Cost 矩阵

---

## 一、当前帝国系统现状盘点

### 已完成的核心闭环

| 层 | 系统 | 状态 | 关键文件 |
|----|------|------|---------|
| Runtime | Kernel + safeRun + CPU tier 看门狗 | ✅ 闭环 | `src/kernel/` |
| State | RoomSnapshot + Memory schema + migration | ✅ 闭环 | `src/systems/room-snapshot.ts`, `src/kernel/memory.ts` |
| Economy | 采能 → spawn → 升级 → 物流 → 市场 | ✅ 闭环 | `src/domain/economy/`, `src/systems/economy.ts` |
| Logistics | Supply → Demand → Transport Plan → Hauler | ✅ 闭环 | `src/domain/logistics/`, `src/systems/logistics-planner.ts` |
| Spawn | 人口规划 → spawn queue → 幂等孵化 → 回收 | ✅ 闭环 | `src/systems/spawn-manager.ts` |
| Construction | 布局蓝图 → 队列执行 → site 配额 | ✅ 闭环 | `src/systems/construction-manager.ts`, `src/domain/layout/` |
| Expansion | 候选评分 → 殖民门禁 → bootstrap → 激活 | ✅ 闭环 | `src/domain/expansion/`, `src/systems/expansion-manager.ts` |
| Remote Mining | 远矿发现 → 分配 → hauler 通勤 → 防御 | ✅ 闭环 | `src/domain/remote/`, `src/systems/remote-mining-manager.ts` |
| Industry | 矿物 → lab 反应链 → boost → factory → commodity | ✅ 闭环 | `src/domain/industry/`, `src/systems/lab-system.ts` |
| Market | 动态定价 → 买卖 → 互济 → 行情快照 | ✅ 闭环 | `src/systems/terminal-manager.ts` |
| Recovery | abort signal → recovery action → spawn/terminal | ✅ 闭环 | `src/systems/recovery-execution-system.ts` |
| Empire Health | 多维健康度 → recovery actions | ✅ 闭环 | `src/systems/empire-health-system.ts` |
| Decision Trace | 事件日志 → 决策追踪 | ✅ 闭环 | `src/systems/decision-trace-system.ts` |
| Military | Strategic → Operational → Tactical → Micro → Role | ✅ 闭环 (A5 FREEZE) | `src/domain/military/`, `src/domain/tactical/` |
| Defense | 塔防御 → threat → posture 联动 | ✅ 闭环 | `src/systems/tower-defense.ts`, `src/domain/defense/` |
| Layout | 锚点选择 → 模板 → 道路 → min-cut | ✅ 闭环 | `src/domain/layout/` |

### 当前缺失或不完整的系统

| 系统 | 现状 | 差距 |
|------|------|------|
| Intelligence | PlayerIntel 存在（A5.2），但只有证据记录，无主动侦察、无玩家行为建模 | 缺少主动情报采集、玩家档案、行为模式分析 |
| Long-term Memory | Memory 有 schema version，但无跨赛季/跨 shard 的长期学习 | 无历史经验积累、无战后学习、无策略评估反馈 |
| Player Modeling | PlayerIntelRecord 记录威胁指数，但不建模玩家行为模式 | 无「这个玩家喜欢什么战术」「什么时候活跃」的分析 |
| Enemy Learning | CombatCapability 每次重新解析 body，不积累历史 | 无「上次遇到的 boosted 玩家 X」的跨 tick 记忆 |
| Combat Learning | 战后有 evaluateWarOutcome，但不反馈到策略调整 | 无「这个编队配置胜率如何」「这个战术是否有效」的统计 |
| Diplomacy | 无 | 不与任何玩家交互（无盟友/贸易协议/非侵略协定） |
| Nuke Strategy | shouldLaunchNuke 存在，但无完整核威慑/反核战略 | 缺少核弹预警、反核资产疏散、核威慑博弈 |
| Power Strategy | power-farm-manager 存在，但无跨 shard power 链 | 缺少 power creep 技能选择、power 资源调度 |
| Multi-room Resource Optimization | logistics-planner 有跨房调度，但无全局资源最优分配 | 缺少 LP 求解 / 贪心全局优化、跨房能量/矿物平衡 |
| Inter-room Warfare | 单 squad 支持，无多 squad 协同 | 无多战线、多目标同时进攻/防守 |
| CPU-aware Planning | CPU tier 看门狗存在，但策略层不主动按 CPU 预算裁剪 | 缺少「CPU 紧张时哪些任务降频」的策略层决策 |
| Risk-aware Planning | risk-model 存在（军事），但经济/扩张缺少风险感知 | 无「扩张失败后的退路」「经济崩溃概率」的量化 |
| Long-horizon Planning | 短期决策完整，缺少中长期目标规划 | 无「30 天后要达到什么状态」的长周期规划 |
| Strategy Evaluation | 无系统化策略效果评估 | 无 A/B 测试、无策略对比、无预期 vs 实际偏差分析 |
| Self-improvement | tuning-engine 存在（参数调节），但无策略级学习 | 无「根据历史表现调整策略参数」的闭环 |

---

## 二、Value × Dependency × Risk × Cost 矩阵

### 评估标准

| 维度 | 1 (低) | 3 (中) | 5 (高) |
|------|--------|--------|--------|
| **Value** | 锦上添花 | 明显改善 | 不可缺 |
| **Dependency** | 无前置依赖 | 需 1-2 个前置 | 需大量基础设施 |
| **Risk** | 实现简单、不易出错 | 中等复杂度 | 高风险/需要大量验证 |
| **Cost** | ≤ 2 文件 | 3-8 文件 | ≥ 9 文件或新系统 |

### 候选方向矩阵

| # | 方向 | Value | Dependency (前置少=高分) | Risk (风险低=高分) | Cost (成本低=高分) | 总分 | 推荐 |
|---|------|-------|------------------------|-------------------|-------------------|------|------|
| 1 | **Long-term Memory + 战后学习** | 5 | 4 (需 Memory 扩展) | 4 (只读分析) | 3 (新 Domain + 系统) | 16 | ✅ 强烈推荐 |
| 2 | **Combat Learning + Strategy Evaluation** | 5 | 5 (消费已有 DecisionTrace) | 4 (只读统计) | 3 (新 Domain) | 17 | ✅ 强烈推荐 |
| 3 | **Player Modeling + 主动侦察** | 4 | 4 (需 scout 系统) | 3 (侦察有 PvP 风险) | 3 (新 Domain + 系统) | 14 | ✅ 推荐 |
| 4 | **Multi-room Resource Optimization** | 4 | 5 (复用已有 logistics) | 4 (优化非执行) | 2 (需 LP/贪心求解) | 15 | ✅ 推荐 |
| 5 | **Risk-aware Planning (经济/扩张)** | 4 | 4 (复用已有 health) | 4 (只读分析) | 3 (新 Domain) | 15 | ✅ 推荐 |
| 6 | **Inter-room Warfare (多 squad)** | 3 | 3 (需 A5 基础设施) | 2 (多战线协调复杂) | 1 (大改 A5) | 9 | ⏸ 暂缓 |
| 7 | **Nuke Strategy (完整核威慑)** | 3 | 4 (shouldLaunchNuke 存在) | 2 (核战误判高风险) | 2 (新 Domain) | 11 | ⏸ 暂缓 |
| 8 | **CPU-aware Planning (策略层裁剪)** | 3 | 5 (CPU tier 已有) | 4 (降频安全) | 3 (改策略层) | 15 | ✅ 推荐 |
| 9 | **Long-horizon Planning** | 4 | 3 (需历史数据) | 3 (长期预测有偏差) | 2 (新规划系统) | 12 | ⏸ 谨慎 |
| 10 | **Power Strategy (跨 shard)** | 2 | 4 (power-farm 已有) | 4 (独立系统) | 2 (新系统) | 12 | ⏸ 谨慎 |
| 11 | **Diplomacy (盟友/贸易)** | 2 | 3 (需通信) | 1 (依赖他人) | 1 (大系统) | 7 | ❌ 不推荐 |
| 12 | **Self-improvement (策略级学习)** | 5 | 2 (需 1+2 先做) | 2 (自我修改有风险) | 1 (大系统) | 10 | ⏸ 后期 |
| 13 | **Market Strategy (高级交易)** | 3 | 5 (terminal 已有) | 4 (只读分析) | 3 (新 Domain) | 15 | ✅ 推荐 |
| 14 | **Seasonal/Shard Strategy** | 2 | 3 | 3 | 2 | 10 | ⏸ 后期 |
| 15 | **Enemy Learning (跨 tick 记忆)** | 3 | 5 (CombatCapability 已有) | 4 (只读记忆) | 3 (Memory 扩展) | 15 | ✅ 推荐 |

---

## 三、推荐优先级排序

### 第一梯队（高 Value + 低 Risk + 低 Cost）

| 优先级 | 方向 | 理由 |
|--------|------|------|
| A6.1 | **Combat Learning + Strategy Evaluation** | Value=5, 直接消费已有 DecisionTrace 和 evaluateWarOutcome，只做统计分析，零执行风险。产出：策略效果评分 → 反馈到 war-planning 参数调整 |
| A6.2 | **Long-term Memory + 战后学习** | Value=5, 在 Memory/RawMemory 上扩展长期存储，记录战后复盘。产出：历史经验库 → 供未来决策参考 |
| A6.3 | **Enemy Learning (跨 tick 记忆)** | Value=3, 在现有 CombatCapability 基础上积累 per-player 历史 body 配置。产出：已知玩家档案 → 加速 threat 评估 |

### 第二梯队（中高 Value + 中等 Cost）

| 优先级 | 方向 | 理由 |
|--------|------|------|
| A6.4 | **Player Modeling + 主动侦察** | Value=4, 需 scout 系统主动采集情报。产出：玩家行为模式 → 优化防御/进攻策略 |
| A6.5 | **Multi-room Resource Optimization** | Value=4, 在现有 logistics-planner 上增加全局优化层。产出：跨房资源最优分配 |
| A6.6 | **CPU-aware Planning (策略层裁剪)** | Value=3, 在策略层根据 CPU tier 主动裁剪非关键工作。产出：CPU 紧张时智能降级 |
| A6.7 | **Risk-aware Planning (经济/扩张)** | Value=4, 在扩张/经济决策中引入风险评估。产出：扩张失败概率 → 更稳健的扩张 |
| A6.8 | **Market Strategy (高级交易)** | Value=3, 在现有动态定价上增加套利/趋势分析。产出：更聪明的买卖时机 |

### 暂缓（高 Cost 或高 Risk）

| 方向 | 暂缓理由 |
|------|---------|
| Inter-room Warfare (多 squad) | 大改 A5 架构，高风险。等 A5 经实战验证后再考虑 |
| Nuke Strategy | 核战误判代价过高。等基础情报系统成熟 |
| Long-horizon Planning | 需大量历史数据，依赖 A6.1+A6.2 先完成 |
| Diplomacy | 依赖他人，非自治系统的核心 |
| Self-improvement | 最复杂、风险最高。等所有学习系统成熟后 |
| Seasonal/Shard Strategy | 非 World 默认目标，按需 |

---

## 四、核心判断

当前帝国已经完成了**生存、经济、物流、扩张、防御、军事**的基础闭环。军事基础设施（A5）已达到「基础设施完成」状态。

**下一阶段最值得投入的方向不是继续扩展军事能力，而是建立「智能」层**：

1. **学习闭环**：从 DecisionTrace 和战后评估中提取知识，反馈到策略参数
2. **长期记忆**：跨 tick/跨 war 的经验积累
3. **玩家建模**：从被动情报到主动侦察和玩家行为预测

这三个方向构成「Empire Intelligence」的基础设施，让帝国从「能反应」升级为「能学习」。
