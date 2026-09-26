/**
 * B6-㉓ 战术链坐标编解码约定：全仓唯一编码 `x * 50 + y`。
 *
 * 原缺陷：战术运行时 5 处写点手搓 `pos.y * 50 + pos.x`，而战术 domain 与
 * `squad-movement-runtime` 自己的解码一律是 `x = floor(p/50), y = p%50`
 * —— 同一批数字两种解释。切比雪夫距离/质心这类对称运算会互相抵消，所以
 * 破口只在两处相遇时才现形：编队槽位（x-major 生成）与成员位（y-major 写入）
 * 比较、以及 `new RoomPosition(floor(p/50), p%50, room)` 重建 —— 结果是把整支
 * 编队镜像到副对角线上（squad-movement-runtime.ts:198/256 就是重建点）。
 *
 * 现在编码只有 `domain/layout/types.packPos` 一个出口，解码只有 `unpackPos`。
 * 本文件钉两件事：
 * 1. 契约：经 packPos 写入的位置，战术 domain 解出来必须是真实几何（反对角线不镜像）；
 * 2. 约定守卫：src 内不得再出现 y-major 的打包算术（历史上正是它把 5 处写点带偏的）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { packPos, unpackPos } from "../../../src/domain/layout/types";
import {
  computeSquadAnchor,
  type SquadMemberRuntimeSnapshot,
  type SquadSnapshot,
} from "../../../src/domain/tactical/squad-formation";

const SRC = resolve(__dirname, "../../../src");
const NL = String.fromCharCode(10);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** 取一个成员位（质心运算用）。三个点故意不关于副对角线对称。 */
function member(name: string, x: number, y: number): SquadMemberRuntimeSnapshot {
  return {
    name,
    role: "attacker",
    pos: packPos(x, y),
    room: "W1N1",
    hits: 1000,
    hitsMax: 1000,
    fatigue: 0,
    alive: true,
    boosted: false,
  };
}

function snapshotOf(members: readonly SquadMemberRuntimeSnapshot[]): SquadSnapshot {
  return {
    squadId: "squad-1",
    operationId: "op-1",
    objectiveId: "obj-1",
    members,
    formation: "COLUMN",
    state: "ADVANCING",
    tick: 1000,
    targetRoom: "W1N1",
    retreatRoom: "W1N1",
    regroupPos: packPos(25, 25),
    regroupRoom: "W1N1",
  } as unknown as SquadSnapshot;
}

describe("packed-pos 契约：编码与解码同序", () => {
  it("packPos/unpackPos 往返保真（含非对称格）", () => {
    for (const [x, y] of [
      [0, 0],
      [49, 49],
      [10, 30],
      [30, 10],
      [1, 48],
    ] as const) {
      expect(unpackPos(packPos(x, y))).toEqual({ x, y });
    }
  });

  it("x 与 y 交换必须得到不同的 packed 值（防「对角线自对称」的假绿）", () => {
    // 质心/切比雪夫距离这类对称运算在 (25,25) 上镜像不变 —— 用对角线上的点
    // 写测试等于没写。这里显式钉住编码的非对称性。
    expect(packPos(10, 30)).not.toBe(packPos(30, 10));
  });

  it("战术 domain 的质心读回真实几何，而不是副对角镜像", () => {
    const anchor = computeSquadAnchor(
      snapshotOf([member("a", 10, 30), member("b", 12, 34), member("c", 14, 28)]),
    );
    expect(unpackPos(anchor.pos)).toEqual({ x: 12, y: 30 }); // 镜像会给出 { x: 30, y: 12 }
  });
});

describe("约定守卫：不允许再出现第二套打包算术", () => {
  it("src 内没有 y-major 打包（`<expr>.y * 50 + <expr>.x`）", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const lines = readFileSync(f, "utf8").split(NL);
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (/\.y\s*\*\s*50\s*\+\s*[\w.[\]]+\.x\b/.test(line)) {
          offenders.push(`${relative(SRC, f)}:${i + 1}: ${t}`);
        }
      });
    }
    expect(
      offenders,
      `发现 y-major 打包（战术 domain 一律按 x-major 解码，这类写法会把坐标镜像到副对角线）：\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });
});
