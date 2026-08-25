# A6.0 — Long-Term Memory Architecture

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、问题：Screeps 帝国运行数百万 tick，如何管理记忆

### 1.1 当前 Memory 系统的局限

当前系统有三层存储（[MEMORY_ARCHITECTURE.md](../architecture/MEMORY_ARCHITECTURE.md)）：

| 层 | 用途 | 当前状态 |
|----|------|---------|
| Memory（版本化真相） | 跨 tick 决策状态：ID/枚举/数字/短 key | ✅ 已有 schema + migration |
| heap/globalCache | 可重建缓存：快照/路径/索引 | ✅ 已有 TTL + 惰性重建 |
| RawMemory segment | 冷数据：intel/遥测/战争账本 | ⚠️ 部分使用（event-log segment 2） |

**缺失**：没有结构化的长期记忆系统。帝国不记得：
- 上次战争用了什么编队、结果如何
- 玩家 X 上次进攻是什么时候、用什么兵种
- 扩张到某房间的失败原因
- 市场价格的历史趋势
- 经济波动的周期性模式

### 1.2 不能简单 `Memory.history.push(...)`

Screeps Memory 每 tick 付 parse/stringify 线性税。如果历史数据进 Memory：
- 10000 tick 后 Memory 膨胀到 MB 级
- parse/stringify 税从 ~0.1 CPU 涨到数 CPU
- 违反 MEMORY_ARCHITECTURE §7 禁止清单 #2："历史日志/曲线/事件流"

**正确路径**：长期记忆走 RawMemory segment，不进 Memory 主体。

---

## 二、记忆分层模型

### 2.1 六层记忆架构

```
┌──────────────────────────────────────────────┐
│ 1. Working Memory (heap, per-tick)            │
│    当前 tick 的决策上下文，tick 末作废         │
├──────────────────────────────────────────────┤
│ 2. Episodic Memory (segment, 滚动窗口)         │
│    具体事件序列：战争经过、扩张过程、经济波动   │
├──────────────────────────────────────────────┤
│ 3. Semantic Memory (segment, 永久聚合)         │
│    提炼的知识：编队胜率、玩家威胁指数、         │
│    扩张失败率                                 │
├──────────────────────────────────────────────┤
│ 4. Strategic Memory (segment, 永久)            │
│    策略级结论：哪种经济策略有效、               │
│    哪种防御布局有效                            │
├──────────────────────────────────────────────┤
│ 5. Player Memory (segment, 月级 TTL)           │
│    玩家档案：行为模式、战术偏好、               │
│    body 历史、攻击记录                         │
├──────────────────────────────────────────────┤
│ 6. Combat Memory (segment, 滚动窗口)           │
│    战斗细节：body 配置、boost 使用、             │
│    微操效果、损失统计                          │
└──────────────────────────────────────────────┘
```

### 2.2 各层详细设计

#### Layer 1: Working Memory

| 属性 | 值 |
|------|-----|
| 存储 | heap (globalCache) |
| 生命周期 | 1 tick |
| 容量 | 无限（可用即用） |
| 用途 | 当前 tick 的 Experience 候选、正在评估的 Pattern |
| 失效 | tick 末自动作废 |
| 已有 | ✅ globalCache 已有此层 |

**不需要新建**。Working Memory 就是 globalCache 中 A6 系统的临时字段。

#### Layer 2: Episodic Memory

| 属性 | 值 |
|------|-----|
| 存储 | RawMemory segment |
| 生命周期 | 10000 tick 滚动窗口 |
| 容量 | 2 segments (200KB) |
| 内容 | 完整的 Experience 记录（Decision + Outcome + Attribution） |
| 压缩 | 降采样（每 N tick 取 1 条，旧数据稀疏） |
| GC | 环形覆盖（新数据覆盖最旧数据） |

**Episodic Memory Segment Schema**：

