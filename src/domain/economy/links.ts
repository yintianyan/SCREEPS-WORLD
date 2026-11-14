/**
 * Link 能量传输决策（纯函数）。一个 link 每 tick 只能发起一次传输（引擎限制）；
 *
 * 引擎传输损耗：发送方扣除 amount，接收方获得 floor(amount × (1 − LINK_LOSS_RATE))，
 * 即 3% 损耗（官方文档确认）。planLinkTransfers 在计算传输量时对需求做损耗补偿：
 * 若目标缺口为 N，则实际发送量 = ceil(N / (1 − LINK_LOSS_RATE))，确保到达量 ≥ N。
 */

import { CONFIG } from "../../config";

/** 引擎传输损耗率（官方文档：3%）。 */
export const LINK_LOSS_RATE = 0.03;

/** 给定发送量，返回接收方实际到账量（向下取整，与引擎一致）。 */
export function receivedAfterLoss(amount: number): number {
  return Math.floor(amount * (1 - LINK_LOSS_RATE));
}

/** 给定目标缺口 needs，返回补偿损耗后需要发送的最小量（向上取整）。 */
export function sendForNeeds(needs: number): number {
  return Math.ceil(needs / (1 - LINK_LOSS_RATE));
}

/** Link 角色分类 — 由系统层根据 link 与 source/controller/storage 的距离判定。 */
export type LinkRole = "source" | "controller" | "storage" | "hub";

/**
 * 需求驱动的 controller link 目标水位：旧实现 RCL8 满级后仍被喂满、
 * 15/tick 白烧（W7N4 实测 storage 恒 0 主因之一），故改为受控消费者 —
 * 满级停供、降级风险保级、RCL<8 按 storage 水位分级。放 domain 是
 * link-system 与 harvester 灌能出口判定共用，避免 creeps→systems 反向依赖。
 * controller 无/非我方 → 0；storageEnergy 无 storage → 0。
 *
 * `downgradeRisk` 由调用方用 `hasControllerDowngradeRisk()` 求出后传入（本函数保持纯数据）。
 * 它原先在这里自判原始阈值，与 room-state 的迟滞带是两根钟 ⇒ 带内（10k~15k）会出现
 * "upgrader 在保级、link 却按无风险停供"的错位；判据统一到单一真相源模块。
 */
/** storage 总容量（引擎 STORAGE_CAPACITY=1M；私服/测试缺常量时回退 1M）。 */
export function gclPushCapacity(): number {
  const cap = (globalThis as { STORAGE_CAPACITY?: number }).STORAGE_CAPACITY;
  return typeof cap === "number" && cap > 0 ? cap : 1_000_000;
}

/**
 * RCL8 冲 GCL 三档带 — 容量比例迟滞的单一展开点，link 供能与 upgrader 冲刺门共用。
 * push = 富线（StartRatio）以上全速；trickle = 停冲线~富线回差带；maintain = 停冲线以下保级。
 */
export type GclPushBand = "push" | "trickle" | "maintain";

export function gclPushBand(storageEnergy: number): GclPushBand {
  const cap = gclPushCapacity();
  if (storageEnergy >= Math.round(cap * CONFIG.economy.waterlines.gclPushStartRatio)) return "push";
  if (storageEnergy >= Math.round(cap * CONFIG.economy.waterlines.gclPushStopRatio))
    return "trickle";
  return "maintain";
}

export function computeControllerLinkTarget(
  rcl: number,
  controller: { my: boolean; ticksToDowngrade: number } | undefined,
  storageEnergy: number,
  linkCapacity: number,
  downgradeRisk: boolean,
): number {
  if (!controller || !controller.my) return 0;
  const upgradeCfg = CONFIG.economy.upgrade;
  const linkCfg = CONFIG.economy.link;
  // RCL8 满级：关闭 GCL 升级时停供（降级风险时保级小水位）；
  // 开启后与 RCL<8 共用 storage 水位分级 —— RCL8 的 upgrade 计入 GCL 进度，
  // 停供等于把唯一的房间上限增长通道关死。
  if (rcl >= 8) {
    if (!upgradeCfg.gclUpgrade) {
      return downgradeRisk ? linkCfg.maintainTarget : 0;
    }
    // RCL8 冲 GCL 走容量比例富线（gclPushStart/StopRatio，50%/30% of 1M）：
    // 旧绝对刻度 10K/50K 只有总容量 1-5%，等于常年裸奔冲 GCL。三档取带收敛在
    // gclPushBand（upgrader 冲刺门同一取带），富线以上满容量、回差带涓流、停冲线以下保级。
    const band = gclPushBand(storageEnergy);
    const byStorage =
      band === "push"
        ? linkCapacity
        : band === "trickle"
          ? Math.round(linkCapacity * linkCfg.lowSupplyRatio)
          : Math.round(linkCapacity * linkCfg.maintainRatio);
    return downgradeRisk ? Math.max(byStorage, linkCfg.maintainTarget) : byStorage;
  }
  // RCL<8：按 storage 水位分级（满功率冲刺 / 半供慢升 / 枯竭保级）。
  if (storageEnergy >= CONFIG.economy.waterlines.sustainedStorage) return linkCapacity;
  if (storageEnergy >= linkCfg.lowSupplyStorage) {
    return Math.round(linkCapacity * linkCfg.lowSupplyRatio);
  }
  return Math.round(linkCapacity * linkCfg.maintainRatio);
}

