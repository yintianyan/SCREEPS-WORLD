/** GameInspector — 世界状态查询工具。 */
import type { TestWorld } from "./TestWorld";
import type { TickRecord } from "./TickRunner";

export interface EmpireStatus {
  alive: boolean;
  rcl: number;
  progress: number;
  progressTotal: number;
  progressPercent: number;
  energyAvailable: number;
  energyCapacity: number;
  totalReserves: number;
  population: Record<string, number>;
  totalCreeps: number;
  containers: number;
  extensions: number;
  towers: number;
  links: number;
  hasStorage: boolean;
  activeSites: number;
  spawning: string[];
  ticksToDowngrade: number;
}

export interface EconomyReport {
  totalHarvested: number;
  totalUpgraded: number;
  totalBuilt: number;
  totalSpawned: number;
  creepsDied: number;
  harvestRate: number;
  upgradeRate: number;
  /** 能量趋势：正=增长，负=衰退（注意：开局冻结储备被消费也会导致负值，单独不构成螺旋证据） */
  energyTrend: number;
  /** 是否处于死亡螺旋（能量持续下降 且 人口同步萎缩——见 economyReport 内注释） */
  deathSpiral: boolean;
}

export class GameInspector {
  constructor(private world: TestWorld) {}

  /** 获取帝国当前状态。 */
  empireStatus(): EmpireStatus {
    const w = this.world;
    const ctrl = w.controller;
    const byRole: Record<string, number> = {};
    for (const c of w.creeps) {
      const role = (c.memory.role as string) ?? "unknown";
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    const spawning: string[] = [];
    for (const s of w.spawns) {
      if (s.spawning) spawning.push(s.spawning.name);
    }
    const progressTotal = ctrl?.progressTotal ?? 1;
    return {
      alive: w.spawns.length > 0,
      rcl: ctrl?.level ?? 0,
      progress: ctrl?.progress ?? 0,
      progressTotal,
      progressPercent: ((ctrl?.progress ?? 0) / progressTotal) * 100,
      energyAvailable: w.room.energyAvailable,
      energyCapacity: w.room.energyCapacityAvailable,
      totalReserves: w.totalEnergy(),
      population: byRole,
      totalCreeps: w.creeps.length,
      containers: w.containers.length,
      extensions: w.extensions.length,
      towers: w.towers.length,
      links: w.links.length,
      hasStorage: w.storage !== null,
      activeSites: w.sites.length,
      spawning,
      ticksToDowngrade: ctrl?.ticksToDowngrade ?? 0,
    };
  }

  /** 经济报告 — 需要传入 tick 记录。 */
  economyReport(records: TickRecord[]): EconomyReport {
    const stats = this.world._stats;
    const ticks = records.length;
    const harvestRate = ticks > 0 ? stats.totalHarvested / ticks : 0;
    const upgradeRate = ticks > 0 ? stats.totalUpgraded / ticks : 0;

    // 能量趋势：比较最后 10% 和前 10% 的平均总能量
    let energyTrend = 0;
    let deathSpiral = false;
    if (records.length >= 20) {
      const window = Math.max(5, Math.floor(records.length * 0.1));
      const early = records.slice(0, window);
      const late = records.slice(-window);
      const earlyAvg = early.reduce((s, r) => s + r.totalEnergy, 0) / early.length;
      const lateAvg = late.reduce((s, r) => s + r.totalEnergy, 0) / late.length;
      energyTrend = lateAvg - earlyAvg;

      // 死亡螺旋：最后 20 tick 能量持续下降 **且人口同步萎缩**。
      // 仅看能量下降会把「健康支出期」（孵化/建造/升级消费、人口稳定）误判为螺旋 —
      // 实测健康轨迹的 energyTrend 也为负（开局 container 冻结能量被逐步消费是结构性
      // 支出），故必须以人口趋势作为生产崩溃的见证（P1-D：轨迹脆弱指标修复）。
      const last20 = records.slice(-20);
      let declining = 0;
      let popDeclining = 0;
      for (let i = 1; i < last20.length; i++) {
        if (last20[i]!.totalEnergy < last20[i - 1]!.totalEnergy) declining++;
        if (last20[i]!.creepCount < last20[i - 1]!.creepCount) popDeclining++;
      }
      const energyFalling = declining / (last20.length - 1) > 0.8;
      const populationCollapsing = popDeclining / (last20.length - 1) > 0.5;
      deathSpiral = energyFalling && populationCollapsing;
    }

    return {
      totalHarvested: stats.totalHarvested,
      totalUpgraded: stats.totalUpgraded,
      totalBuilt: stats.totalBuilt,
      totalSpawned: stats.totalSpawned,
      creepsDied: stats.creepsDied,
      harvestRate,
      upgradeRate,
      energyTrend,
      deathSpiral,
    };
  }

  /** 生成失败诊断报告。 */
  failureReport(failure: string, records: TickRecord[]): string {
    const status = this.empireStatus();
    const lastRecords = records.slice(-5);
    const lines: string[] = [
      "╔══════════════════════════════════════════╗",
      "║       INTEGRATION TEST FAILURE REPORT     ║",
      "╠══════════════════════════════════════════╣",
      `║ Tick: ${this.world.tick}`,
      `║ Room: ${this.world.config.roomName}`,
      `║ RCL: ${status.rcl} (${status.progressPercent.toFixed(1)}%)`,
      `║ Energy: ${status.energyAvailable}/${status.energyCapacity}`,
      `║ Reserves: ${status.totalReserves}`,
      `║ Creeps: ${JSON.stringify(status.population)}`,
      `║ Containers: ${status.containers} | Extensions: ${status.extensions}`,
      `║ Sites: ${status.activeSites} | Spawning: ${status.spawning.join(", ") || "none"}`,
      "╠══════════════════════════════════════════╣",
      `║ Failure: ${failure}`,
      "╠══════════════════════════════════════════╣",
      "║ Last 5 ticks:",
    ];
    for (const r of lastRecords) {
      lines.push(`║   t${r.tick}: E=${r.totalEnergy} creeps=${r.creepCount} RCL=${r.rcl}`);
    }
    if (this.world._stats.runtimeErrors.length > 0) {
      lines.push("╠══════════════════════════════════════════╣");
      lines.push("║ Runtime Errors:");
      for (const e of this.world._stats.runtimeErrors.slice(-3)) {
        lines.push(`║   ${e.slice(0, 80)}`);
      }
    }
    lines.push("╚══════════════════════════════════════════╝");
    return lines.join("\n");
  }

  /** 查找卡死的 creep（连续 N tick 位置不变）。 */
  stuckCreeps(records: TickRecord[], threshold = 10): string[] {
    // 简化：检查当前 creep 是否 idle 且无 assignment
    const stuck: string[] = [];
    for (const c of this.world.creeps) {
      if (c.memory.mode === "idle" && !c.memory.assignment) {
        stuck.push(c.name);
      }
    }
    return stuck;
  }
}
