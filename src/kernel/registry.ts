import type { CreepRole, System } from "./contracts";

/** Explicit registration prevents import-order coupling and makes extensions auditable. */
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

  getSystems(): Iterable<System> { return this.systems.values(); }
  getRole(name: string): CreepRole | undefined { return this.roles.get(name); }

  private assertUnique<T>(items: Map<string, T>, name: string, kind: string): void {
    if (items.has(name)) throw new Error(`Duplicate ${kind} registration: ${name}`);
  }
}
