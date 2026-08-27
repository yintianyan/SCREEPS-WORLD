/** A3-001: AgendaItem 类型 + Operation 创建 + 幂等键 */
import { describe, expect, it } from "vitest";
import {
  createOperation,
  makeOperationId,
  isActive,
  isTerminalStatus,
  isExpired,
  type OperationContext,
} from "../../../src/domain/operation/agenda-item";

const TICK = 1000;

describe("A3-001: AgendaItem 创建 + 幂等键", () => {
  it("makeOperationId 生成确定性幂等键", () => {
    const id1 = makeOperationId("W1N1", "W2N1", "energy");
    const id2 = makeOperationId("W1N1", "W2N1", "energy");
    expect(id1).toBe("supply:W1N1:W2N1:energy");
    expect(id1).toBe(id2);
  });

  it("不同房对生成不同 id", () => {
    const id1 = makeOperationId("W1N1", "W2N1", "energy");
    const id2 = makeOperationId("W1N1", "W3N1", "energy");
    expect(id1).not.toBe(id2);
  });

  it("createOperation 初始状态为 planned", () => {
    const op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 2000, TICK);
    expect(op.status).toBe("planned");
    expect(op.type).toBe("supply");
    expect(op.requestedAmount).toBe(2000);
    expect(op.deliveredAmount).toBe(0);
    expect(op.reservedAmount).toBe(0);
    expect(op.retries).toBe(0);
    expect(op.createdAt).toBe(TICK);
    expect(op.deadline).toBe(TICK + 2000);
  });
});

describe("A3-005: 幂等键去重", () => {
  it("同 (from, to, resource) 的 id 相同", () => {
    const op1 = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 1000, TICK);
    const op2 = createOperation("W1N1", "W2N1", "energy", 2000, 2, TICK + 2000, TICK);
    expect(op1.id).toBe(op2.id);
  });
});

describe("A3-012: 超时检测", () => {
  it("tick > deadline → isExpired true", () => {
    const op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK);
    expect(isExpired(op, TICK + 50)).toBe(false);
    expect(isExpired(op, TICK + 101)).toBe(true);
  });

  it("isActive 对终态返回 false", () => {
    const completed: OperationContext = {
      ...createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK),
      status: "completed",
    };
    expect(isActive(completed)).toBe(false);
  });

  it("isActive 对非终态返回 true", () => {
    const op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK);
    expect(isActive(op)).toBe(true);
  });

  it("isTerminalStatus 正确识别终态", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("expired")).toBe(true);
    expect(isTerminalStatus("planned")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });
});
