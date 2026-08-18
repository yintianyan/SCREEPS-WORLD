# 回归分析：W37S58「creep 不工作」是怎么被最近的提交引入的

> 关联诊断报告：`DIAG-creep-frozen-2026-08-18.md`
> 主房 W37S58（RCL7，shard3）。分析方式：git blame / git log 锁定相关提交 + 通读
> `spawn-manager.ts` / `queue.ts` / `demand.ts` 的孵化隔离逻辑 + 线上跨 tick 实测反证。

## 0. 一句话结论

**这不是某次「改坏」的单点 bug，而是 `1cca151` 引入的「孵化隔离熔断」机制，叠加早期两笔
配置（`maxRetries:5`、`starvationDegradeFloor:300`），把一次本来会自愈的「能量低谷」放大成了
「矿工停产 500 tick → 能量断链死亡螺旋」。在 `1cca151` 之前，同样的瞬时 spawn 失败只会下一
tick 重试、能量恢复即自愈；之后则直接把整条采集链钉死 500 tick。**

线上实锤（tick 82334830 复探）：`harvester:W37S58:1` 黑名单已**自然到期消失**，两矿 `hv` 均
恢复为 1 —— 印证「矿工隔离」正是扳机，且隔离窗口一过生产即恢复；但 `energyAvailable=16`、
`storage=18k`、`colonyState=recovery` 说明螺旋留下的能量深坑仍在回填中。

---

## 1. 罪魁提交：`1cca151`

**`1cca151` — feat(economy): 完成P0-P1-3全链路经济与防御优化**

这一笔在 `spawn-manager.ts` 里新增了三件套：

| 机制 | 代码位置 | 作用 |
| --- | --- | --- |
| `spawnBlacklist` | `spawn-manager.ts:64-77` | per-room 黑名单，key 到期前拒绝重建该请求 |
| `computeQuarantineTtl(key)` | `spawn-manager.ts:503-508` | 采集角色（harvester/worker）= `requestTtl/2` = **500 tick**；其余 = `requestTtl` = **1000 tick** |
| churn 熔断 | `spawn-manager.ts:541-582` | 200 tick 滑窗内同 role churn > 20 → 该 role 冻结 100 tick |

**隔离触发点（双路径，都在 `cleanQueue` → `spawn-manager.ts:52-78` 落盘）：**

```ts
// queue.ts:122-144  cleanQueue 的两种 purge
if (req.retries >= maxRetries) {            // 路径①：重试烧穿
  onPurge(req.key, "retries");
}
if (req.expiresAt && tick > req.expiresAt) { // 路径②：TTL 1000 tick 过期
  onPurge(req.key, "expired");
}
// spawn-manager.ts:71-77  purge 后写入黑名单（采集角色在 normal/crisis 也照隔离）
for (const key of purgedKeys) {
  const isCollector = key.startsWith("worker:") || key.startsWith("harvester:");
  if (isCollector && isBootstrapOrRecovery) continue;  // ← 仅 bootstrap/recovery 豁免
  roomMem.spawnBlacklist[key] = ctx.tick + computeQuarantineTtl(key);
}
```

**关键设计缺陷**：采集角色的隔离豁免**只覆盖 `bootstrap`/`recovery` 两种状态**
（`spawn-manager.ts:65-73`）。当房间处于 `normal`（或危机 `crisis`）时，harvester 失败照样被
关 500 tick。而 `normal` 恰恰是能量低谷最常出现的状态 —— 于是「丢一个矿工」在 normal 态下
不可自愈。

---

## 2. 两个放大因子（更早提交，单独无害）

### `maxRetries: 5` — 提交 `834260d`（2026-07-20）
`src/config/index.ts:124-135`。重试上限只有 **5 次**。一旦 harvester 连续 5 tick 因能量不足
（`degraded === undefined`，即连最小 body 都负担不起，`trySpawn:367-371`）而烧 retries，立刻
purge → 进黑名单。5 次太少了：能量低谷常持续数十 tick，期间只要有 5 个 tick 恰好 `ea < 最小body`
就触发隔离。

### `starvationDegradeFloor: 300` — 提交 `da813382`（2026-07-29）
`src/config/index.ts`。规定「饥饿降级产物必须 ≥ 300 能量」，低于地板则**继续排队、不烧
retries**（`trySpawn:377-379`）。本意是防铸出 1C1M 残废，但副作用是：当 `ea` 在 200~300 区间
时，harvester 永远等不到 ≥300 的 body，只能空转；一旦 `ea` 跌破 200（螺旋中常见），`degraded`
返回 `undefined` → retries 立刻开烧。

> 这两笔配置在 `1cca151` **之前**也存在，但那时没有「purge+隔离」——失败只是原地重试，
> 能量回暖即孵化，不会升级成停产。是 `1cca151` 把它们从「软等待」变成了「硬隔离」。

---

## 3. 完整因果链（为什么「之前好好的」现在炸了）

