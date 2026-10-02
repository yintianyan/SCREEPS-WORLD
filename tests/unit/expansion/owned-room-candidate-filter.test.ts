/**
 * #86 —— 自有房必须从候选池里剔掉（与 `dropReleasedRooms` 同一个洞的另一半）。
 *
 * 现场证据（2026-10-02 20:5xZ，t=83386099）：`Memory.kernel.expansionCandidates` 十条满格里躺着
 * `W38S56 st=QUALIFIED`，而 W38S56 就是我自己的幼房（claim 成功在 8.5 小时前，
 * `lastExpansionCompletedTick=83328457`）。候选只在 Intel 刷新时重建 ⇒ 占领成功不会让那条候选失效，
 * 于是它一直顶着旧的 QUALIFIED 状态：白占一格（池子上限 10）+ 把 dashboard 的 `candidateCount`
 * 读成"还有一个合格目标"。
 *
 * 反向实验按同一形状做：把过滤摘掉 ⇒ (a)/(e) 必须转红、其余全绿。
 */
import { describe, expect, it } from "vitest";
import { dropOwnedRooms, dropReleasedRooms } from "../../../src/domain/expansion/candidate";

type Row = { roomName: string; status: string };

const row = (roomName: string, status = "QUALIFIED"): Row => ({ roomName, status });
const names = (rows: readonly Row[]) => rows.map(r => r.roomName).join(",");

describe("#86 自有房不进候选池", () => {
  it("(a) 现场形状：我已经拥有的房即使 st=QUALIFIED 也被剔掉", () => {
    const pool = [row("W38S57"), row("W38S56"), row("W39S55")];
    expect(names(dropOwnedRooms(pool, ["W37S58", "W38S56"]))).toBe("W38S57,W39S55");
  });

  it("(b) 控制组：非自有房一条都不动（包括同为 QUALIFIED 的正常目标）", () => {
    const pool = [row("W38S57"), row("W38S58"), row("W39S55")];
    expect(names(dropOwnedRooms(pool, ["W37S58", "W38S56"]))).toBe("W38S57,W38S58,W39S55");
  });

  it("(c) 没有自有房时恒等返回（新启动/无主期不得改变行为）", () => {
    const pool = [row("W38S57"), row("W38S56")];
    expect(names(dropOwnedRooms(pool, []))).toBe("W38S57,W38S56");
  });

  it("(d) 对状态不敏感是刻意的：QUALIFIED / DISCOVERED / UNKNOWN 一视同仁", () => {
    const pool = [
      row("W38S56", "QUALIFIED"),
      row("W37S56", "DISCOVERED"),
      row("W37S54", "UNKNOWN"),
    ];
    expect(dropOwnedRooms(pool, ["W38S56", "W37S54"]).map(r => r.roomName)).toEqual(["W37S56"]);
  });

  it("(e) 与重占排除叠加时两条语义互不吞掉（自有房与刚放弃的房各自被剔，第三方保留）", () => {
    const pool = [row("W38S56"), row("W37S55"), row("W38S57")];
    const released = { W37S55: 83000000 };
    const applied = dropOwnedRooms(dropReleasedRooms(pool, released), ["W38S56"]);
    expect(names(applied)).toBe("W38S57");
    // 单独走排除表时自有房仍在 ⇒ 证明这两道闸确实是两件事，不是一道被另一道顺带做了。
    expect(names(dropReleasedRooms(pool, released))).toBe("W38S56,W38S57");
  });
});
