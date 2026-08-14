/**
 * Mineral Miner — P2 矿物开采角色（RCL6+，需 extractor）。站 mineral 旁采集，倒入旁边
 * container，由 hauler 的 haulMineralsToStorage 接力搬到 terminal（贸易变现）或 storage（喂 lab）。
 * 补齐工业链第一环 — 此前 harvestMineral 挂在 harvester 但被 stationaryMine 无条件拦截、永不执行。
 * 为何独立角色而非复用 harvester：harvester 的 stationaryMine 只查「矿位旁有 container/link」
 * 即锚定采能量，矿物采集永远轮不到；专职矿工 policy 无此拦截。
 * body 必须含 CARRY：harvestMineral resolve 检查剩余容量>0（纯 WORK 永不触发），走「采满→倒」循环。
 * 生命周期：minCount=0 → 矿采空后 demand 不再孵化，存量矿工自然老死不补（替换门禁 3 阻止）。
 */
import type { Priority } from "../../kernel/contracts";
import type { RolePolicy } from "../engine/action-types";
import {
  harvestMineral,
  dumpMineralsToNearbyContainer,
  buildNearbyContainerSite,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";

const policy: RolePolicy = {
  // R3a：recovery 收入路径豁免 — 矿物收入不消耗能量（矿工自采、容器→terminal），
  // 是 W7 贫困陷阱的脱困路径；recovery 时保底 1 个矿工继续采。
  recoveryEligible: true,
  acquire: [
    // 0. 满载倒矿（防御纵深）— 镜像到 acquire：即便 FSM 因单 tick 抖动（extractor 冷却置 idle、
    //    container 建成延迟等）没能停在 work，满载矿工在 acquire 也能倒矿自愈（存量冻结矿工可解冻）。
    dumpMineralsToNearbyContainer(),
    // 1. 采集 mineral（有空余背包时）。extractor 5-tick 冷却 ERR_TIRED 会置 idle，
    //    updateMode 总量口径恢复分支会正确按背包内容切 work/acquire。
    harvestMineral(),
  ],

  work: [
    // 1. 满载优先倒入 mineral 旁 container（range<=2）— 矿物高价值不应滞留背包。
    dumpMineralsToNearbyContainer(),
    // 2. container 尚未建成时，用背包能量……矿工无能量，此候选仅在有 site 时
    //    命中（矿工路过时顺手拍 site，加速 container 落成）；无 site 则跳过。
    buildNearbyContainerSite(),
    // 3. 拦截站桩矿工继续采集（container 未满时同 mode 继续采，防离岗）。
    harvestMineral(),
  ],
};

export const mineralMinerRole = defineRole("mineralMiner", 2 as Priority, policy);
