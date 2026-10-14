/**
 * #181 的悬挂绑定清洗——判定层的钉（roadmap 补329／补331）。
 *
 * ⚠️边界要说清：本文件钉的是**判定本身**。`agendaManagerSystem` 全库没有任何测试夹具，
 * 所以"调用点真的接上了"这一件不在这里覆盖——它靠 typecheck＋线上部署后的读数判效
 * （读法见 DEPLOY-RUNBOOK：新单绑定后同拍采 `carrierName` 与该只的 `ticksToLive`）。
 */
import { describe, expect, it } from "vitest";
import { pruneStaleCarrierBinding } from "../../../src/domain/operation/op-binding";
import type { OperationContext } from "../../../src/domain/operation/agenda-item";

function op(carrierName?: string): OperationContext {
  return {
    status: "running",
    createdAt: 1000,
    deliveredAmount: 0,
    carrierName,
  } as OperationContext;
}

describe("悬挂载体绑定清洗（#181）", () => {
  it("名字解析不到活体 ⇒ 摘掉，字段回到「未绑」态", () => {
    const o = op("carrier-W37S58-0-83633073-5jw");
    const live = new Set(["carrier-W37S58-0-83634673-5kv"]);
    expect(pruneStaleCarrierBinding(o, live)).toBe(true);
    expect("carrierName" in o).toBe(false);
    expect(o.carrierName).toBeUndefined();
  });

  it("线上那枚 op 的形状：绑的是死名、活载体就在册 ⇒ 清完之后兜底才有机会跑", () => {
    // 补328/329 现场：op 绑 `…-5jw`（死于 83,634,680），而 `…-5kv`（生于 83,634,673）活着。
    // 这条用例的价值在于：清洗函数**只认活体集合**，不认 deliveredAmount／carrierHasRun，
    // 所以它与 stability.hasMinimumCommitment 是两件不同的事（后者会保护这条 op 不被取消）。
    const o = op("carrier-W37S58-0-83633073-5jw");
    expect(pruneStaleCarrierBinding(o, new Set(["carrier-W37S58-0-83634673-5kv"]))).toBe(true);
    expect(o.deliveredAmount).toBe(0); // 前提：这枚 op 确实还没交付过
  });

  it("绑定有效（名字在活体集合里）⇒ 不动、返回 false", () => {
    const o = op("carrier-A");
    expect(pruneStaleCarrierBinding(o, new Set(["carrier-A"]))).toBe(false);
    expect(o.carrierName).toBe("carrier-A");
  });

  it("本来就没绑 ⇒ 直接 false（不得凭空造字段）", () => {
    const o = op(undefined);
    expect(pruneStaleCarrierBinding(o, new Set(["carrier-A"]))).toBe(false);
    // 夹具里显式写了 `carrierName: undefined` ⇒ 键是在的；这条用例真正要钉的是
    // 函数**不凭空造值**（也不把 undefined 变成一个假绑定）。
    expect(o.carrierName).toBeUndefined();
  });

  it("空活体集合 ⇒ 任何绑定都算悬挂（首趟冷启动会走这条路，由下一趟重新绑）", () => {
    const o = op("carrier-A");
    expect(pruneStaleCarrierBinding(o, new Set())).toBe(true);
    expect(o.carrierName).toBeUndefined();
  });
});
