/**
 * 采购需求的「生产者侧指纹」—— publishProcurementDemands 是唯一写入口，所以指纹也落在这里。
 * 立案理由：线上 `stats.trade.demandsLive=0` 同时可以是"生产者从没走到发布那一行"与
 * "发布了、但消费方每 200 拍才来看一次时条目已过期"，而这两种止步要修的是不同的模块
 * （lab-system vs 信道时效）。消费方读的是合并过滤后的表，永远区分不了这两件事。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  globalCache,
  publishProcurementDemands,
  recordProcurementAttempt,
} from "../../../src/kernel/global-cache";
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

  // 上面那条「交零条也要留痕」在 lab-system 的真实调用路径里永远不会发生：
  // 两个调用点都包在 `if (demands.length > 0)` 里。所以 published 单独一个数
  // 分不清「没走到那块」与「走到了、算出 0 条」—— 线上一轮 1884 拍里 published=0
  // 而同窗 demandsLive=1 / buyOk=6（那些来自没被护栏包住的 recovery-execution），
  // lab 这条一步都没留下痕迹，就是撞在这两种止步共用一个读数上。
  // 注：各用例用互不相同的房名，断言与「本房此前有没有痕迹」彻底无关
  // （这两张表按房 key，历史上 resetGlobals 漏清过它们 —— 已在夹具里补上）。
  it("发布决策的足迹与发布本身分开：算出 0 条也要留痕", () => {
    recordProcurementAttempt("W10", 0, 1_000);
    expect(globalCache().procurementAttempted?.["W10"]).toEqual({ computed: 0, at: 1_000 });
    // 走到过 ≠ 发出过：护栏挡住了 publish，所以 published 一侧没有这一笔。
    expect(globalCache().procurementPublished?.["W10"]).toBeUndefined();
  });

  it("三态可辨：没走到 / 走到算出 0 条 / 走到并发出", () => {
    // ① 从没走到的房：两份指纹都不该有它的条目。
    expect(globalCache().procurementAttempted?.["W11"]).toBeUndefined();
    // ② 走到了但判定无需买 —— 只有 attempted，没有 published。
    recordProcurementAttempt("W12", 0, 1_000);
    expect(globalCache().procurementAttempted?.["W12"]).toEqual({ computed: 0, at: 1_000 });
    expect(globalCache().procurementPublished?.["W12"]).toBeUndefined();
    // ③ 走到了且发了 —— published 才出现，且条数与算出的一致。
    recordProcurementAttempt("W13", 2, 1_010);
    publishProcurementDemands("W13", [demand("X", 1_260), demand("GH2O", 1_260)], 1_010);
    expect(globalCache().procurementAttempted?.["W13"]).toEqual({ computed: 2, at: 1_010 });
    expect(globalCache().procurementPublished?.["W13"]).toEqual({ n: 2, at: 1_010 });
  });

  it("足迹按房分开，且同房被最新一次覆盖", () => {
    recordProcurementAttempt("W14", 0, 1_000);
    recordProcurementAttempt("W15", 1, 1_005);
    recordProcurementAttempt("W14", 3, 1_050);
    expect(globalCache().procurementAttempted?.["W14"]).toEqual({ computed: 3, at: 1_050 });
    expect(globalCache().procurementAttempted?.["W15"]).toEqual({ computed: 1, at: 1_005 });
  });
});
