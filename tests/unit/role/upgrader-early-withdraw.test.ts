/** R647：RCL<4 早期房允许 upgrader 从 source container 取能（mature 房不变）。 */
import { describe, expect, it } from "vitest";
import { withdrawRichestContainerEarly } from "../../../src/creeps/engine/actions/withdraw";

function makeAc(rcl: number, energies: number[]): any {
  const containers = energies.map((e, i) => ({
    id: `c${i}`,
    store: { getUsedCapacity: () => e },
  }));
  return { snapshot: { rcl, containers } } as any;
}

describe("withdrawRichestContainerEarly — RCL<4 兜底（R647）", () => {
  it("RCL2 + 有能量的 source container ⇒ 取最满那只", () => {
    const ac = makeAc(2, [500, 1800]);
    const best = withdrawRichestContainerEarly().resolve!(ac);
    expect(best?.id).toBe("c1");
  });

  it("RCL4+ ⇒ 不生效（保持不抢物流源）", () => {
    const ac = makeAc(4, [1800]);
    expect(withdrawRichestContainerEarly().resolve!(ac)).toBeUndefined();
  });

  it("RCL2 + 容器全空 ⇒ 返回 undefined", () => {
    const ac = makeAc(2, [0, 0]);
    expect(withdrawRichestContainerEarly().resolve!(ac)).toBeUndefined();
  });
});
