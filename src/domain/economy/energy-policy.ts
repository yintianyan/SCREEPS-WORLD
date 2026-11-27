import { CONFIG } from "../../config";
import { STORAGE_CAPACITY } from "../tuning/bounds";

export interface EnergyPolicy {
  crisisBuyFloor: number;
  aidRecipientFloor: number;
  aidDonorFloor: number;
  saleFloor: number;
  terminalStorageFloor: number;
  terminalEnergyTarget: number;
  terminalReserveFloor: number;
  nukerStorageFloor: number;
}

/** 战略能量闸统一按真实 storage 容量取线；无容量读数时回退引擎常量 1M。 */
export function getEnergyPolicy(storageCapacity?: number): EnergyPolicy {
  const capacity =
    typeof storageCapacity === "number" && storageCapacity > 0 ? storageCapacity : STORAGE_CAPACITY;
  const r = CONFIG.energy.policyRatios;
  return {
    crisisBuyFloor: Math.floor(capacity * r.crisisBuy),
    aidRecipientFloor: Math.floor(capacity * r.aidRecipient),
    aidDonorFloor: Math.floor(capacity * r.aidDonor),
    saleFloor: Math.floor(capacity * r.sale),
    terminalStorageFloor: Math.floor(capacity * r.terminalStorage),
    terminalEnergyTarget: Math.floor(capacity * r.terminalEnergyTarget),
    terminalReserveFloor: Math.floor(capacity * r.terminalReserve),
    nukerStorageFloor: Math.floor(capacity * r.nukerStorage),
  };
}

/** 从 storage store 安全读取容量；mock/私服缺 getCapacity 时回退 1M。 */
export function getStorageCapacity(store: unknown): number {
  const reader = store as
    { getCapacity?: (resource?: ResourceConstant) => number | null | undefined } | undefined;
  const capacity =
    typeof reader?.getCapacity === "function"
      ? reader.getCapacity("energy" as ResourceConstant)
      : undefined;
  return typeof capacity === "number" && capacity > 0 ? capacity : STORAGE_CAPACITY;
}

export function getEnergyPolicyForStorage(store: unknown): EnergyPolicy {
  return getEnergyPolicy(getStorageCapacity(store));
}
