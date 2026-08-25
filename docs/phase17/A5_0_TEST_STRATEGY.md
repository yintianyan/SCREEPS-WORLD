# A5.0 — Military Test Strategy

> **阶段**：A5.0 · 纯架构研究。**不写生产代码**。
> **依据**：[TEST_ARCHITECTURE.md](../architecture/TEST_ARCHITECTURE.md) ·
> 现有测试 `tests/unit/` / `tests/e2e/`。
> **原则**：每个纯函数可单测；每个决策路径可回放；每个场景可注入。

---

## 1. 测试分层

| 层 | 范围 | 工具 | 频率 |
| --- | --- | --- | --- |
| **Unit Test** | 纯函数（assessThreat / evaluateCombatCapability / decideRetreat 等） | `npm run test:unit` | 每次提交 |
| **Scenario Test** | 多纯函数组合的决策链（威胁→分级→响应） | `npm run test:unit` | 每次提交 |
| **E2E Test** | 完整 tick 循环（sense→state→strategy→plan→execute→feedback） | `npm run test:integration` | 每次提交 |
| **Runtime Test** | 私服 / MMO 长时间运行 | 手动 + soak | 发布前 |
| **Replay Test** | Decision Trace 回放验证 | 手动 | 事后复盘 |
| **Stress Test** | 多房同时受袭 / 低 CPU / 大规模编队 | 手动 / 私服 | 阶段性 |

---

## 2. 必须设计的测试场景（20 个）

### 2.1 PVE 场景

| ID | 场景 | 验证点 | 预期行为 |
| --- | --- | --- | --- |
| A5-S01 | Single Invader | 威胁分类 + 塔自动清 | 威胁级 1 → 塔自动击杀 → 无 defender 孵化 |
| A5-S02 | Invader Wave | 多只 invader 同时出现 | 塔集火 + 威胁不升级到 siege |

### 2.2 PVP 单位场景

| ID | 场景 | 验证点 | 预期行为 |
| --- | --- | --- | --- |
| A5-S03 | Boosted Attacker | T3 boost attack 编队 | 交战盈亏判定 → 打不动停火蓄能 |
| A5-S04 | Boosted Healer | T3 boost heal 编队 | 塔目标选奶妈优先 → 集火 |
| A5-S05 | Remote Mining Harassment | 远矿房被骚扰 | PAUSE/ESCORT/RETREAT 决策正确 |

### 2.3 PVP 战术场景

| ID | 场景 | 验证点 | 预期行为 |
| --- | --- | --- | --- |
| A5-S06 | Tower Siege | heal-tank 吸塔 | 塔停火 → 蓄能 → 退守内圈 |
| A5-S07 | Rampart Defense | 敌攻击 rampart 内建筑 | rampart 挡住 → 塔反击 |
| A5-S08 | Controller Attack | 敌 claim 动作 | 威胁级 4 → safemode 候选 |
| A5-S09 | Claim Attempt | 敌 claimer 入自有房 | 最高优先级响应 |
| A5-S10 | Multi-Room Defense | 多房同时受袭 | 按生存风险分配，不平均分兵 |

### 2.4 PVP 编队场景

| ID | 场景 | 验证点 | 预期行为 |
| --- | --- | --- | --- |
| A5-S11 | Squad Attack | quad 编队攻坚 | 集结→推进→交战→撤退全链 |
| A5-S12 | Squad Retreat | 编队 HP < 30% | decideRetreat → 撤退到安全房 |
| A5-S13 | Escort | duo 轻队护航 hauler | 走防御预算，不升战争 |
| A5-S14 | Loss Recovery | 编队全灭 | 止损 → 黑名单 → recovery → 重建 |

### 2.5 战略场景

| ID | 场景 | 验证点 | 预期行为 |
| --- | --- | --- | --- |
| A5-S15 | Economic War | war 基金耗尽 | 止损链退 fortify |
| A5-S16 | Nuclear Threat | nuke 落点预警 | 资产抢救 + rampart 加固 + safemode 禁开 |
| A5-S17 | Concurrent Threats | 多方向同时入侵 | 按威胁量级分配防御 |
| A5-S18 | Threat Escalation | WATCH→ALERT→FORTIFY→EMERGENCY | 升级链正确，每级带滞回 |

### 2.6 边界场景

