/**
 * 物流请求池纯函数层（P3 · REQUEST_POOL_DESIGN §2–§5）。
 *
 * Demand 瞬时不持久化（STATE_OWNERSHIP §1.4）：每 tick 由 logistics 系统重导出，
 * 确定性 key 幂等重建即天然去重；跨 tick 连续性由 key 注册表（firstSeen）+ 执行者
 * 租约承载。认领即 Task（六态归执行层契约）。禁全量重匹配/全局最优（红线 1）。
 *
 * A2 后半扩展：Request Scope Model（DATA_FLOW §2 Demand 语义）。
 * scope 为可选字段——缺省 = "room"，不破坏现有 key 语义与幂等合并。
 */

/**
 * 请求归属域（A2 后半·步 11：Request Scope Model）。
 *
 * - room：房内请求（现有行为——由本房 logistics 系统生成并满足）
 * - empire：帝国级请求（跨房调拨候选——由 Empire Resource Imbalance 检测产出，
 *   A2 后半只生成候选不执行运输；A3 阶段由 logistics 系统消费）
 * - operation：操作级请求（未来扩展——远矿/军事行动的物流需求）
 */
export type RequestScope = "room" | "empire" | "operation";

/** 搬运请求五字段合同化（LOGISTICS §2.1-2：资源/数量/位置/优先级/TTL）。 */
export interface TransportRequest {
  /** 确定性身份："collect:<room>:<containerId>"——重建幂等即 dedup。 */
  key: string;
  resource: "energy";
  /** 源侧可取量（供给账已扣并发占用的语义，见 supplyLedger）。 */
  amount: number;
  sourceId?: string;
  pos?: { x: number; y: number };
  priority: 0 | 1 | 2 | 3;
  /** 请求归属域（A2 后半扩展）。缺省 = "room"，不破坏现有 key 语义。 */
  scope?: RequestScope;
  /** 帝国级请求的目标房（scope="empire" 时由 Imbalance 检测填充）。 */
  targetRoom?: string;
}

/** 供给侧登记项（「此处有多少可取」）。available 由调用方按库存给出。 */
export interface SupplySource {
  id: string;
  pos: { x: number; y: number };
  available: number;
}

/** 在途租约摘要（执行者 assignment 的投影）。valid=false 表示租约已失效可回收。 */
export interface LeaseSummary {
  sourceId?: string;
  valid: boolean;
}

/**
 * 供给账（防超卖）：每个供给源扣除其活跃租约占用后的可承诺量。
 * 并发上限语义由调用方的每源上限表达（maxWorkers=1 先例）；此处输出
 * 「活跃租约数」与「剩余可开租约」，供生成器截断请求数量与金额。
 */
export function supplyLedger(
  sources: readonly SupplySource[],
  leases: readonly LeaseSummary[],
  maxConcurrentPerSource: number,
): Map<string, { activeLeases: number; remainingSlots: number; available: number }> {
  const out = new Map<string, { activeLeases: number; remainingSlots: number; available: number }>();
  for (const s of sources) {
    out.set(s.id, { activeLeases: 0, remainingSlots: maxConcurrentPerSource, available: s.available });
  }
  for (const l of leases) {
    if (!l.valid || !l.sourceId) continue;
    const e = out.get(l.sourceId);
    if (!e) continue;
    e.activeLeases++;
    e.remainingSlots = Math.max(0, maxConcurrentPerSource - e.activeLeases);
  }
  return out;
}

/** 请求池生成输入。 */
export interface BuildInputs {
  roomName: string;
  /** 含能非 controller container（controller container 是投递目标非来源）。 */
  supplies: readonly SupplySource[];
  /** 活跃 haul 租约（执行者投影）。 */
  leases: readonly LeaseSummary[];
  /** 塔饥渴信号（任一塔低于阈值区间下沿）——收集请求整体提级 P0（需求侧聚合）。 */
  towerStarving: boolean;
  /** 每源并发上限（先例 maxWorkers=1）。 */
  maxConcurrentPerSource: number;
  /** 提级前基线优先级。 */
  basePriority: 0 | 1 | 2 | 3;
  /** 塔饥渴时提级到的优先级。 */
  boostedPriority: 0 | 1 | 2 | 3;
}

