# 老玩家深度审查报告（第二轮 · 战略层）

> 审查视角：资深 Screeps 官服玩家 + 资深工程师。
> 审查范围：业务逻辑层（不含代码风格），覆盖 plan.md 设计意图与 src/ 实际实现的一致性。
> 前置说明：第一轮审查（optimization-plan.md，P0-1 ~ P2-9 共 9 项）经逐项核对**已全部落地修复**，
> 本报告只讲增量发现，不重复已解决的问题。

---

## 0. 总体评价

**内核层（调度 / 看门狗 / 错误边界 / Memory 治理）是官服一流水准**：

- 四档 bucket 降级 + 滞回 + 逐档恢复，比绝大多数 20 CPU 玩家的"拍脑袋 if bucket"严谨得多；
- RoomSnapshot 每房每 tick 单次 `find`、Kernel 单次遍历 `Game.creeps` 同时产出占用与在途能量，
  这是教科书级的扫描合并；
- 站桩矿工同 tick `harvest` + `transfer`、威胁分级（scout 不冻结经济）、塔集火 + 奶妈优先、
  link 最小传输阈值、储备差分含 creep 携带能量 —— 上一轮的老玩家修正全部正确落地；
- movement 的疲劳感知 swampCost、自适应 reusePath、三级卡位脱困，均已达到可直接上官服的质量。

**但战略层存在系统性盲区**：当前代码是一个极其优秀的"单房 RCL1–5 生存机器"，
而 plan.md 承诺的 M7（多房/远矿）与 M8（link/塔防/市场/扩张）在代码中**零接口预留**。
更紧迫的是，若干经验偏差会在 RCL4–6 开始锁死发展节奏 —— 详见下文。

一句话结论：**守住生存闭环的能力 95 分，把能量变成发展速度的能力 55 分。**

---

## 1. 盲区识别（未被考虑的关键机制）

### 1.1 🔴 远程采矿与扩张：完全为零，且接口被写死

**现状证据**：
- `src/creeps/movement.ts` 所有寻路硬编码 `maxRooms: 1`；
- 无 scout / reserver / remoteHarvester / remoteHauler 角色，`bootstrap.ts` 无注册位；
- `src/systems/room-observer.ts` 名不副实 —— 不使用 StructureObserver、不侦察邻居房，
  只剩每 50 tick 的诊断日志，注释中的"布局触发/防御协调"标注为"未来"；
- 无 `Game.flags`、无 claim 逻辑、无 route/waypoint 概念。

**为什么这是头号盲区**：单房 2 个 source 的能量上限是 20/tick（source 房），
扣除 spawn 供能、建造、维修后，RCL6+ 的升级与 GCL 增速都会被这个天花板压死。
老玩家的标准答案是 RCL4–5 起开 1–2 个邻房 remote mining（每房多 10–20/tick 净收入）。
plan.md 把多房放在 M7，但 movement 层 `maxRooms: 1` 写死意味着 M7 不是"加插件"，
而是**动内核级的改造** —— 与"多房可作为插件加入，无需修改内核"的长期目标自相矛盾。

**建议**：现在就做两件事（不必实现完整 remote）：
1. movement 的 `maxRooms` 从 config 读取，默认 1，为 remote 角色预留 `route` 缓存键设计；
2. room-observer 增加最简邻居房侦察（每 N tick 扫一个出口邻房，记录 source 数 / 是否有主 /
   source keeper 存在性，存 RoomMemory 短字段）—— 这是后续所有扩张决策的数据源。

### 1.2 🔴 市场（Game.market）：零引用，lab 产业链因此空转

**现状证据**：全库无 `Game.market` 引用；`src/domain/industry/terminal-policy.ts` 是显式 no-op
（只接收不发送）；terminal 仅作矿物卸载目的地。

**连锁后果**：`lab-system.ts` 的 boost 链（XGH2O 升级 +400% 等）原料全靠自产，
而没有市场采购 → boost 几乎永远不会实际发生 → RCL6 建的 lab 是沉没成本。
同时 RCL6+ 房间能量/矿物盈余没有变现通道（卖能量买紧缺矿物是最基础的官服操作）。