| ID | 场景 | 验证点 | 预期行为 |
| --- | --- | --- | --- |
| A5-S19 | False Positive | scout 过境 / 无害侦察 | 不触发全防御动员 |
| A5-S20 | Threat Expiration | 威胁超 staleTicks | 降级 → 退出 defense（带迟滞） |

---

## 3. Unit Test 设计

### 3.1 纯函数测试模式

```typescript
// 模式：输入快照 → 纯函数 → 断言输出
describe("assessThreat", () => {
  it("level 0: 无可见敌", () => {
    const input = makeThreatInput({ threatCreeps: [] });
    const result = assessThreat(input);
    expect(result.level).toBe(0);
    expect(result.recommendedPosture).toBe("NORMAL");
  });

  it("level 1: 单只 invader", () => {
    const input = makeThreatInput({
      threatCreeps: [makeCreep({ owner: "Invader", attack: 1 })],
    });
    const result = assessThreat(input);
    expect(result.level).toBe(1);
  });

  it("level 3: heal ≥ 塔净伤", () => {
    const input = makeThreatInput({
      threatCreeps: [makeCreep({ heal: 50, boost: "XLH2O" })],
      towers: [makeTower({ energy: 100, range: 15 })],
    });
    const result = assessThreat(input);
    expect(result.level).toBe(3);
    expect(result.estimatedIntent).toBe("SIEGE");
  });
});
```

### 3.2 现有纯函数测试覆盖

| 纯函数 | 测试文件 | 覆盖状态 |
| --- | --- | --- |
| `isThreat()` / `classifyThreats()` | `tests/unit/defense/threat.test.ts` | ✅ |
| `selectTowerTarget()` | `tests/unit/defense/tower-target.test.ts` | ✅ |
| `assessEngagement()` | `tests/unit/defense/tower-engagement.test.ts` | ✅ |
| `classifyFortification()` | `tests/unit/defense/fortification.test.ts` | ✅ |
| `selectWarTarget()` | `tests/unit/war/planning.test.ts` | ✅ |
| `evaluateWarOutcome()` | `tests/unit/war/planning.test.ts` | ✅ |
| `planSalvageShipment()` | `tests/unit/defense/nuke-response.test.ts` | ✅ |

### 3.3 待补充的纯函数测试

| 纯函数 | 测试场景 | 优先级 |
| --- | --- | --- |
| `assessThreat()` (扩展) | 20 个场景全覆盖 | A5.1 |
| `evaluateCombatCapability()` | body 解析 + boost 倍率 | A5.1 |
| `computeCombatPower()` | 编队聚合 + 阵型 | A5.1 |
| `decideRetreat()` | P0 撤退判定 | A5.1 |
| `scoreCombatTarget()` | 目标评分 | A5.2 |
| `decideCombatAction()` | 战斗决策 | A5.2 |

---

## 4. E2E Test 设计

### 4.1 E2E 场景模式

```typescript
// 模式：注入 mock Game 状态 → 运行完整 tick → 断言 action
describe("A5-S01: Single Invader", () => {
  it("塔自动清 invader, 不孵化 defender", () => {
    const game = mockGame({
      rooms: {
        W1N1: {
          controller: { my: true, level: 5 },
          hostiles: [makeInvader({ attack: 1 })],
          towers: [makeTower({ energy: 500 })],
        },
      },
    });
    const result = runTick(game);
    expect(result.actions.towerAttacks).toHaveLength(1);
    expect(result.actions.spawnRequests).not.toContain("defender");
  });
});
```

### 4.2 现有 E2E 测试

| 测试文件 | 场景 | 状态 |
| --- | --- | --- |
| `tests/e2e/scenarios/09-recovery-loop.test.ts` | 恢复循环 | ✅ |
| `tests/e2e/scenarios/10-phase8-metrics.test.ts` | Phase 8 指标 | ✅ |
| `tests/e2e/scenarios/11-decision-trace.test.ts` | 决策追踪 | ✅ |

### 4.3 待补充的 E2E 测试