/**
 * 生成本 tick 搬运请求集合（重导出＝dedup；聚合＝每源一请求）。
 * 防超卖：remainingSlots=0 的源不生成请求（并发上限封顶）。
 */
export function buildTransportRequests(input: BuildInputs): TransportRequest[] {
  const ledger = supplyLedger(input.supplies, input.leases, input.maxConcurrentPerSource);
  const priority = input.towerStarving ? input.boostedPriority : input.basePriority;
  const reqs: TransportRequest[] = [];
  for (const s of input.supplies) {
    const e = ledger.get(s.id)!;
    if (e.remainingSlots <= 0 || s.available <= 0) continue;
    reqs.push({
      key: "collect:" + input.roomName + ":" + s.id,
      resource: "energy",
      amount: s.available,
      sourceId: s.id,
      pos: s.pos,
      priority,
    });
  }
  return reqs;
}

/** key 注册表项（heap，跨 tick 记 firstSeen/认领态；reset 可丢——仅指标损失）。 */
export interface RegistryEntry {
  firstSeen: number;
  claimed: boolean;
  claimedAt?: number;
  /** 饥饿老化一次性提级标记。 */
  promotedOnce?: boolean;
}

/** 注册表对账结果。 */
export interface ReconcileResult {
  /** 本窗过期出池的 key（TTL 到期未被认领完成——回执事件用）。 */
  expiredKeys: string[];
  /** 条件消失（源空/被消费）而自然离池的 key。 */
  vanishedKeys: string[];
}

/**
 * 注册表对账：登记新 key（firstSeen）、清失联项、判过期。
 * 过期=TTL 到期且从未被认领（认领过的离池视为 fulfilled，不回执过期）。
 */
export function reconcileRegistry(
  registry: Map<string, RegistryEntry>,
  currentKeys: ReadonlySet<string>,
  tick: number,
  ttlTicks: number,
): ReconcileResult {
  const expiredKeys: string[] = [];
  const vanishedKeys: string[] = [];
  for (const [key, entry] of registry) {
    if (!currentKeys.has(key)) {
      if (!entry.claimed) {
        const age = tick - entry.firstSeen;
        if (age >= ttlTicks) expiredKeys.push(key);
        else vanishedKeys.push(key);
      }
      registry.delete(key);
    }
  }
  for (const key of currentKeys) {
    if (!registry.has(key)) registry.set(key, { firstSeen: tick, claimed: false });
  }
  return { expiredKeys, vanishedKeys };
}

/**
 * L2 池收缩（LOGISTICS §3）：风险缓冲低于地板时只保留 P0/P1 请求——
 * 低优先级搬运需求让位给生存链。当前单房需求集多为 P0/P1，本过滤为
 * 合同完整性守卫；P2/P3 运输需求入池后即成为有效降级通道。
 */
export function applyShrink(reqs: TransportRequest[], shrink: boolean): TransportRequest[] {
  if (!shrink) return reqs;
  return reqs.filter(r => r.priority <= 1);
}
/**
 * 饥饿老化（LOGISTICS §5）：age > promoteAfter 且 priority ≥ 2 → 提一级（一次性）。
 * 仅 P2/P3 适用；Recovery 档不生效（调用方在降档时不调用本函数）。
 */
export function promoteAged(
  reqs: TransportRequest[],
  registry: Map<string, RegistryEntry>,
  tick: number,
  promoteAfterTicks: number,
): void {
  for (const r of reqs) {
    if (r.priority < 2) continue;
    const e = registry.get(r.key);
    if (!e || e.promotedOnce) continue;
    if (tick - e.firstSeen > promoteAfterTicks) {
      r.priority = (r.priority - 1) as 0 | 1 | 2 | 3;
      e.promotedOnce = true;
    }
  }
}