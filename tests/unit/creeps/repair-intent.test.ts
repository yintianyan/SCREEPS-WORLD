/** R676：修复计量对「目标在 resolve/execute 之间消失」的防护。 */
import { describe, expect, it } from "vitest";
import { repairIntentAmount } from "../../../src/creeps/engine/actions/helpers";

function creepWithWork(parts: number): any {
  return { body: Array.from({ length: parts }, () => ({ type: WORK })) };
}

describe("repairIntentAmount", () => {
  it("正常目标：按 WORK 与剩余血量取较小值", () => {
    const target: any = { hits: 0, hitsMax: 500 };
    expect(repairIntentAmount(creepWithWork(2), target)).toBe(2); // min(200,500)/100
  });

  it("目标已消失（getter 抛 Could not find an object）→ 返回 0，不中断 creep", () => {
    const target: any = {
      hits: 0,
      get hitsMax(): number {
        throw new Error("Could not find an object with ID gone");
      },
    };
    expect(repairIntentAmount(creepWithWork(3), target)).toBe(0);
  });

  it("目标已满血 → 0", () => {
    const target: any = { hits: 500, hitsMax: 500 };
    expect(repairIntentAmount(creepWithWork(2), target)).toBe(0);
  });
});
