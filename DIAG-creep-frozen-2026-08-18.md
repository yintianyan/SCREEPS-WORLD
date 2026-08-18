# 官服线上 Creep 不工作 — 诊断报告（2026-08-18）

> 主房 W37S58（RCL7，shard3）。诊断方式：经 `tools/mmo/` 探针（`console-probe.js` 写 `Memory.__diag*` → `fetch-diag.js` 读回），跨 tick 差分 + 移动意图账本核对。

## 🎯 结论
**不是全局冻结。** 执行层（主循环 / traffic-manager / CPU / 缓存 / PathFinder）全部正常，creep 该动的也在动。
真正的病灶是一条**「能量断链死亡螺旋」**：

> 1 号矿的 harvester 被 spawn 黑名单隔离 → 该 source 无人采矿 → 认领它的 hauler 在空容器旁干等 → 能量进不了 storage → spawn 网络饥饿 → builder 等贵 body 反复 spawn 失败也进黑名单 → 25 个工地停摆 + 编制 11→8 下滑。

## 🔍 证据链
1. **主循环活着**：`kernel.tier=healthy`、`recoveryTicks=0`、tick 持续上涨、bucket 8738、单 tick CPU 仅 ~3 → 排除宕机 / CPU 饥饿。
2. **移动层没坏**：`global.__moveIntents` 有 3 条合法相邻移动意图、`tick` 匹配、`trafficEnabled()` 开着 → 排除 traffic 全局开关 / 账本错位。
3. **寻路/缓存正常**：`objCacheTick===Game.time`、source 解析正常、`PathFinder.search` 返回 18 步有效路径 → 排除寻路/陈旧缓存。
4. **cross-tick 差分**：窗口内 8 个 creep 仅 defender 移动；distributor +200（在倒能，正常）；harvester 能量增减 0（站桩 miner 同 tick 采倒，正常）。
5. **种群 11→8**：掉的正是 mineralMiner / upgrader（后来已补回）；但 **`harvester:W37S58:1` 在 `spawnBlacklist` 里** → 该 source 无 miner。
6. **diag9 实锤**：harvester 认领的 source(35,4) → `hvCount=0`（无人采矿），容器仅 114、link 0；hauler 自身 `e=0` 原地卡 1 tick。
7. **帝国能量贫穷**：storage ~18k（容量 100 万）、spawn/extension 网络长期 ~17% 满（632→974）。
8. **最直观的"不干活"**：`buildQueue=25`，builder 两槽（`:0/:1`）全黑 → 工地全停。

## 🧬 根因
`harvester:W37S58:1` 在能量饥饿期 spawn 失败 → `retries` 烧穿 `maxRetries` → 进黑名单（默认 ~1000 tick 隔离）。该 source 停产后：
- 认领它的 hauler 在空容器旁 idle/stuck → 不运能；
- 全网能量摄入减半 → storage 见底 → spawn 网络饥饿；
- builder（贵 body）spawn 失败 → 也进黑名单 → 建造停摆；
- 编制持续下滑 → 螺旋自强化。

## 🛠️ 建议处置（⚠️ A 涉及线上 Memory 写入，需你确认）
**A. 短期解螺旋（可逆、低风险）**：清除 `Memory.rooms.W37S58.spawnBlacklist` 中 `harvester:W37S58:1` 与 `builder:W37S58:0/1` 三项，让 1 号矿 harvester 与 builder 立即重生。harvester 复产 → hauler 解卡 → 能量回流 → 螺旋止住。

**B. 防复发**：核查 harvester 为何会 spawn 失败（retries 烧穿）——通常是「spawn 网络能量门槛 + 降级地板」在能量低谷期卡死。可考虑：
- 提升 distributor 对 spawn/extension 的填充优先级，让 spawn 网络常驻高位；
- 或下调 `CONFIG.spawn.starvationDegradeFloor`，允许低谷期铸更小 body 而非死等满额。

**C. 验证**：清黑名单后盯 ~200 tick，确认 1 号矿 harvester 复活、hauler 恢复搬运、storage 回升、builder 出蛋、buildQueue 开始消化。

## 📌 附：诊断中排除的假设
- ❌ 全局宕机 / 恢复模式（tier=healthy, recoveryTicks=0）
- ❌ CPU 饥饿（单 tick 仅 ~3，所谓 19.5 是 console 中途采样假象）
- ❌ traffic-manager 全局开关关掉（开着，且关掉时直连 creep.move 照样走）
- ❌ 缓存陈旧 / PathFinder 坏（tick 匹配、搜路正常）
- ❌ storage 富得流油（实测仅 ~18k / 100 万，是能量贫穷）
