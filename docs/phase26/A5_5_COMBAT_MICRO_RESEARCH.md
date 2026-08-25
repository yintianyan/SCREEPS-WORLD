# A5.5 Combat Micro Research — Screeps PvP Tactical Micro API Facts & Heuristics

> Phase 26 | A5.5 §2
> Date: 2026-08-27
> Status: RESEARCH COMPLETE

本文档区分 **Screeps API 事实**（引擎常量、调用语义）和 **玩家经验/战术启发式**（社区共识、经验法则）。
不把经验伪装成游戏规则。

---

## 1. Body Parts — Engine Constants (CONFIRMED)

| Part | Hits | Cost | Combat Role |
|------|------|------|-------------|
| ATTACK | 100 | 80 | 近身 30 dmg/tick (range 1) |
| RANGED_ATTACK | 100 | 150 | 远程 10 dmg/tick (range 3), rangedMassAttack AoE 1-3 |
| HEAL | 100 | 250 | 近身 12 heal/tick (range 1), 远程 4 heal/tick (range 3) |
| TOUGH | 100 | 10 | 减伤层（被 boost 后等效 HP 倍增） |
| MOVE | 100 | 50 | 移动力（fatigue 恢复） |
| WORK | 100 | 100 | dismantle 50 dmg/tick (对建筑) |
| CLAIM | 100 | 600 | reserve/attackController |

**引擎事实**：
- 每部件 100 hits，被摧毁后不贡献能力。
- body 顺序决定被攻击时部件损坏顺序（前面的先坏）。
- TOUGH 在 body 中的位置影响减伤效率——TOUGH 在前面承受伤害时，后面的部件得到保护。
- Boost 倍率：T1 ×2, T2 ×3, T3 ×4（ATTACK/RANGED_ATTACK/HEAL/MOVE/CLAIM）；TOUGH T1=0.7减伤, T2=0.5, T3=0.3。

---

## 2. Kiting — API Facts vs Heuristics

### API Facts (CONFIRMED)
- `creep.pos.getRangeTo(target.pos)` 返回切比雪夫距离（Chebyshev = max(|dx|,|dy|)）。
- `creep.rangedAttack(target)` range ≤ 3，否则返回 ERR_NOT_IN_RANGE。
- `creep.attack(target)` range ≤ 1，否则返回 ERR_NOT_IN_RANGE。
- `creep.move(direction)` 每方向 1 格，fatigue > 0 时不能 move。
- 移动不消耗 tick（move 调用即返回 OK），但 fatigue 在 tick 末结算。
- 平原 fatigue=1/step，沼泽 fatigue=5/step，路 fatigue=0。
- 1 MOVE 恢复 2 fatigue/tick（在平原上 = 每步 1 tick 恢复）。

### Heuristics (Community Experience)
- **Kiting 有效条件**：我方 RANGED_ATTACK 且 mobility > 敌方 mobility（MOVE ratio 更高）。
- **Kiting 无效条件**：敌方有相等或更优 MOVE ratio——后退一步敌人前进一步，净距离不变。
- **Tower 下的 Kiting**：在敌方 Tower 范围内 kiting 延长暴露时间，可能得不偿失。
- **Kiting 方向选择**：向远离敌人的方向移动，但避免被逼到墙角或死胡同。
- **Tough 排列**：无 boost TOUGH 不减伤（等效 100 HP），只有 boosted TOUGH 才有减伤效果。

---

## 3. Focus Fire — API Facts

### API Facts (CONFIRMED)
- 多个 creep 对同一目标 attack：伤害叠加（无递减）。
- `creep.rangedMassAttack(target)` 对目标周围 1-3 格内所有敌方造成伤害（主目标满伤，AoE 减半）。
- 过量伤害（overkill）完全浪费——目标 HP 降至 0 后多余伤害不传递。
- 部件损坏规则：HP 从 total 向 0 递减，每次扣 100 摧毁一个部件（从 body 数组末尾开始）。

### Heuristics
- **最优集火数量**：刚好够击杀（totalDamage ≈ effectiveHP），多余 attacker 应分流。
- **Healer 集火效率**：打 healer 需要 burst > heal/cycle，否则打不动。
- **Overkill 阈值**：社区经验 1.5× effectiveHP 是分流阈值（已在 A5.4.3 实现）。

---

## 4. Healer Protection — API Facts

### API Facts (CONFIRMED)
- HEAL range 1（近身 12/tick），rangedHeal range 3（远程 4/tick）。
- 一个 healer 只能 heal 一个目标/tick（不是 AoE）。
- Healer 可以自奶（heal self）。
- Boosted HEAL T3 = 48 heal/tick（近身）/ 16 ranged heal/tick。

### Heuristics
- **Healer 距离法则**：healer 到 combat creep ≤ 3 格 = 有效覆盖（ranged heal 可达）。
- **Healer 优先级**：healer 死亡 = 编队失去续战能力，应优先保护。
- **Body 位置**：TOUGH 排在前面保护 HEAL 部件。
- **Healer 追随模式**：跟随最强 combat creep 而非最弱——最强者输出最高也最容易被集火。

