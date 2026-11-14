/**
 * 远矿 deposit 采集的派工规划（纯函数）。
 *
 * 回答的唯一问题：**当前这些可见 deposit，该由哪间房派一只采集者去采**。
 * 不访问 Game/Memory、不发动作；系统层负责收集观测并落 spawnQueue，角色层负责执行。
 */

/** 观测到的 deposit（由系统层从 Game.rooms 的 FIND_DEPOSITS 收集）。 */
export interface DepositObservation {
  /** deposit 稳定 id。 */
  id: string;
  /** deposit 所在房。 */
  roomName: string;
  /** 剩余存在 tick（deposit 采空/到期后会消失）。 */
  ticksToDecay: number;
  /** 资源类型（mist/biomass/metal/silicon）；实时视野或 intel 快照携带。 */
  depositType?: string;
}

/** 可派工的候选 home 房。 */
export interface DepositHomeObservation {
  roomName: string;
  /** 本房 spawn 数；0 = 无法孵化。 */
  spawnCount: number;
  /**
   * 是否有 storage 或 terminal —— 采集物必须能落地才算闭环。
   * 没有落点时采集只会 drop 在 home 地面，不构成收益，不如不派工。
   */
  hasDepositSink: boolean;
  /** 殖民地状态；只有 normal 才允许开新采集线（recovery/bootstrap 先保命）。 */
  colonyState: string;
}

/** 规划输入。 */
export interface DepositPlanInput {
  deposits: readonly DepositObservation[];
  homes: readonly DepositHomeObservation[];
  /** 已有存活采集者占用的 deposit id（防重复派工）。 */
  liveDepositIds: ReadonlySet<string>;
  /** 已排队（未孵化）请求占用的 deposit id（防同一窗口重复提交）。 */
  pendingDepositIds: ReadonlySet<string>;
  /** 每间 home 同时允许的 deposit 线数（产能/CPU 上限）。 */
  maxPerHome: number;
  /**
   * home 当前已有的 deposit 线数（存活 + 排队）。
   * 只算本轮新派工不够：deposit 会随探索陆续出现，每轮各派一条会让同一房超编。
   */
  homeLoad?: Readonly<Record<string, number>>;
  /**
   * 剩余寿命绝对下限（tick）：低于此值无论多近都不派。
   * 注意引擎语义：每次 harvest 会把 decayTime 重置为 +50000
   * （DEPOSIT_DECAY_TIME），持续开采的 deposit 几乎不会自然过期 —
   * 「剩余寿命」只约束「能否在过期前到达并开工」，真正的采集预算是
   * 疲劳（cooldown = 0.001×harvested^1.2，累计值不重置）与采集者寿命。
   */
  minTicksToDecay: number;
  /**
   * 派工绝对距离上限（房）。采集者寿命 1500，往返 2×距离×travelTicksPerRoom：
   * 距离太远的条线采集窗口不足，扣孵化+通勤后接近负收益 — 距离必须显式封顶。
   */
  maxDistance: number;
  /** 跨房通勤估算（tick/房，无路平原满速口径）。 */
  travelTicksPerRoom: number;
  /** 到达时剩余寿命必须 ≥ 采集者单程通勤 + 此余量（开工 runway）。 */
  arrivalRunwayTicks: number;
  /** 两房线性距离（注入以便单测；生产用 Game.map.getRoomLinearDistance）。 */
  distance: (a: string, b: string) => number;
}

/** 一条派工决策。 */
export interface DepositAssignment {
  depositId: string;
  depositRoom: string;
  home: string;
  /** 派工携带的资源类型；系统层写入 creep memory，落仓时据此 transfer。 */
  depositType?: string;
}

/**
 * 生成派工决策。
 *
 * 规则与顺序（刻意全部确定性，便于复盘）：
 * 1) 过滤寿命不足 / 已被存活或排队采集者占用的 deposit；
 * 2) 过滤无 spawn、无落点、非 normal 的 home；
 * 3) deposit 按 id 排序，逐个选**距离最近**且未达 maxPerHome 的 home；
 *    距离平局按房名字典序 —— 避免同输入两次运行派到不同房。
 * 4) 距离/寿命门是**逐 (deposit, home) 对**判定的：距离超上限的 home 不参选，
 *    剩余寿命不足以覆盖「单程通勤 + 开工余量」的组合也跳过 —
 *    「捡不到就别送人」的采集者寿命账本（寿命 1500，highway 无续命）。
 */
export function planDepositAssignments(input: DepositPlanInput): DepositAssignment[] {
  const {
    deposits,
    homes,
    liveDepositIds,
    pendingDepositIds,
    maxPerHome,
    minTicksToDecay,
    maxDistance,
    travelTicksPerRoom,
    arrivalRunwayTicks,
    distance,
  } = input;
  if (maxPerHome <= 0 || homes.length === 0) return [];

  const usableHomes = homes.filter(
    h =>
      h.spawnCount > 0 &&
      h.hasDepositSink &&
      h.colonyState === "normal" &&
      (input.homeLoad?.[h.roomName] ?? 0) < maxPerHome,
  );
  if (usableHomes.length === 0) return [];

  const load = new Map<string, number>(usableHomes.map(h => [h.roomName, 0]));
  const assignments: DepositAssignment[] = [];
  const candidates = [...deposits]
    .filter(d => d.ticksToDecay >= minTicksToDecay)
    .filter(d => !liveDepositIds.has(d.id) && !pendingDepositIds.has(d.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const deposit of candidates) {
    let bestHome: DepositHomeObservation | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const home of usableHomes) {
      if ((load.get(home.roomName) ?? 0) >= maxPerHome) continue;
      const dist = distance(home.roomName, deposit.roomName);
      // 距离上限：寿命 1500 的采集者跨房往返是有形成本，超距条线必然负收益。
      if (dist > maxDistance) continue;
      // 到达跑道：剩余寿命须覆盖「单程通勤 + 开工余量」，否则人到deposit没了。
      // （每次 harvest 会把 decayTime 重置 +50000，抵达后的持续开采不再受寿命约束。）
      if (deposit.ticksToDecay < dist * travelTicksPerRoom + arrivalRunwayTicks) continue;
      if (
        dist < bestDistance ||
        (dist === bestDistance &&
          bestHome !== undefined &&
          home.roomName.localeCompare(bestHome.roomName) < 0)
      ) {
        bestDistance = dist;
        bestHome = home;
      }
    }
    if (!bestHome) continue;
    load.set(bestHome.roomName, (load.get(bestHome.roomName) ?? 0) + 1);
    assignments.push({
      depositId: deposit.id,
      depositRoom: deposit.roomName,
      home: bestHome.roomName,
      ...(deposit.depositType ? { depositType: deposit.depositType } : {}),
    });
  }
  return assignments;
}
