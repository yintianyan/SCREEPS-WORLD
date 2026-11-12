/**
 * 资源流契约注册表（Phase A）。
 *
 * 只做「资源 → 生命周期契约」的分类与阈值声明，不参与运行时决策。
 * 契约字段与《资源流契约表（ResourceFlowContract）》§3/§4/§9 对齐；
 * 后续阶段（出口车道、停止阀）从这里读取上限与出口顺序。
 *
 * 设计约束：
 * - 不依赖 Game/Memory；纯数据 + 纯函数。
 * - 未在 Screeps 基础矿物/化合物表中登记的资源统一按 commodity 处理，
 *   保证未来新增 commodity 也能拿到一套保守契约，而不是落到 undefined。
 */
import { REACTIONS } from "../industry/types";

/** 资源流分类 —— 同类资源共用一套契约。 */
export const FLOW_RESOURCE_CLASSES = [
  "energy",
  "battery",
  "baseMineral",
  "compound",
  "ghodium",
  "power",
  "commodity",
  "rawCommodity",
  "ops",
  "pixel",
  "credit",
] as const;

export type FlowResourceClass = (typeof FLOW_RESOURCE_CLASSES)[number];

/** 资源级别：L0 生命线；L1 生产原料；L2 中间品；L3 终端资产；L4 账户/内部。 */
export type ResourceCriticality = "L0" | "L1" | "L2" | "L3" | "L4";

/** 契约覆盖的缓冲位置。 */
export type BufferLocation =
  "storage" | "terminal" | "factory" | "lab" | "container" | "powerSpawn" | "nuker";

/** 单个位置的库存上限。 */
export interface ResourceBufferCap {
  /** 软上限：超过后优先走出口，不强制停止上游。 */
  soft?: number;
  /** 硬上限：超过后必须停止上游或强制转移。 */
  hard?: number;
}

/** 单类资源的完整生命周期契约。 */
export interface ResourceFlowContract {
  flowClass: FlowResourceClass;
  criticality: ResourceCriticality;
  /** 是否参与房间库存/流量观测；账户资源或内部资源为 false。 */
  enabled: boolean;
  /** 来源（本地生产/调入/买入/转化）。 */
  sources: readonly string[];
  /** 本地消费者。 */
  localDemand: readonly string[];
  /** 出口顺序（数组顺序即优先级）。 */
  exits: readonly string[];
  /** 各位置软/硬上限。 */
  buffers: Partial<Record<BufferLocation, ResourceBufferCap>>;
  /** 停止阀：满足时停止上游生产/买入。 */
  stopValve: string;
  /** 恢复条件。 */
  restart: string;
  /** 低于此值视为 critical。 */
  criticalWater: number;
  /** 低于此值视为 deficit。 */
  lowWater: number;
  /** 高于此值视为 surplus（可能进入 stuck 判定）。 */
  highWater: number;
  /** 硬上限：超过后必须停止上游或强制转移。 */
  hardCap: number;
  /** stuck 判定的连续 tick 阈值。 */
  stuckTicksThreshold: number;
}

/** 统一 stuck 判定窗口（约一个完整孵化/物流周期）。 */
const STUCK_TICKS_THRESHOLD = 500;

/** 各分类的水位参数（§4 确认值）。 */
const WATER = {
  energy: { criticalWater: 5000, lowWater: 50000, highWater: 100000, hardCap: 1000000 },
  battery: { criticalWater: 5000, lowWater: 5000, highWater: 100000, hardCap: 150000 },
  baseMineral: { criticalWater: 200, lowWater: 500, highWater: 10000, hardCap: 20000 },
  compound: { criticalWater: 100, lowWater: 100, highWater: 300, hardCap: 600 },
  ghodium: { criticalWater: 500, lowWater: 1000, highWater: 5000, hardCap: 5000 },
  power: { criticalWater: 0, lowWater: 100, highWater: 100, hardCap: 100 },
  commodity: { criticalWater: 0, lowWater: 0, highWater: 30000, hardCap: 50000 },
  rawCommodity: { criticalWater: 0, lowWater: 0, highWater: 10000, hardCap: 20000 },
  ops: { criticalWater: 0, lowWater: 200, highWater: 1000, hardCap: 1000 },
  pixel: { criticalWater: 0, lowWater: 0, highWater: 0, hardCap: 0 },
  credit: { criticalWater: 100, lowWater: 100, highWater: 20000, hardCap: 20000 },
} as const;

