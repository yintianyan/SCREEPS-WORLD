/**
 * Nuke 响应决策纯函数测试（审计缺口 1+3：落点感知 + 资产抢救）。
 *
 * 覆盖：
 *   pickSalvageRecipient（接收房选择）：
 *   - 常规：无警报 + 有 terminal 的候选中容量最富余者胜出
 *   - 排除项：警报房 / 无 terminal 房 / 自身 / 零容量房均不可作接收方
 *   - 无合格候选 → undefined（单房帝国静默）
 *   planSalvageShipment（发运规划）：
 *   - 价值密度优先序：power > G > X 化合物 > battery > 基础矿物 > 能量兜底
 *   - 能量兜底留运费地板；低于地板 → 不发
 *   - 空 terminal → undefined（抢救完成）
 */
import { describe, expect, it } from "vitest";
import {
  pickSalvageRecipient,
  planSalvageShipment,
  type SalvageCandidate,
} from "../../../src/domain/defense/nuke-response";

function candidate(opts: Partial<SalvageCandidate> & { roomName: string }): SalvageCandidate {
  return {
    hasTerminal: true,
    nukeAlert: false,
    terminalFree: 100000,
    ...opts,
  };
}

describe("pickSalvageRecipient — 资产抢救接收房选择", () => {
  it("无警报 + 有 terminal 的候选中容量最富余者胜出", () => {
    const result = pickSalvageRecipient(
      [
        candidate({ roomName: "A", terminalFree: 50000 }),
        candidate({ roomName: "B", terminalFree: 200000 }),
        candidate({ roomName: "C", terminalFree: 120000 }),
      ],
      "Z",
    );
    expect(result?.roomName).toBe("B");
  });

  it("警报房不可作接收方（转进去是二次损失）", () => {
    const result = pickSalvageRecipient(
      [
        candidate({ roomName: "A", nukeAlert: true }),
        candidate({ roomName: "B", terminalFree: 50000 }),
      ],
      "Z",
    );
    expect(result?.roomName).toBe("B");
  });

  it("无 terminal 的房不可作接收方", () => {
    const result = pickSalvageRecipient(
      [candidate({ roomName: "A", hasTerminal: false })],
      "Z",
    );
    expect(result).toBeUndefined();
  });

  it("自身被排除（不可能给自己发运）", () => {
    const result = pickSalvageRecipient(
      [candidate({ roomName: "A", terminalFree: 999999 })],
      "A",
    );
    expect(result).toBeUndefined();
  });

  it("零容量房被排除（terminal 满则无处接收）", () => {
    const result = pickSalvageRecipient(
      [candidate({ roomName: "A", terminalFree: 0 })],
      "Z",
    );
    expect(result).toBeUndefined();
  });

  it("无任何候选 → undefined（单房帝国静默等待）", () => {
    expect(pickSalvageRecipient([], "Z")).toBeUndefined();
  });
});

describe("planSalvageShipment — 抢救发运规划", () => {
  const FEE_RESERVE = 2000;

  it("价值密度优先序：power 击败同库存的 G 与矿物", () => {
    const plan = planSalvageShipment(
      new Map([["energy", 10000], ["G", 3000], ["power", 500], ["U", 8000]]),
      "B",
      FEE_RESERVE,
    );
    expect(plan).toEqual({ to: "B", resourceType: "power", amount: 500 });
  });

  it("无 power 时 G 次优先", () => {
    const plan = planSalvageShipment(
      new Map([["G", 3000], ["U", 8000]]),
      "B",
      FEE_RESERVE,
    );
    expect(plan?.resourceType).toBe("G");
  });

  it("X 化合物优先于 battery 与基础矿物", () => {
    const plan = planSalvageShipment(
      new Map([["XUH2O", 1000], ["battery", 5000], ["Z", 9000]]),
      "B",
      FEE_RESERVE,
    );
    expect(plan?.resourceType).toBe("XUH2O");
  });

  it("非能量资源发完后能量兜底：留运费地板，余量全发", () => {
    const plan = planSalvageShipment(
      new Map([["energy", 10000]]),
      "B",
      FEE_RESERVE,
    );
    expect(plan).toEqual({ to: "B", resourceType: "energy", amount: 8000 });
  });

  it("能量恰好等于运费地板 → 不发（保住后续 send 的运费来源）", () => {
    const plan = planSalvageShipment(
      new Map([["energy", FEE_RESERVE]]),
      "B",
      FEE_RESERVE,
    );
    expect(plan).toBeUndefined();
  });

  it("空 terminal → undefined（抢救已完成）", () => {
    expect(planSalvageShipment(new Map(), "B", FEE_RESERVE)).toBeUndefined();
  });
});