**建议**：terminal-policy 从 no-op 升级为最小策略：
- 卖：storage 能量 > 阈值（如 200k）时挂卖单或接买单；
- 买：boost 目标化合物的基础矿物缺口（`getMineralDeficits()` 已有现成的查询函数，直接接上）；
- 全部走 `Game.market.orders` 已有单撮合，不做复杂套利（符合首期非目标）。

### 1.3 🔴 防御体系只有一层：塔 + safeMode，缺 defender 与修墙链

**现状证据**：
- `tower-defense.ts` 做得不错（集火、奶妈优先、能量保留），但它是**唯一的防御手段**；
- `builder.ts` 明确不修 wall/rampart；墙血量目标（RCL7-8: 10M）只能靠**塔修** ——
  塔修墙是能量黑洞（远距离效率衰减 + 与开火争能量），且入侵期间塔应当开火而非修墙；
- safe mode 触发条件：仅当**无塔**且敌人贴近 spawn 5 格。
  推论：有塔的房间 spawn 被拆时**不触发 safe mode**，完全赌塔 DPS 能打死拆除者。
  对 boosted WORK dismantler（一个 boosted WORK = 拆墙 100 hits×4 = 高效拆迁），
  单塔/双塔 DPS 打不动，防线会被磨穿。

**建议**（分层补齐，按 RCL 解锁）：
1. RCL3–4：builder 增加"防御维修"分支 —— 仅修 rampart 到 RCL 分级目标血量，
  受盈余门禁（energyPressure 低 + 无 P0/P1 缺口）限制，塔不再修墙只修关键结构；
2. RCL4+：新增 `defender` 角色（rampart 内站桩 melee，2A+2M+若干 TOUGH），
  仅 threatCreeps 存在时由 spawn-manager 以 P0/P1 生成，威胁解除后 recycle；
3. safe mode 条件补充："有塔但 spawn/塔本体 hits 正在下降且塔 DPS 不足以击杀"
  （简单的 dps 估算：塔可用 DPS vs 敌方 heal/治疗 + 有效血量）。

### 1.4 🟠 矿物产业链闭环断裂：extractor 无自动放置

`harvester.ts` 在 source 再生期会 `harvestMineral`，hauler 会运回矿物 ——
但布局模板 `compact-core-v1.ts` **没有 extractor cell**，layout-planner 永远不会建它。
这条链路目前是死代码，除非玩家手动放 extractor。

**建议**：模板增加 extractor cell（minRcl: 6, phase: "late", priority: 3），
或在确认矿物策略前删除 `harvestMineral` 分支避免误导。

### 1.5 🟠 能量回收机制缺失：无 recycleCreep

全库无 `recycleCreep` / `renewCreep` 调用。后果：
- 换代场景（小 body 被大 body 替换、worker 退役）的残值全部浪费 ——
  一个 350 能量 body 回收约返还 100+ 能量；
- 多余的 hauler（经济收缩后配额下降）只能等 1500 tick 自然老死，白吃 CPU。

**建议**：spawn-manager 增加回收通道 —— 需求评估输出"富余名单"，
富余 creep 走到最近 spawn 旁 `recycleCreep`；defender 威胁解除后走同一通道。

### 1.6 🟡 RCL8 升级限速（15 e/tick）无显式逻辑

当前 upgrader 最大 2W × maxCount 3 = 6/tick，**巧合地**满足 RCL8 的 15/tick 上限。
但这是巧合不是设计 —— 一旦按本报告 §2.1 放大 upgrader body，立即违规浪费能量。

**建议**：在 upgrader 需求评估中显式编码 `if (rcl === 8) targetWorkParts = min(workParts, 15)`。

### 1.7 🟡 idle 无停车策略

`role-runner.ts` 空闲即原地罚站。在紧凑核心布局里，罚站位置可能恰好堵住
source 工位、container 顶格、走廊咽喉。老玩家会 park 到 storage/spawn 旁的指定待命区。

**建议**：布局模板标注 1–2 个 idle 停车位，idle 时低成本靠拢（复用现有 movement，每 tick 一次判断）。

---

## 2. 经验偏差（不符合老玩家最佳实践）

### 2.1 🔴 最大偏差：body 模板不随 RCL 放大

`src/config/bodies.ts` 全部封顶在低档位：

