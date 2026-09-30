/**
 * 帝国风险缓冲的取值范围（G3 的输入之一）。
 * 线上实证：`kernel.empireEconomy.rb=0` 而同时 `te=885,885`、gate netFlow=+29.4/t ——
 * 那个 0 不是"帝国快断供"，而是**幼房还没有 storage**（riskBuffer 的分子是 storageEnergy，RCL4 才有结构），
 * 它的缓冲躺在 container 与 spawn 池里（ea=529/550、房内 7,085 能量）。
 * 用结构性 0 去当帝国的短板 ⇒ health 被判成 stable ⇒ 扩张闸 G3 恒红，且红的原因与真实储备无关。
 * 这里钉的是**取值范围**，不是阈值：`stableMinRiskBuffer` 一个数都没动。
 */
import { describe, expect, it } from "vitest";
import { buildEmpireResourceView } from "../../../src/domain/strategy/resource-view";
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";

function prof(over: Partial<RoomEconomicProfile>): RoomEconomicProfile {
  return {
    roomName: over.roomName ?? "W1N1",
    rcl: over.rcl ?? 8,
    hasSpawn: true,
    hasStorage: true,
    hasTerminal: false,
    storageEnergy: 500000,
    storageCapacity: 1000000,
    estimatedIncome: 100,
    netFlow: 20,
    riskBuffer: 400000,
    contractReserve: 0,
    efficiency: 0.9,
    economyPressure: 0,
    hasLiveThreat: false,
    economicClass: "core",
    netFlowPositive: true,
    selfSufficiency: 1,
    isStruggling: false,
    ...over,
  } as unknown as RoomEconomicProfile;
}

const TICK = 10_000;

describe("resource-view minRiskBuffer 的取值范围（G3 输入）", () => {
  it("有 storage 的房参与 min；没有 storage 的房不再用结构性 0 当短板", () => {
    const view = buildEmpireResourceView(
      [
        prof({ roomName: "W7S7", riskBuffer: 400000, storageEnergy: 500000 }),
        // 幼房：无 storage ⇒ riskBuffer=0（不是断供，是测不到）
        prof({
          roomName: "W8S8",
          rcl: 3,
          hasStorage: false,
          storageEnergy: 0,
          riskBuffer: 0,
          economicClass: "candidate",
        }),
      ],
      TICK,
    );
    expect(view.minRiskBuffer).toBe(400000);
  });

  it("多房都有 storage 时短板效应照旧（最差的那一环说了算）", () => {
    const view = buildEmpireResourceView(
      [prof({ roomName: "W7S7", riskBuffer: 400000 }), prof({ roomName: "W6S6", riskBuffer: 900 })],
      TICK,
    );
    expect(view.minRiskBuffer).toBe(900);
  });

  it("全部房都没有 storage 时行为与改前一致（min→0，不假装充裕）", () => {
    const view = buildEmpireResourceView(
      [
        prof({ roomName: "W8S8", rcl: 1, hasStorage: false, storageEnergy: 0, riskBuffer: 0 }),
        prof({ roomName: "W9S9", rcl: 2, hasStorage: false, storageEnergy: 0, riskBuffer: 0 }),
      ],
      TICK,
    );
    expect(view.minRiskBuffer).toBe(0);
  });
});
