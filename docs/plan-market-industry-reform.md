# Terminal / Lab / Factory / 市场交易系统改造计划

> **状态**：设计已固化，待逐阶段实施。
> **创建**：2026-08-20。
> **触发**：线上 3 千万 credits + 零买入日志的根因诊断。
> **无 schema 变更**：procurementDemands 纯 heap，不触发 Memory 迁移。

## 1. 根因摘要

线上 3 千万 credits + 卖出正常成交 + **零买入日志**。根因不是 credits 断源或市场流动性问题，
而是工业链的需求信号从未从消费方传递到采购方。具体 5 个架构断层：

| 断层 | 严重度 | 描述 |
|------|--------|------|
| 需求信号断路 | **严重** | 消费方（lab/factory/boost）的需求不传递到采购方（terminal-manager） |
| 缺口目标硬编码 | **严重** | `MINERAL_RESERVE_TARGET`（500/200）固定目标与实际消费速率无关 |
| 库存口径遗漏 | **中等** | `collectMineralInventory` 不看 lab/factory 库存（lab 在反应中的原料被忽略） |
| 买入品类缺失 | **中等** | 只买 7 种基础矿物，不买中间产物/化合物 |
| 优先级饥饿 | **中等** | `continue` 链让卖出永远挤出买入（每轮只有 1 个 deal 窗口） |

## 2. 理想架构：需求驱动闭环

### 核心原则

Screeps 工业链是多级供应链：

```
基础矿 (extractor) → 中间产物 (lab reaction) → 终端化合物 (boost/卖出)
                     ↑ 原料缺口                        ↑ 化合物盈余
                     │                                  │
               市场买入 (terminal)              市场卖出 (terminal)
```

理想架构需要：
1. **统一的库存视图**：storage + terminal + labs + factory 在一个可计算口径下
2. **需求自下而上汇总**：消费方发布"需要什么、多少、什么时候、为什么"
3. **采购决策中心化**：terminal-manager 汇总所有需求，按优先级排序
4. **deal 窗口竞争**：卖出和买入按边际价值竞争同一 terminal 冷却窗口

### 理想 tick 执行流

```
P1: lab-system 运行
    → 收集完整库存（storage + terminal + labs + factory）
    → 规划反应链、评估 boost 需求
    → 发布采购需求表到 globalCache.procurementDemands

P3: factory-manager 运行
    → 选 commodity 目标
    → 发布采购需求表

P3: terminal-manager 运行（最后执行，可读取所有上游需求）
    → 步骤1: 收集完整库存（与 lab 同口径）
    → 步骤2: 汇总 procurementDemands → 按 priority 排序
    → 步骤3: 检查自有房 mineral 互济（terminal.send，不占 deal 冷却）
    → 步骤4: 单一 deal 决策 — 比较所有候选 deal（卖出盈余 vs 买入缺口）
             按"帝国边际价值"排序，取最高价值的一笔执行
    → 步骤5: 挂单管理（不占 deal 冷却）
```

### 理想的 deal 决策模型

每个候选 deal 计算 `imperial_value`：

```
// 卖出 value = credits 获益 × 流动性折价
sell_value = (order.price - minSellPrice) × amount × liquidity_factor

// 买入 value = 需求优先级 × 缺口严重度 × 时间紧迫性
buy_value = demand.priority × (demand.deficit / demand.target) × urgency_factor

// 取 max(sell_value, buy_value) 的候选执行
```

## 3. 当前缺陷对照

| 维度 | 理想架构 | 当前实现 | 差距 |
|------|----------|----------|------|
| 库存视图 | storage + terminal + labs + factory 统一 | terminal-manager 只看 storage + terminal | 遗漏 lab/factory |
| 需求来源 | lab/factory/boost 发布结构化需求 | 硬编码 MINERAL_RESERVE_TARGET(500/200) | 零通信 |
| 买入品类 | 基础矿 + 中间产物 + 化合物 | 只有 7 种基础矿物 | 中间产物缺失 |
| deal 调度 | 单一决策器比较边际价值 | continue 链硬编码先卖后买 | 卖出独占窗口 |
| 跨系统协调 | globalCache 传递 procurementDemands | lab 需求写 RoomMemory(terminal 不读) | 信号断路 |
| 卖出品类 | 盈余矿物 + 产出化合物 + commodity | 只卖 homeMineral + energy + battery | 化合物不卖 |
| 卖出执行 | 现货 deal + 挂单并用 | 现货 deal 优先 + 挂单管理 | **正确** |
| 价格门禁 | 动态：根据需求优先级调整 | 静态硬编码 | 可接受（后续优化） |

## 4. 分阶段实施计划

### 阶段 0：统一库存视图（最小改动，立即生效）

