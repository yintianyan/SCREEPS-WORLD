import { describe, expect, it } from "vitest";
import { canSpawnEvidence, evaluateCheckpoint } from "../../../src/domain/expansion/checkpoint";

/**
 * 线上实测的幼房形态（W38S56，83322007~83322039）：进能 ~13/t，bay 每 ~16 拍被一次
 * 孵化占满，`energyAvailable` 在 11 / 102 / 227 之间摆 —— ≥300 只存在于 bay 的空档里。
 * expansion-manager 的 interval=100，采样大概率正好错过空档，于是 spawn 明明在正常
 * 生人，CP2 仍判"不能孵化"，整条检查点链（CP3/CP4/CP5）都卡在它后面。
 */
describe("canSpawnEvidence — spawn 活性不吃自己的排气", () => {
  it("bay 正在孵化即为证据，即使池子只剩 11", () => {
    expect(canSpawnEvidence(11, true)).toBe(true);
    expect(canSpawnEvidence(227, true)).toBe(true);
  });

  it("空 bay 时水位判据一个都没放松：299 仍为假", () => {
    expect(canSpawnEvidence(299, false)).toBe(false);
    expect(canSpawnEvidence(0, false)).toBe(false);
  });

  it("300 及以上照常为真（与改前逐点一致）", () => {
    expect(canSpawnEvidence(300, false)).toBe(true);
    expect(canSpawnEvidence(450, true)).toBe(true);
  });

  it("CP2 在「spawn 已建成 + 池子 11 + 正在孵化」下判 PASSED", () => {
    const r = evaluateCheckpoint({
      checkpointId: "CP2_SPAWN_ACTIVE",
      controllerClaimed: true,
      spawnBuilt: true,
      spawnCanSpawn: canSpawnEvidence(11, true),
      harvesterActive: false,
      transporterActive: false,
      extensionsBuilt: false,
      containerBuilt: false,
      roadsBuilt: false,
      netEnergyFlowPositive: false,
      empireIntegrated: false,
      tick: 83322023,
      retryCount: 0,
    });
    expect(r.passed).toBe(true);
  });

  it("反面对照：「spawn 已建成 + 池子 11 + bay 空」仍判不过（不是恒真闸）", () => {
    const r = evaluateCheckpoint({
      checkpointId: "CP2_SPAWN_ACTIVE",
      controllerClaimed: true,
      spawnBuilt: true,
      spawnCanSpawn: canSpawnEvidence(11, false),
      harvesterActive: false,
      transporterActive: false,
      extensionsBuilt: false,
      containerBuilt: false,
      roadsBuilt: false,
      netEnergyFlowPositive: false,
      empireIntegrated: false,
      tick: 83322023,
      retryCount: 0,
    });
    expect(r.passed).toBe(false);
  });
});
