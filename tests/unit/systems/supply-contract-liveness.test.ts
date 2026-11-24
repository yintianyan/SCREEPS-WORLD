/** Supply Contract 契约活性测试（2026-11-21 批次 3，立案 #6）。
 *
 * 病灶：maintainSupplyContracts 首行 `if (!networkSnapshot) return` —— networkSnapshot
 * 存 heap、部署即失；缺失时**整函数早退**，stale 清理路径在生产上从未执行
 * （线上合同 ca=ua=83316316 存活 100 万拍、td=0 的铁证）。
 *
 * 修复后语义：清理段无条件执行（不订阅 heap 快照，只信 Memory 生命周期字段）；
 * 仅创建/匹配段依赖快照。契约活性 = lastMatchedAt 在推进 —— 长期运行的合同要断言
 * 生命周期字段在走，不能只测纯函数的"true 时会清理"（设计原则 5）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runSpecializationPlanning } from "../../../src/systems/empire/specialization-planner";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  SUPPLY_CONTRACT_STALE_TICKS,
  deserializeContract,
  serializeContract,
  type ContractMemorySnapshot,
  type SupplyContract,
} from "../../../src/domain/economy/supply-contract";
import type { SupplyNode } from "../../../src/domain/operation/supply-node";
import type { DemandNode } from "../../../src/domain/operation/demand-node";
import type { NetworkSnapshot } from "../../../src/domain/operation/network-snapshot";
import { resetGlobals } from "../../support/factories";
import type { TickContext } from "../../../src/kernel/contracts";

// 测试夹具只构造部分引擎对象。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = (): any => globalThis as any;

const T0 = 84_000_000;

function makeCtx(tick: number): TickContext {
  return { tick, budget: { canStart: () => true }, snapshots: () => [] } as unknown as TickContext;
}

function supplyNode(room: string, resource = "energy"): SupplyNode {
  return {
    room,
    resource,
    available: 900000,
    reserved: 0,
    safety: 180000,
    transferable: 100000,
    priority: 2,
    health: 1,
    capacity: 1000000,
    timestamp: T0,
  } as SupplyNode;
}

function demandNode(room: string, remaining: number, resource = "energy"): DemandNode {
  return {
    room,
    resource,
    requested: remaining,
    priority: 2,
    deadline: T0 + 5000,
    criticality: "normal",
    fulfilled: 0,
    remaining,
    firstSeen: T0,
    timestamp: T0,
  } as DemandNode;
}

/** 造一条 active 合同瘦快照。lm 缺省不写 —— 模拟旧版 Memory（lastMatchedAt 从未被写）。 */
function contractSnapshot(
  source: string,
  target: string,
  createdAt: number,
  lm?: number,
): ContractMemorySnapshot {
  const c = {
    id: `contract:${source}:${target}:energy`,
    sourceRoom: source,
    targetRoom: target,
    resource: "energy",
    targetRate: 100,
    minimumReserve: 200000,
    priority: 2,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    activatedAt: createdAt,
    terminatedAt: undefined,
    totalDelivered: 0,
    lastInjectionTick: undefined,
    consecutiveShortfall: 0,
    degradedRateMultiplier: 0.5,
    sourceRole: undefined,
    targetRole: undefined,
    reason: "network-surplus-deficit-pair",
    ...(lm !== undefined ? { lastMatchedAt: lm } : {}),
  } as unknown as SupplyContract;
  return serializeContract(c) as ContractMemorySnapshot;
}

function seedMemory(
  contracts: ContractMemorySnapshot[],
  pbBoostDemand?: Record<
    string,
    {
      attackUnits: number;
      healUnits: number;
      until: number;
      compounds: { attack: string; heal: string };
    }
  >,
): void {
  g().Memory = {
    rooms: {},
    creep: {},
    flags: {},
    kernel: {
      ...(contracts.length > 0 ? { supplyContracts: contracts } : {}),
      ...(pbBoostDemand !== undefined ? { pbBoostDemand } : {}),
    },
  };
}

function loadLedger(): SupplyContract[] {
  const raw = g().Memory.kernel?.supplyContracts ?? [];
  return (raw as ContractMemorySnapshot[]).map(deserializeContract);
}

beforeEach(() => {
  resetGlobals();
  const g = globalCache() as { networkSnapshot?: unknown };
  delete g.networkSnapshot;
});