**目标**：消除 `collectMineralInventory` 遗漏 lab/factory 的缺陷。

**改动**：
- 提取公共纯函数 `collectFullInventory(snapshot)` 到 `domain/industry/inventory.ts`
- 收集 `storage + terminal + labs + factory` 的非 energy 资源
- `terminal-manager.ts` 的 `collectMineralInventory` 改为调用此函数
- `lab-system.ts` 的 `collectCompoundInventory` 也改为调用此函数（消除两处重复口径）

**验收标准**：
- `collectFullInventory` 包含 lab 和 factory 库存
- 现有测试不回归
- `lab-system` 和 `terminal-manager` 使用同一库存口径

**改动范围**：1 个新纯函数文件 + 2 个调用方修改

---

### 阶段 1：需求信号传递（核心架构修复）

**目标**：让消费方发布结构化采购需求，terminal-manager 汇总后决策。

**数据契约**：

```typescript
// global-cache.ts 新增
export interface ProcurementDemand {
  /** 资源类型（基础矿/中间产物/化合物/power/G）。 */
  resource: string;
  /** 缺口量。 */
  amount: number;
  /** 优先级（0-100，越高越急）。 */
  priority: number;
  /** 截止 tick（超过则降级/放弃）。 */
  deadline: number;
  /** 来源标记（诊断用）。 */
  reason: string;
}

// globalCache 新增字段
procurementDemands?: { tick: number; byRoom: Record<string, ProcurementDemand[]> };
```

**发布方**：

| 系统 | 发布什么 | 优先级范围 |
|------|----------|-----------|
| lab-system | 反应链展开的基础矿缺口 + boost 化合物缺口 | 20-30（反应原料）/ 30-40（boost） |
| factory-manager | commodity 配方原料缺口 | 10-15（非生存） |
| terminal-manager（自检） | powerSpawn power 缺口 / nuker G 缺口 | 25（power）/ 15（G） |

**消费方**：`terminal-manager` 在 `run()` 开头读取 `globalCache().procurementDemands`，按 priority 降序排序，在 deal 窗口中按序尝试买入。

**验收标准**：
- lab 反应链消耗 H 时，terminal-manager 收到 `{resource: "H", amount: 3000}` 需求
- 单测验证需求表写入/读取
- deadline 过期的 demand 被清除

**改动范围**：
- `global-cache.ts`：新增类型 + 字段
- `domain/industry/` 新增 `procurement.ts` 纯函数（汇总/排序/去重/过期清理）
- `lab-system.ts`：反应链规划后展开需求
- `factory-manager.ts`：commodity 目标后展开需求
- `terminal-manager.ts`：读取需求表

**依赖**：阶段 0

---

### 阶段 2：deal 调度改为优先级竞争（修复 continue 饥饿）

**目标**：卖出和买入在同一个 deal 窗口内按边际价值竞争。

**改动**：

```typescript
// terminal-manager.ts run() 改造
for (const snapshot of ctx.snapshots()) {
  if (terminal.cooldown > 0) continue;

  // 收集所有候选 deal（卖出 + 买入），每个带 priority
  const candidates: DealCandidate[] = [];

  // 卖出候选（priority 基于盈余量 × 价格）
  if (surplusEnergy > 0) candidates.push({ type: "sell-energy", priority: 40, ... });
  if (surplusMineral > 0) candidates.push({ type: "sell-mineral", priority: 35, ... });
  if (surplusBattery > 0) candidates.push({ type: "sell-battery", priority: 30, ... });

  // 买入候选（priority 来自 procurementDemands）
  for (const demand of demands) {
    candidates.push({ type: "buy", priority: demand.priority, ... });
  }

  // 按 priority 降序排序，取最高价值的一笔执行
  candidates.sort((a, b) => b.priority - a.priority);
  if (candidates.length > 0) {
    executeDealCandidate(candidates[0], terminal, snapshot);
  }
}
```

**安全约束**：
- 卖出 priority 上限 = 50（日常盈余变现，不让日常贸易挤掉紧急采购）
- 买入 priority 范围 = 10-100（boost/危机可超过卖出上限）
- 危机能量买入 priority = 80（生存级，优先于一切卖出）

**验收标准**：
- 卖出和买入在 deal 窗口内按 priority 竞争
- 线上出现买入日志
- 单测验证 priority 排序

**改动范围**：`terminal-manager.ts` 的 `run()` 函数重构执行链

**依赖**：阶段 1

---

### 阶段 3：扩展买入品类（中间产物/化合物）

**目标**：当 lab 反应链需要中间产物（OH、ZK、UL、G）且库存不足时，可从市场买入。

