import type { CreepRole, System } from "./contracts";

/** 显式注册可防止 import 顺序耦合，使扩展可审计。 */
export class Registry {
  private readonly systems = new Map<string, System>();
  private readonly roles = new Map<string, CreepRole>();

  registerSystem(system: System): this {
    this.assertUnique(this.systems, system.name, "system");
    this.systems.set(system.name, system);
    return this;
  }

  registerRole(role: CreepRole): this {
    this.assertUnique(this.roles, role.name, "role");
    this.roles.set(role.name, role);
    return this;
  }

  /** 系统按优先级升序排列（P0 在前）。 */
  getSystems(): System[] {
    return [...this.systems.values()].sort((a, b) => a.priority - b.priority);
  }

  /** 角色按优先级升序排列（P0 在前）。 */
  getRoles(): CreepRole[] {
    return [...this.roles.values()].sort((a, b) => a.priority - b.priority);
  }

  getRole(name: string): CreepRole | undefined {
    return this.roles.get(name);
  }

  getSystem(name: string): System | undefined {
    return this.systems.get(name);
  }

  private assertUnique<T>(items: Map<string, T>, name: string, kind: string): void {
    if (items.has(name)) throw new Error(`Duplicate ${kind} registration: ${name}`);
  }
}
