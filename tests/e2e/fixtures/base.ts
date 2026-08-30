/**
 * L0 环境基座 — t0 真实环境唯一标准答案（E2E_ENV_BASE_CONTRACT §1）。
 * canonical 房：spawn(300) + controller + 2 source + mineral（真实游戏新 spawn 房形态）。
 * 全仓唯一 t0 构造器；变体环境（RCL/资源/地形/敌占）一律走 inject.ts 具名注入。
 */
import { standardRoom } from "./rooms";
import type { RoomSetup } from "../framework/WorldBuilder";

/** t0 基座：canonical 新 spawn 房（无任何场景假设）。 */
export function t0Base(roomName: string): RoomSetup {
  return standardRoom(roomName, 300, 1);
}
