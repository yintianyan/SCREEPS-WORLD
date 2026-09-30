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

  /**
   * 线上回归（2026-09-30 巡检 #47，W38S56 RCL3 无 storage）：demand 的 `canDeliver` 闸门在
   * 「核心池刚好满 + 无 fillTargets」时关闭 ⇒ haulerTarget 回落 minCount ⇒ keep 变小 ⇒
   * 这一条按 ttl 升序吃掉**最年轻**的 hauler，而当时 3 个 source container 各压 2000 能量。
   * 1225 拍内 25 次 hauler 回收（age 中位 202、死亡位置全贴在 spawn 邻格）。
   * 规则：源侧有积压 = 活干不出去，不是没活可干 ⇒ **否决销毁**（编制目标与阈值一个都没改）。
   */
  it("源侧 container 积压时，富余 hauler 一律不回收（sink 满 ≠ 运力过剩）", () => {
    const haulers = [
      summary("ha1", "hauler"),
      summary("ha2", "hauler"),
      summary("ha3", "hauler"),
      summary("ha4", "hauler"),
      summary("ha5", "hauler"),
    ];
    // target=2 → keep=3 → 无积压时应回收 2 只（TTL 最小者）。
    expect(selectRecycleCandidates(haulers, "W7N4", KNOWN, 2, 2, undefined, false)).toHaveLength(2);
    // 同一份编成，只要源侧压着能量，一条都不许动。
    expect(selectRecycleCandidates(haulers, "W7N4", KNOWN, 2, 2, undefined, true)).toHaveLength(0);
  });

  it("sourceBacklog 省略（旧调用方）→ 行为不变，规则 3 照常执行", () => {
    const haulers = [
      summary("ha1", "hauler"),
      summary("ha2", "hauler"),
      summary("ha3", "hauler"),
      summary("ha4", "hauler"),
    ];
    expect(selectRecycleCandidates(haulers, "W7N4", KNOWN, 2, 2)).toHaveLength(1);
  });

  it("积压否决只管 hauler：废弃角色与 worker 富余照常回收", () => {
    const marked = selectRecycleCandidates(
      [
        summary("old_miner", "miner"),
        summary("h1", "harvester"),
        summary("h2", "harvester"),
        summary("w1", "worker"),
        summary("w2", "worker"),
        summary("ha1", "hauler"),
        summary("ha2", "hauler"),
        summary("ha3", "hauler"),
        summary("ha4", "hauler"),
      ],
      "W7N4",
      KNOWN,
      2,
      2,
      undefined,
      true,
    );
    expect(marked).toContain("old_miner"); // 规则 1 不受影响
    expect(marked).toContain("w2"); // 规则 2 不受影响
    expect(marked).not.toContain("ha1"); // 规则 3 被否决
  });
});