describe("supply contract 契约活性（批次 3 #6）", () => {
  it("活性：匹配对存在时，长期运行的合同 lastMatchedAt 随每趟 pass 推进", () => {
    seedMemory([contractSnapshot("W37S58", "W38S56", T0 - 200)]);
    globalCache().networkSnapshot = {
      supplyNodes: [supplyNode("W37S58")],
      demandNodes: [demandNode("W38S56", 20000)],
    } as unknown as NetworkSnapshot;

    runSpecializationPlanning(makeCtx(T0));
    runSpecializationPlanning(makeCtx(T0 + 100));
    runSpecializationPlanning(makeCtx(T0 + 200));

    const ledger = loadLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.lastMatchedAt).toBe(T0 + 200); // 最后一趟 pass 盖章
    expect(ledger[0]?.status).toBe("active");
  });

  it("核心回归：networkSnapshot 缺失（heap 空窗）→ stale 清理照常执行", () => {
    // 一条宽限已过（旧 Memory 形态：无 lm，按 createdAt 起算）+ 一条尚在宽限内。
    seedMemory([
      contractSnapshot("W37S58", "W38S56", T0 - SUPPLY_CONTRACT_STALE_TICKS),
      contractSnapshot("W39S55", "W38S56", T0 - 10),
    ]);
    // 刻意不设 globalCache().networkSnapshot —— 旧实现在此整函数早退、什么都不清。

    runSpecializationPlanning(makeCtx(T0));

    const ledger = loadLedger();
    expect(ledger).toHaveLength(1); // 过期者被清、年轻者存活
    expect(ledger[0]?.sourceRoom).toBe("W39S55");
  });

  it("线上僵尸合同复现：ca=ua 无 lm、存活 100 万拍 → 首趟 pass 即清", () => {
    // 复刻线上读数：ca=83316316、ua=83316316、td=0、无 li/lm。
    seedMemory([contractSnapshot("W37S58", "W38S56", 83_316_316)]);
    globalCache().networkSnapshot = {
      supplyNodes: [supplyNode("W37S58")],
      demandNodes: [], // 需求端已消失 ⇒ 无匹配、无新签发（隔离清理断言）
    } as unknown as NetworkSnapshot;

    runSpecializationPlanning(makeCtx(84_316_316));

    expect(loadLedger()).toHaveLength(0);
  });

  it("宽限窗吸收快照瞬断：单趟缺失不清年轻合同，连续超窗才清", () => {
    seedMemory([contractSnapshot("W37S58", "W38S56", T0 - 200)]);
    globalCache().networkSnapshot = {
      supplyNodes: [supplyNode("W37S58")],
      demandNodes: [demandNode("W38S56", 20000)],
    } as unknown as NetworkSnapshot;
    runSpecializationPlanning(makeCtx(T0)); // 匹配、盖章

    delete globalCache().networkSnapshot; // 部署/预算饿死 → heap 空窗
    runSpecializationPlanning(makeCtx(T0 + 100));
    expect(loadLedger()).toHaveLength(1); // 宽限内不误杀
    expect(loadLedger()[0]?.lastMatchedAt).toBe(T0); // 不推进但也没清

    runSpecializationPlanning(makeCtx(T0 + SUPPLY_CONTRACT_STALE_TICKS + 200));
    expect(loadLedger()).toHaveLength(0); // 连续超窗 → 确实无法再验证 → 清
  });

  it("pbBoostDemand 过期残留无条件清扫（快照缺失也清）", () => {
    seedMemory([contractSnapshot("W37S58", "W38S56", T0 - 200)], {
      W37S58: {
        attackUnits: 4,
        healUnits: 2,
        until: T0 - 1,
        compounds: { attack: "XGH2O", heal: "XGH2O" },
      },
      W38S56: {
        attackUnits: 4,
        healUnits: 2,
        until: T0 + 500,
        compounds: { attack: "XGH2O", heal: "XGH2O" },
      },
    });
    delete globalCache().networkSnapshot;

    runSpecializationPlanning(makeCtx(T0));

    const demand = g().Memory.kernel.pbBoostDemand;
    expect(demand.W37S58).toBeUndefined();
    expect(demand.W38S56).toBeDefined();
  });

  it("pbBoostDemand 无残留时不写 Memory（卫生段零写放大）", () => {
    seedMemory([], undefined);
    delete globalCache().networkSnapshot;
    runSpecializationPlanning(makeCtx(T0));
    expect(g().Memory.kernel.pbBoostDemand).toBeUndefined();
  });
});