/** 纯数据视图 — 不持有 Screeps 对象引用，便于测试。 */
export interface LinkInfo {
  id: string;
  energy: number;
  energyCapacity: number;
  cooldown: number;
  role: LinkRole;
}

export interface LinkTransfer {
  fromId: string;
  toId: string;
  amount: number;
}

/**
 * 规划本 tick 的 link 间能量传输。约束：每源 link 每 tick 至多参与一次传输、
 * 不超源可用能量与目标空闲容量、冷却中的 link 不能发起（引擎限制）。

 * P1-4 minTransfer：source 攒够阈值或快满才发，避免小额传输白占冷却导致
 * 源 link 装不下新能量而溢出；controller「急需」（能量低于阈值）时豁免。
 * minTransfer 默认 0（无阈值，向后兼容），生产调用由 link-system 传 CONFIG 值。
 */
export interface LinkTransferOptions {
  minTransfer?: number;
  /**
   * 需求驱动的 controller 目标水位（缺省 = 容量，向后兼容）；调用方
   * （link-system）按升级需求计算（RCL8 停供 / 保级 / RCL<8 分级）。
   */
  controllerTargetEnergy?: number;
  /**
   * source→storage 的最小目标空闲量（缺省 0 = 旧行为）。storage link 只剩 1-2 格时
   * 不发小额传输：私服 link 每 tick 一次 + 3-14 tick cooldown，用一次冷却换 1-2 单位
   * 到账是纯亏损。link-system 传 CONFIG.economy.link.storageSinkMinFree。
   */
  storageSinkMinFree?: number;
}

