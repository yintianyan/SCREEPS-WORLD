/** 远矿逐房「新开」就绪门测试（Phase 1b）。 */
import { describe, expect, it } from "vitest";
import {
  coreClearReopenAllowed,
  remoteExpansionAffordable,
  roomReadyForNewRemote,
} from "../../../src/systems/remote/remote-mining-manager";
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

describe("remote 新开门与贫困闸同一把尺 — remoteExpansionAffordable", () => {
  it("storage 低于 expansionMinStorage → 不新开（否则开→孵不出→废弃→重开 churn）", () => {
    expect(remoteExpansionAffordable(CONFIG.remote.expansionMinStorage - 1)).toBe(false);
  });

  it("达到 expansionMinStorage → 经济前提放行", () => {
    expect(remoteExpansionAffordable(CONFIG.remote.expansionMinStorage)).toBe(true);
  });
});

describe("贫困期重开豁免 — 只认确需清核的线（coreClearReopenAllowed）", () => {
  it("op 上仍有 needCoreClear（核心未拆）→ 允许重开清核线", () => {
    expect(coreClearReopenAllowed({ needCoreClear: true }, true)).toBe(true);
    // 已确认有核心时，即使 intel 暂未显示 Invader 预定也放行。
    expect(coreClearReopenAllowed({ needCoreClear: true }, false)).toBe(true);
  });

  it("从未确认核心、但 intel 显示 Invader 预定 → 允许重开探测（W37S57 路径）", () => {
    expect(coreClearReopenAllowed({}, true)).toBe(true);
    expect(coreClearReopenAllowed(undefined, true)).toBe(true);
  });

  it("没有 Invader 预定且无核心证据 → 不允许", () => {
    expect(coreClearReopenAllowed({}, false)).toBe(false);
    expect(coreClearReopenAllowed(undefined, false)).toBe(false);
  });

  it("已确认拆核（coreClearedAt）→ 即使 Invader 预定残留也不重开", () => {
    // 线上 W7N3：核心拆除后预定仍残留到 4843346；若按 reservedBy 豁免，
    // 会白孵 clearer 去空房 → 1500t 后再废弃，形成新一轮循环。
    expect(coreClearReopenAllowed({ coreClearedAt: 4838459 }, true)).toBe(false);
  });
});
