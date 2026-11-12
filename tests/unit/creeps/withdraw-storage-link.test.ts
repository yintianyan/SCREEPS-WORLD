/**
 * Phase C：storage link 排空守卫（RCL8 停供时不得抑制）。
 *
 * 回归背景：W8N3 RCL8 后 controller 目标水位 = 0，link-system Step2 永不执行；
 * 旧守卫只看「controller link 有空位」就返回 undefined，导致 storage link 800/800
 * 无人排空 → source link 全满 → 采集端堵死、storage 卡在 51K。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withdrawStorageLink } from "../../../src/creeps/engine/actions/withdraw";
import type { ActionContext } from "../../../src/creeps/engine/action-types";
import { CONFIG } from "../../../src/config";
import { mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

const ORIGINAL_GCL = CONFIG.economy.upgrade.gclUpgrade;

/** CONFIG 为 readonly 声明，测试需临时覆盖开关（用断言绕开只读修饰）。 */
function setGclUpgrade(enabled: boolean): void {
  (CONFIG.economy.upgrade as unknown as { gclUpgrade: boolean }).gclUpgrade = enabled;
}

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Memory = { rooms: {} };
});

afterEach(() => {
  setGclUpgrade(ORIGINAL_GCL);
});

function makeStore(resources: Record<string, number>, capacity: number) {
  const used = (resource?: string): number =>
    resource === undefined
      ? Object.values(resources).reduce((sum, amount) => sum + amount, 0)
      : (resources[resource] ?? 0);
  return {
    ...resources,
    getUsedCapacity: used,
    getFreeCapacity: (resource?: string) => capacity - used(resource),
    getCapacity: () => capacity,
  };
}

function linkAt(x: number, y: number, energy: number): any {
  return {
    id: `link-${x}-${y}`,
    pos: mockPos(x, y, "W8N3"),
    store: makeStore(energy > 0 ? { energy } : {}, 800),
    cooldown: 0,
  };
}

function makeAc(opts: {
  rcl: number;
  ctrlLinkEnergy: number;
  storageLinkEnergy?: number;
  storageEnergy?: number;
  downgradeRisk?: boolean;
}): ActionContext {
  const creep = {
    name: "hauler-1",
    store: makeStore({}, 800),
    memory: { role: "hauler", home: "W8N3" },
    pos: mockPos(22, 18, "W8N3"),
    room: { name: "W8N3" },
  } as unknown as Creep;

  const snapshot = mockSnapshot({
    roomName: "W8N3",
    rcl: opts.rcl,
    controller: {
      my: true,
      pos: mockPos(22, 42, "W8N3"),
      ticksToDowngrade: 200000,
    } as any,
    // storage 在 (21,15)，storage link (22,18) 距 3 格（storageAnchorRange=3）。
    storage: {
      pos: mockPos(21, 15, "W8N3"),
      store: makeStore({ energy: opts.storageEnergy ?? 51074 }, 1000000),
    } as any,
    links: [linkAt(22, 18, opts.storageLinkEnergy ?? 800), linkAt(22, 42, opts.ctrlLinkEnergy)],
  });

  return { creep, snapshot, assignment: undefined, budget: {} as any, ctx: {} as any };
}

describe("withdrawStorageLink — controller 补能守卫", () => {
  it("GCL 关闭 + RCL8 无降级风险 → 不抑制，hauler 正常排空 storage link", () => {
    setGclUpgrade(false);
    const ac = makeAc({ rcl: 8, ctrlLinkEnergy: 200 });
    const target = withdrawStorageLink().resolve(ac) as any;
    expect(target?.id).toBe("link-22-18");
  });

  it("GCL 开启 + RCL8 + controller link 缺能 → 抑制（让 link-system Step2 用瞬移补能）", () => {
    setGclUpgrade(true);
    const ac = makeAc({ rcl: 8, ctrlLinkEnergy: 200 });
    expect(withdrawStorageLink().resolve(ac)).toBeUndefined();
  });

  it("GCL 开启 + RCL8 + controller link 接近满（free < 抑制阈值）→ 不抑制（防 storage link 堵死）", () => {
    setGclUpgrade(true);
    // free = 800 - 600 = 200 < controllerFeedSuppressFree(400)。
    const ac = makeAc({ rcl: 8, ctrlLinkEnergy: 600 });
    const target = withdrawStorageLink().resolve(ac) as any;
    expect(target?.id).toBe("link-22-18");
  });

  it("RCL7 且 controller link 空位充足 → 抑制（保留给 link-system Step2）", () => {
    const ac = makeAc({ rcl: 7, ctrlLinkEnergy: 200, storageEnergy: 60000 });
    expect(withdrawStorageLink().resolve(ac)).toBeUndefined();
  });

  it("RCL8 但有降级风险 → 抑制（保级时 Step2 仍会抽能）", () => {
    (globalThis as any).Memory.rooms["W8N3"] = { controllerDowngradeRisk: true };
    const ac = makeAc({ rcl: 8, ctrlLinkEnergy: 200, downgradeRisk: true });
    expect(withdrawStorageLink().resolve(ac)).toBeUndefined();
  });

  it("RCL8 且 storage link 为空 → undefined（无可排空）", () => {
    const ac = makeAc({ rcl: 8, ctrlLinkEnergy: 200, storageLinkEnergy: 0 });
    expect(withdrawStorageLink().resolve(ac)).toBeUndefined();
  });

  it("RCL7 但 controller link 只剩很小空位（< 抑制阈值）→ 不抑制", () => {
    // 空位 200 < controllerFeedSuppressFree(400)：Step2 的补给窗口已很小，
    // hauler 可以排空而不必担心掐断 controller。
    const ac = makeAc({ rcl: 7, ctrlLinkEnergy: 600, storageEnergy: 60000 });
    const target = withdrawStorageLink().resolve(ac) as any;
    expect(target?.id).toBe("link-22-18");
  });
});