---

## 5. Enemy Healer Hunting — API Facts

### API Facts (CONFIRMED)
- 敌方 healer 的 heal 优先级由敌方代码决定（Screeps 不强制 AI 行为）。
- 可以通过 body 解析判断敌方 healer（HEAL parts > 0）。
- 敌方 healer 距离目标 ≤ 3 时才能远程治疗，≤ 1 时近身治疗。

### Heuristics
- **先杀 healer 条件**：我方 burst > enemy_healer_effectiveHP 且 burst - enemy_heal > 0。
- **打不动 healer 时**：转打其保护目标迫使 healer 暴露或转移 heal。
- **Tank + Healer 组合**：打 Tank 效率低（Tough 减伤 + heal 覆盖），应迫使 healer 移动。

---

## 6. Terrain Effects — API Facts

### API Facts (CONFIRMED)
- 平原：fatigue 1/step。
- 沼泽：fatigue 5/step。
- 路：fatigue 0/step。
- 墙：不可通行（FIND_STRUCTURES 中的 constructedWall / terrain wall）。
- Rampart：友方可通行（fatigue 取决于下方地形），敌方不可通行。
- Room exit：在地图边缘，creep 跨越即进入新房间。

### Heuristics
- **Chokepoint 战术价值**：窄通道限制接敌面积，数量劣势方可通过 chokepoint 减少同时交战人数。
- **沼泽 kiting 优势**：沼泽中 MOVE ratio 低的敌方移动极慢，ranged unit 可无伤放风筝。
- **Rampart 优势**：己方 rampart 上作战 = 免疫远程攻击（但近身和 dismantle 仍有效）。
- **Room exit 机制**：跨房后本 tick 不可再行动，cross-room 追击有 1 tick 窗口。

---

## 7. Tower Interaction — API Facts

### API Facts (CONFIRMED)
- Tower attack 伤害公式：`max(150, 600 - distance * 75)`（到目标距离 1-5 格满伤 600，6+ 格递减，最低 150）。
- Tower 可攻击敌方 creep/结构。
- Tower 每 tick 可执行一个动作（attack/heal/repair）。
- Tower 能量消耗：attack 10 energy/shot, repair 10 energy, heal 10 energy。
- Tower 优先级由 `tower.room` 的 `controller` 所有者代码决定。

### Heuristics
- **Tower range 边缘**：距离 5 格 = 满伤区（600 dmg），6-10 = 衰减区（525-150），11+ = 最小伤（150）。
- **Tower + Healer 对抗**：单个 tower 对 heal 覆盖下的 tough creep 无效（heal > tower damage at range）。
- **多塔集火**：3+ tower 近距离 = CRITICAL 区（1800 dmg/tick），非 tough/boost creep 瞬杀。
- **Tower avoidance**：在塔有效范围内尽量缩短暴露时间，优先在 range > 10 时接敌。

---

## 8. Rampart / Wall Interaction — API Facts

### API Facts (CONFIRMED)
- Rampart 保护下方所有结构和 creep（对远程攻击和近身攻击均免疫）。
- Rampart 有自己的 hits（可被 dismantle/attack 消耗）。
- 友方 rampart 可通行，敌方 rampart 不可通行。
- `LOOK_CONSTRUCTION_SITES` 可发现正在建造的 rampart（未完工 = 无保护）。
- Wall（constructedWall）阻挡移动和远程攻击，但可被 dismantle/attack 消耗。

### Heuristics
- **Rampart 攻防**：打 rampart 上的敌人 = 需要先拆 rampart（dismantle 50/tick vs rampart HP）。
- **Wall gap blocking**：wall 缺口 = 天然 chokepoint，可在此设伏。
- **Rampart 未完工**：施工中的 rampart 无保护，是突破口。

---

## 9. Body Fatigue & MOVE Ratio — API Facts

### API Facts (CONFIRMED)
- Fatigue 累积：平原 1/step, 沼泽 5/step, 路 0。
- Fatigue 恢复：每 MOVE 部件 2 fatigue/tick（boosted MOVE T3 = 8/tick）。
- Fatigue > 0 = 不能 move（但可以 attack/heal/rangedAttack）。
- Body weight = 非 MOVE 非 CARRY(空) 部件数。
- MOVE ratio = MOVE_parts / body_weight。ratio ≥ 1 = 平原无 fatigue。ratio ≥ 5 = 沼泽无 fatigue。

### Heuristics
- **mobility 决定 kiting 可行性**：mobility 差 = 无法 kite，只能 hold ground 或 retreat。
- **MOVE-heavy 设计**：纯 ranged (RA/MOVE 1:1) 可在平原 kiting 任何 MOVE ratio ≤ 1 的 melee。
- **Boosted MOVE**：T3 boosted MOVE = ×4 fatigue 恢复 = 沼泽可通行（5/4 ≈ 1.25 tick/step）。
- **Fatigue 锁定**：fatigue > 0 的 creep 不能后退，kiting 时必须管理 fatigue。

---

## 10. Safe Mode & Nuke — API Facts

