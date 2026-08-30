/** Assertions — 游戏级断言系统。 */
import { expect } from "vitest";
import type { TestWorld } from "./TestWorld";
import type { TickRecord } from "./TickRunner";
import { GameInspector } from "./GameInspector";

export class Assertions {
  private inspector: GameInspector;

  constructor(private world: TestWorld, private records: TickRecord[] = []) {
    this.inspector = new GameInspector(world);
  }

  /** 帝国存活：spawn 存在、controller 存在、无致命 runtime error。 */
  assertEmpireAlive(context = ""): void {
    const status = this.inspector.empireStatus();
    const msg = () => this.inspector.failureReport(`Empire not alive: ${context}`, this.records);

    expect(status.alive, `Spawn must exist. ${msg()}`).toBe(true);
    expect(status.rcl, `Controller must exist. ${msg()}`).toBeGreaterThan(0);

    // 检查致命 runtime error（排除已知的非致命日志）
    const fatal = this.world._stats.runtimeErrors.filter(
      e => !e.includes("unknown role") && !e.includes("cooldown"),
    );
    expect(fatal, `No fatal runtime errors. ${msg()}`).toHaveLength(0);
  }

  /** 经济健康：能量在增长或稳定，harvest 正常，无死亡螺旋。 */
  assertEconomyHealthy(context = ""): void {
    const economy = this.inspector.economyReport(this.records);
    const msg = () => this.inspector.failureReport(`Economy unhealthy: ${context}`, this.records);

    expect(economy.totalHarvested, `Must have harvested energy. ${msg()}`).toBeGreaterThan(0);
    expect(economy.deathSpiral, `Must not be in death spiral. ${msg()}`).toBe(false);
  }

  /** 无 runtime error。 */
  assertNoRuntimeError(context = ""): void {
    const errors = this.world._stats.runtimeErrors;
    const msg = () => this.inspector.failureReport(`Runtime errors: ${context}`, this.records);
    expect(errors, `No runtime errors expected. ${msg()}`).toHaveLength(0);
  }




  /** Spawn 不长期空闲（连续 N tick 无孵化且无 creep 在队列中）。 */
  assertSpawnActive(maxIdleTicks = 100, context = ""): void {
    if (this.records.length < maxIdleTicks) return;
    // 检查最后 maxIdleTicks 中是否有孵化活动
    const lastWindow = this.records.slice(-maxIdleTicks);
    const anySpawning = lastWindow.some(r => r.spawning.length > 0);
    const anyCreepChange = lastWindow.some((r, i) =>
      i > 0 && r.creepCount !== lastWindow[i - 1]!.creepCount,
    );
    const msg = () => this.inspector.failureReport(`Spawn idle > ${maxIdleTicks} ticks: ${context}`, this.records);
    expect(anySpawning || anyCreepChange, `Spawn must be active. ${msg()}`).toBe(true);
  }




  /** Container 存活（hits > 0）。 */
  assertContainersAlive(context = ""): void {
    const dead = this.world.containers.filter(c => c.hits <= 0);
    const msg = () => this.inspector.failureReport(`${dead.length} containers dead: ${context}`, this.records);
    expect(dead, `All containers must be alive. ${msg()}`).toHaveLength(0);
  }




  // assertPopulationBalanced / assertRclAtLeast / assertProgressGrowing / assertEnergyAbove /
  // assertRoleExists / assertRoleAbsent / assertHarvestRate / assertUpgradeRate /
  // assertRecoveryWithin / assert / 工厂 createAssertions 已删除
  //（R20⑤：审计确认零调用；需要时走 support/assertions 或本类新增）。
}