| 角色 | 封顶 body | 成本 | RCL5 (800) / RCL6 (1300) / RCL8 (2300) 的容量利用率 |
| --- | --- | ---: | --- |
| harvester | 5W1C1M | 600 | 75% / 46% / 26% |
| upgrader | 2W1C2M | 350 | 44% / 27% / 15% |
| builder | 2W1C2M | 350 | 同上 |
| hauler | 4C2M（道路变体） | 300 | 38% / 23% / 13% |

**连锁代价**：
1. **升级功率被锁死**（见 §2.2）；
2. 同样功率需要**更多 creep 数** → CPU、寻路、堵路、spawn 占用时间全部线性上升。
   spawn 时间是稀缺资源（3 tick/part）：一个 350 body 占 15 tick 孵化窗，
   RCL6 用 350 body 等于让 1300 容量的 spawn 干 300 容量的活；
3. hauler 150–200 的 CARRY 在 RCL5+ 长链路（source→storage→controller）上
   要跑更多趟，交通热度和道路磨损同步放大。

**老玩家做法**：
- upgrader：RCL4 起 4–6W，RCL6 起 8–15W 站桩（配 controller container/link，0 通勤）；
- hauler：按"运距 × 产出速率 ÷ CARRY"计算单人吞吐，body 随链路拉长而放大；
- builder：RCL4+ 4–8W，大工地（storage/塔）几下就拍完，减少往返。

**建议**：`bodies.ts` 每个角色增加 RCL4+ / RCL6+ 档位（selectBody 已有容量匹配机制，
纯配置改动，零架构风险）；upgrader 档增加时同步落地 §1.6 的 RCL8 限速。

### 2.2 🔴 升级功率 6 e/tick 是全局发展瓶颈

单房收入 ~20 e/tick，扣除 spawn 供能（摊薄约 1–2）、hauler 维持、建造维修后，
RCL4+ 常态盈余应在 8–12 e/tick。但 upgrader 上限 = 3 × 2W = **6 e/tick**，
且 `economyPressure` 梯度还会进一步缩编。

RCL4→8 需要的控制器能量是百万级；升级管道是全房间最窄的一段管子，
而老玩家的共识是：**防御与 spawn 供能之外，能量应优先灌给 controller** ——
RCL 每升一级解锁的是 spawn 容量、塔、link、storage、lab，是复利。

**建议**：upgrader 目标功率改为"storage 水位 + 盈余速率"驱动：
- storage > 50k（或盈余 > 阈值）：升级功率拉满（受 RCL8 15/tick 上限约束）；
- storage 10k–50k：维持当前梯度；
- < 10k：只保底保级。
配合 §2.1 的大 body，单个 15W upgrader 站桩即可吃满 RCL8 上限，creep 数反而降到 1 个。

### 2.3 🟠 hauler 配额是被动启发式，滞后一个阶梯

`demand.ts` 的 hauler 配额：container 填充 >80% 计 2、>40% 计 1。
这是**先堆积、后补人**的被动策略 —— 能量已经在 container 里躺了一段时间，
系统才承认"运不走"。孵化一个 hauler 还要再等 9–15 tick。

**老玩家做法**（吞吐模型）：
```
所需 CARRY 总量 ≈ 产出速率(e/tick) × 往返路程(tick) 
所需 hauler 数 = ceil(所需 CARRY / 单 body CARRY)
```
快照已有 sourceOccupancy 和距离数据，计算是纯函数、每房每 25–50 tick 一次即可。
填充度信号可以保留作为**修正项**（持续 >80% 说明模型低估，临时 +1）。

### 2.4 🟠 塔修关键结构与 builder 维修重叠

`tower-defense.ts` 无敌人时修 <50% 的 spawn/extension/tower/container；
`builder.ts` 的 `repairCritical` 也修同一批目标。塔修 1 次 = 10 能量且远距离衰减，
creep 修 = 1 energy/100 hits/WORK —— **塔修是 creeps 维修成本的数倍**，还占用防御弹药。

**建议**：塔的无战事维修收窄为"仅修 creep 无法及时到达的紧急项"（如 container 即将断链 decay），
常规 <50% 维修全部交给 builder/repair 分支。

