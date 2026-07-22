import { describe, expect, it } from "vitest";
import { planLinkTransfers, type LinkInfo } from "../src/domain/economy/links";

function link(
  id: string,
  role: LinkInfo["role"],
  energy: number,
  opts?: { cooldown?: number; capacity?: number },
): LinkInfo {
  return {
    id,
    role,
    energy,
    energyCapacity: opts?.capacity ?? 800,
    cooldown: opts?.cooldown ?? 0,
  };
}

describe("Links — planLinkTransfers", () => {
  it("returns empty when no links", () => {
    expect(planLinkTransfers([])).toEqual([]);
  });

  it("returns empty when only one link exists", () => {
    const links = [link("s1", "source", 500)];
    expect(planLinkTransfers(links)).toEqual([]);
  });

  it("transfers from source to controller when controller needs energy", () => {
    const links = [
      link("s1", "source", 500),
      link("c1", "controller", 100),
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(1);
    // source 有 500，controller 需要 700 → 传输 500（source 全部能量）。
    expect(transfers[0]).toEqual({ fromId: "s1", toId: "c1", amount: 500 });
  });

  it("transfers from source to storage when controller is full", () => {
    const links = [
      link("s1", "source", 500),
      link("c1", "controller", 800),
      link("st", "storage", 200),
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({ fromId: "s1", toId: "st", amount: 500 });
  });

  it("prioritizes controller over storage", () => {
    const links = [
      link("s1", "source", 500),
      link("c1", "controller", 300),
      link("st", "storage", 200),
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({ fromId: "s1", toId: "c1", amount: 500 });
  });

  it("sends remaining source to storage via second link when first fills controller", () => {
    // link 每 tick 只能传输一次。两个 source link：一个填 controller，一个填 storage。
    const links = [
      link("s1", "source", 300),
      link("s2", "source", 400),
      link("c1", "controller", 500), // needs 300
      link("st", "storage", 300),    // free 500
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toEqual({ fromId: "s1", toId: "c1", amount: 300 });
    expect(transfers[1]).toEqual({ fromId: "s2", toId: "st", amount: 400 });
  });

  it("uses multiple source links to fill controller", () => {
    const links = [
      link("s1", "source", 200),
      link("s2", "source", 300),
      link("c1", "controller", 100), // needs 700
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toEqual({ fromId: "s1", toId: "c1", amount: 200 });
    expect(transfers[1]).toEqual({ fromId: "s2", toId: "c1", amount: 300 });
  });

  it("storage fills controller when no source links available", () => {
    const links = [
      link("st", "storage", 600),
      link("c1", "controller", 100),
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(1);
    // storage 有 600，controller 需要 700 → 传输 600（storage 全部能量）。
    expect(transfers[0]).toEqual({ fromId: "st", toId: "c1", amount: 600 });
  });

  it("skips source links on cooldown", () => {
    const links = [
      link("s1", "source", 500, { cooldown: 1 }),
      link("c1", "controller", 100),
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(0);
  });

  it("skips source links with zero energy", () => {
    const links = [
      link("s1", "source", 0),
      link("c1", "controller", 100),
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(0);
  });

  it("does not transfer from storage to controller when controller is above half", () => {
    const links = [
      link("st", "storage", 600),
      link("c1", "controller", 500, { capacity: 800 }),
    ];
    // controller needs 300, but no source links → storage fills it
    const transfers = planLinkTransfers(links);
    // Actually storage will fill since controllerNeeds > 0
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({ fromId: "st", toId: "c1", amount: 300 });
  });

  it("ignores hub links", () => {
    const links = [
      link("h1", "hub", 700),
      link("c1", "controller", 100),
    ];
    const transfers = planLinkTransfers(links);
    expect(transfers).toHaveLength(0);
  });
});

// ── P1-4 最小传输阈值 ──
describe("Links — minTransfer 阈值（P1-4）", () => {
  it("低于阈值且远未满时不传输", () => {
    const links = [
      link("s1", "source", 300, { capacity: 800 }), // 300 < 400 且 300 < 720(90%)
      link("c1", "controller", 700, { capacity: 800 }), // needs 100 但不急（700 >= 400）
    ];
    const transfers = planLinkTransfers(links, { minTransfer: 400 });
    expect(transfers).toHaveLength(0);
  });

  it("达阈值即传输", () => {
    const links = [
      link("s1", "source", 400, { capacity: 800 }),
      link("c1", "controller", 700, { capacity: 800 }), // needs 100
    ];
    const transfers = planLinkTransfers(links, { minTransfer: 400 });
    expect(transfers).toEqual([{ fromId: "s1", toId: "c1", amount: 100 }]);
  });

  it("接近满（>=90%）即便低于阈值也传输（防溢出）", () => {
    const links = [
      link("s1", "source", 200, { capacity: 200 }), // 满，200 >= 180(90%)
      link("c1", "controller", 700, { capacity: 800 }), // needs 100
    ];
    const transfers = planLinkTransfers(links, { minTransfer: 400 });
    expect(transfers).toEqual([{ fromId: "s1", toId: "c1", amount: 100 }]);
  });

  it("controller 急需（能量低于阈值）时豁免小额 source 传输", () => {
    const links = [
      link("s1", "source", 100, { capacity: 800 }), // 100 < 400 且未满
      link("c1", "controller", 100, { capacity: 800 }), // 100 < 400 → 急需
    ];
    const transfers = planLinkTransfers(links, { minTransfer: 400 });
    expect(transfers).toEqual([{ fromId: "s1", toId: "c1", amount: 100 }]);
  });

  it("低于阈值的 source 不向 storage 溢出回收", () => {
    const links = [
      link("s1", "source", 300, { capacity: 800 }), // < 400 且未满
      link("c1", "controller", 800, { capacity: 800 }), // 满，不急需
      link("st", "storage", 200, { capacity: 800 }),
    ];
    const transfers = planLinkTransfers(links, { minTransfer: 400 });
    expect(transfers).toHaveLength(0);
  });
});