**改动**：
- `ProcurementDemand` 已支持任意 `resource` 字符串
- `terminal-manager` 新增 `tryBuyByDemand`：按 demand 的 resource 查 sell 单
- 价格上限按 resource 类型分级：
  - 基础矿：`maxBuyPrice`（已有配置）
  - 中间产物：`maxBuyPrice` × 2（加工溢价）
  - 化合物：`maxBuyPrice` × 5（T2/T3 市价更高）
- `config/index.ts` 新增 `compoundBuyPriceMultiplier` 配置

**验收标准**：
- 中间产物缺口可触发买入
- 单测验证 `tryBuyByDemand` 处理 OH/ZK/UL

**改动范围**：`terminal-manager.ts` + `config/index.ts`

**依赖**：阶段 1

---

### 阶段 4：卖出品类扩展（lab 产出化合物）

**目标**：lab 产出的 T3 化合物在 boost 库存已满后可卖出变现。

**改动**：
- lab-system 在反应链完成后，检查产出化合物库存是否超过 boost 储备目标
- 超出部分写入 `globalCache().surplusCompounds` 供 terminal-manager 卖出
- terminal-manager 新增 `trySellSurplusCompound` 函数

**验收标准**：
- boost 储备满后 T3 化合物可卖
- 单测验证 `trySellSurplusCompound`

**改动范围**：`lab-system.ts` + `terminal-manager.ts`

**依赖**：阶段 1

---

### 阶段 5（可选）：动态价格调整

**目标**：根据需求优先级动态调整买入价格上限。

**改动**：
- 高优先级需求（boost/war）允许上浮 50% 价格上限
- 低优先级需求（commodity）维持基准价格
- 纯函数 `adjustMaxPrice(basePrice, demand)` 实现

**改动范围**：`terminal-manager.ts`

**依赖**：阶段 2

## 5. 架构约束（不可违反）

1. **terminal-manager 是 `Game.market.deal` 的唯一调用者** — lab/factory 不得直接调 deal
2. **procurementDemands 是可丢弃缓存**（globalCache/heap） — global reset 后下 tick 重建，不写 Memory
3. **每房每轮至多 1 笔 deal**（terminal 冷却约束） — deal 窗口内按 priority 竞争
4. **getAllOrders 调用受 interval(200t) + bucket 门禁控制** — 不增加调用频率
5. **价格门禁是安全底线** — 即使 priority 很高，超过 maxBuyPrice × 容忍系数也不买
6. **需求表的 deadline 防止僵尸需求** — 过期 demand 被清除，不无限累积
7. **无 schema 变更** — procurementDemands 纯 heap

## 6. 与现有架构的兼容性

| 现有设计 | 保留/改造 | 理由 |
|----------|-----------|------|
| `tryManageSellOrders`（挂单管理） | **保留** | 不占 deal 冷却，设计正确 |
| `trySellPixel` | **保留** | 账户资源，独立链路 |
| `tryNukeSalvage` | **保留** | 生存动作，优先级最高 |
| `planEnergyAid` / `planMineralAid` | **保留** | terminal.send 不占 deal 冷却 |
| `trySellSurplusEnergy` / `trySellHomeMineral` / `trySellSurplusBattery` | **重构为 deal 候选** | 从 continue 链改为 priority 竞争 |
| `tryBuyCrisisEnergy` | **重构为 deal 候选** | priority = 80（生存级） |
| `tryBuyDeficit` | **重构为 `tryBuyByDemand`** | 消费 procurementDemands 替代硬编码目标 |
| `tryBuyPower` / `tryBuyGhodium` | **重构为 demand 发布** | 需求写入 procurementDemands |
| `MINERAL_RESERVE_TARGET` | **废弃** | 被需求信号替代 |
| `collectMineralInventory` | **替换为 `collectFullInventory`** | 加入 labs + factory |

## 7. 实施顺序与验收

| 阶段 | 改动量 | 风险 | 验收标准 | 依赖 |
|------|--------|------|----------|------|
| 0: 统一库存 | 小 | 低 | collectFullInventory 含 lab/factory；测试不回归 | 无 |
| 1: 需求信号 | 中 | 中 | lab 消耗 H 时 terminal 收到需求；单测验证写入/读取 | 阶段 0 |
| 2: deal 调度 | 中 | 中 | 线上出现买入日志；单测验证 priority 排序 | 阶段 1 |
| 3: 买入品类 | 小 | 低 | 中间产物缺口可买入；单测验证 | 阶段 1 |
| 4: 卖出品类 | 小 | 低 | 化合物盈余可卖出；单测验证 | 阶段 1 |
| 5: 动态价格 | 小 | 低 | 高优先级允许上浮价格；单测验证 | 阶段 2 |
