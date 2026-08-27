/** B1 回收通道纯决策测试。 */
import { describe, expect, it } from "vitest";
import { selectRecycleCandidates } from "../../../src/domain/spawn/recycle";
import type { CreepSummary } from "../../../src/domain/spawn/demand";

const KNOWN = new Set(["harvester", "hauler", "upgrader", "builder", "worker"]);

function summary(name: string, role: string, home = "W7N4"): CreepSummary {
  return { name, role, home, ticksToLive: 1000, bodyLength: 3 };
}

describe("recycle — selectRecycleCandidates", () => {
  it("废弃角色（不在注册表中）被标记回收", () => {
    const marked = selectRecycleCandidates(
      [summary("old_miner", "miner"), summary("h1", "harvester"), summary("h2", "harvester")],
      "W7N4",
      KNOWN,
      2,
    );
    expect(marked).toContain("old_miner");
    expect(marked).not.toContain("h1");
  });

  it("unknown 角色（数据畸形）不回收，交迁移/人工处理", () => {
    const marked = selectRecycleCandidates([summary("weird", "unknown")], "W7N4", KNOWN, 2);
    expect(marked).toHaveLength(0);
  });

  it("harvester 满编时，worker 保留 1 只保险、其余标记", () => {
    const marked = selectRecycleCandidates(
      [
        summary("h1", "harvester"),
        summary("h2", "harvester"),
        summary("w1", "worker"),
        summary("w2", "worker"),
        summary("w3", "worker"),
      ],
      "W7N4",
      KNOWN,
      2,
    );
    expect(marked).toHaveLength(2);
    expect(marked).toContain("w2");
    expect(marked).toContain("w3");
    expect(marked).not.toContain("w1");
  });

  it("harvester 未满编时，worker 全部保留（灾后力量不回收）", () => {
    const marked = selectRecycleCandidates(
      [summary("h1", "harvester"), summary("w1", "worker"), summary("w2", "worker")],
      "W7N4",
      KNOWN,
      2,
    );
    expect(marked).toHaveLength(0);
  });

  it("他房 creep 不被本房标记", () => {
    const marked = selectRecycleCandidates(
      [summary("miner_elsewhere", "miner", "W8N4")],
      "W7N4",
      KNOWN,
      2,
    );
    expect(marked).toHaveLength(0);
  });

  it("富余 hauler（> haulerTarget+1）→ 回收最老富余者", () => {
    const haulers = [
      summary("ha1", "hauler"),
      summary("ha2", "hauler"),
      summary("ha3", "hauler"),
      summary("ha4", "hauler"),
    ];
    const marked = selectRecycleCandidates(haulers, "W7N4", KNOWN, 2, 2);
    // target=2 → keep=3 → 4 只中回收 1 只（TTL 最小者）。
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe("ha1");
  });

  it("hauler 未超目标+1 → 不回收（防抖动缓冲）", () => {
    const haulers = [summary("ha1", "hauler"), summary("ha2", "hauler"), summary("ha3", "hauler")];
    const marked = selectRecycleCandidates(haulers, "W7N4", KNOWN, 2, 2);
    expect(marked).toHaveLength(0);
  });

  it("替换窗口内的富余 hauler 不回收（自然寿终，避免回收竞态）", () => {
    const dying = { name: "ha1", role: "hauler", home: "W7N4", ticksToLive: 10, bodyLength: 3 };
    const alive = [summary("ha2", "hauler"), summary("ha3", "hauler")];
    const marked = selectRecycleCandidates([dying, ...alive], "W7N4", KNOWN, 2, 1);
    // target=1 → keep=2 → 富余候选是最老（濒死）ha1 → 替换窗口内跳过 → 不回收。
    expect(marked).toHaveLength(0);
  });
});
