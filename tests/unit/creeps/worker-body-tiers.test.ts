/** R669：worker body 高容量档 —— carry 不能永远只有 1 个（50 能量/趟）。 */
import { describe, expect, it } from "vitest";
import { selectBody } from "../../../src/config/bodies";

const carries = (parts: string[]) => parts.filter(p => p === "carry").length;

describe("selectBody — worker 载重档", () => {
  it("RCL8 sponsor（cap 5,600）⇒ carry ≥6（300 能量/趟）", () => {
    const body = selectBody("worker", 5600);
    expect(carries(body)).toBeGreaterThanOrEqual(6);
    expect(body.length).toBeLessThanOrEqual(50);
  });

  it("cap 500 ⇒ 2W4C2M（carry 4）", () => {
    const body = selectBody("worker", 500);
    expect(carries(body)).toBeGreaterThanOrEqual(4);
  });

  it("RCL1（cap 300）⇒ 经典 2W1C1M 不变", () => {
    const body = selectBody("worker", 300);
    expect(carries(body)).toBe(1);
  });
});
