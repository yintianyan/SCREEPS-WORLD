/** Harvester */
import type { Priority } from "../../kernel/contracts";
import type { RolePolicy } from "../engine/action-types";
import {
  buildNearbyContainerSite,
  dumpMineralsToNearbyContainer,
  dumpToNearbyContainer,
  dumpToNearbyLink,
  fillEmptiestContainer,
  fillTarget,
  harvestMineral,
  harvestSource,
  repairNearbyContainer,
  stationaryMine,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";

const policy: RolePolicy = {
  acquire: [
    // 0. 站桩采集并同 tick 倒能（source 旁有 container/link 时）— 消除采/倒互斥的产能损失。
    stationaryMine(),
    // 1. 无 source sink（早期无 container）时的通用采集（含拥挤迁移）。
    harvestSource(),
    // source 再生期间：如果 extractor 存在（RCL6+），采集 mineral。
    harvestMineral(),
  ],

  work: [
    // 0. 站桩采集同 tick 倒能 — 拦截站桩矿工，使其永不因 container 满而落到后续离岗动作（P2-7）。
    stationaryMine(),
    // 1. 矿物优先卸载（不应占用 energy carry 空间）。
    dumpMineralsToNearbyContainer(),
    // 2. 身边 link（range<=2）— 瞬时传输到 controller/storage。
    dumpToNearbyLink(),
    // 3. 身边 container（range<=2）— 站桩 miner 倒能（经济第一优先级）。
    dumpToNearbyContainer(),
    // 3.5 紧急恢复：身边 container 在建 site（range<=3）。
    buildNearbyContainerSite(),
    // 3.6 身边 container 血量 < 80% 时修复（仅在倒能后仍有剩余能量时触发，
    //     即 container 已满无法接收更多能量 — 避免修复抢占倒能导致经济断流）。
    repairNearbyContainer(),
    // 4. 直接送 spawn/extension/tower（早期无 container 的矿工物流回退）。
    fillTarget(),
    // 5. 全满时倒入最空 container。
    fillEmptiestContainer(),
    // 无候选 → park 待命。harvester 不 fallback 建造/升级（builder/upgrader 的职责）—
    // 留在矿位等 container 有空间，stationaryMine 会拦截。
  ],
};

export const harvesterRole = defineRole("harvester", 1 as Priority, policy);
