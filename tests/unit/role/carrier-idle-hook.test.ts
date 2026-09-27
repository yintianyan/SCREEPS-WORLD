/** 回归：carrier 无候选钩子不得在「该去而未至」的房间切 idle —— 满载停滞死锁。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { carrierRole } from "../../../src/creeps/roles/carrier";
import { mockContext, mockCreep, mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

/**
 * 构造满载 carrier mock：背包 1200/1200、身处 home(W37S58) 而非 remoteTarget(W37S55)。
 * work 候选 transferTargetStorage 在非目标房 resolve 为 undefined —— 正是线上 6 只
 * 满载 carrier 的停滞形态。
 */
function makeLoadedCarrierAtHome(mode: string): any {
  const creep = mockCreep({
    name: "carrier-W37S58-0-83275973-6wkb",
    role: "carrier",
    mode,
    home: "W37S58",
    used: 1200,
    capacity: 1200,
    pos: undefined,
  });
  creep.memory.remoteTarget = "W37S55";
  creep.room = {
    name: "W37S58",
    find: vi.fn(() => []),
    findExitTo: vi.fn(() => 3),
    lookForAt: vi.fn(() => []),
  };
  return creep;
}

function emptySnapshot() {
  return mockSnapshot({
    hostileCreeps: [],
    threatCreeps: [],
    spawns: [],
    fillTargets: [],
  });
}

describe("carrier — shouldIdleWhenNoCandidate 满载停滞死锁回归", () => {
  it("满载 carrier mode=idle 在 home → run 后 mode 必须停在 work（旧实现打回 idle 形成死锁）", () => {
    // 死锁链：ensureHome(idle→dest=home，已在家，放行) → updateMode(used>0→work) →
    // work 候选在非目标房 miss → 钩子。旧实现恒 true → mode=idle，下一 tick 重复 ——
    // 跨房导航只在 ensureHome 返回 false（mode=work）的 tick 发生，永远轮不到。
    const creep = makeLoadedCarrierAtHome("idle");
    carrierRole.run(creep, mockContext(emptySnapshot()));
    expect(creep.memory.mode).toBe("work");
  });

  it("空载 acquire 在 home → 允许 idle（等 storage 回填，旧行为保留）", () => {
    const creep = makeLoadedCarrierAtHome("acquire");
    creep.store.getUsedCapacity = () => 0;
    carrierRole.run(creep, mockContext(emptySnapshot()));
    // home 即 acquire 的应在之处：无候选 → idle 合法。
    expect(creep.memory.mode).toBe("idle");
  });
});
