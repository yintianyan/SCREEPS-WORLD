import { describe, expect, it } from "vitest";
import type { CreepRole, System } from "../src/kernel/contracts";
import { Registry } from "../src/kernel/registry";

describe("Registry", () => {
  it("registers extensions by their stable names", () => {
    const registry = new Registry();
    const role: CreepRole = { name: "test-role", run: () => undefined };
    const system: System = { name: "test-system", run: () => undefined };

    registry.registerRole(role).registerSystem(system);

    expect(registry.getRole("test-role")).toBe(role);
    expect([...registry.getSystems()]).toEqual([system]);
  });

  it("rejects duplicate extension names", () => {
    const registry = new Registry();
    registry.registerRole({ name: "worker", run: () => undefined });

    expect(() => registry.registerRole({ name: "worker", run: () => undefined }))
      .toThrow("Duplicate role registration: worker");
  });
});
