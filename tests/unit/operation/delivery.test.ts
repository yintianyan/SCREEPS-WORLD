import { describe, expect, it } from "vitest";
import { createOperation } from "../../../src/domain/operation/agenda-item";
import {
  applyDelivery,
  capRequestToCarrier,
  markReady,
  markRunning,
} from "../../../src/domain/operation/lifecycle";

const TICK = 1000;

function runningOp(requested: number) {
  const created = createOperation("W1N1", "W1N2", "energy", requested, 2, TICK + 2000, TICK);
  const ready = markReady(created, TICK);
  const running = markRunning(ready.op, TICK);
  return running.op;
}

describe("applyDelivery — 满额送达的状态机", () => {
  it("running + 满额 → completed（不允许 running→completed 的直接跳跃）", () => {
    const next = applyDelivery(runningOp(1200), 1200, TICK + 10);
    expect(next.status).toBe("completed");
    expect(next.deliveredAmount).toBe(1200);
    expect(next.updatedAt).toBe(TICK + 10);
  });

  it("running + 部分 → verifying，累计量不超请求", () => {
    const next = applyDelivery(runningOp(1800), 1200, TICK + 10);
    expect(next.status).toBe("verifying");
    expect(next.deliveredAmount).toBe(1200);
  });

  it("verifying + 余量 → completed", () => {
    const partial = applyDelivery(runningOp(1800), 1200, TICK + 10);
    const done = applyDelivery(partial, 600, TICK + 20);
    expect(done.status).toBe("completed");
    expect(done.deliveredAmount).toBe(1800);
  });

  it("verifying + 过量 → 累计封顶在 requested", () => {
    const partial = applyDelivery(runningOp(1800), 1200, TICK + 10);
    const done = applyDelivery(partial, 1200, TICK + 20);
    expect(done.status).toBe("completed");
    expect(done.deliveredAmount).toBe(1800);
  });
});

describe("capRequestToCarrier — 入账前按实际载体容量夹", () => {
  it("请求高于载体容量时夹到容量；不高于时原样", () => {
    const op = runningOp(1650);
    expect(capRequestToCarrier(op, 1200).requestedAmount).toBe(1200);
    expect(capRequestToCarrier(op, 1650)).toBe(op);
    expect(capRequestToCarrier(runningOp(1200), 1650).requestedAmount).toBe(1200);
  });

  it("夹后满额送达直接 completed", () => {
    const capped = capRequestToCarrier(runningOp(1650), 1200);
    const done = applyDelivery(capped, 1200, TICK + 10);
    expect(done.status).toBe("completed");
    expect(done.deliveredAmount).toBe(1200);
  });
});
