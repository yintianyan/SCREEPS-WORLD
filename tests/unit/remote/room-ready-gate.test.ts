/** 远矿逐房「新开」就绪门测试（Phase 1b）。 */
import { describe, expect, it } from "vitest";
import { roomReadyForNewRemote } from "../../../src/systems/remote-mining-manager";
import { CONFIG } from "../../../src/config";
import { mockSnapshot, mockStore } from "../../support/factories";

const minRcl = CONFIG.remote.roomMinRcl;
const minStore = CONFIG.remote.roomMinStorage;

/** 构建带指定 storage 能量的快照（storage 建成于 RCL4，能量任意）。 */
function snap(rcl: number, storageEnergy: number | undefined) {
  return mockSnapshot({
    rcl,
    storage:
      storageEnergy === undefined
        ? undefined
        : ({ store: mockStore(storageEnergy, 1_000_000) } as never),
  });
}

describe("remote 逐房就绪门 — roomReadyForNewRemote", () => {
  it("成熟房（RCL≥门限 + normal + storage 盈余）→ 放行新开", () => {
    expect(roomReadyForNewRemote(snap(minRcl, minStore), "normal")).toBe(true);
  });

  it("RCL 低于门限（嫩房）→ 拒绝（即便 normal + storage 足）", () => {
    expect(roomReadyForNewRemote(snap(minRcl - 1, minStore + 50000), "normal")).toBe(false);
  });

  it("colonyState 非 normal（recovery/bootstrap）→ 拒绝（本房自顾不暇）", () => {
    expect(roomReadyForNewRemote(snap(minRcl + 1, minStore + 50000), "recovery")).toBe(false);
    expect(roomReadyForNewRemote(snap(minRcl + 1, minStore + 50000), "bootstrap")).toBe(false);
  });

  it("无 storage → 拒绝（无缓冲，供不动远矿运力）", () => {
    expect(roomReadyForNewRemote(snap(minRcl + 1, undefined), "normal")).toBe(false);
  });

  it("storage 能量低于门限 → 拒绝（缓冲不足）", () => {
    expect(roomReadyForNewRemote(snap(minRcl + 1, minStore - 1), "normal")).toBe(false);
  });

  it("colonyState 缺失（undefined）→ 拒绝（保守）", () => {
    expect(roomReadyForNewRemote(snap(minRcl + 1, minStore + 50000), undefined)).toBe(false);
  });

  it("Tier0 降门：storage 1 万（原 2 万门挡住）+ RCL≥门限 + normal → 放行", () => {
    // 贫困陷阱修复：门槛从 20000 降到 8000，让 storage 常年见底的房也能开远矿补收入。
    // 硬编码 10000 作回归锚：若有人把 roomMinStorage 调回 >10000，此测试立即失败。
    expect(roomReadyForNewRemote(snap(minRcl, 10000), "normal")).toBe(true);
    expect(CONFIG.remote.roomMinStorage).toBeLessThanOrEqual(10000);
  });
});
