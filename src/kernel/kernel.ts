import { CONFIG } from "../config";
import { maintainMemory } from "./memory";
import type { System } from "./contracts";
import { Registry } from "./registry";
import { safeRun } from "./safe-run";

export class Kernel {
  constructor(private readonly registry: Registry) {}

  run(): void {
    safeRun("memory", maintainMemory);
    this.runSystems();
    this.runCreeps();
  }

  private runSystems(): void {
    for (const system of this.registry.getSystems()) {
      if (!system.critical && this.outOfBudget()) break;
      safeRun(`system/${system.name}`, () => system.run());
    }
  }

  private runCreeps(): void {
    for (const creep of Object.values(Game.creeps)) {
      if (this.outOfBudget()) break;
      const role = this.registry.getRole(creep.memory.role);
      if (!role) {
        console.log(`[${Game.time}] creep/${creep.name}: unknown role '${creep.memory.role}'`);
        continue;
      }
      safeRun(`creep/${creep.name}/${role.name}`, () => role.run(creep));
    }
  }

  private outOfBudget(): boolean {
    return Game.cpu.getUsed() >= Game.cpu.limit - CONFIG.kernel.cpuReserve;
  }
}
