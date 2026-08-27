/** A3-006: Operation Lifecycle 状态转换 */
import { describe, expect, it } from "vitest";
import {
  createOperation,
  type OperationContext,
} from "../../../src/domain/operation/agenda-item";
import {
  markReady,
  markRunning,
  markVerifying,
  markCompleted,
  markBlocked,
  markFailed,
  markCancelled,
  markExpired,
  retryFromBlocked,
  checkExpiry,
  reportDelivery,
} from "../../../src/domain/operation/lifecycle";

const TICK = 1000;

describe("A3-006: Lifecycle 状态转换", () => {
  it("planned → ready → running → verifying → completed", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK);

    const ready = markReady(op, TICK + 10);
    expect(ready.ok).toBe(true);
    op = ready.op;
    expect(op.status).toBe("ready");

    const running = markRunning(op, TICK + 20);
    expect(running.ok).toBe(true);
    op = running.op;
    expect(op.status).toBe("running");

    const verifying = markVerifying(op, TICK + 30);
    expect(verifying.ok).toBe(true);
    op = verifying.op;
    expect(op.status).toBe("verifying");

    const completed = markCompleted(op, TICK + 40);
    expect(completed.ok).toBe(true);
    op = completed.op;
    expect(op.status).toBe("completed");
  });

  it("非法跳跃转换被拒绝", () => {
    const op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK);
    // planned → running (跳过 ready) 非法
    const result = markRunning(op, TICK + 10);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("illegal");
  });

  it("终态不允许转换", () => {
    const completed: OperationContext = {
      ...createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK),
      status: "completed",
    };
    const result = markReady(completed, TICK + 10);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("illegal");
  });
});

describe("A3-009: Partial Fulfillment", () => {
  it("部分送达后 deliveredAmount 更新", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 2000, TICK);
    op = reportDelivery(op, 800, TICK + 50);
    expect(op.deliveredAmount).toBe(800);
    expect(op.requestedAmount).toBe(2000);
  });

  it("deliveredAmount 达到 requestedAmount 时 verifying → completed", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK);
    // 先走到 verifying
    op = markReady(op, TICK).op;
    op = markRunning(op, TICK).op;
    op = markVerifying(op, TICK).op;
    // 全额送达
    op = reportDelivery(op, 1000, TICK + 10);
    expect(op.status).toBe("completed");
    expect(op.deliveredAmount).toBe(1000);
  });

  it("deliveredAmount 不超过 requestedAmount", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK);
    op = reportDelivery(op, 1500, TICK + 10);
    expect(op.deliveredAmount).toBe(1000);
  });
});

describe("A3-013: Operation Retry", () => {
  it("blocked → retry → ready，retries 递增", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK);
    op = markBlocked(op, TICK, "test").op;
    expect(op.status).toBe("blocked");

    const retry = retryFromBlocked(op, TICK + 100);
    expect(retry.ok).toBe(true);
    expect(retry.op.status).toBe("ready");
    expect(retry.op.retries).toBe(1);
  });

  it("超过 maxRetries 时 retry 失败", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK, 2);
    op = markBlocked(op, TICK, "test1").op;
    op = retryFromBlocked(op, TICK + 100).op;
    expect(op.retries).toBe(1);

    op = markBlocked(op, TICK + 200, "test2").op;
    op = retryFromBlocked(op, TICK + 300).op;
    expect(op.retries).toBe(2);

    // 第三次重试应失败
    op = markBlocked(op, TICK + 400, "test3").op;
    const result = retryFromBlocked(op, TICK + 500);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("max retries");
  });

  it("markFailed 设置 cooldownUntil", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK);
    op = markBlocked(op, TICK, "test").op;
    const failed = markFailed(op, TICK + 100, "max retries");
    expect(failed.ok).toBe(true);
    expect(failed.op.status).toBe("failed");
    expect(failed.op.cooldownUntil).toBeGreaterThan(TICK + 100);
  });
});

describe("A3-014: 超时 → expired", () => {
  it("checkExpiry 超时自动转 expired", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK);
    const result = checkExpiry(op, TICK + 200);
    expect(result.op.status).toBe("expired");
  });

  it("checkExpiry 未超时不转换", () => {
    const op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK);
    const result = checkExpiry(op, TICK + 50);
    expect(result.op.status).toBe("planned");
  });

  it("终态操作不被 expiry 影响", () => {
    const completed: OperationContext = {
      ...createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK),
      status: "completed",
    };
    const result = checkExpiry(completed, TICK + 200);
    expect(result.op.status).toBe("completed");
  });
});

describe("A3-012: 取消路径", () => {
  it("markCancelled 从 running → cancelled", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK);
    op = markReady(op, TICK).op;
    op = markRunning(op, TICK).op;
    const result = markCancelled(op, TICK + 100, "target critical");
    expect(result.ok).toBe(true);
    expect(result.op.status).toBe("cancelled");
  });
});
