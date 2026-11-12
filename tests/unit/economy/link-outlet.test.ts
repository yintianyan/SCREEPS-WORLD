/** linkHasOutlet 纯函数测试（2026-08-02，link 布局漏洞 #3）。 */
import { describe, expect, it } from "vitest";
import { linkHasOutlet } from "../../../src/domain/economy/link-outlet";
import { findStorageLink, type LinkInfo } from "../../../src/domain/economy/links";

function makeLink(id: string, role: LinkInfo["role"]): LinkInfo {
  return { id, role, energy: 0, energyCapacity: 800, cooldown: 0 };
}

describe("linkHasOutlet — source link 出口判定", () => {
  it("非 source link 永远返回 true（不需要 outlet）", () => {
    expect(linkHasOutlet("controller", [])).toBe(true);
    expect(linkHasOutlet("storage", [])).toBe(true);
    expect(linkHasOutlet("hub", [])).toBe(true);
  });

  it("source link 无其他 link → 无 outlet（死资产）", () => {
    expect(linkHasOutlet("source", [])).toBe(false);
  });

  it("source link + 只有其他 source link → 无 outlet", () => {
    const others = [makeLink("src2", "source")];
    expect(linkHasOutlet("source", others)).toBe(false);
  });

  it("source link + controller link → 有 outlet", () => {
    const others = [makeLink("ctrl1", "controller")];
    expect(linkHasOutlet("source", others)).toBe(true);
  });

  it("source link + storage link → 有 outlet", () => {
    const others = [makeLink("stor1", "storage")];
    expect(linkHasOutlet("source", others)).toBe(true);
  });

  it("source link + controller + storage link → 有 outlet", () => {
    const others = [makeLink("ctrl1", "controller"), makeLink("stor1", "storage")];
    expect(linkHasOutlet("source", others)).toBe(true);
  });

  it("source link + 只有 hub link → 无 outlet（hub 不是有效下游）", () => {
    const others = [makeLink("hub1", "hub")];
    expect(linkHasOutlet("source", others)).toBe(false);
  });
});

describe("findStorageLink — 与布局分类同源（storageAnchorRange=3）", () => {
  // W8N3 现场坐标：storage (21,15)、storage link (22,18) —— 切比雪夫距离 3。
  const view = {
    storage: { pos: { x: 21, y: 15 } },
    controller: { pos: { x: 23, y: 42 } },
    sources: [{ pos: { x: 34, y: 20 } }, { pos: { x: 30, y: 21 } }],
    links: [
      { id: "src1", pos: { x: 33, y: 20 } },
      { id: "ctrl", pos: { x: 22, y: 42 } },
      { id: "src2", pos: { x: 30, y: 20 } },
      { id: "stor", pos: { x: 22, y: 18 } },
    ],
  };

  it("距 storage 3 格的 link 仍判为 storage（旧 range<=2 会漏掉）", () => {
    expect(findStorageLink(view)?.id).toBe("stor");
  });

  it("无 storage → undefined", () => {
    expect(findStorageLink({ ...view, storage: undefined })).toBeUndefined();
  });
});
