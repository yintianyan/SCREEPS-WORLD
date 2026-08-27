/** Scout */
import type { Priority } from "../../kernel/contracts";
import type { RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";

const policy: RolePolicy = {
  acquire: [],
  work: [],
  // recon push-through：钻进敌方过境房（如 Aguia 的 W38S58）时不 flee 回 home，
  // 继续向 remoteTarget 推进（配合 memory.avoidRooms 绕行，仅在被 hostile 包围无路可绕时硬钻）。
  // 否则一次性便宜 scout（[MOVE] 50 能量）遇袭即弃任务，recon 永不完成 → 占领链卡死。
  pushThrough: true,
};

export const scoutRole = defineRole("scout", 3 as Priority, policy);
