import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  commitContractLedger,
  contractEndpointsHaveStorage,
  deserializeContract,
  openContractLedger,
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
/**
 * 事务边界把「读到什么形状」收敛到单点：三方消费者原先各自断言，
 * 字段读不懂的条目会按各自默认值被解释（缺 st 读成 proposed、缺 s 永不被摘），
 * 而 planner 的整表写回会把误读的条目原样续写。事务保证三方看到同一份良构快照。
 */
describe("合同账事务 — 畸形条目在边界丢弃", () => {
  const good = {
    i: "c1",
    s: "W1N1",
    t: "W1N2",
    r: "E",
    tr: 180,
    mr: 200000,
    p: 0,
    st: "A",
    ca: 1,
    ua: 2,
    td: 0,
    cs: 0,
    dm: 50,
    rs: "x",
  };

  it("非数组 / 缺省视为空账且不计畸形", () => {
    expect(openContractLedger(undefined)).toEqual({ malformed: 0, snapshots: [] });
    expect(openContractLedger("nope")).toEqual({ malformed: 0, snapshots: [] });
  });

  it("良构条目原样保留，非对象与缺关键列被剔除并计数", () => {
    const tx = openContractLedger([
      good,
      null,
      { ...good, i: "" },
      { ...good, s: undefined },
      { ...good, tr: "180" },
      { ...good, dm: Number.NaN },
    ]);
    expect(tx.snapshots).toHaveLength(1);
    expect(tx.snapshots[0]).toBe(good);
    expect(tx.malformed).toBe(5);
  });

  it("可选列缺省合法（旧快照没有 lm/ac/tm/li/sr/tr2）", () => {
    const old = {
      i: "c2",
      s: "W1N1",
      t: "W1N2",
      r: "E",
      tr: 10,
      mr: 0,
      p: 1,
      st: "P",
      ca: 1,
      ua: 1,
      td: 0,
      cs: 0,
      dm: 100,
      rs: "",
    };
    expect(openContractLedger([old]).snapshots).toHaveLength(1);
  });

  it("提交后交回纯快照数组，空账交回空数组而非 undefined", () => {
    expect(commitContractLedger(openContractLedger([good]))).toEqual([good]);
    expect(commitContractLedger({ malformed: 3, snapshots: [] })).toEqual([]);
  });
});

/**
 * 守卫：Memory 契约不得退化为 unknown[]。退化的代价是每个读者重新长一份本地断言，
 * 读者之间按各自默认值解释同一条脏数据 —— 正是「一张表两种形状」事故的土壤。
 */
describe("守卫 — supplyContracts 在 Memory 契约中带具体类型", () => {
  it("global.d.ts 不把它声明为 unknown[]", () => {
    const src = readFileSync(resolve(__dirname, "../../../src/types/global.d.ts"), "utf8");
    expect(/supplyContracts\s*\?:\s*unknown\s*\[\]/.test(src)).toBe(false);
    expect(/supplyContracts\s*\?:\s*ContractMemorySnapshot\s*\[\]/.test(src)).toBe(true);
  });
});
