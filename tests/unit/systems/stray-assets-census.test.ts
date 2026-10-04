/**
 * §3.4 残留资产普查（#118 的机器可读版）—— 只测归集口径。
 *
 * 立案理由：W37S55 释放后仍留着 2 只 `my===true` 的 spawn，而它不在 `Memory.rooms` ⇒
 * **凡按 `Memory.rooms`/`ctx.snapshots()` 遍历的机制都看不见它**（两发手工探针才发现）。
 * 本仪器的方向特意反过来：从"我拥有的对象"出发问房，所以它对无视野的房同样成立
 * （`Game.structures` / `Game.constructionSites` 是引擎维护的登记表，零 `find`）。
 *
 * ⚠️ 这里测的是 `tallyStrayObjects` 这个纯函数；**调用点在 `telemetry-collector.run()` 的
 * 相位相对门里**（与人口普查同拍），系统级用例不在本文件覆盖范围内 ⇒ 上线后判"有没有写者"
 * 只能看 `Memory.kernel.stats.strayAssets` 是否出现（键不见＝未部署，不等于"没有残留"）。
 */
import { describe, expect, it } from "vitest";
import { tallyStrayObjects } from "../../../src/systems/telemetry-collector";

const at = (roomName: string) => ({ pos: { roomName } });

describe("tallyStrayObjects — 「我名下、但那个房不在管控内」的归集", () => {
  const managed = new Set(["W37S58", "W38S56", "W38S58"]);

  it("管控内的房一个都不记（这是主判据：正常房不得被算成残留）", () => {
    expect(tallyStrayObjects([at("W37S58"), at("W38S56"), at("W38S58")], managed)).toEqual({});
  });

  it("管控外按房计数 —— W37S55 那两只 spawn 的形状", () => {
    expect(tallyStrayObjects([at("W37S55"), at("W37S55")], managed)).toEqual({ W37S55: 2 });
  });

  it("多个无主房分别记账，不与管控房混算", () => {
    const r = tallyStrayObjects(
      [at("W37S58"), at("W37S55"), at("W37S55"), at("W36S57"), at("W37S58")],
      managed,
    );
    expect(r).toEqual({ W37S55: 2, W36S57: 1 });
    expect("W37S58" in r).toBe(false);
  });

  it("空输入 → 空表（**干净态是正面读数**：采集器会原样落盘 structures:{}）", () => {
    expect(tallyStrayObjects([], managed)).toEqual({});
  });

  it("异常输入不得炸：无 pos / roomName 为空的条目跳过，其余照常计", () => {
    const junk: { pos?: { roomName: string } }[] = [
      {},
      { pos: undefined },
      { pos: { roomName: "" } },
      at("W37S55"),
    ];
    expect(tallyStrayObjects(junk, managed)).toEqual({ W37S55: 1 });
  });

  it("管控集为空 ⇒ 所有有我方对象的房都是残留（释放链清干净 Memory 后的极端形）", () => {
    expect(tallyStrayObjects([at("W37S58")], new Set<string>())).toEqual({ W37S58: 1 });
  });
});
