/** 核弹落点规避 — 纯函数选点测试。 */
import { describe, expect, it } from "vitest";
import {
  findNukeEvasionTarget,
  NUKE_DAMAGE_RADIUS,
} from "../../../src/domain/defense/nuke-response";

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function expectOutsideAll(
  target: { x: number; y: number },
  nukes: readonly { pos: { x: number; y: number } }[],
): void {
  for (const n of nukes) {
    expect(chebyshev(target, n.pos)).toBeGreaterThan(NUKE_DAMAGE_RADIUS);
  }
}

describe("findNukeEvasionTarget", () => {
  it("落点半径内返回最近的半径外格", () => {
    const nukes = [{ pos: { x: 25, y: 25 } }];
    const target = findNukeEvasionTarget({ x: 25, y: 25 }, nukes);
    expect(target).toBeDefined();
    expectOutsideAll(target!, nukes);
    expect(target!.x).toBeGreaterThanOrEqual(0);
    expect(target!.x).toBeLessThanOrEqual(49);
    expect(target!.y).toBeGreaterThanOrEqual(0);
    expect(target!.y).toBeLessThanOrEqual(49);
  });

  it("不在危险区时返回 undefined（不接管移动）", () => {
    expect(findNukeEvasionTarget({ x: 0, y: 0 }, [{ pos: { x: 25, y: 25 } }])).toBeUndefined();
  });

  it("多个核弹时要求避开所有落点", () => {
    const nukes = [{ pos: { x: 25, y: 25 } }, { pos: { x: 25, y: 31 } }];
    const target = findNukeEvasionTarget({ x: 25, y: 25 }, nukes);
    expect(target).toBeDefined();
    expectOutsideAll(target!, nukes);
  });

  it("贴墙角落也能选到房间内且半径外的格", () => {
    const nukes = [{ pos: { x: 0, y: 0 } }];
    const target = findNukeEvasionTarget({ x: 0, y: 0 }, nukes);
    expect(target).toBeDefined();
    expectOutsideAll(target!, nukes);
    expect(target!.x).toBeLessThanOrEqual(49);
    expect(target!.y).toBeLessThanOrEqual(49);
  });

  it("没有核弹时返回 undefined", () => {
    expect(findNukeEvasionTarget({ x: 25, y: 25 }, [])).toBeUndefined();
  });

  it("落地还早（超出撤离窗口）时不接管，让资产抢救/正常工作继续", () => {
    expect(
      findNukeEvasionTarget({ x: 25, y: 25 }, [{ pos: { x: 25, y: 25 }, timeToLand: 40000 }]),
    ).toBeUndefined();
  });

  it("落地窗口内才撤离", () => {
    const nukes = [{ pos: { x: 25, y: 25 }, timeToLand: 50 }];
    const target = findNukeEvasionTarget({ x: 25, y: 25 }, nukes);
    expect(target).toBeDefined();
    expectOutsideAll(target!, nukes);
  });
});
