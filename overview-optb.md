# 扩张闭环：全部人为/架构阻塞已清除（状态总览，2026-08-18）

> 从「scout 卡敌对房 flee」一路修到「fortify 记忆冻结扩张」，共 8 刀。本文件为最终状态，
> 取代早期 Opt B 专项文档。

## 一、已落地的修复（按时间线）

| # | 修复 | 提交 | 解决的问题 |
|---|------|------|-----------|
| 1-3 | scout 三招（hostileAdjacent 评分 / avoidRooms 绕房 / pushThrough 不 flee） | `50c793c` | scout 钻敌对房 flee 卡死、到不了侦察目标 |
| 4 | horizon 视野外扩（frontier 候选） | `229b689` | prospect 视野锁死：只探已知房，新干净房永远发现不了 |
| 5 | RESOURCE_PIXEL 未定义（改为字面量 `"pixel"`） | `a63b00c` | terminal pixel 变现每 tick 报错失效 |
| 6 | 像素系统重评估 + Opt B：prospect 任务存续期对瞬时 posture 翻转脱敏 | `2fedcc7` | pixel 放血令 posture 翻 develop → 在途任务秒撤 → scout 孤儿化 |
| 7 | nextDirFromPath 橡皮筋修复 | `db728fd` | scout 末段 NE↔SW 2-循环 thrash，到不了目标出口 |
| 8 | **Option A：expansionAllowed 解耦 fortify 记忆** | `18fde6f` | Aguia 边境游荡刷新 lastHostileAt → posture 钉 fortify → 殖民授权被过期记忆收割 |

## 二、第八刀（本次，Option A）详情

**根因**：第一刀把 `newRemoteOpsAllowed` 解耦为跟随 `liveThreat`（恐吓税修复远矿侧），但 `expansionAllowed`
仍硬性 `posture==="expand" && !liveThreat`。Aguia 在 W38S58 常驻 14+ creep、周期游进 W37S58 刷新
`lastHostileAt`（在 threatWindow 3000 内）→ posture 钉 `fortify` → 殖民授权被「过期威胁记忆」收割，
是恐吓税在扩张侧的残余。

**改动（`src/domain/strategy/posture.ts`）**
- 扩张健康门（`expandHealth` = gclHeadroom + allNormal + bucket≥7000 + 压力≤0.4 + sponsorReady + youngestMature）
  提到全局统一计算。
- `finalize` 签名加 `expandHealth`；`expansionAllowed = expandHealth && !liveThreat && posture !== "war"`。
  - 不再要求 `posture === "expand"`：fortify 无活敌 + 健康时殖民仍授权（殖民目标远离边境，安全）。
  - `war` 态硬性关闭扩张（战争是主动冲突，不应同时殖民）。
  - 活敌门禁保留（防御优先）。
- 全部 7 处 `finalize(...)` 调用补传 `expandHealth`，避免默认 false 把 fortify 又关掉。
- 测试：`posture.test.ts` 补「近期受袭但敌已撤离→expansionAllowed true」断言 + 新增 2 例（fortify 无活敌+健康→授权、war 即便无活敌→不殖民）。

**质量门**：typecheck ✅｜vitest **2351** ✅｜build ✅。

**部署包确认含修复**：`dist/main.js` 压缩后 `expansionAllowed:a&&!s&&"war"!==e`（= `expandHealth && !liveThreat && posture!=="war"`）；旧串 `posture==="expand"` 计数 0（已移除）。

## 三、当前实时状态（shard3，盯盘核对）

- `kernel.strategy = { posture: fortify, expansionAllowed: false, newRemoteOpsAllowed: true, warPressureTicks: 0 }`
- `kernel.tier = guarded`（bucket ∈ [3000, 7000)）；`pixelAt` 近期有值（pixel 放血正常，非 bug）。
- `W37S58` 地面真相：**safeMode 仍激活**（剩 ~7479t，早前 Aguia 游进触发余波）、**hostileCreeps = 0（此刻无活敌）**。
  → 印证 `newRemoteOpsAllowed=true`（无 liveThreat），posture 的 fortify 已是「过期记忆」而非当下威胁。

**关键判定**：当前 `expansionAllowed=false` 是 **bucket≥7000 健康门槛**所致（tier=guarded 即 bucket<7000），
**不是 posture 阻塞**——第八刀已把 posture 这层解除。实证卡点：MMO 当前 tick 几乎停滞（40s+ 内不推进、Memory 冻结），
无法现场抓到 bucket 越 7000 的 healthy 窗口；逻辑已由单测锁死。

## 四、结论与剩余项

✅ **扩张闭环的全部人为/架构阻塞已清除**：scout flee（#1-3）→ 视野锁死（#4）→ pixel 变现报错（#5）
→ 孤儿化（Opt B #6）→ 末段 thrash（#7）→ fortify 记忆冻结（Option A #8）。

⚠️ 剩余 `expansionAllowed=false` 仅发生在 `bucket<7000`（pixel 振荡期），是**设计内 CPU 安全**
（扩张 CPU 重，要求 healthy bucket）。pixel 两次放血之间的 healthy 窗口里扩张会跑；Opt B 护送在途 scout 过 dip。
→ 扩张被 **throttle 但不再被 block**，符合用户「保留 pixel、让扩张对振荡鲁棒」的既定取向。

**下一步（非阻塞，待 MMO tick 恢复后盯盘确认）**
- 抓 `tier=healthy` 时刻 `expansionAllowed` 翻 true → `intel[target]` 落库 → `kernel.expansion` 出现 claimer，闭环最终落地。
  现有 hourly 自动化「Screeps shard3 线上盯盘」会持续观测。
- 若想扩张更稳更频：杠杆是调和 pixel 与 expand 的 bucket 争夺（如 pixel 仅在非扩张关键窗口放血），但用户此前明确不选停 pixel。
- 边境缓冲（选项 A 第二子项）：对 Aguia 边境做预 fortify/claim 缓冲，属更激进扩张策略，未做、待拍板。

## 五、观测脚本（临时，/tmp）
- `probe_strategy.js`：读 kernel.strategy/expansionAllowed/tier + W37S58 真实敌对 creep/safeMode。
- `watch_expand.js`：轮询抓 expansionAllowed 翻 true。
- `probe_bucket.js`：console→Memory 读真实 Game.cpu.bucket（两次采样看回升）。
- `probe_threat.js` / `watch_optb.js` / `probe_scout_stuck.js`：前期 Opt B / thrash 诊断。
