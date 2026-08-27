/** runAction 统一错误处理策略测试。 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetGlobals,
  mockCreep,
  mockPos,
} from "../../role-helpers";
import { runAction, actOrMove } from "../../../src/creeps/engine/actions/helpers";

// Screeps 错误码常量（测试环境未全局注入）。
const OK = 0;
const ERR_NOT_IN_RANGE = -9;
const ERR_FULL = -10;
const ERR_INVALID_TARGET = -7;
const ERR_NOT_ENOUGH_RESOURCES = -6;
const ERR_TIRED = -2;

/** 构造满足 { pos: RoomPosition } 类型的 target，range > 1 以触发 moveTo 路径。 */
function target() {
  return { pos: mockPos() as any };
}

/** 构造 range > 1 的 pos mock（确保 moveToTarget 走 moveTo 而非 move）。 */
function farPos() {
  const pos = mockPos();
  pos.getRangeTo = vi.fn(() => 5);
  return pos as any;
}

/** 构造远距离 target。 */
function farTarget() {
  return { pos: farPos() };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("runAction — 基本行为", () => {
  it("OK 时不调用任何 handler", () => {
    const creep = mockCreep();
    const action = vi.fn(() => OK);
    const handler = vi.fn();

    const result = runAction(creep, target(), action, { [ERR_FULL]: handler });

    expect(result).toBe(OK);
    expect(handler).not.toHaveBeenCalled();
  });

  it("返回 action 的结果码", () => {
    const creep = mockCreep();
    const action = vi.fn(() => ERR_FULL);

    const result = runAction(creep, target(), action);

    expect(result).toBe(ERR_FULL);
  });

  it("无 handlers 时退化为 actOrMove 行为", () => {
    const creep = mockCreep();
    const action = vi.fn(() => OK);

    const result = runAction(creep, target(), action);

    expect(result).toBe(OK);
    // 无 moveTo 调用（OK 不触发移动）。
    expect(creep.moveTo).not.toHaveBeenCalled();
  });
});

describe("runAction — ERR_NOT_IN_RANGE 自动移动", () => {
  it("ERR_NOT_IN_RANGE 自动触发 moveToTarget", () => {
    const creep = mockCreep();
    // 确保 creep.pos.getRangeTo 也返回 > 1，使 moveToTarget 走 moveTo 路径。
    creep.pos.getRangeTo = vi.fn(() => 5);
    const action = vi.fn(() => ERR_NOT_IN_RANGE);

    runAction(creep, farTarget(), action);

    // moveToTarget 在 range > 1 时调用 creep.moveTo。
    expect(creep.moveTo).toHaveBeenCalled();
  });

  it("ERR_NOT_IN_RANGE 不查 handlers 表（内建优先）", () => {
    const creep = mockCreep();
    creep.pos.getRangeTo = vi.fn(() => 5);
    const action = vi.fn(() => ERR_NOT_IN_RANGE);
    const rangeHandler = vi.fn();

    // 即使声明了 ERR_NOT_IN_RANGE handler 也不会调用 — 移动是内建行为。
    runAction(creep, farTarget(), action, { [ERR_NOT_IN_RANGE]: rangeHandler });

    expect(rangeHandler).not.toHaveBeenCalled();
    expect(creep.moveTo).toHaveBeenCalled();
  });
});

describe("runAction — 错误码 handler 分发", () => {
  it("ERR_FULL 触发对应 handler", () => {
    const creep = mockCreep();
    const action = vi.fn(() => ERR_FULL);
    const fullHandler = vi.fn();

    runAction(creep, target(), action, { [ERR_FULL]: fullHandler });

    expect(fullHandler).toHaveBeenCalledTimes(1);
  });

  it("ERR_INVALID_TARGET 触发对应 handler", () => {
    const creep = mockCreep();
    const action = vi.fn(() => ERR_INVALID_TARGET);
    const invalidHandler = vi.fn();

    runAction(creep, target(), action, { [ERR_INVALID_TARGET]: invalidHandler });

    expect(invalidHandler).toHaveBeenCalledTimes(1);
  });

  it("ERR_NOT_ENOUGH_RESOURCES 触发对应 handler", () => {
    const creep = mockCreep();
    const action = vi.fn(() => ERR_NOT_ENOUGH_RESOURCES);
    const handler = vi.fn();

    runAction(creep, target(), action, { [ERR_NOT_ENOUGH_RESOURCES]: handler });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ERR_TIRED 触发对应 handler", () => {
    const creep = mockCreep();
    const action = vi.fn(() => ERR_TIRED);
    const handler = vi.fn();

    runAction(creep, target(), action, { [ERR_TIRED]: handler });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("未注册的错误码静默忽略", () => {
    const creep = mockCreep();
    const action = vi.fn(() => ERR_FULL);
    const invalidHandler = vi.fn();

    // 只注册了 ERR_INVALID_TARGET，但返回 ERR_FULL。
    runAction(creep, target(), action, { [ERR_INVALID_TARGET]: invalidHandler });

    expect(invalidHandler).not.toHaveBeenCalled();
    // 非移动错误码也不触发 moveTo。
    expect(creep.moveTo).not.toHaveBeenCalled();
  });
});

describe("runAction — 多 handler 共存", () => {
  it("不同错误码分派到不同 handler", () => {
    const creep = mockCreep();

    const fullHandler = vi.fn();
    const invalidHandler = vi.fn();

    // ERR_FULL → fullHandler
    runAction(creep, target(), vi.fn(() => ERR_FULL), {
      [ERR_FULL]: fullHandler,
      [ERR_INVALID_TARGET]: invalidHandler,
    });
    expect(fullHandler).toHaveBeenCalledTimes(1);
    expect(invalidHandler).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // ERR_INVALID_TARGET → invalidHandler
    runAction(creep, target(), vi.fn(() => ERR_INVALID_TARGET), {
      [ERR_FULL]: fullHandler,
      [ERR_INVALID_TARGET]: invalidHandler,
    });
    expect(fullHandler).not.toHaveBeenCalled();
    expect(invalidHandler).toHaveBeenCalledTimes(1);
  });

  it("同一错误码可注册多个副作用（闭包组合）", () => {
    const creep = mockCreep();
    let sideEffectA = false;
    let sideEffectB = false;

    runAction(creep, target(), vi.fn(() => ERR_FULL), {
      [ERR_FULL]: () => {
        sideEffectA = true;
        sideEffectB = true;
      },
    });

    expect(sideEffectA).toBe(true);
    expect(sideEffectB).toBe(true);
  });
});

describe("runAction — handler 闭包捕获上下文", () => {
  it("handler 可访问 creep.memory 并修改状态", () => {
    const creep = mockCreep({ mode: "acquire" });

    runAction(creep, target(), vi.fn(() => ERR_FULL), {
      [ERR_FULL]: () => {
        creep.memory.mode = "idle";
      },
    });

    expect(creep.memory.mode).toBe("idle");
  });

  it("handler 可清除缓存目标 ID", () => {
    const creep = mockCreep();
    creep.memory.targetId = "site_abc" as any;

    runAction(creep, target(), vi.fn(() => ERR_INVALID_TARGET), {
      [ERR_INVALID_TARGET]: () => {
        creep.memory.targetId = undefined;
      },
    });

    expect(creep.memory.targetId).toBeUndefined();
  });
});

describe("actOrMove — 向后兼容", () => {
  it("行为与无 handler 的 runAction 一致（OK）", () => {
    const creep = mockCreep();
    const action = vi.fn(() => OK);

    const result = actOrMove(creep, target(), action);

    expect(result).toBe(OK);
    expect(creep.moveTo).not.toHaveBeenCalled();
  });

  it("行为与无 handler 的 runAction 一致（ERR_NOT_IN_RANGE）", () => {
    const creep = mockCreep();
    creep.pos.getRangeTo = vi.fn(() => 5);
    const action = vi.fn(() => ERR_NOT_IN_RANGE);

    const result = actOrMove(creep, farTarget(), action);

    expect(result).toBe(ERR_NOT_IN_RANGE);
    expect(creep.moveTo).toHaveBeenCalled();
  });

  it("非移动错误码不触发 moveTo", () => {
    const creep = mockCreep();
    const action = vi.fn(() => ERR_FULL);

    const result = actOrMove(creep, target(), action);

    expect(result).toBe(ERR_FULL);
    expect(creep.moveTo).not.toHaveBeenCalled();
  });
});