```typescript
interface EpisodicSegmentData {
  /** Segment 元数据 */
  epoch: number;           // 最后写入 tick
  version: number;         // schema 版本
  /** Experience 记录数组（环形） */
  experiences: ExperienceRecord[];
  /** 写入游标（环形覆盖位置） */
  cursor: number;
}

interface ExperienceRecord {
  /** 稳定唯一 ID */
  id: string;
  /** 发生 tick */
  tick: number;
  /** 经验类型 */
  type: "war" | "expansion" | "economic" | "defense" | "logistics";
  /** 关联的 DecisionRecord ID（A4.7 DecisionTrace） */
  decisionId: string;
  /** 关联的 EventLog 事件 */
  eventIds: number[];
  /** 决策摘要（不存完整 DecisionRecord，只存摘要） */
  decisionSummary: {
    category: string;     // DecisionCategory
    action: string;       // selectedAction
    actor: string;        // 决策者
  };
  /** 结果 */
  outcome: {
    success: boolean;
    metric: string;       // 量化结果指标
    value: number;        // 量化值
  };
  /** 归因 */
  attribution: {
    primaryFactor: string;
    confidence: number;   // 0-1
  };
  /** 压缩后的状态快照 hash（不存完整状态） */
  stateHash: string;
}
```

**容量估算**：
- 每条 ExperienceRecord ≈ 200 字节（JSON 压缩后）
- 2 segments = 200KB / 200B = 1000 条
- 10000 tick 滚动窗口 = 平均每 10 tick 1 条
- 降采样策略：近 1000 tick 每 10 tick 取 1 条，1000-5000 tick 每 50 tick 取 1 条，5000-10000 tick 每 100 tick 取 1 条

#### Layer 3: Semantic Memory

| 属性 | 值 |
|------|-----|
| 存储 | RawMemory segment |
| 生命周期 | 永久（更新不删） |
| 容量 | 1 segment (100KB) |
| 内容 | 从 Episodic Memory 提炼的聚合知识 |
| 压缩 | 统计聚合（EMA / 分位数 / 直方图） |
| GC | 超容量时合并低置信度条目 |

**Semantic Memory Segment Schema**：

```typescript
interface SemanticSegmentData {
  epoch: number;
  version: number;
  /** 知识条目 */
  knowledge: KnowledgeEntry[];
}

interface KnowledgeEntry {
  /** 知识 ID */
  id: string;
  /** 知识类型 */
  type: "combat-stat" | "expansion-stat" | "economic-stat" | "player-stat";
  /** 知识主体（如 "player:X" / "formation:2atk-1heal" / "room:W1N1"） */
  subject: string;
  /** 统计数据 */
  stats: {
    samples: number;       // 样本数
    successRate: number;   // 成功率 (EMA)
    avgValue: number;      // 平均值 (EMA)
    variance: number;      // 方差
    lastUpdated: number;   // 最后更新 tick
  };
  /** 置信度（基于样本数和方差） */
  confidence: number;      // 0-1
  /** 来源 Episodic IDs（可追溯） */
  sourceEpisodes: string[]; // 限长 10
}
```

**容量估算**：
- 每条 KnowledgeEntry ≈ 300 字节
- 1 segment = 100KB / 300B = 333 条
- 足以覆盖：50 个玩家档案 + 50 种编队配置 + 100 个房间统计 + 100 个经济指标 + 33 条策略结论

#### Layer 4: Strategic Memory

| 属性 | 值 |
|------|-----|
| 存储 | RawMemory segment |
| 生命周期 | 永久 |
| 容量 | 共用 Semantic Memory segment |
| 内容 | 策略级结论 |
| 压缩 | 只存结论不存数据 |

**Strategic Memory 内容**：

