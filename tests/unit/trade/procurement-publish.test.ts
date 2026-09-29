/**
 * 采购需求的「生产者侧指纹」—— publishProcurementDemands 是唯一写入口，所以指纹也落在这里。
 * 立案理由：线上 `stats.trade.demandsLive=0` 同时可以是"生产者从没走到发布那一行"与
 * "发布了、但消费方每 200 拍才来看一次时条目已过期"，而这两种止步要修的是不同的模块
 * （lab-system vs 信道时效）。消费方读的是合并过滤后的表，永远区分不了这两件事。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalCache, publishProcurementDemands } from "../../../src/kernel/global-cache";
import type { ProcurementDemand } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../support/factories";

const demand = (resource: string, deadline: number): ProcurementDemand => ({
  resource,
  amount: 300,
  priority: 25,
  deadline,
  reason: "lab-reaction",
});

describe("生产者侧指纹 —— 发布这一行有没有被执行，必须单独可读", () => {
  beforeEach(() => {
    resetGlobals();
  });

  it("记录本次交出的条数与时刻", () => {
    publishProcurementDemands("W1", [demand("X", 1_250), demand("GH2O", 1_250)], 1_000);
    expect(globalCache().procurementPublished?.["W1"]).toEqual({ n: 2, at: 1_000 });
  });

  it("记的是调用方的产出，不是合并/过期过滤后的表内容", () => {
    // 先发布两条，再在条目全部过期之后只发布一条：表里最终只有 1 条，
    // 而指纹要回答的是"这次生产者交出了几条" ⇒ 必须是 1（不是历史累计，也不是表长）。
    publishProcurementDemands("W1", [demand("X", 1_010), demand("GH2O", 1_010)], 1_000);
    publishProcurementDemands("W1", [demand("U", 1_300)], 1_200);
    expect(globalCache().procurementDemands?.byRoom["W1"]).toHaveLength(1);
    expect(globalCache().procurementPublished?.["W1"]).toEqual({ n: 1, at: 1_200 });
  });

  it("交零条也要留痕：零需求本身就是一次被执行到的发布", () => {
    publishProcurementDemands("W1", [], 1_000);
    expect(globalCache().procurementPublished?.["W1"]).toEqual({ n: 0, at: 1_000 });
  });

  it("按房分开记账，别房的发布不污染本房读数", () => {
    publishProcurementDemands("W1", [demand("X", 1_250)], 1_000);
    publishProcurementDemands("W2", [demand("H", 1_250), demand("O", 1_250)], 1_010);
    expect(globalCache().procurementPublished?.["W1"]).toEqual({ n: 1, at: 1_000 });
    expect(globalCache().procurementPublished?.["W2"]).toEqual({ n: 2, at: 1_010 });
  });
});
