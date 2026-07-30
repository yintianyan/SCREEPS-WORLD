/**
 * Mineral Miner — P2 矿物开采角色（RCL6+，需 extractor）。
 *
 * 职责：站到 mineral 旁用 extractor 采集矿物（如 Zynthium），倒入 mineral 旁
 * container，由 hauler 的 haulMineralsToStorage 接力搬到 terminal（贸易变现）
 * 或 storage（喂 lab 反应链）。补齐工业链第一环——此前 harvestMineral 挂在
 * harvester 但被 stationaryMine 无条件拦截、永不执行，extractor 沦为死资产。
 *
 * 为何独立角色而非复用 harvester：harvester 的 stationaryMine 只查"矿位旁有
 * container/link"即锚定采能量，矿物采集永远轮不到；专职矿工 policy 无此拦截。
 *
 * body 必须含 CARRY：harvestMineral 的 resolve 检查 creep 剩余容量>0
 * （空 CARRY 的纯 WORK body 永不触发采集），故走"采满→倒 container"循环。
 *
 * 生命周期：CONFIG.roles.mineralMiner minCount=0 → 矿采空（mineralAmount=0）
 * 后 demand 不再孵化，存量矿工自然老死不补（替换门禁 3 天然阻止）。
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
  acquire: [
    // 采集 mineral（有空余背包时）。extractor 5-tick 冷却 ERR_TIRED 会置 idle，
    // work 链的 harvestMineral 会拦截自愈（下一 tick 冷却结束继续采）。
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
