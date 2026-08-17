/**
 * linkHasOutlet 纯函数测试（2026-08-02，link 布局漏洞 #3）。
 *
 * 覆盖：
 *   - 非 source link 永远有 outlet（不需要下游）
 *   - source link 有 controller/storage link → 有 outlet
 *   - source link 无 controller/storage link → 无 outlet（死资产）
 *   - otherLinks 不含 link 自身（调用方过滤）
 */
import { describe, expect, it } from "vitest";
import { linkHasOutlet } from "../../../src/domain/economy/link-outlet";
import type { LinkInfo } from "../../../src/domain/economy/links";

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
