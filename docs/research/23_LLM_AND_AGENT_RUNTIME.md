# 23 · LLM 与 Agent Runtime 边界

> 研究文档 · 结论等级：**决策已定**（证据充分）。本文回答总任务书 §20/§21：Screeps AI
> 本身是否应该拥有 Agent Runtime？LLM 应该处于什么层？哪些东西是真正的 Agent？

## 1. Problem

「完全自治帝国」的愿景容易滑向两个错误方向：一是把 LLM 塞进线上决策路径追求
「智能」；二是把每个 Manager 命名为 Agent、堆出一个没有实际价值的 Agent Framework。
必须划清三条边界：

1. LLM / 外部智能在系统中的合法位置；
2. 「真 Agent」（拥有自主目标选择权的组件）与确定性系统的判据；
3. 是否需要一个专门的 Agent Runtime（规划器、协商、信念系统等）。

## 2. Research Questions

- 游戏运行时能否直接调用 LLM？技术上的硬约束是什么？
- 社区有没有线上 LLM/ML 决策的成功先例？
- 顶级 bot 的「智能」实际由什么构成？
- 哪些决策绝对不能交给 LLM / 学习系统？
- Agent Runtime 在 Screeps 语境下有没有可辩护的用途？

## 3. Existing Solutions（真实案例核查）

### 3.1 游戏运行时的硬约束

Screeps 脚本运行在服务器端沙箱中，API 面没有任何出站网络能力（无 HTTP/fetch/
WebSocket；官方 API 列表 https://docs.screeps.com/api/ 全部为游戏对象操作）。外部
世界与 bot 的唯一交互通道是官方 REST API（读写 Memory/RawMemory segments、推送
代码）。**结论：LLM 在物理上不可能进入 tick 执行路径** —— CONFIRMED（API 面直接
可证）。

CPU 侧同样否决：tick 内脚本配额按 CPU 计（bucket 上限 10,000，tickLimit = limit +
最多 500 bucket CPU，见 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)），
而任何远程推理延迟以秒计、不可预算、不可超时控制。

### 3.2 已知的 LLM × Screeps 集成实践

