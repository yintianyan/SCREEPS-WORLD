import { describe, expect, it } from "vitest";
import {
  contractEndpointsHaveStorage,
  deserializeContract,
  serializeContract,
  isContractActive,
  type ContractMemorySnapshot,
  type SupplyContract,
} from "../../../src/domain/economy/supply-contract";

/**
 * 线上事实（11:4x 实测）：`Memory.kernel.supplyContracts` 里有一条
 * `contract:W37S58:W38S56:energy`，`ca=83316316`、`ua=83316316`、`td=0`、连 `li`(lastInjectionTick) 都没有 ——
 * 存活 16,300 拍，一次都没被注入、一单位都没交付。
 *
 * 根因是**一张表两种形状**：写方 specialization-planner 存的是 `serializeContract` 的瘦快照（缩写键
 * `i/s/t/r/st/…`），而读方 logistics-planner 过去把那个数组**直接 cast** 成 `SupplyContract[]`。
 * 于是 `contract.status` 是 `undefined` ⇒ `isContractActive(undefined)=false` ⇒ 每条合同都被当成不存在，
 * 整个跨房供给机制静默失效（连"0 contracts"那行日志都是自洽的）。
 */
const snapshot: ContractMemorySnapshot = {
  i: "contract:W37S58:W38S56:energy",
  s: "W37S58",
  t: "W38S56",
  r: "E",
  tr: 180,
  mr: 200000,
  p: 0,
  st: "A",
  ca: 83316316,
  ua: 83316316,
  ac: 83316316,
  td: 0,
  cs: 0,
  dm: 50,
  rs: "network-surplus-deficit-pair",
} as ContractMemorySnapshot;

describe("供给合同瘦快照 ≠ 领域对象（读方必须反序列化）", () => {
  it("把瘦快照当领域对象读，status 是 undefined ⇒ 合同被当成不存在", () => {
    const misread = snapshot as unknown as SupplyContract;
    expect(misread.status).toBeUndefined();
    expect(isContractActive(misread.status)).toBe(false);
  });

  it("经 deserializeContract 才拿到 active ⇒ 这条合同会进物流规划", () => {
    const c = deserializeContract(snapshot);
    expect(c.status).toBe("active");
    expect(isContractActive(c.status)).toBe(true);
    expect(c.sourceRoom).toBe("W37S58");
    expect(c.targetRoom).toBe("W38S56");
    expect(c.id).toBe("contract:W37S58:W38S56:energy");
  });

  it("serialize→deserialize 往返保状态与端点（写读同一形状的最低契约）", () => {
    const c = deserializeContract(snapshot);
    const roundTripped = deserializeContract(serializeContract(c));
    expect(roundTripped.status).toBe(c.status);
    expect(roundTripped.sourceRoom).toBe(c.sourceRoom);
    expect(roundTripped.targetRoom).toBe(c.targetRoom);
    expect(roundTripped.resource).toBe(c.resource);
  });
});

// 反序列化一旦修对，被掩盖的第二件事就露出来：派生请求的两端 endpoint 都写死 type:"storage"，
// 而合同常常在目标还是幼房（storage 要 RCL4）时签发 —— 线上新接活的这条正是 W37S56（现 RCL3，无 storage）。
// 这道安全闸保证"接对"而不是"开始生成永远投递不到的请求"。
describe("contractEndpointsHaveStorage — 复活路径的安全闸", () => {
  it("两端都有 storage 才进规划", () => {
    const c = deserializeContract(snapshot);
    expect(contractEndpointsHaveStorage(c, room => room === "W37S58" || room === "W38S56")).toBe(
      true,
    );
  });

  it("目标还没有 storage（幼房 RCL3）⇒ 不发单，等它到 RCL4", () => {
    const c = deserializeContract(snapshot);
    expect(contractEndpointsHaveStorage(c, room => room === "W37S58")).toBe(false);
    // source 侧缺 storage 同样不发（没得可抽）
    expect(contractEndpointsHaveStorage(c, room => room === "W38S56")).toBe(false);
  });
});
