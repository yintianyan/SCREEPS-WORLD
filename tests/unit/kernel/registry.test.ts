import { describe, expect, it } from "vitest";
import type { CreepRole, System } from "../../../src/kernel/contracts";
import { Registry } from "../../../src/kernel/registry";

describe("Registry", () => {
  it("registers extensions by their stable names", () => {
    const registry = new Registry();
    const role: CreepRole = { name: "test-role", priority: 1, run: () => undefined };
    const system: System = { name: "test-system", priority: 1, run: () => undefined };

    registry.registerRole(role).registerSystem(system);

    expect(registry.getRole("test-role")).toBe(role);
    expect([...registry.getSystems()]).toEqual([system]);
  });

  it("rejects duplicate extension names", () => {
    const registry = new Registry();
    registry.registerRole({ name: "worker", priority: 0, run: () => undefined });

    expect(() => registry.registerRole({ name: "worker", priority: 0, run: () => undefined }))
      .toThrow("Duplicate role registration: worker");
  });

  it("returns systems sorted by priority ascending", () => {
    const registry = new Registry();
    const p2: System = { name: "p2-system", priority: 2, run: () => undefined };
    const p0: System = { name: "p0-system", priority: 0, run: () => undefined };
    const p1: System = { name: "p1-system", priority: 1, run: () => undefined };

    registry.registerSystem(p2).registerSystem(p0).registerSystem(p1);

    const sorted = registry.getSystems();
    expect(sorted[0]?.name).toBe("p0-system");
    expect(sorted[1]?.name).toBe("p1-system");
    expect(sorted[2]?.name).toBe("p2-system");
  });

  it("returns roles sorted by priority ascending", () => {
    const registry = new Registry();
    registry.registerRole({ name: "upgrader", priority: 2, run: () => undefined });
    registry.registerRole({ name: "worker", priority: 0, run: () => undefined });
    registry.registerRole({ name: "harvester", priority: 1, run: () => undefined });

    const sorted = registry.getRoles();
    expect(sorted[0]?.name).toBe("worker");
    expect(sorted[1]?.name).toBe("harvester");
    expect(sorted[2]?.name).toBe("upgrader");
  });
});
