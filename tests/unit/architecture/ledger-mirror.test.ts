/** 账本镜像一致性 — kernel 侧 RoomEnergyCounters 是 domain 侧 EnergyLedger 的手工镜像，字段集漂移即红。 */
import { describe, expectTypeOf, it } from "vitest";
import type { EnergyLedger } from "../../../src/domain/economy/accounting";
import type { EnergyCounterField } from "../../../src/kernel/global-cache";

describe("账本镜像一致性", () => {
  it("RoomEnergyCounters 字段集与 EnergyLedger 字段集相等", () => {
    expectTypeOf<EnergyCounterField>().toEqualTypeOf<keyof EnergyLedger>();
  });
});
