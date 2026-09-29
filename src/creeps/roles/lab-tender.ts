/**
 * Lab Tender — 化合物 `storage/terminal → lab` 的专职搬运工。
 *
 * 为什么需要一个新角色而不是给现有角色改链序（线上实证，07:48Z/08:16Z 两轮探针）：
 * 反应链的原料早已到位（terminal X=600 / GH2O=300）、需求表每拍都新鲜（loads=4），
 * 而 10 座 lab 的 `mineralType` 连续数小时全空 —— **取料相在两个现有角色上都结构性不可达**：
 *   - distributor：它的 acquire 链第 2 位 `withdrawStorageForDistribution` 的条件是
 *     "本档位有任何 fillTarget 要能量"，而 spawn/extension/tower 常态要能量 ⇒ 背包永远被
 *     孵化能量占用，排在第 7 位的 `supplyLabs` 取料相轮不到。
 *   - hauler：`supplyLabs` 只挂在 work 链，而 work 态要求"满载去投放"——空载取料进不去
 *     （这条它自己的注释就写明了："work 态必满 ⇒ 几乎触发不了"）。
 * 把化合物取料提到 distributor 的填能之前 = 让工业优先级压过孵化能量池，
 * 那是角色文件里写死的生存侧不变量（"spawn/extension 任何档位不裁剪"），不能倒挂。
 *
 * 所以补一个**只干这一件事**的角色：它不碰能量分配（生存侧不受影响），背包永远留给化合物，
 * maxCount=1、4C4M 量级（一次一趟 200 单位），成本是一个小身子 + 每拍 <0.1 CPU。
 */
import type { Priority } from "../../kernel/contracts";
import type { RolePolicy } from "../engine/action-types";
import { supplyLabs } from "../engine/actions";
import { defineRole } from "../engine/role-runner";

const policy: RolePolicy = {
  // 空载时让位 parking，不占 lab/terminal 旁的工作格。
  park: true,
  // 同一个双相候选挂两条链：空载 ⇒ withdraw（storage 优先、terminal 回退），
  // 携化合物 ⇒ deposit 到需要它的 lab，无需求方则 dump 回 storage 解堵。
  acquire: [supplyLabs()],
  work: [supplyLabs()],
};

export const labTenderRole = defineRole("labTender", 2 as Priority, policy);