export function planLinkTransfers(
  links: readonly LinkInfo[],
  opts: LinkTransferOptions = {},
): LinkTransfer[] {
  const minTransfer = opts.minTransfer ?? 0;
  // 快满比例：源 link 能量达容量 90% 时即使低于阈值也发（避免下一批采集溢出）。
  const NEAR_FULL_RATIO = 0.9;
  const transfers: LinkTransfer[] = [];
  const sent = new Set<string>();

  // P0-B：按能量降序排列 source link —— 旧的固定遍历顺序会让数组里第一条永远先发，
  // 第二条长期 800 满仓（W8N3 的 (30,20) 就是这样被饿成死水的）。满的先发，先解背压。
  const sourceLinks = links
    .filter(l => l.role === "source" && l.energy > 0 && l.cooldown === 0)
    .sort((a, b) => b.energy - a.energy);
  const controllerLink = links.find(l => l.role === "controller");
  const storageLink = links.find(l => l.role === "storage");

  const controllerTarget =
    opts.controllerTargetEnergy ?? (controllerLink ? controllerLink.energyCapacity : 0);
  // controller 目标缺口（考虑传输损耗：需要发送 sendForNeeds(needs) 才能填满缺口）。
  let controllerNeeds = controllerLink ? Math.max(0, controllerTarget - controllerLink.energy) : 0;

  // controller 急需：目标>0 且能量低于 min(目标, minTransfer) → 豁免 source 阈值。
  // target=0 时永不 urgent（停供）。
  const controllerUrgent =
    controllerLink !== undefined &&
    controllerTarget > 0 &&
    controllerLink.energy < Math.min(controllerTarget, minTransfer);

  const meetsThreshold = (src: LinkInfo): boolean =>
    src.energy >= minTransfer || src.energy >= src.energyCapacity * NEAR_FULL_RATIO;

  // 跟踪 controller 本 tick 已接收量（快照 energy 不反映同 tick 前序传输）。
  let controllerReceived = 0;

  // 源 link 每 tick 只能发起一次传输（引擎限制）。当 controller 接近满
  // （缺口 < minTransfer 且非 urgent）且源 link 快满了时，跳过 controller 传输，
  // 保留传输机会给 Step 2 排空到 storage — 避免「source link 花 800 容量的
  // 传输冷却去给 controller 传 50 能量、剩余 750 溢出」的浪费。controller 的
  // 少量缺口由 Step 3（storage → controller）在 link-system 层补齐。

  // controller 是否值得 source link 传输：缺口 >= minTransfer 或 urgent。
  // 无 storage link 时不跳过：source link 能量无处排空，跳过只会溢出。
  const controllerWantsSource =
    controllerNeeds > 0 && (controllerUrgent || controllerNeeds >= minTransfer || !storageLink);

  // 1. source → controller（最高优先：站桩升级供能）
  // 损耗补偿：目标缺口 N → 发送 sendForNeeds(N)，但不超源可用量与目标空闲容量。
  for (const src of sourceLinks) {
    if (!controllerWantsSource) break;
    if (!meetsThreshold(src) && !controllerUrgent) continue;
    // 动态空闲 = 容量 - 快照能量 - 本 tick 已接收量。
    const targetFree = controllerLink
      ? controllerLink.energyCapacity - controllerLink.energy - controllerReceived
      : 0;
    const sendAmount = Math.min(src.energy, targetFree, sendForNeeds(controllerNeeds));
    if (sendAmount <= 0) continue;
    transfers.push({ fromId: src.id, toId: controllerLink!.id, amount: sendAmount });
    sent.add(src.id);
    const arrived = receivedAfterLoss(sendAmount);
    controllerNeeds -= arrived;
    controllerReceived += arrived;
  }

  // 2. storage → controller（controller 的第二供给源，先于 source 溢出回收）
  // storage link 是 controller 的备用油箱：source link 受 3–14 tick cooldown 限制时，
  // 由它把 storage 侧能量补进 controller，缩短 upgrader 的取能空窗。
  // 损耗补偿：发送 sendForNeeds(needs) 以确保到达量覆盖缺口。
  if (
    storageLink &&
    storageLink.cooldown === 0 &&
    storageLink.energy > 0 &&
    controllerLink &&
    controllerNeeds > 0
  ) {
    const targetFree = controllerLink.energyCapacity - controllerLink.energy - controllerReceived;
    const sendAmount = Math.min(storageLink.energy, targetFree, sendForNeeds(controllerNeeds));
    if (sendAmount > 0) {
      transfers.push({ fromId: storageLink.id, toId: controllerLink.id, amount: sendAmount });
    }
  }

  // 3. source → storage（溢出回收）
  // storage 回收不追求精确补偿损耗：溢出回收场景下多传少传均可，下 tick 会重新评估。
  // P0-B：目标空闲不足 minFree 时整段不发 —— 用一次 source link 的传输冷却换
  // 1-2 单位到账是纯亏损（storage link 常年 798/799 的放大器）。
  if (storageLink) {
    const minFree = opts.storageSinkMinFree ?? 0;
    let storageFree = storageLink.energyCapacity - storageLink.energy;
    if (storageFree >= minFree) {
      for (const src of sourceLinks) {
        if (sent.has(src.id) || storageFree < minFree) continue;
        if (!meetsThreshold(src)) continue;
        // 发送量不超过目标空闲容量（引擎会拒绝超容量的传输）。
        const amount = Math.min(src.energy, storageFree);
        if (amount <= 0) continue;
        transfers.push({ fromId: src.id, toId: storageLink.id, amount });
        sent.add(src.id);
        // 目标空闲按到账量扣减（到账量 ≤ 发送量）。
        storageFree -= receivedAfterLoss(amount);
      }
    }
  }

  return transfers;
}

/** 二维坐标视图 — 供 classifyLinkRole 纯几何计算，不依赖 Screeps RoomPosition。 */
export interface LinkAnchorPoint {
  x: number;
  y: number;
}

/**
 * 各 link 角色的锚定半径（Chebyshev）。
 *
 * 放置侧（task-factory 的搜索半径）与运行时分类侧（classifyLinkRole）必须读**同一个对象**：
 * 两侧一旦分叉，就会出现「建得出来但没人排空」的死 link —— 旧实现把 2 这个数字抄在
 * classifyLinkRole 默认值、CONFIG.economy.link.anchorRange、task-factory 三处
 * `searchRange=2` 与 gaps/tuning 的默认实参里，注释自陈「改动需三处同步」，
 * 而同步靠人记。
 */
export interface LinkRoleRanges {
  readonly source: number;
  readonly controller: number;
  readonly storage: number;
}

