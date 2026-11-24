import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { REMOTE_ABANDON } from "../../../src/domain/remote/op-outcome";
import {
  enforceRemoteTargetPolicies,
  reactivateRemoteTargetPolicies,
} from "../../../src/systems/remote/op-lifecycle";
import { resetGlobals } from "../../support/factories";

type TargetPolicy = { disabled?: boolean; reactivate?: boolean };
const originalPolicies = CONFIG.remote.targetPolicies;

beforeEach(() => {
  resetGlobals();
  Memory.rooms.W37S58 = { spawnQueue: [] };
  (CONFIG.remote as unknown as { targetPolicies: Record<string, TargetPolicy> }).targetPolicies = {
    "W37S58>W39S57": { disabled: true },
    "W37S58>W37S57": { reactivate: true },
  };
});

afterEach(() => {
  (CONFIG.remote as unknown as { targetPolicies: Record<string, TargetPolicy> }).targetPolicies =
    originalPolicies;
});

describe("remote target policy — 人工停用", () => {
  it("首次停用转 abandoned 并留策略墓碑，重复执行幂等", () => {
    const disabled: RemoteOp = { state: "active", createdAt: 1, lastSeen: 1 };
    const enabled: RemoteOp = { state: "active", createdAt: 1, lastSeen: 1 };
    const alreadyAbandoned: RemoteOp = { state: "abandoned", createdAt: 1, lastSeen: 1 };
    const ops: Record<string, RemoteOp> = {
      W39S57: disabled,
      W36S58: enabled,
      W37S56: alreadyAbandoned,
    };
    const globalActiveTargets = new Set(["W36S58", "W39S57"]);

    expect(enforceRemoteTargetPolicies(ops, "W37S58", 1000, globalActiveTargets)).toBe(1);
    expect(disabled.state).toBe("abandoned");
    expect(disabled.stateSince).toBe(1000);
    expect(enabled.state).toBe("active");
    expect(globalActiveTargets.has("W39S57")).toBe(false);
    expect(enforceRemoteTargetPolicies(ops, "W37S58", 1010, globalActiveTargets)).toBe(0);
    expect(Memory.rooms.W37S58?.remoteGraveyard?.at(-1)).toMatchObject({
      t: "W39S57",
      r: REMOTE_ABANDON.PolicyDisabled,
      at: 1000,
    });
  });

  it("停用释放名额后从已有记录恢复目标，并同步跨房去重集合", () => {
    const restore: RemoteOp = { state: "abandoned", createdAt: 1, lastSeen: 1 };
    const replacement: RemoteOp = { state: "active", createdAt: 2, lastSeen: 2 };
    const ops: Record<string, RemoteOp> = { W37S57: restore, W39S57: replacement };
    const globalActiveTargets = new Set(["W36S58", "W39S57"]);

    enforceRemoteTargetPolicies(ops, "W37S58", 1000, globalActiveTargets);
    expect(reactivateRemoteTargetPolicies(ops, "W37S58", 1010, 1, globalActiveTargets)).toBe(1);
    expect(restore.state).toBe("active");
    expect(restore.stateSince).toBe(1010);
    expect(restore.lastSeen).toBe(1010);
    expect(globalActiveTargets.has("W37S57")).toBe(true);
    expect(reactivateRemoteTargetPolicies(ops, "W37S58", 1020, 1, globalActiveTargets)).toBe(0);
  });
});