```typescript
interface StrategicConclusion {
  id: string;
  /** 策略领域 */
  domain: "economy" | "expansion" | "military" | "defense" | "logistics" | "spawn";
  /** 结论 */
  conclusion: string;      // 人类可读
  /** 支撑数据（Semantic Memory 中的 KnowledgeEntry IDs） */
  evidence: string[];
  /** 建议 */
  recommendation: string;  // 人类可读
  /** 置信度 */
  confidence: number;
  /** 最后验证 tick */
  lastValidated: number;
  /** 状态 */
  status: "active" | "shadow" | "invalidated" | "quarantined";
}
```

#### Layer 5: Player Memory

| 属性 | 值 |
|------|-----|
| 存储 | RawMemory segment |
| 生命周期 | 月级 TTL（~30000 tick），被攻击刷新 |
| 容量 | 共用 Intel players segment |
| 内容 | 玩家行为档案 |
| 压缩 | 衰减权重而非删除 |

**与已有 IntelState 的关系**：

IntelState §3.8 已有玩家级威胁记忆（segment 独立 1-2 段）。A6 的 Player Memory **不替换** IntelState，而是在其上叠加行为分析层。

```typescript
interface PlayerProfile {
  username: string;
  /** 威胁指数（来自 IntelState，A6 只读） */
  threatIndex: number;     // 来自 PlayerIntelRecord
  /** A6 新增：行为统计 */
  behaviorStats: {
    /** 观察到的进攻次数 */
    attackCount: number;
    /** 观察到的 body 配置历史（限长 10） */
    bodyHistory: BodySnapshot[];
    /** 活跃时段统计（Screeps 时间） */
    activeTimeSlots: number[];  // 24 个时段的 EMA
    /** 扩张行为统计 */
    expansionRate: number;   // EMA
    /** 偏好战术 */
    preferredTactics: string[]; // ["SIEGE", "HARASSMENT", ...]
  };
  /** 最后遭遇 tick */
  lastEncountered: number;
  /** 数据置信度 */
  confidence: number;
}

interface BodySnapshot {
  tick: number;
  /** body 摘要（角色 + 数量，不存完整 body） */
  composition: { role: string; count: number; boosted: boolean }[];
  /** 观测到的战术行为 */
  observedBehavior: string;
}
```

#### Layer 6: Combat Memory

| 属性 | 值 |
|------|-----|
| 存储 | RawMemory segment |
| 生命周期 | 10000 tick 滚动窗口 |
| 容量 | 1 segment (100KB) |
| 内容 | 战斗细节 |
| 压缩 | 聚合统计（不存原始 tick 级数据） |
| GC | 环形覆盖 |

**Combat Memory Segment Schema**：

```typescript
interface CombatSegmentData {
  epoch: number;
  version: number;
  /** 战斗记录 */
  battles: BattleRecord[];
  cursor: number;
}

interface BattleRecord {
  id: string;
  tick: number;
  /** 目标房间 */
  targetRoom: string;
  /** 对手 */
  opponent: string;
  /** 我方编队摘要 */
  ourComposition: { role: string; count: number; boosted: boolean }[];
  /** 敌方编队摘要 */
  enemyComposition: { role: string; count: number; boosted: boolean }[];
  /** 战术状态转换序列（摘要） */
  tacticalTransitions: string[];  // ["FORMING→MOVING→ENGAGING→RETREATING"]
  /** 结果 */
  outcome: "success" | "failure" | "unknown";
  /** 损失 */
  ourLosses: number;
  enemyLosses: number;
  /** CPU 消耗估算 */
  cpuCost: number;
  /** 关键决策 hash（可 Replay） */
  keyDecisionHash: string;
}
```

---

## 三、存储分配总表

| Segment | 内容 | 预算 | TTL | 写频率 | 激活频率 |
|---------|------|------|-----|--------|---------|
| `a6-episodic-1` | Episodic Memory 前半段 | 100KB | 10000t 滚动 | 事件式 | 按需 |
| `a6-episodic-2` | Episodic Memory 后半段 | 100KB | 10000t 滚动 | 事件式 | 按需 |
| `a6-semantic` | Semantic + Strategic Memory | 100KB | 永久 | 每 500t | 按需 |
| `a6-combat` | Combat Memory | 100KB | 10000t 滚动 | 事件式 | 按需 |
| `intel-players` | (已有) Player Intel + A6 Player Profile 扩展 | 100KB | 月级 | 事件式 | 低频 |

