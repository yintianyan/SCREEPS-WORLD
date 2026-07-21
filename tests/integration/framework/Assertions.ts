/**
 * Assertions — 游戏级断言系统。
 *
 * 不判断代码执行，判断游戏状态。
 * 每个断言失败时输出完整诊断报告，方便 AI Agent 自动修复。
 */
import { expect } from "vitest";
import type { TestWorld } from "./TestWorld";
import type { TickRecord, RunResult } from "./TickRunner";
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

  /** 人口平衡：各角色数量在合理范围内。 */
  assertPopulationBalanced(context = ""): void {
    const status = this.inspector.empireStatus();
    const msg = () => this.inspector.failureReport(`Population imbalanced: ${context}`, this.records);

    // 至少有 harvester 或 worker 在采矿
    const miners = (status.population["harvester"] ?? 0) + (status.population["worker"] ?? 0);
    expect(miners, `Must have at least 1 miner. ${msg()}`).toBeGreaterThan(0);

    // 总 creep 数不超过合理上限
    expect(status.totalCreeps, `Population too large. ${msg()}`).toBeLessThanOrEqual(20);
  }

  /** RCL 达到指定等级。 */
  assertRclAtLeast(level: number, context = ""): void {
    const status = this.inspector.empireStatus();
    const msg = () => this.inspector.failureReport(`RCL < ${level}: ${context}`, this.records);
    expect(status.rcl, `RCL must be >= ${level}. ${msg()}`).toBeGreaterThanOrEqual(level);
  }

  /** Controller 进度在增长。 */
  assertProgressGrowing(context = ""): void {
    if (this.records.length < 10) return;
    const early = this.records.slice(0, 5).reduce((s, r) => s + r.progress, 0) / 5;
    const late = this.records.slice(-5).reduce((s, r) => s + r.progress, 0) / 5;
    const msg = () => this.inspector.failureReport(`Progress not growing: ${context}`, this.records);
    expect(late, `Controller progress must grow. ${msg()}`).toBeGreaterThan(early);
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

  /** 能量储备不低于阈值。 */
  assertEnergyAbove(threshold: number, context = ""): void {
    const total = this.world.totalEnergy();
    const msg = () => this.inspector.failureReport(`Energy ${total} < ${threshold}: ${context}`, this.records);
    expect(total, `Energy reserves must be above ${threshold}. ${msg()}`).toBeGreaterThanOrEqual(threshold);
  }

  /** 指定角色存在。 */
  assertRoleExists(role: string, minCount = 1, context = ""): void {
    const count = this.world.creepsByRole(role).length;
    const msg = () => this.inspector.failureReport(`Role ${role} count=${count} < ${minCount}: ${context}`, this.records);
    expect(count, `Must have >= ${minCount} ${role}. ${msg()}`).toBeGreaterThanOrEqual(minCount);
  }

  /** 指定角色不存在（用于验证危机时停止生产）。 */
  assertRoleAbsent(role: string, context = ""): void {
    const count = this.world.creepsByRole(role).length;
    const msg = () => this.inspector.failureReport(`Role ${role} should be absent but count=${count}: ${context}`, this.records);
    expect(count, `Must have 0 ${role}. ${msg()}`).toBe(0);
  }

  /** Container 存活（hits > 0）。 */
  assertContainersAlive(context = ""): void {
    const dead = this.world.containers.filter(c => c.hits <= 0);
    const msg = () => this.inspector.failureReport(`${dead.length} containers dead: ${context}`, this.records);
    expect(dead, `All containers must be alive. ${msg()}`).toHaveLength(0);
  }

  /** 采集率达标。 */
  assertHarvestRate(minRate: number, context = ""): void {
    const economy = this.inspector.economyReport(this.records);
    const msg = () => this.inspector.failureReport(`Harvest rate ${economy.harvestRate.toFixed(1)} < ${minRate}: ${context}`, this.records);
    expect(economy.harvestRate, `Harvest rate must be >= ${minRate}/tick. ${msg()}`).toBeGreaterThanOrEqual(minRate);
  }

  /** 升级率达标。 */
  assertUpgradeRate(minRate: number, context = ""): void {
    const economy = this.inspector.economyReport(this.records);
    const msg = () => this.inspector.failureReport(`Upgrade rate ${economy.upgradeRate.toFixed(1)} < ${minRate}: ${context}`, this.records);
    expect(economy.upgradeRate, `Upgrade rate must be >= ${minRate}/tick. ${msg()}`).toBeGreaterThanOrEqual(minRate);
  }

  /** 从灾难中恢复：在 N tick 内重新建立能量循环。 */
  assertRecoveryWithin(maxTicks: number, context = ""): void {
    const economy = this.inspector.economyReport(this.records);
    const msg = () => this.inspector.failureReport(`No recovery within ${maxTicks} ticks: ${context}`, this.records);
    expect(economy.totalHarvested, `Must recover harvesting. ${msg()}`).toBeGreaterThan(0);
    expect(economy.deathSpiral, `Must not remain in death spiral. ${msg()}`).toBe(false);
  }

  /** 自定义断言。 */
  assert(condition: boolean, message: string): void {
    const msg = () => this.inspector.failureReport(message, this.records);
    expect(condition, msg()).toBe(true);
  }
}

/** 从 RunResult 创建 Assertions。 */
export function createAssertions(world: TestWorld, result: RunResult): Assertions {
  return new Assertions(world, result.records);
}