### API Facts (CONFIRMED)
- Safe Mode：controller 激活后 20,000 tick，期间敌方 creep 在本房不可 attack/heal/build/claim。
- Safe Mode 不阻止 dismantle。
- Nuke：land tick = 发射 tick + 50,000 (或 10,000 for nuke).预警期可被拦截（attack nuke position）。
- Nuke 对 rampart 下的目标无效（rampart 吸收伤害）。

### Heuristics
- **Safe Mode = 战术暂停**：进攻方需退回或 dismantle（唯一不受 safe mode 阻止的动作）。
- **Nuke = 区域拒绝**：提前撤离或确保 rampart 覆盖。

---

## 11. Ranged Mass Attack — API Facts

### API Facts (CONFIRMED)
- `creep.rangedMassAttack(target)` 对目标及其 1-3 格内所有敌方造成：
  - 主目标：10 dmg（同 rangedAttack）
  - 1 格内：4 dmg（半伤）
  - 2 格内：4 dmg
  - 3 格内：4 dmg
- 消耗一次 RANGED_ATTACK action（每 tick 一次）。
- Boost 不影响 AoE 范围，只影响主目标伤害倍率。

### Heuristics
- **rangedMassAttack 使用条件**：周围 ≥ 3 个敌方密集时优于 rangedAttack（总伤害更高）。
- **Formation breaking**：对密集编队（CLUSTER）的 rangedMassAttack 效率最高。

---

## 12. Combat Pressure Dimensions — Research Summary

基于以上 API 事实，A5.5 CombatPressure 应包含以下独立维度：

| 维度 | 来源 | 影响 |
|------|------|------|
| enemyPressure | 敌方 attack + rangedAttack | 生存压力 → retreat/kite |
| damagePressure | 我方 net damage taken/tick | 血量下降速率 → heal/retreat |
| healPressure | 我方 heal coverage vs demand | 治疗是否覆盖 → retreat/regroup |
| towerPressure | TowerExposure + tower count | 塔威胁 → avoidance/retreat |
| mobilityPressure | 我方 vs 敌方 MOVE ratio | kiting 可行性 → kite/hold/retreat |
| formationPressure | CohesionMetric status | 编队完整性 → reform/regroup |
| retreatPressure | RetreatQuality + 退路状态 | 撤退可行性 → retreat timing |

---

## 13. Attack / Movement Arbitration — Priority Model

基于 Screeps 1-action-per-tick 限制（一个 creep 每 tick 只能做一个 action：attack OR move OR heal），需要明确优先级：

| 优先级 | Action | 条件 |
|--------|--------|------|
| 1 (最高) | RETREAT | hp < retreatThreshold OR authorization revoked |
| 2 | SURVIVAL | 即将死亡（hp < 1 tick致死量）→ retreat |
| 3 | HEAL_SUPPORT | healer 需要治疗濒死队友 |
| 4 | ATTACK_RANGE | 在射程内且有有效目标 → attack |
| 5 | KITE | 敌方接近 + 我方 ranged 优势 → 后退保持距离 |
| 6 | FORMATION | 偏离阵型 → 移回阵位 |
| 7 | REPOSITION | 地形不利 → 重新定位 |
| 8 (最低) | PATROL | 无敌人 → 巡逻 |

**关键约束**：Screeps 每 tick 一个 action，所以 arbitration 必须 **唯一输出**，不能并行。

---

## 14. Target Switching — Hysteresis Model

### Problem
Target oscillation: A → B → A → B → ... 导致：
- 过量移动（追 A，再追 B）
- 集火效率下降（伤害分散）
- 确定性被破坏（如果切换基于微弱差异）

### Solution: Lock + Hysteresis

```
SWITCH_SCORE = candidate_score - current_target_score
SWITCH_MARGIN = threshold (e.g., 15% of max score)
LOCK_UNTIL = tick + lock_duration (e.g., 5 ticks)

if target is locked (tick < LOCK_UNTIL):
    do not switch unless SWITCH_SCORE > SWITCH_MARGIN * 2
else if SWITCH_SCORE > SWITCH_MARGIN:
    switch to candidate, set LOCK_UNTIL
else:
    keep current target
```

### Tie-break Rules (Deterministic)
1. priority (higher wins)
2. urgency (higher wins)
3. distance (lower wins)
4. id (lexicographic, lower wins)

---

## 15. Known Limitations of This Research

1. **Screens PvP 没有 replays**：所有 heuristics 来自社区经验和理论推导，未经大规模统计验证。
2. **Body 解析限制**：敌方 body 只有在视野内且未隐藏时可见。`creep.body` 对 owner creep 完全可见，对 hostile creep 也可见（这是 API 事实）。
3. **Real-time 不确定性**：PvP 中敌方行为不可预测，micro 模型只能基于当前 tick 可观测信息。
4. **CPU 限制**：复杂的 micro 决策在 20+ squad × 50 targets 场景下可能 CPU 紧张。
5. **确定性 vs 适应性**：确定性 replay 保证可调试性，但真实战斗中敌方行为变化要求快速适应。