### 2.5 🟡 预热替换 buffer 缺路程项

`needsReplacement` 阈值 = `bodyLength × 3 + 15`。plan.md §5.4 明确要求
"预计路程与 15 tick 安全缓冲之和" —— 实现只做了固定 15。
单房内部路程 10–30 tick 常见，大 body 矿工（15 tick 孵化 + 25 tick 通勤）会断档 ~25 tick。

**建议**：需求评估时按 source→spawn 已知距离（快照有数据）加路程项，纯函数改动。

### 2.6 🟡 harvester 固定 1 CARRY：link mining 时纯浪费

5W1C1M 对 container mining 是正确折中（1C 承接同 tick transfer）；
但 RCL5+ source link 就位后，矿工不再需要 CARRY（能量直接进 link），
此时 5W1M（550）比 5W1C1M（600）省 50 能量且 body 更短。

**建议**：低优先级。可为 harvester 增加"link 就位后无 CARRY"档位，
由 spawn-manager 按 snapshot 中 source link 存在性选档。

---

## 3. 效率瓶颈（tick 浪费与能量流转）

按"每修复一项能多榨出多少能量/CPU"排序：

| # | 瓶颈 | 浪费估算 | 修复入口 |
| --- | --- | --- | --- |
| 3.1 | 升级功率 6 e/tick 封顶（§2.2） | RCL4+ 每天少升数万控制能量，直接拖慢 RCL/GCL 复利 | bodies.ts + demand.ts |
| 3.2 | body 不放大 → creep 数膨胀（§2.1） | 每 creep 每 tick 的调度/寻路/碰撞成本 × 多余数量；spawn 孵化窗挤占 | bodies.ts |
| 3.3 | hauler 被动配额（§2.3） | 能量在 container 滞留时间 = 住房升级的时间价值 | demand.ts 吞吐模型 |
| 3.4 | 塔与 builder 重复维修（§2.4） | 塔修一次 10 能量 vs creep 1 能量/100hits，差数倍 | tower-defense.ts |
| 3.5 | 无 recycle（§1.5） | 换代 body 残值 + 富余 creep 白吃 CPU | spawn-manager.ts |
| 3.6 | idle 罚站堵路（§1.7） | 间接：堵路导致他人重寻路 CPU + 通勤变长 | role-runner.ts + 模板停车位 |
| 3.7 | 链路无 terminal 补给 / 无市场（§1.2） | lab 系统整体空转，RCL6 建筑沉没 | terminal-policy.ts |

**已经做对、值得保持的效率实践**（审查确认，勿回退）：
- 矿工同 tick harvest+transfer、sink 满原地 drop 不离岗；
- controller container 半满以下 fill 优先级最高（升级不断粮）；
- link 三级链 + minTransfer=400 + controller 急需豁免；
- 储备差分含 creep 携带能量（物流搬运不误判危机）；
- 全局每 tick 最多 1 site + source container 紧急重建豁免门禁（防死锁）；
- 道路证据驱动（双窗口 ≥5 次通行）+ 确定性走廊路双轨制。

---

## 4. 发展节奏评估

### 4.1 RCL1–4：✅ 节奏正确，堪称范本

灾后 200 能量立即 [W,C,M] → container → extension → tower → storage 的解锁顺序、
"P0 缺口时不建普通 site"、道路不预铺 —— 全部符合老玩家共识，无需调整。

### 4.2 RCL4–6：⚠️ 缺"升级冲刺"阶段，节奏将明显慢于同类

老玩家在 storage 落成后进入**冲刺模式**：upgrader 功率拉满冲 RCL5（link）→ RCL6（lab/terminal/extractor），
因为 RCL5/6 解锁的是产能工具本身，早到一天复利一天。
本项目 maxCount 3 × 2W 的设计会把这段拖长 2–3 倍。**这是全报告 ROI 最高的修复点**（§2.1+§2.2）。

### 4.3 军事节奏：⚠️ RCL3 之后没有第二手

RCL3 塔（对）→ RCL4 rampart 方向盾（对）→ 然后就没了。
RCL5+ 面对有组织的进攻（boosted dismantle / ranged kiting），塔 + safeMode 不够。
防御建设建议与 RCL 解锁绑定（§1.3 的分层方案），不要等 M8 一并做 ——
防御插件和 link/市场是不同优先级，塔防plan.md 已列为 critical，defender 应同级。