```
[normal 态能量低谷]  storage≈18k、spawn/extension 网络≈17% 满（实测）
        │
        ▼
harvester:W37S58:1 的 body 成本 > 当前 energyAvailable
  ├─ trySpawn 进降级分支（trySpawn:348）
  ├─ harvester 是 P1（demand.ts:367，非危机不升 P0），normal 态 starvedP1 需等 ≥2×孵化耗时才成立
  ├─ 早期 allowDegrade=false → 静默 continue（不烧 retries，只是等）
  └─ 等到 starvedP1 成立 → degradeBody 尝试铸最小 body
        │
        ▼ 若此刻 ea 跌破最小 harvester body（≈200，即 WORK+MOVE+CARRY）
  degraded === undefined  →  req.retries++  (trySpawn:367-371)
        │  连续 5 tick 都如此（maxRetries:5 烧穿）
        ▼
  cleanQueue 路径① purge（retries≥5）
        │
        ▼  (1cca151 新增)  normal 态采集角色不豁免 → 写 spawnBlacklist
  harvester:W37S58:1 被隔离 500 tick  ←★★ 扳机 ★★
        │
        ▼
  该 source（实测 source(35,4)）hvCount=0 → 停产
  认领它的 hauler 在空容器旁 idle/stuck（e=0，实测）
        │
        ▼
  全网能量摄入减半 → storage 见底 → spawn 网络更饿
  builder（贵 body，P2）spawn 失败 → 也进黑名单（builder:W37S58:0/1）
        │
        ▼  自强化
  编制 11→8、buildQueue=25 全停、colonyState 跌到 recovery
```

**对比「之前」（1cca151 之前）**：同样的 `ea` 低谷里，harvester 失败只是留在队列、下一 tick
重试；能量一旦回血（distributor 把 storage 的 18k 泵回来）立刻孵化，**最多晚几 tick，绝不
停产**。隔离机制把「晚几 tick」变成了「停产 500 tick」。

---

## 4. 线上实测反证

| 时间点 | spawnBlacklist | 状态 | 解读 |
| --- | --- | --- | --- |
| 首探（~18:30） | `harvester:W37S58:1` + `builder:W37S58:0/1` | 螺旋中 | 矿工+建造双黑 |
| 复探（tick 82334830） | 仅 `builder:W37S58:1` | recovery，两矿 `hv=1` | **harvester 黑名单已自然到期**，生产恢复 |

- harvester 隔离窗口 = 500 tick（`requestTtl/2`，`computeQuarantineTtl`）。到期后它从黑名单
  消失、两矿重建 harvester → 直接证明「矿工隔离」是螺旋扳机。
- 但 `energyAvailable=16`、`storage=18143`、`colonyState=recovery` 说明：螺旋虽止，能量深坑
  需时间回填。这正是「为什么看起来还是半死不活」的原因 —— **不是又卡住了，是在还债**。

---

## 5. 为什么 v33 修复包（`2fefe85`）没救到这个

`2fefe85` 落地了 R11 完整情报与远矿运营止损（sealed-exits / stall-census / 卡位层等），
**未触碰 `spawn-manager.ts`**（git show --stat 证实它只改了 intent/traffic/remote-mining/
intel 等）。所以最近的修复包针对的是「远矿锁死」，**与本次主房能量螺旋无关** —— 这进一步
坐实根因在更早的 `1cca151` 孵化隔离机制。

---

## 6. 修复建议（防复发，非急救）

核心矛盾：**采集角色是经济命脉，normal/crisis 态下不应被硬性隔离 500 tick**。熔断已有独立的
churn 熔断（200t 窗口 >20 次 → 冻 100 tick）兜底，隔离机制对采集角色是冗余且危险的。

**推荐方案 A（最小改动、最稳）：采集角色永远豁免隔离**
```ts
// spawn-manager.ts:71-73  改为无条件豁免采集角色
for (const key of purgedKeys) {
  const isCollector = key.startsWith("worker:") || key.startsWith("harvester:");
  if (isCollector) continue;   // 采集角色永不隔离，保留 pre-1cca151 自愈语义
  const ttl = computeQuarantineTtl(key);
  roomMem.spawnBlacklist[key] = ctx.tick + ttl;
}
```
- 保留 pre-`1cca151` 自愈；真正的持久配置错误仍由 churn 熔断（100 tick 冻）兜住，不会无限翻炒。
- 风险：若某采集角色 body 真有持久错误，会每 tick 重试 —— 但 churn 熔断会接住。

**备选方案 B（更温和）：把采集角色隔离 TTL 从 500 砍到 ~100 tick**
- 仍留「防无限 churn」的缓冲，但窗口足够短，自愈快。**不如 A 干净**。

**配套：把 `maxRetries` 从 5 提到 ~10~15**
- 给能量低谷更多重试余量，避免在 normal 态误触 purge（即便不采纳 A，这也能显著降低复发率）。

> 注：churn 熔断本身在螺旋中可能也冻 harvester（>20 churn/200t）。方案 A 让采集角色永不进
> 黑名单，但 churn 熔断是另一通道 —— 若实测发现螺旋期 churn 熔断也误冻 harvester，需同步把
> harvester 从 `CHURN_FREEZE` 豁免（P0 worker 生命线已如此处理，见 demand.ts:265-267）。

---

## 7. 当前处置建议

- **短期（已自然发生）**：harvester 隔离已到期，生产在恢复，**无需手动清黑名单**。
- **可选加速**：`builder:W37S58:1` 仍黑到 tick 82335778（≈948 tick）。若想加速建造回填，可
  手动清这一项（低风险，recovery 态下 builder 会立即重建）。是否执行等你拍板（涉及线上
  Memory 写入）。
- **根本**：合并上面的方案 A（+ 可选 `maxRetries` 上调），从机制上消除「矿工停产螺旋」复发可能。