| 场景 ID | 测试文件 | 优先级 |
| --- | --- | --- |
| A5-S01–S02 | `tests/e2e/scenarios/12-invader.test.ts` | A5.1 |
| A5-S03–S04 | `tests/e2e/scenarios/13-boosted-attacker.test.ts` | A5.1 |
| A5-S05 | `tests/e2e/scenarios/14-remote-harassment.test.ts` | A5.1 |
| A5-S06–S07 | `tests/e2e/scenarios/15-tower-siege.test.ts` | A5.1 |
| A5-S08–S09 | `tests/e2e/scenarios/16-controller-attack.test.ts` | A5.2 |
| A5-S11–S12 | `tests/e2e/scenarios/17-squad-attack.test.ts` | A5.2 |
| A5-S14 | `tests/e2e/scenarios/18-loss-recovery.test.ts` | A5.2 |
| A5-S16 | `tests/e2e/scenarios/19-nuclear-threat.test.ts` | A5.2 |
| A5-S17–S20 | `tests/e2e/scenarios/20-concurrent-threats.test.ts` | A5.2 |

---

## 5. Replay Test

### 5.1 Decision Trace 回放

```text
1. 从 decision-trace-system Ring Buffer 取 DecisionSnapshot
2. 提取输入快照 (CombatContext / EngagementState)
3. 重新调用纯函数
4. 断言输出与记录的决策一致
5. 不一致 = 纯函数有副作用或非确定性 (违反纯函数律)
```

### 5.2 战后复盘

```text
War Operation 结束后:
  1. 取 war ledger (战前 Prediction + 战后 Actual)
  2. 计算误差 (Error = |Prediction - Actual|)
  3. 更新 PlayerIntel 行为画像
  4. 有界调参 (casualtyMultiplier / warPressureTicks)
```

---

## 6. Stress Test

### 6.1 多房同时受袭

```text
注入: 5 房同时出现 raid 编队
验证:
  - 按生存风险分配 defender, 不平均分兵
  - safemode 多房抉择按可保住房评分
  - CPU 不超限 (看门狗不降级到 Recovery)
  - 非受袭房经济不受影响
```

### 6.2 低 CPU 压力

```text
注入: CPU bucket < 2000 (Recovery 档)
验证:
  - P0 防御应答不降级 (tower-defense 仍开火)
  - war-planner 冻结新 Operation
  - 编队停安全房待命而非解散
  - 最小 defender 车道维持
```

### 6.3 大规模编队

```text
注入: 50 只 creep 的 swarm 编队
验证:
  - 威胁分级正确 (level 3/4)
  - tower 集火协调不被淹没
  - safemode 正确触发
  - 帝国 health 正确反映危机
```

---

## 7. Runtime Test (私服 / MMO)

### 7.1 私服测试

- 使用 private server 注入 mock 敌对 creep
- 验证完整防御链：感知→分级→响应→反馈
- 验证 war 授权链：posture→warPlan→集结→推进→核验

### 7.2 MMO 长时间运行

- soak test: 连续运行 7 天以上
- 监控：CPU / Memory / bucket / 房间存活率 / 错误率
- 关注：war 黑名单膨胀、warPlan 残留、nuke 台账泄漏

---

## 8. 测试质量门槛

| 门槛 | 标准 | 强制 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` 全绿 | ✅ |
| 单元测试 | `npm run test:unit` 全绿 | ✅ |
| 集成测试 | `npm run test:integration` 全绿 | ✅ |
| 构建 | `npm run build` 全绿 | ✅ |
| 纯函数覆盖 | 所有军事纯函数有单测 | ✅ |
| 场景覆盖 | 20 个必须场景有 E2E | A5.1/A5.2 |
| Decision Trace | 关键决策可回放 | ✅ |

---

## 9. 结论

A5.0 测试策略定义了 20 个必须覆盖的军事场景，覆盖 PVE / PVP / 编队 / 战略 / 边界
五大类。现有纯函数测试已覆盖威胁分类、塔目标选择、交战判定、工事分类、战争目标
选择、战后核验、nuke 响应等核心纯函数。

A5.1 测试优先级：
1. 补充 `assessThreat()` 扩展后的纯函数测试（20 场景全覆盖）
2. 补充 `evaluateCombatCapability()` / `decideRetreat()` 纯函数测试
3. 补充 A5-S01–S07 的 E2E 测试（PVE + 基础 PVP）

A5.2 测试优先级：
1. 补充 A5-S08–S20 的 E2E 测试（高级 PVP + 战略 + 边界）
2. Stress Test 场景注入