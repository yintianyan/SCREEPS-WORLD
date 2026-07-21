/**
 * Harvester — P1 定点矿工。
 *
 * 策略声明：
 *   acquire: 从固定 source 采集（含拥挤迁移）
 *   work:    link 倒能 > container 倒能 > 建身边 container site > fillTarget > 最空 container > 建造 > 升级
 */
import type { Priority } from "../kernel/contracts";
import type { RolePolicy } from "./action-types";
import {
  buildNearbyContainerSite,
  buildNearestSite,
  dumpMineralsToNearbyContainer,
  dumpToNearbyContainer,
  dumpToNearbyLink,
  fillEmptiestContainer,
  fillTarget,
  harvestMineral,
  harvestSource,
  repairNearbyContainer,
  upgradeController,
} from "./actions";
import { defineRole } from "./role-runner";

const policy: RolePolicy = {
  acquire: [
    harvestSource(),
    // source 再生期间：如果 extractor 存在（RCL6+），采集 mineral。
    harvestMineral(),
  ],

  work: [
    // 0. 矿物优先卸载（不应占用 energy carry 空间）。
    dumpMineralsToNearbyContainer(),
    // 1. 身边 link（range<=2）— 瞬时传输到 controller/storage。
    dumpToNearbyLink(),
    // 1.5 紧急：身边 container 血量 < 80% 时先修再倒（防止 container 坍塌断链）。
    repairNearbyContainer(),
    // 2. 身边 container（range<=2）— 站桩 miner。
    dumpToNearbyContainer(),
    // 2.5 紧急恢复：身边 container 在建 site（range<=3）。
    buildNearbyContainerSite(),
    // 3. 直接送 spawn/extension/tower。
    fillTarget(),
    // 4. 全满时倒入最空 container。
    fillEmptiestContainer(),
    // 5. 帮忙建造附近 site。
    buildNearestSite(),
    // 6. 全部已满 — 升级控制器。
    upgradeController(),
  ],
};

export const harvesterRole = defineRole("harvester", 1 as Priority, policy);
