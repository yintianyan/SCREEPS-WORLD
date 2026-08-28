import type { CreepRole, RoomSnapshot, System } from "./contracts";

/** 世界模型构建函数签名 — 由 systems/room-snapshot 注入，Kernel 不直接 import。 */
export type WorldModelBuilder = (
  room: Room,
  globalSourceOccupancy?: ReadonlyMap<string, number>,
  globalCreepEnergy?: ReadonlyMap<string, number>,
  globalPendingHarvesters?: ReadonlyMap<string, number>,
) => RoomSnapshot;

/** 显式注册可防止 import 顺序耦合，使扩展可审计。 */
export class Registry {
  private readonly systems = new Map<string, System>();
  private readonly roles = new Map<string, CreepRole>();
  /** 世界模型构建函数 — 由 bootstrap 注入，Kernel 通过此接口调用避免直接 import systems 层。 */
  private worldModelBuilder: WorldModelBuilder | undefined;

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

  registerWorldModelBuilder(builder: WorldModelBuilder): this {
    this.worldModelBuilder = builder;
    return this;
  }

  getWorldModelBuilder(): WorldModelBuilder {
    if (!this.worldModelBuilder) throw new Error("WorldModelBuilder not registered — bootstrap must call registerWorldModelBuilder()");
    return this.worldModelBuilder;
  }

  getSystems(): System[] {
    return [...this.systems.values()].sort((a, b) => a.priority - b.priority);
  }

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
