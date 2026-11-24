import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { REMOTE_ABANDON } from "../../../src/domain/remote/op-outcome";
import { enforceRemoteTargetPolicies } from "../../../src/systems/remote/op-lifecycle";
import { resetGlobals } from "../../support/factories";

const originalPolicies = CONFIG.remote.targetPolicies;

beforeEach(() => {
  resetGlobals();
  Memory.rooms.W37S58 = { spawnQueue: [] };
  (
    CONFIG.remote as unknown as { targetPolicies: Record<string, { disabled: boolean }> }
  ).targetPolicies = { "W37S58>W37S57": { disabled: true } };
});

afterEach(() => {
  (
    CONFIG.remote as unknown as { targetPolicies: Record<string, { disabled: boolean }> }
  ).targetPolicies = originalPolicies;
});

describe("remote target policy — 人工停用", () => {
  it("首次停用转 abandoned 并留策略墓碑，重复执行幂等", () => {
    const disabled: RemoteOp = { state: "active", createdAt: 1, lastSeen: 1 };
    const enabled: RemoteOp = { state: "active", createdAt: 1, lastSeen: 1 };
    const alreadyAbandoned: RemoteOp = { state: "abandoned", createdAt: 1, lastSeen: 1 };
    const ops: Record<string, RemoteOp> = {
      W37S57: disabled,
      W36S58: enabled,
      W37S56: alreadyAbandoned,
    };

    expect(enforceRemoteTargetPolicies(ops, "W37S58", 1000)).toBe(1);
    expect(disabled.state).toBe("abandoned");
    expect(disabled.stateSince).toBe(1000);
    expect(enabled.state).toBe("active");
    expect(enforceRemoteTargetPolicies(ops, "W37S58", 1010)).toBe(0);
    expect(Memory.rooms.W37S58?.remoteGraveyard?.at(-1)).toMatchObject({
      t: "W37S57",
      r: REMOTE_ABANDON.PolicyDisabled,
      at: 1000,
    });
  });
});
