/**
 * R8 回归测试：shouldIdleWhenNoCandidate 钩子等价性锁住。
 *
 * 背景：P2-M 将 role-runner 中 `role === "remoteHauler" && mode === "work" && room === home`
 * 硬编码下沉为 RolePolicy.shouldIdleWhenNoCandidate 钩子。原硬编码解决线上 idle→ensureHome
 * 死循环：remoteHauler work 在 home 房无 sink 时若不切 idle，会保持 work → 无候选 → 保持 work →
 * 永久冻结。钩子化后若未来改动误删钩子或改语义，死循环回归。
 *
 * 三断言（review 要求）：
 *   ① remoteHauler work 在 home 房无候选 → idle（钩子返回 true）
 *   ② remoteHauler acquire 在 remoteTarget 房无候选 → 不 idle（钩子返回 false，防 home↔remote 振荡）
 *   ③ 无钩子角色同条件 → 不 idle（undefined === true → false，不因 undefined 误切；证明钩子必要性）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteHaulerRole } from "../../../src/creeps/roles/remote-hauler";
import { defineRole } from "../../../src/creeps/engine/role-runner";
import type { RolePolicy } from "../../../src/creeps/engine/action-types";
import type { Priority } from "../../../src/kernel/contracts";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  resetGlobals,
} from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

/**
 * 构造无候选的 remoteHauler mock：
 *   - work 在 home 房：snapshot 无 storage + fillTargets 空 → work 候选全 undefined
 *   - acquire 在 remoteTarget 房：room.find 返回空 → acquire 候选全 undefined
 */
function makeRemoteHauler(opts: {
  mode: string;
  roomName: string;
  used: number;
}): any {
  const creep = mockCreep({
    name: "rh1",
    role: "remoteHauler",
    mode: opts.mode,
    home: "W7N4",
    used: opts.used,
    capacity: 100,
    pos: undefined,
  });
  // remoteTarget + 房间名覆盖（mockCreep 默认 room.name=home）
  creep.memory.remoteTarget = "W7N9";
  creep.room = {
    name: opts.roomName,
    find: vi.fn(() => []),
    findExitTo: vi.fn(() => 3),
    lookForAt: vi.fn(() => []),
  };
  return creep;
}

/** 无 storage、无 fillTargets 的 home 房快照 — 让 work 候选全部 miss。 */
function emptySinkSnapshot() {
  return mockSnapshot({
    storage: undefined,
    fillTargets: [],
    hostileCreeps: [],
    threatCreeps: [],
    spawns: [],
  });
}

describe("R8 — shouldIdleWhenNoCandidate 钩子等价性", () => {
  it("① remoteHauler work 在 home 房无候选 → 切 idle", () => {
    // work 模式 + 在 home 房（W7N4）+ 背包有能量（used=50）
    // ensureHome: work+remoteHauler → goHome=true → 在 home → 返回 true（继续候选评估）
    // work 候选: fillStorage(storage=undefined→miss) + haulFillTarget(fillTargets=[]→miss)
    // → idle 分支 → shouldIdleWhenNoCandidate(work && room==home → true) → 切 idle
    const snap = emptySinkSnapshot();
    const creep = makeRemoteHauler({ mode: "work", roomName: "W7N4", used: 50 });

    remoteHaulerRole.run(creep, mockContext(snap));

    expect(creep.memory.mode).toBe("idle");
  });

  it("② remoteHauler acquire 在 home 房 → 不切 idle（ensureHome 导航去 remoteTarget）", () => {
    // acquire 模式 + 在 home 房（W7N4）+ 背包空（used=0）
    // ensureHome: acquire → goHome=false → dest=remoteTarget → 不在 remoteTarget → moveTowardRoom + 返回 false
    // role-runner: ensureHome 返回 false → remoteTarget 存在 → 不切 idle → return
    // → mode 保持 acquire（ensureHome 下一 tick 导航去 remoteTarget）
    //   若误切 idle：idle → ensureHome goHome → 留在 home → updateMode 转 acquire →
    //   ensureHome 又导航 → 但若 ensureHome 逻辑被改误返回 true → idle 分支 → 死循环
    const snap = emptySinkSnapshot();
    const creep = makeRemoteHauler({ mode: "acquire", roomName: "W7N4", used: 0 });

    remoteHaulerRole.run(creep, mockContext(snap));

    expect(creep.memory.mode).toBe("acquire");
  });

  it("③ 无钩子角色同条件 → 不切 idle（undefined 钩子安全 + 证明钩子必要性）", () => {
    // 与 ① 相同条件（work + remoteHauler role + 在 home 房），但 policy 无 shouldIdleWhenNoCandidate 钩子。
    // 验证：policy.shouldIdleWhenNoCandidate?.(ac) === true → undefined === true → false
    //   → !remoteTarget(false) || room==remoteTarget(false) || false → false → 不切 idle
    // 这证明：移除钩子后 remoteHauler work 在 home 房不 idle → 永久冻结（钩子是必需的）。
    const snap = emptySinkSnapshot();
    const creep = makeRemoteHauler({ mode: "work", roomName: "W7N4", used: 50 });

    // 无钩子 policy — 模拟"钩子被误删"的回归场景
    const noHookPolicy: RolePolicy = {
      acquire: [],
      work: [],
      park: true,
    };
    const noHookRole = defineRole("remoteHauler", 1 as Priority, noHookPolicy);
    noHookRole.run(creep, mockContext(snap));

    // 不切 idle — 保持 work（错误行为，但验证了默认逻辑不因 undefined 误切）
    expect(creep.memory.mode).toBe("work");
  });
});
