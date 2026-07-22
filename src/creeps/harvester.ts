/**
 * Harvester — P1 定点矿工。
 *
 * 策略声明：
 *   acquire: 站桩采集并同 tick 倒能（有 source container/link 时）> 通用采集（含拥挤迁移）
 *   work:    站桩采集同 tick 倒能（拦截站桩矿工，防离岗）> 矿物卸载 > link/container 倒能 > 建身边 site > fill > 最空 container > 建造 > 升级
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
  stationaryMine,
  upgradeController,
} from "./actions";
import { defineRole } from "./role-runner";

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
    // 2.5 紧急：身边 container 血量 < 80% 时先修再倒（防止 container 坍塌断链）。
    repairNearbyContainer(),
    // 3. 身边 container（range<=2）— 站桩 miner。
    dumpToNearbyContainer(),
    // 3.5 紧急恢复：身边 container 在建 site（range<=3）。
    buildNearbyContainerSite(),
    // 4. 直接送 spawn/extension/tower（早期无 container 的矿工物流回退）。
    fillTarget(),
    // 5. 全满时倒入最空 container。
    fillEmptiestContainer(),
    // 6. 帮忙建造附近 site。
    buildNearestSite(),
    // 7. 全部已满 — 升级控制器。
    upgradeController(),
  ],
};

export const harvesterRole = defineRole("harvester", 1 as Priority, policy);