**Segment 激活预算**：A6 常态占用 ≤ 2 个激活段（episodic 当前页 + semantic）。与 Intel 共享 10 段/tick 上限。

---

## 四、轻量统计机制评估

### 4.1 适合 Screeps 的统计机制

| 机制 | 用途 | CPU | Memory | 确定性 | 适合度 | 使用场景 |
|------|------|-----|--------|--------|--------|---------|
| **Ring Buffer** | 固定长度历史窗口 | O(1) | O(N) | ✅ | ⭐⭐⭐⭐⭐ | Experience Buffer, Combat Memory |
| **Rolling Statistics** | 滑动窗口均值/方差 | O(1) | O(1) | ✅ | ⭐⭐⭐⭐⭐ | 经济趋势, 胜率 EMA |
| **EMA (Exponential Moving Average)** | 衰减权重平均 | O(1) | O(1) | ✅ | ⭐⭐⭐⭐⭐ | 所有需要 "近期更重要" 的统计 |
| **EWMA** | 同 EMA（另一种称呼） | O(1) | O(1) | ✅ | ⭐⭐⭐⭐⭐ | 同上 |
| **Histogram** | 分布统计 | O(1) update | O(B) (B=bins) | ✅ | ⭐⭐⭐⭐ | CPU 消耗分布, 经济波动分布 |
| **Reservoir Sampling** | 固定容量均匀采样 | O(1) | O(K) | ⚠️ 需确定性 PRNG | ⭐⭐⭐ | 长期历史采样（需用确定性 hash 代替 random） |
| **Count-Min Sketch** | 频率估计 | O(1) | O(d×w) | ✅ | ⭐⭐ | 事件频率统计（但 Screeps 事件量不大，overkill） |
| **Bloom Filter** | 存在性检查 | O(1) | O(m) | ✅ | ⭐⭐ | 玩家名去重（但 Set 更简单） |

### 4.2 推荐使用

**第一阶段使用**：
1. **Ring Buffer** — Experience Buffer (heap)
2. **EMA** — 所有需要衰减权重的统计（胜率、威胁指数、经济趋势）
3. **Rolling Statistics** — 滑动窗口统计（最近 N 个采样的均值/方差）
4. **Histogram** — 经济/CPU 分布统计

**不使用**（过度工程）：
- Count-Min Sketch — Screeps 事件量不大，直接用 Map 计数
- Bloom Filter — 用 Set 代替
- Reservoir Sampling — 用降采样（每 N tick 取 1 条）代替

### 4.3 确定性 EMA 实现

```typescript
// 确定性 EMA（无 Math.random，无浮点误差）
function emaUpdate(prev: number, value: number, alpha: number): number {
  // alpha 固定为 2/(N+1) 形式，N 为窗口大小
  // 使用 toFixed(4) 固定精度防浮点漂移
  const next = prev + alpha * (value - prev);
  return Number(next.toFixed(4));
}
```

---

## 五、Memory 预算模型

### 5.1 每层预算

| 层 | max entries | TTL | compression | aggregation | GC |
|----|-------------|-----|-------------|-------------|-----|
| Working Memory | 无限（heap） | 1 tick | 无 | 无 | tick 末自动 |
| Episodic | 1000 | 10000t 滚动 | 降采样 | 无 | 环形覆盖 |
| Semantic | 333 | 永久 | 聚合统计 | EMA + 分位数 | 超容量合并低置信 |
| Strategic | 33 | 永久 | 只存结论 | 无 | invalidated 时清除 |
| Player | 50 | 月级 | 衰减权重 | EMA | TTL 到期清除 |
| Combat | 200 | 10000t 滚动 | 聚合统计 | EMA | 环形覆盖 |