/**
 * 完整契约表。数据来源与理由见《资源流契约表》§4/§9；
 * 这里的阈值是「已确认默认值」，不是运行时现状。
 */
export const RESOURCE_CONTRACTS: Readonly<Record<FlowResourceClass, ResourceFlowContract>> = {
  energy: {
    flowClass: "energy",
    criticality: "L0",
    enabled: true,
    sources: [
      "harvest",
      "source-link",
      "remote-mining",
      "market-buy",
      "battery-decompress",
      "energy-aid",
    ],
    localDemand: [
      "spawn",
      "upgrade",
      "build-repair",
      "tower",
      "lab",
      "factory",
      "power-spawn",
      "nuker",
      "terminal-fee",
    ],
    exits: ["local-consumption", "energy-aid", "market-sell", "battery-compress", "stop-upstream"],
    buffers: {
      storage: { soft: 100000, hard: 1000000 },
      terminal: { soft: 10000 },
      factory: { soft: 3000, hard: 12500 },
      powerSpawn: { soft: 1000 },
      nuker: { soft: 300000 },
      container: { soft: 2000 },
    },
    stopValve: "storage >= 90% → 限采；无消费者且无出口 → 停止上游",
    restart: "storage 低于 lowWater，或出现新的需求 ticket",
    ...WATER.energy,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  battery: {
    flowClass: "battery",
    criticality: "L3",
    enabled: true,
    sources: ["factory-compress", "nuke-salvage"],
    localDemand: ["crisis-decompress"],
    exits: ["market-sell", "crisis-decompress", "nuke-salvage", "stop-compress"],
    buffers: {
      terminal: { soft: 50000 },
      storage: { soft: 100000 },
      factory: { soft: 200, hard: 50000 },
    },
    stopValve: "battery 总量超过 hardCap 且无卖出/援助 ticket → 停止压缩",
    restart: "battery 总量低于 lowWater，或出现新的卖出/援助 ticket",
    ...WATER.battery,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  baseMineral: {
    flowClass: "baseMineral",
    criticality: "L1",
    enabled: true,
    sources: ["extractor", "market-buy", "mineral-aid", "nuke-salvage"],
    localDemand: ["lab-reaction", "factory-bar", "factory-commodity"],
    exits: ["lab-factory-demand", "mineral-aid", "market-sell", "stop-mining"],
    buffers: {
      storage: { soft: 10000 },
      terminal: { soft: 20000 },
      factory: { soft: 5000 },
    },
    stopValve: "home mineral 总量 >=10K 且无 lab/factory/援助/卖出 ticket → 停止 mineralMiner",
    restart: "home mineral 低于 5K，或出现新的 lab/factory/援助/卖出 ticket",
    ...WATER.baseMineral,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  compound: {
    flowClass: "compound",
    criticality: "L2",
    enabled: true,
    sources: ["lab-reaction", "market-buy", "nuke-salvage"],
    localDemand: ["lab-reaction", "creep-boost", "ghodium-chain"],
    exits: ["reaction-boost", "market-sell", "nuke-salvage", "stop-reaction"],
    buffers: {
      lab: { soft: 300, hard: 3000 },
      storage: { soft: 600 },
      terminal: { soft: 30000 },
    },
    stopValve: "库存达到 stockpile 且无 boost/卖出 ticket → 停止反应",
    restart: "库存低于 lowWater，或出现新的 boost/反应 ticket",
    ...WATER.compound,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  ghodium: {
    flowClass: "ghodium",
    criticality: "L1",
    enabled: true,
    sources: ["lab-reaction", "market-buy", "nuke-salvage"],
    localDemand: ["nuker", "gh-reaction", "go-reaction"],
    exits: ["nuker-reaction", "nuke-salvage", "stop-production"],
    buffers: {
      nuker: { soft: 5000, hard: 5000 },
      storage: { soft: 1000 },
      terminal: { soft: 1000 },
    },
    stopValve: "nuker 满且无 GH/GO 反应 ticket → 停止产 G/买 G",
    restart: "nuker 低于 5000，或出现新的 GH/GO 反应 ticket",
    ...WATER.ghodium,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  power: {
    flowClass: "power",
    criticality: "L1",
    enabled: true,
    sources: ["market-buy", "power-farm"],
    localDemand: ["power-spawn", "power-creep-gpl"],
    exits: ["power-spawn", "stop-buy"],
    buffers: {
      powerSpawn: { soft: 100, hard: 100 },
      storage: { soft: 100 },
      terminal: { soft: 100 },
    },
    stopValve: "无 powerSpawn → 不买入；war 姿态 → 停止 processPower",
    restart: "powerSpawn 存在且 power 低于 100，和平姿态",
    ...WATER.power,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  commodity: {
    flowClass: "commodity",
    criticality: "L3",
    enabled: true,
    sources: ["factory-produce", "market-buy-components"],
    localDemand: ["higher-tier-recipe"],
    exits: ["market-sell", "nuke-salvage", "stop-production"],
    buffers: {
      factory: { soft: 25000, hard: 50000 },
      terminal: { soft: 30000 },
      storage: { soft: 50000 },
    },
    stopValve: "无真实买盘，或产物超过上限 → 停止生产",
    restart: "出现新的卖出 ticket 且库存低于 highWater",
    ...WATER.commodity,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  rawCommodity: {
    flowClass: "rawCommodity",
    criticality: "L1",
    enabled: true,
    sources: ["market-buy"],
    localDemand: ["commodity-recipe"],
    exits: ["commodity-recipe", "stop-buy"],
    buffers: {
      factory: { soft: 10000, hard: 50000 },
      terminal: { soft: 10000 },
    },
    stopValve: "无生产 ticket → 不买入",
    restart: "出现新的 commodity 生产 ticket",
    ...WATER.rawCommodity,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  ops: {
    flowClass: "ops",
    criticality: "L4",
    enabled: false,
    sources: ["power-creep-generate-ops"],
    localDemand: ["power-creep-powers"],
    exits: ["power-creep-operate"],
    buffers: {},
    stopValve: "无 power creep → 不产生 ops",
    restart: "power creep 存在",
    ...WATER.ops,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  pixel: {
    flowClass: "pixel",
    criticality: "L3",
    enabled: false,
    sources: ["generate-pixel"],
    localDemand: [],
    exits: ["market-sell"],
    buffers: {},
    stopValve: "CONFIG.pixel.enabled=false → 不生成",
    restart: "CONFIG.pixel.enabled=true",
    ...WATER.pixel,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
  credit: {
    flowClass: "credit",
    criticality: "L4",
    enabled: false,
    sources: ["market-sell"],
    localDemand: ["market-buy"],
    exits: ["market-buy"],
    buffers: {},
    stopValve: "credits 低于 floor → 停止买入",
    restart: "credits 高于 floor",
    ...WATER.credit,
    stuckTicksThreshold: STUCK_TICKS_THRESHOLD,
  },
};

/** 7 种可采矿的基础矿物。 */
const BASE_MINERALS: ReadonlySet<string> = new Set(["H", "O", "U", "L", "K", "Z", "X"]);

/** 只能通过市场获得的 raw commodity（引擎 COMMODITIES 无配方）。 */
const RAW_COMMODITIES: ReadonlySet<string> = new Set(["silicon", "metal", "biomass", "mist"]);

/**
 * 资源 → 契约分类。
 *
 * 判定顺序：
 * 1. 特殊资源（energy/battery/power/ops/pixel/credit/G）；
 * 2. 基础矿物；
 * 3. 只能市场买的 raw commodity；
 * 4. 反应表内的化合物（OH/ZK/UL/GH/GO/T1-T3）；
 * 5. 其余按 commodity 兜底（bar/T1-T5/未来扩展）。
 */
export function classifyFlowResource(resource: string): FlowResourceClass {
  if (resource === "energy") return "energy";
  if (resource === "battery") return "battery";
  if (resource === "power") return "power";
  if (resource === "ops") return "ops";
  if (resource === "pixel") return "pixel";
  if (resource === "credit" || resource === "credits") return "credit";
  if (resource === "G") return "ghodium";
  if (BASE_MINERALS.has(resource)) return "baseMineral";
  if (RAW_COMMODITIES.has(resource)) return "rawCommodity";
  if (REACTIONS[resource] !== undefined) return "compound";
  return "commodity";
}

/** 取资源对应的契约。未知资源按 commodity 兜底（见 classifyFlowResource）。 */
export function getResourceContract(resource: string): ResourceFlowContract {
  return RESOURCE_CONTRACTS[classifyFlowResource(resource)];
}

/** 取资源在指定位置的软/硬上限；未登记的位置返回 undefined。 */
export function getResourceBufferCap(
  resource: string,
  location: BufferLocation,
): ResourceBufferCap | undefined {
  return getResourceContract(resource).buffers[location];
}