### 4.4 多房节奏：🔴 M7 时点偏晚 + 代码零预留

官服单房冲 RCL8 的过程中 GCL 自然到 2–3（控制器能量同时喂 GCL），
意味着**到达 RCL8 时就应该已经会扩张了**，而不是 RCL8 后才开始学。
且 movement/observer/route 全部零接口（§1.1），M7 会变成伤筋动骨的大改。

**建议**：把"接口预留"（movement maxRooms 配置化、邻居侦察、route 缓存键）
从 M7 拆出来提前到当前阶段，每个改动都很小；完整 remote 逻辑仍可放 M7。

### 4.5 RCL8：⚠️ 限速逻辑缺失（§1.6），随 body 放大必须同步落地

---

## 5. 行动清单（按 ROI 排序）

### 第一批：不动架构的纯配置/domain 修改（1–2 天，收益最大）

| # | 内容 | 文件 | 风险 |
| --- | --- | --- | --- |
| A1 | upgrader/builder/hauler 增加 RCL4+/RCL6+ body 档位 | `src/config/bodies.ts` | 低，selectBody 容量匹配兜底 |
| A2 | upgrader 目标功率改为 storage 水位驱动 + RCL8 15/tick 显式限速 | `src/domain/spawn/demand.ts` | 低，保留原梯度作中水位分支 |
| A3 | 塔维修收窄为紧急项，常规维修归 builder | `src/systems/tower-defense.ts` | 低 |
| A4 | 替换 buffer 加路程项 | `src/domain/spawn/demand.ts` | 低，纯函数 |
| A5 | 模板补 extractor cell（或删 harvestMineral 死代码） | `src/domain/layout/templates/compact-core-v1.ts` | 低，模板版本 +1 按规范迁移 |

### 第二批：新角色/新通道（2–4 天）

| # | 内容 | 说明 |
| --- | --- | --- |
| B1 | recycleCreep 回收通道 | spawn-manager 富余名单 + 走近 spawn 回收 |
| B2 | defender 角色（rampart 站桩 melee） | P0/P1 生成、威胁解除走 B1 回收 |
| B3 | builder 防御维修分支（rampart 至分级血量，盈余门禁） | 解除"塔修墙"能量黑洞 |
| B4 | hauler 吞吐模型 | 填充度信号降级为修正项 |
| B5 | idle 停车位 | 模板标注 + role-runner 低成本靠拢 |
| B6 | safe mode 条件补"有塔但守不住"分支 | dps 估算即可，不必精确 |

### 第三批：战略接口预留（为 M7/M8 拆雷，各 0.5–1 天）

| # | 内容 | 说明 |
| --- | --- | --- |
| C1 | movement `maxRooms` 配置化 | 默认 1，remote 角色传 route |
| C2 | room-observer 最简邻居侦察 | source 数/归属/SK，存 RoomMemory |
| C3 | terminal-policy 最小市场策略 | 卖余能 + 买 boost 矿物缺口（接 `getMineralDeficits()`） |

### 原则提醒（与 plan.md 一致）

- A/B 批全部可走现有插件规范：新角色只改 `bootstrap.ts` + 新模块，不动 Kernel；
- 模板改动递增 `templateId`/`layout.version` 并写迁移；
- 每批合并前 `npm run typecheck && npm test && npm run build` 全绿；
- C 批只是"拆雷"，不是提前实现 M7 —— 警惕把 20 CPU 预算花在尚未验证的扩张上。

---

## 附：本次审查方法与覆盖面

- 通读 `docs/plan.md`（876 行）全文、`docs/optimization-plan.md`（317 行，第一轮 9 项）；
- 三个并行探索代理覆盖 `src/creeps/`、`src/systems/`、`src/domain/` + `src/kernel/` 全部 58 个 TS 文件；
- 关键数值人工复核：`src/config/bodies.ts` 全文、`src/domain/spawn/demand.ts` upgrader 段；
- 第一轮 9 项问题逐一与当前代码核对，确认全部修复（本报告不重复计分）。