| 案例 | 架构 | 状态 |
| --- | --- | --- |
| [Screeps LLM Agent（derek.net.au 开发日志）](https://www.derek.net.au/logs/) | 体外 Node.js「大脑」经 `screeps-api` HTTPS 轮询（每 10–20 tick）读 `Memory.brainInput`，LLM 决策写回 `Memory.brainOutput`，游戏内脚本解析执行后删除；长期策略走「LLM 生成代码补丁 → 写文件 → 客户端同步」 | **纯架构规划，无运行数据**（页面自标 "Architecture Plan"；同站其他项目报告本地 LLM「给出自信的胡说」、必须加 JSON 校验与 guardrails） |
| [Overmind-RL（bencbartlett）](https://github.com/bencbartlett/Overmind-RL) | 把 Screeps 作为 RL 训练环境，训练过程完全在游戏外 | 研究/实验性质，非线上决策 |
| [r/screeps ML 讨论（2017）](https://www.reddit.com/r/screeps/comments/5uab0c/api_for_machine_learning/) | 定义决策点 → 体外反馈学习 → 回写参数 | 讨论，无长期存活实现 |
| TooAngel（十年公服无人值守） | 「智能」= 指数平滑资源统计（cpuIdle/heapFree/memoryFree）门控扩张 | 全确定性，无 ML —— [Design.md](https://github.com/TooAngel/screeps/blob/master/doc/Design.md) |
| Overmind | 「智能」= 决策树 + 优先级请求队列 + 相位化 tick | 全确定性；RL 目录存在但用于体外实验 |
| bonzAI（bonzaiferroni） | 愿景含「从结果与随机变异演化」，README 承认当时选房仍需人工 | 愿景与自动化覆盖率诚实分离的典型 |

**社区裁决性事实：截至调研日，没有任何已知长期存活的高水平 bot 在线上决策路径
使用 LLM 或在线学习。所有「智能」都是确定性规则 + 统计门控 + 体外调参。**
—— CONFIRMED（对全部调研对象的源码/文档核查）

## 4. Screeps Community Practice

- 体外训练、体内执行是唯一被尝试过的 ML/LLM 接入形态（Overmind-RL、derek 方案）。
- 社区对「AI 做所有决策」的态度务实：bonzAI 明确把愿景与当前覆盖率分开陈述，被视为
  诚实做法；夸大自治度会损害可信度 —— [community 经验，见 RESEARCH_SOURCES.md]。
- 本地 LLM 工程教训（derek.net.au 同站日志）：必须节流（LLM 每秒级、游戏 tick 亚秒级）、
  必须校验输出结构、必须可回滚（Git 兜底）。—— CONFIRMED（工程实践，非 Screeps 特有）

## 5. Existing Bot Analysis（与 Agent 概念的对照）

- Overmind 的 Overlord/Overseer/Directive 虽然名字像 Agent，实质是**确定性控制器 +
  条件挂载点**：没有信念系统、没有目标协商、没有学习。它的自治来自结构化分解，
  不来自智能算法。
- TooAngel 的外交声誉系统是确定性状态机；「trapped 检测→升级策略」是元规则而非
  学习。
- 启示：顶级 bot 用「架构」换自治，不用「智能算法」换自治。

## 6. Advantages（推荐边界设计的优势）

1. **可测试**：tick 决策全确定性 → 决策函数可做纯函数单测、场景注入、回归。
2. **可预算**：CPU/Memory 成本静态可知，无不可控外部依赖。
3. **可回滚**：LLM 建议只落在有界参数层，错误建议的影响半径天然受限。
4. **故障隔离**：外部服务（LLM/API）不可用时帝国照常运行——自治契约不依赖体外组件。

## 7. Disadvantages（代价）

- 体外 LLM 顾问不了解实时约束，建议可能不可行——需要参数白名单 + 值域护栏 +
  canary 流程兜底。
- 「确定性优先」意味着某些模糊决策（外交、非常规战术）质量上限由规则设计决定，
  不能指望 LLM 现场救场。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| LLM 生成代码直接上线 | 逻辑错误毁掉帝国 | 代码必须经本地验证门槛（typecheck/test/build 全绿）+ git 回滚；禁止线上自动改代码 |
| LLM 幻觉机制事实（如错误 boost 倍率） | 战斗/经济决策系统性错误 | 一切数值以引擎常量为准（见 03 号文档核查法），LLM 输出不得作为事实源 |
| Memory 指令通道被无条件信任执行 | 体外故障放大到线上 | 指令必须 schema 校验、幂等、带过期与预算上限，非法即拒 |
| 把 Manager 称作 Agent 的概念污染 | 架构评审失去判据 | 本文档 §10 判据 + 术语表强制 |

## 9. CPU Implications

- tick 路径 LLM 成本恒为 0（物理不可达 + 架构禁止）。
- 遥测导出给体外顾问：走 RawMemory segment 低频写入（每 N tick 聚合一次），
  已在 [21_OBSERVABILITY.md](21_OBSERVABILITY.md) 预算内。
- 体外顾问的算力成本不计入游戏 CPU，但计入「建议生效延迟」：参数调整周期
  不应短于统计窗口（否则噪声驱动调参）。

## 10. Recommended Design

### 10.1 判据：什么是「真 Agent」

> **一个组件是 Agent，当且仅当它在运行时拥有「目标选择权」——即能改变「帝国现在
> 追求什么」，而不仅仅是「如何执行既定目标」。**

按此判据盘点本架构（见 [26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md)）：

| 组件 | 是否 Agent | 理由 |
| --- | --- | --- |
| 帝国战略层（posture + budget 决策器） | **受限 Agent** | 唯一拥有目标选择权（peace/fortify/war、扩张/收缩），但它是确定性纯函数：输入态势快照，输出姿态与预算 |
| Kernel / 各 System / RolePolicy / 物流 | 确定性系统 | 执行既定策略，无目标选择权 |
| Creep | 确定性执行器 | 声明式策略驱动的 FSM |
| 体外 LLM 顾问 | 工具，非 Agent | 无运行时目标选择权；只提供建议，采纳权在护栏/canary 流程 |

**结论：本架构不需要 Agent Runtime。**「Agent」是职责描述，不是运行时设施。
命名纪律：禁止把 System/Manager 冠以 Agent 后缀制造架构错觉。

### 10.2 LLM 的三层合法位置（全部体外）

```text
L1 开发期研究员（当前已实践）
    LLM 读代码/文档/issue → 产出设计、迁移、审计结论
    护栏：本地质量门槛（typecheck/test/build）+ 人工评审
L2 运营期低频战略顾问（可选演进）
    读 segment 遥测 → 产出「有界参数调整建议」
    护栏：参数白名单 + 值域/单调性校验 + 统计窗口约束 + canary 生效 + 自动回滚
    帝国侧消费点：tuning 覆盖层（tuned.ts 类机制），建议只是候选值来源之一
L3 灾难接管辅助（人工在场）
    人工授权下做诊断与恢复方案建议；一切动作仍经发布流程
```

硬性律令（与冻结蓝图 LLM_BOUNDARY 一致）：**LLM/外部控制平面不得进入 tick 执行
路径；若引入，必须异步化、可超时、可降级，且外部服务不可用时帝国仍能安全运行。**

### 10.3 禁止清单（绝对不能交给 LLM 的事）

1. 任何 tick 内决策（移动/攻击/spawn/建造/交易的下达）；
2. 事实裁决（游戏机制数值、API 行为——以官方常量与 typings 为准）；
3. 未经验证的代码直接进入生产分支；
4. 修改 Memory schema 或绕过迁移写状态；
5. 自我复制/自我部署闭环（线上 bot 不得改自己的代码；发布永远走体外 CI）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 线上 LLM 决策（tick 内或 Memory 轮询指令通道常开） | 无网络 API（物理否决）+ CPU 不可预算 + 延迟不可控 + 幻觉不可隔离；derek 方案本身无运行数据支撑 |
| Multi-Agent 社会（Empire Agent ↔ Room Agent 协商/谈判） | CPU 与不确定性双重爆炸；无任何已知成功先例；职责可用确定性分层完整表达 |
| 在线强化学习（线上 self-play 更新策略） | 无安全 eval 环境；训练事故直接等于帝国损失；Overmind-RL 的正确姿势是全体外 |
| 效用 Agent（每 tick 对所有 Goal 重算效用竞拍） | CPU 不可承受且决策抖动；TooAngel 用三个平滑指标达成同等的资源裁决 —— 见 [06_GOAL_AND_POLICY_SYSTEM.md](06_GOAL_AND_POLICY_SYSTEM.md) |

## 12. Open Questions

1. L2 顾问的参数白名单粒度：调 room 级参数还是 empire 级参数？过细导致建议噪声放大。
2. 遥测 → 建议的 schema 定义（需与 21 号文档的 segment 遥测格式共同冻结）。
3. 建议错误时的回滚半衰期：多长的观察窗口足以判定「保留 or 回滚」。
4. 多顾问竞争（不同 LLM/不同提示给出冲突建议）时的裁决机制——短期答案是：不引入
   多顾问，保持单一建议源。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://docs.screeps.com/api/ | 官方 API | 运行时无出站网络能力 | CONFIRMED |
| https://www.derek.net.au/logs/ | 开发日志 | 唯一已知 LLM×Screeps 集成为体外大脑 + Memory 通道；纯规划无实测；guardrails 关键 | CONFIRMED（对其状态的自述） |
| https://github.com/bencbartlett/Overmind-RL | 源码 | RL 只作体外训练环境 | CONFIRMED |
| https://www.reddit.com/r/screeps/comments/5uab0c/api_for_machine_learning/ | 社区讨论 | ML 共识形态=体外学习 | LIKELY |
| https://github.com/TooAngel/screeps/blob/master/doc/Design.md | 源码文档 | 十年无人值守自治全靠确定性统计门控 | CONFIRMED |
| https://github.com/bonzaiferroni/bonzAI | 源码 | 自治愿景与实际覆盖率诚实分离 | CONFIRMED |
| docs/architecture/LLM_BOUNDARY.md（本仓库冻结蓝图） | 蓝图 | 与本文结论一致的既有契约 | CONFIRMED |
