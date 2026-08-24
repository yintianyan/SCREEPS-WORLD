import { describe, it, expect } from "vitest";
import {
  evaluateMultiResourceHealth,
} from "../../../src/domain/strategy/multi-resource-health";
import {
  createResourceLedger,
  getOrCreateEntry,
  emptyStock,
} from "../../../src/domain/economy/resource-ledger";

describe("Multi-Resource Empire Health", () => {
  it("Energy HEALTHY + 无矿物 = empire HEALTHY", () => {
    const ledger = createResourceLedger();
    const energy = getOrCreateEntry(ledger, "energy");
    energy.stock = { ...emptyStock(), storage: 100000 };
    energy.productionRate = 10;
    energy.consumptionRate = 5;

    const result = evaluateMultiResourceHealth(100, ledger, "healthy");
    expect(result.health).toBe("healthy");
    expect(result.worstMineral).toBeNull();
    expect(result.hasMineralDeficit).toBe(false);
  });

  it("Energy HEALTHY + Mineral DEFICIT = empire DEFICIT", () => {
    const ledger = createResourceLedger();
    const energy = getOrCreateEntry(ledger, "energy");
    energy.stock = { ...emptyStock(), storage: 100000 };
    energy.productionRate = 10;
    energy.consumptionRate = 5;

    const mineral = getOrCreateEntry(ledger, "U" as never);
    mineral.stock = { ...emptyStock(), storage: 10 };
    mineral.productionRate = 0;
    mineral.consumptionRate = 5;

    const result = evaluateMultiResourceHealth(100, ledger, "healthy");
    expect(result.health).toBe("deficit"); // mineral deficit pulls empire down
    expect(result.worstMineral).toBe("U");
    expect(result.hasMineralDeficit).toBe(true);
  });

  it("Energy CRITICAL + Mineral HEALTHY = empire CRITICAL", () => {
    const ledger = createResourceLedger();
    const mineral = getOrCreateEntry(ledger, "U" as never);
    mineral.stock = { ...emptyStock(), storage: 100000 };
    mineral.productionRate = 5;
    mineral.consumptionRate = 2;

    const result = evaluateMultiResourceHealth(100, ledger, "critical");
    expect(result.health).toBe("critical");
    expect(result.bottleneck).toBe("energy");
  });

  it("无矿物数据时只看 Energy", () => {
    const ledger = createResourceLedger();
    const result = evaluateMultiResourceHealth(100, ledger, "stable");
    expect(result.health).toBe("stable");
    expect(result.mineralHealth).toEqual([]);
  });

  it("bottleneck 是最差的非 energy 资源", () => {
    const ledger = createResourceLedger();
    const energy = getOrCreateEntry(ledger, "energy");
    energy.stock = { ...emptyStock(), storage: 100000 };
    energy.productionRate = 10;
    energy.consumptionRate = 5;

    const mineral = getOrCreateEntry(ledger, "L" as never);
    mineral.stock = { ...emptyStock(), storage: 5 };
    mineral.productionRate = 0;
    mineral.consumptionRate = 3;

    const result = evaluateMultiResourceHealth(100, ledger, "healthy");
    expect(result.bottleneck).toBe("L");
  });
});
