# research/ · Phase-0 调研存档（2026-08-22 重新执行）

本目录是文档三层体系中的**调研存档层**：证据链，不直接裁决实现（裁决规则见
[../README.md](../README.md)）。本套件为总任务书「Screeps AI Empire 前期调研与
总体架构研究」的完整执行产物（34 份文档），全部基于当轮真实网络调研（官方文档
与引擎常量交叉核查 + 7 家 bot 源码级考古 + 社区经验挖掘），未沿用历史存档结论。

## 入口

- **导航与总结论**：[00_EXECUTIVE_SUMMARY.md](00_EXECUTIVE_SUMMARY.md)
- **「今天开始开发用什么架构」（14 点）**：[../RESEARCH_EXECUTIVE_SUMMARY.md](../RESEARCH_EXECUTIVE_SUMMARY.md)
- **最终架构**：[26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md)
- **裁决记录**：[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)（ADR-001…012）
- **机制事实基准**：[03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)
  （全套件引用数值以此为准，含 10 条冲突裁决）
- **来源台账**：[RESEARCH_SOURCES.md](RESEARCH_SOURCES.md)

## 文件清单

```text
00_EXECUTIVE_SUMMARY.md          导航与总结论
01_SCREEPS_AI_LANDSCAPE.md       生态全景 + 社区十教训
02_EXISTING_BOT_ANALYSIS.md      7 家 bot 源码级考古（Overmind/TooAngel/TI/Quorum/bonzAI/KasamiBot/hivemind）
03_SCREEPS_GAME_CONSTRAINTS.md   官方机制事实基准（引擎常量级，含勘误表）
04_EMPIRE_ARCHITECTURE.md        帝国层（职责/接口/失败模式）
05_AGENT_ARCHITECTURE.md         Model A–E 裁决与组件判据
06_GOAL_AND_POLICY_SYSTEM.md     姿态×预算战略层
07_PLANNING_SYSTEM.md            规划系统（Intent/Demand + 低频议程）
08_DEMAND_TASK_DIRECTIVE_MODEL.md 四概念数据流模型
09_ROOM_ARCHITECTURE.md          房间层（能力门槛 phase）
10_ROOM_DEVELOPMENT.md           房间发展（六 phase + 能量 sink）
11_SPAWN_SYSTEM.md               孵化系统（唯一写者+需求驱动）
12_LOGISTICS_SYSTEM.md           物流（请求池+link 网+terminal 均衡）
13_CONSTRUCTION_SYSTEM.md        建造与布局（模板+适配）
14_INTELLIGENCE_SYSTEM.md        情报（TTL+置信度+segment）
15_DEFENSE_SYSTEM.md             防御（威胁分级+能量会计）
16_MILITARY_SYSTEM.md            军事（war 授权+止损链）
17_EXPANSION_SYSTEM.md           扩张（投资决策+自举车道）
18_MEMORY_ARCHITECTURE.md        三级存储与迁移规范
19_SCHEDULER_KERNEL.md           轻量内核裁决
20_CPU_OPTIMIZATION.md           CPU 预算与优化
21_OBSERVABILITY.md              观测与遥测
22_SELF_HEALING.md               自愈闭环
23_LLM_AND_AGENT_RUNTIME.md      LLM/Agent 边界（无 Agent Runtime）
24_FAILURE_MODES.md              五大类失败模式（34 条）
25_ARCHITECTURAL_TRADEOFFS.md    取舍台账（T-01…T-14）
26_FINAL_ARCHITECTURE.md         最终架构总纲
27_IMPLEMENTATION_ROADMAP.md     验收制路线（A0–A5 × P1–P12）
28_TESTING_STRATEGY.md           测试策略（L1–L6 + 场景矩阵）
29_RISK_REGISTER.md              风险登记（R-01…R-18）
30_RED_TEAM_REVIEW.md            红队评审（12 向量）
ARCHITECTURE_DECISIONS.md        ADR-001…012
RESEARCH_SOURCES.md              来源台账（含冲突裁决与未证实名单）
```

## 使用约定

1. 其他文档层引用机制数值时以 03 号为准（引擎常量 > 官方散文 > 社区 wiki）。
2. 研究结论与 `docs/architecture/` 冻结蓝图冲突时：走 ADR 流程
   （ARCHITECTURE_FREEZE §15），不得静默改契约。
3. 每份主题文档均为 13 节结构（Problem → … → Evidence/Sources），证据带
   CONFIRMED/LIKELY/UNCERTAIN/SPECULATION 四级置信度标注。
