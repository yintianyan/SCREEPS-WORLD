/**
 * drift 恒等式的两个方向不变量。
 *
 * 立案理由（自证）：`drift = Δtracked − flowBalance − looseDelta − Δother`，
 * 而 `other`（factory + powerSpawn，2026-09-29 起还含 lab 储能）**不在 `trackedPoolsOf` 里**。
 * ⇒ 一笔"storage → 工业池"的纯搬运会让 tracked 少 1000、other 多 1000，
 * 于是同一个 1000 被算了两次损失（drift=−2000），而它既不是收入也不是消费。
 * 工业刚被 labTender 喂起来（每窗往 lab 灌约 1000 能量）⇒ 这条从"潜在"变成"每天在响"：
 * 线上实测 `dr` 从 −2360/−1802 量级只降到 −995，而 `pl` 显示同窗 `other` 正好 +1000。
 *
 * 正确性怎么定（不是把符号翻一下了事）：
 *   纯跨池搬运 ⇒ 能量既没产生也没消失 ⇒ drift 必须 0；
 *   工业池内部把能量**消耗掉**（压缩成 commodity、boost 用掉，没有对应计数器）⇒
 *   tracked 不动而 other 下降 ⇒ drift 必须为负（这才是要报的"账实不符"）。
 * 两个不变量同时成立，只有"加 Δother"做得到 —— 见下面第二个 it 与第三个 it。
 */
import { describe, expect, it } from "vitest";
import {
  emptyLedger,
  rollupWindow,
  type EnergyPools,
} from "../../../src/domain/economy/accounting";

function pools(o: Partial<EnergyPools>): EnergyPools {
  return {
    spawnExt: 0,
    containers: 0,
    storage: 0,
    terminal: 0,
    links: 0,
    carry: 0,
    towers: 0,
    loose: 0,
    other: 0,
    ...o,
  };
}

describe("drift 恒等式：跨池搬运不该被当成账实不符", () => {
  it("storage → 工业池 纯搬运 1000 ⇒ drift = 0（能量没产生也没消失）", () => {
    const w = rollupWindow(
      0,
      50,
      emptyLedger(),
      emptyLedger(),
      pools({ storage: 5000, other: 0 }),
      pools({ storage: 4000, other: 1000 }),
    );
    expect(w.income).toBe(0);
    expect(w.consumption).toBe(0);
    expect(w.drift).toBe(0);
  });

  it("工业池 → storage 反向搬运 ⇒ 同样 drift = 0（搬运不等于消费）", () => {
    const w = rollupWindow(
      0,
      50,
      emptyLedger(),
      emptyLedger(),
      pools({ storage: 4000, other: 1000 }),
      pools({ storage: 5000, other: 0 }),
    );
    expect(w.drift).toBe(0);
  });

  it("没有工业桶时：industrial 池 → storage 的搬运与工业池烧掉在池快照上不可分（桶补上后才可分）", () => {
    // 下面这个形状（storage +1000、other −1000）在本用例里是**搬运**，drift=0 是对的。
    // 若它是"工业池烧掉 1000"，同一组池读数会得到同样的 0 —— 这正是旧局限；
    // 现在由 `industrialSpend` 计数器区分：有桶时烧掉会归零，无桶时烧掉会报 −1000。
    // 两种情形见文件前面的两个新用例。
    const w = rollupWindow(
      0,
      50,
      emptyLedger(),
      emptyLedger(),
      pools({ storage: 4000, other: 1000 }),
      pools({ storage: 5000, other: 0 }),
    );
    expect(w.drift).toBe(0);
  });

  it("工业桶补上后：factory 烧掉 600 ⇒ drift 归零（这就是 #206 要修的那条）", () => {
    const start = emptyLedger();
    const end = emptyLedger();
    end.industrialSpend = 600;
    const w = rollupWindow(
      0,
      50,
      start,
      end,
      pools({ storage: 5000, other: 600 }),
      pools({ storage: 5000, other: 0 }),
    );
    expect(w.drift).toBe(0);
  });

  it("桶缺席时同一笔消耗仍必须报负 drift（不是把符号改回去）", () => {
    const w = rollupWindow(
      0,
      50,
      emptyLedger(),
      emptyLedger(),
      pools({ storage: 5000, other: 600 }),
      pools({ storage: 5000, other: 0 }),
    );
    expect(w.drift).toBe(-600);
  });

  it("核弹发射：nuker 储能在受踪池之外 ⇒ nukeSpend 必须从解释项里减掉", () => {
    const end = emptyLedger();
    end.industrialSpend = 50_000;
    end.nukeSpend = 50_000;
    const w = rollupWindow(
      0,
      50,
      emptyLedger(),
      end,
      pools({ storage: 5000 }),
      pools({ storage: 5000 }),
    );
    // 发射前后池快照完全一致；若把整笔工业桶加回，这里会报 +50,000 的假 drift。
    expect(w.drift).toBe(0);
  });

  it("既有不变量不得被我改坏：loose 自然衰减不算账实不符", () => {
    const w = rollupWindow(
      0,
      50,
      emptyLedger(),
      emptyLedger(),
      pools({ storage: 5000, loose: 200 }),
      pools({ storage: 5000, loose: 150 }),
    );
    expect(w.looseDelta).toBe(-50);
    expect(w.drift).toBe(0);
  });

  it("真实消费（升级 300）仍要能被流平衡解释，drift 归零", () => {
    const start = emptyLedger();
    const end = emptyLedger();
    end.upgraded = 300;
    const w = rollupWindow(0, 50, start, end, pools({ storage: 5000 }), pools({ storage: 4700 }));
    expect(w.consumption).toBe(300);
    expect(w.drift).toBe(0);
  });
});