### 5.2 总容量

```
Working Memory:   heap（不计入 segment 预算）
Episodic:         2 segments × 100KB = 200KB
Semantic+Strategic: 1 segment × 100KB = 100KB
Player:           共用 intel-players segment（扩展现有）
Combat:           1 segment × 100KB = 100KB
─────────────────────────────────────
Total segments:   4 个 A6 专用 + 1 个共用 = 5 segments
Total capacity:   ~400KB (A6 专用) + 共用部分
```

### 5.3 禁止事项

| 禁止 | 理由 |
|------|------|
| 无限历史 | 百万 tick 产生百万条记录，远超容量 |
| 原始 tick 级数据进 segment | 体积爆炸 |
| Memory 主体存历史 | 违反 MEMORY_ARCHITECTURE §7 #2 |
| heap 状态抢救进 Memory | 违反 MEMORY_ARCHITECTURE §4 |
| 每 tick 写 segment | 异步语义 + 写放大 |
| 多系统写同一 segment | 唯一写者原则 |

---

## 六、与已有存储系统的关系

### 6.1 不替换已有系统

| 已有系统 | A6 的关系 |
|---------|----------|
| Memory schema (A1) | A6 不新增 Memory 字段（除可能的 posture 建议字段） |
| globalCache (A1) | A6 在 globalCache 中添加临时字段（Working Memory） |
| EventLog segment 2 (A4.7) | A6 只读消费 EventLog，不替换 |
| IntelState segment (A5.2) | A6 扩展 Player Memory，但不替换 IntelEntry |
| tuning-engine Memory (A4) | A6 的 Adaptive Policy 通过 tuning 覆盖层接口写入 |
| TelemetryState (L1/L2/L3) | A6 只读消费 L2/L3 聚合数据 |

### 6.2 Segment 写纪律

遵守 [MEMORY_ARCHITECTURE.md](../architecture/MEMORY_ARCHITECTURE.md) §5：

1. 每片头部带 `epoch` + 脏标记
2. 脏数据低频批量写，禁止每 tick 全量重写
3. 异步语义：本 tick 请求、下 tick 可读
4. 激活预算集中管理（单一 segment-store 写者）
5. lzstring 压缩

---

## 七、长期运行的 Memory 健康保证

### 7.1 体积遥测

每 1000 tick 采样 A6 segment 总体积，环比增长超阈值 → WARN。

### 7.2 GC 策略

| 数据类型 | GC 机制 | 触发频率 |
|---------|---------|---------|
| Episodic | 环形覆盖（cursor 到头覆盖最旧） | 每次写入 |
| Semantic | 超容量合并（合并低置信度条目） | 每 5000 tick |
| Strategic | invalidated 时清除 | 事件式 |
| Player | TTL 到期清除（jitter 防过期风暴） | 每 1000 tick 扫描 |
| Combat | 环形覆盖 | 每次写入 |

### 7.3 灾后恢复

global reset 后：
- Working Memory 丢失（可接受，下 tick 重建）
- Segment 数据不丢失（持久存储）
- 重建时从 segment 加载 Semantic + Strategic Memory 到 heap 缓存
- Episodic + Combat Memory 按需加载（不常驻 heap）

---

## 八、关键结论

1. **长期记忆必须走 segment**，不进 Memory 主体
2. **六层记忆模型**覆盖从瞬时到永久的全时间尺度
3. **每层有明确的容量上限和 GC 策略**，防止无限增长
4. **使用轻量统计机制**（EMA / Ring Buffer / Rolling Statistics），不使用重量级算法
5. **不替换已有存储系统**，只扩展和叠加
6. **Segment 写纪律**遵守 MEMORY_ARCHITECTURE §5 所有条款
7. **总 segment 占用** ≤ 5 个（含共用），常态激活 ≤ 2 个
