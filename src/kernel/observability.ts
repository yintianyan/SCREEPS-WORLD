/** 业务动作回执：last-only 观测，不参与任何决策。 */
import { globalCache } from "./global-cache";

export interface RoleObservation {
  at: number;
  name: string;
  role: string;
  home: string;
  room: string;
  mode: string;
  load: number;
  exit: string;
  candidate?: string;
  targetId?: string;
  rc?: number;
  sinkReason?: string;
}

export interface DealObservation {
  at: number;
  room: string;
  channel: string;
  ok: boolean;
  rc: number;
  orderId: string;
  resourceType?: MarketResourceConstant;
  resourceBefore?: number;
  amount: number;
  price: number;
  counterparty: string;
  fee: number;
  creditsBefore: number;
  creditsAfter: number;
  count: number;
}

export interface LabObservation {
  at: number;
  room: string;
  kind: "boost" | "reaction";
  ok: boolean;
  rc: number;
  labIds: string[];
  target?: string;
  compound?: string;
  parts?: number;
  energyBefore: number;
  input1?: number;
  input2?: number;
  count: number;
}

export type RoadBuildLeg = "acquire" | "work" | "commute" | "unclassified";

export interface RoadBuildObservation {
  at: number;
  home: string;
  remoteTarget: string;
  room: string;
  leg: RoadBuildLeg;
  outcome: string;
  siteId?: string;
  rc?: number;
  energy: number;
  workParts: number;
  count: number;
}

export interface BusinessObservations {
  at: number;
  roles?: Record<string, RoleObservation>;
  deals?: Record<string, DealObservation>;
  labs?: Record<string, LabObservation>;
  roads?: Record<string, RoadBuildObservation>;
}

const ROLE_CAP = 64;
const DEAL_CAP = 32;
const LAB_CAP = 32;
const ROAD_CAP = 64;

function storeLast<T extends { at: number }>(
  map: Record<string, T> | undefined,
  key: string,
  value: T,
  cap: number,
): Record<string, T> {
  const target = map ?? {};
  if (target[key] === undefined && Object.keys(target).length >= cap) {
    let oldestKey: string | undefined;
    let oldestTick = Number.POSITIVE_INFINITY;
    for (const [entryKey, entry] of Object.entries(target)) {
      if (entry.at < oldestTick) {
        oldestTick = entry.at;
        oldestKey = entryKey;
      }
    }
    if (oldestKey !== undefined) delete target[oldestKey];
  }
  target[key] = value;
  return target;
}

function observations(): BusinessObservations {
  const g = globalCache();
  return (g.obs ??= { at: Game.time });
}

export function recordRoleObservation(
  creep: Creep,
  detail: Pick<RoleObservation, "exit"> &
    Partial<Pick<RoleObservation, "candidate" | "targetId" | "rc" | "sinkReason">>,
): void {
  const obs = observations();
  obs.at = Game.time;
  obs.roles = storeLast(
    obs.roles,
    creep.name,
    {
      at: Game.time,
      name: creep.name,
      role: creep.memory.role ?? "unknown",
      home: creep.memory.home ?? creep.room.name,
      room: creep.room.name,
      mode: creep.memory.mode ?? "unknown",
      load: creep.store.getUsedCapacity(),
      ...detail,
    },
    ROLE_CAP,
  );
}

export function recordDealObservation(detail: Omit<DealObservation, "at" | "count">): void {
  const obs = observations();
  obs.at = Game.time;
  const key = `${detail.room}:${detail.channel}`;
  const previous = obs.deals?.[key];
  obs.deals = storeLast(
    obs.deals,
    key,
    { ...detail, at: Game.time, count: (previous?.count ?? 0) + 1 },
    DEAL_CAP,
  );
}

export function recordLabObservation(detail: Omit<LabObservation, "at" | "count">): void {
  const obs = observations();
  obs.at = Game.time;
  const key = `${detail.room}:${detail.kind}`;
  const previous = obs.labs?.[key];
  obs.labs = storeLast(
    obs.labs,
    key,
    { ...detail, at: Game.time, count: (previous?.count ?? 0) + 1 },
    LAB_CAP,
  );
}

export function recordRoadBuildObservation(
  creep: Creep,
  detail: Omit<
    RoadBuildObservation,
    "at" | "count" | "home" | "remoteTarget" | "room" | "energy" | "workParts"
  > & { energy: number; workParts: number },
): void {
  const obs = observations();
  obs.at = Game.time;
  const home = creep.memory.home ?? creep.room.name;
  const remoteTarget = creep.memory.remoteTarget ?? "none";
  const key = `${home}>${remoteTarget}|${detail.leg}`;
  const previous = obs.roads?.[key];
  obs.roads = storeLast(
    obs.roads,
    key,
    {
      ...detail,
      home,
      remoteTarget,
      room: creep.room.name,
      at: Game.time,
      count: (previous?.count ?? 0) + 1,
    },
    ROAD_CAP,
  );
}