/**
 * source/controller 取 2：harvester 站 container（贴 source）上仍能 range1 够到隔一格的 link。
 * storage 取其上界 +1：link 槽位由引擎按 RCL 门控（5:2／6:3／7:4／8:6），而道路与 extension
 * 从 RCL1 就开始占地 —— 等 storage link 拿到槽位（RCL6+）时，storage 的 ≤2 邻域往往已被铺满。
 * 线上实证：W8N3 的 storage (21,15) 的 24 格邻域全是 extension/road/lab ⇒ `linkStorage:1`
 * 成了永久不可满足缺口，并把布局规划器钉在 gap-force 慢速重试上。放到 3 格即可满足
 * （(22,18)／(24,18) 空闲且不密封），代价只是 hauler 多走两格。
 */
export const DEFAULT_LINK_ROLE_RANGES: LinkRoleRanges = { source: 2, controller: 2, storage: 3 };

/** 由 CONFIG.economy.link 形状解析角色半径 —— 唯一映射点，调用方不得自行拼装。 */
export function resolveLinkRoleRanges(cfg?: {
  anchorRange?: number;
  storageAnchorRange?: number;
}): LinkRoleRanges {
  const base = cfg?.anchorRange ?? DEFAULT_LINK_ROLE_RANGES.source;
  return {
    source: base,
    controller: base,
    storage: cfg?.storageAnchorRange ?? DEFAULT_LINK_ROLE_RANGES.storage,
  };
}

/**
 * 按「最近锚获胜」分类 link 角色（纯函数）：Chebyshev 距离最近且落在**该角色自己的**半径内的
 * 锚定角色胜出；等距按 controller > storage > source 裁决（专属单例不被 source 抢占）；
 * 均不在范围内 → hub。替代旧「source 固定最高优先级 + 短路」— 旧版会把紧邻
 * controller/storage 却落在 source range≤2 的 link 误判为 source（优先级劫持），
 * 令 controller/storage link 从传输拓扑消失、升级链/排空链断裂。
 *
 * 入参兼容旧的单一数字（三角色同值）；新代码传 LinkRoleRanges。
 */
export function classifyLinkRole(
  link: LinkAnchorPoint,
  sources: readonly LinkAnchorPoint[],
  controller: LinkAnchorPoint | undefined,
  storage: LinkAnchorPoint | undefined,
  ranges: number | LinkRoleRanges = DEFAULT_LINK_ROLE_RANGES,
): LinkRole {
  const r: LinkRoleRanges =
    typeof ranges === "number" ? { source: ranges, controller: ranges, storage: ranges } : ranges;
  const cheb = (a: LinkAnchorPoint, b: LinkAnchorPoint): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  let dSource = Infinity;
  for (const s of sources) {
    const d = cheb(link, s);
    if (d < dSource) dSource = d;
  }
  const dController = controller ? cheb(link, controller) : Infinity;
  const dStorage = storage ? cheb(link, storage) : Infinity;

  // 候选：范围内的锚定角色，(距离, tie-break 优先级 pri 越大越优先)。
  const candidates: { role: LinkRole; dist: number; pri: number }[] = [];
  if (dSource <= r.source) candidates.push({ role: "source", dist: dSource, pri: 0 });
  if (dStorage <= r.storage) candidates.push({ role: "storage", dist: dStorage, pri: 1 });
  if (dController <= r.controller)
    candidates.push({ role: "controller", dist: dController, pri: 2 });
  if (candidates.length === 0) return "hub";

  candidates.sort((a, b) => a.dist - b.dist || b.pri - a.pri);
  return candidates[0]!.role;
}

/**
 * 从快照中找出 storage 角色的 link（与 `classifyLinkRole` 同一组半径）。
 *
 * 为什么必须有这个函数：storage link 的布局半径是 `storageAnchorRange=3`，
 * 而运行时消费者（hauler 排空、harvester 出口判定、hauler 编制、distributor 中转）
 * 曾各自写死 `getRangeTo(storage) <= 2` —— W8N3 的 storage link (22,18) 距
 * storage (21,15) 恰好 3 格，四处全部找不到它，于是 storage link 常年 799、
 * source link 无出口、controller link 只能靠 source 单路补给。
 * 统一到本函数后，放置侧与消费侧共用同一把尺。
 */
export function findStorageLink<T extends { pos: { x: number; y: number } }>(
  view: {
    storage?: { pos: { x: number; y: number } } | undefined;
    controller?: { pos: { x: number; y: number } } | undefined;
    sources: readonly { pos: { x: number; y: number } }[];
    links: readonly T[];
  },
  ranges: LinkRoleRanges = DEFAULT_LINK_ROLE_RANGES,
): T | undefined {
  const st = view.storage;
  if (!st) return undefined;
  const sourcePoints = view.sources.map(s => s.pos);
  return view.links.find(
    l => classifyLinkRole(l.pos, sourcePoints, view.controller?.pos, st.pos, ranges) === "storage",
  );
}
