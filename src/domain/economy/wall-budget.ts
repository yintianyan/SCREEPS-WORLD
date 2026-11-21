/** 和平期修墙速率预算（2026-11-21 批次 4，立案 #5）— 纯函数，无 Game/Memory 访问。
 *
 * 病灶：fortifyActive 是**开关闸**而非预算闸 —— 开启后墙目标（RCL8 10M hits）
 * 无速率上限，修墙是三类消费里唯一没有资产收益的纯消耗，W37S58 实测灌墙
 * 6.3 e/t ≈ 全房净流 5.3 e/t（盈余被墙整口吃掉）。
 *
 * 模型：每房一个**能量累积池** —— 每拍进水 rate，上限 cap；塔与 builder 的和平期
 * wall/rampart 维修共用一个池，按实际能量口径扣账。池空则和平期修墙停（等进水），
 * 长期平均速率被钉在 rate —— 是预算闸，不是开关闸。
 *
 * 豁免：liveThreat（正在挨打）/ colonyState=defense / 帝国 war 姿态（批次 2 后 war
 * 只由玩家敌意维持，不再是 NPC 噪声）。应急维修路径（新生 rampart 急救、critical
 * repair、塔的威胁路径）本就不走本预算 —— 它们是止损，不是和平期美化。
 */

/** 每拍进水（能量）：和平期修墙的长期平均速率上限。 */
export const WALL_BUDGET_RATE = 2;

/** 池上限（能量）：闲时蓄水、忙时放量的缓冲带。 */
export const WALL_BUDGET_CAP = 10_000;

/**
 * 房预算区是否已立账：池记录**存在**（哪怕为 0）= room-state 进水写者写过至少一次
 * ⇒ 受预算闸约束；**undefined** = 从未进水 ⇒ 预算闸未启用（旧行为）。
 * 生产上 room-state 是 P0 每拍先于塔/creep 运行，本房有 snapshot 则必已立账；
 * 「undefined=闸开」只服务于测试夹具与理论上的写者缺位 —— 它与 0 的区别是
 * **预算区的存废**，不是水位：0 是"立账且耗尽"，闸关；undefined 是"无预算区"。
 */
export function isWallBudgetTracked(
  pools: Record<string, number> | undefined,
  room: string,
): boolean {
  return pools?.[room] !== undefined;
}

/** 累加池水位。elapsed=1 为常态（room-state 每拍调）；elapsed 用于节律对齐。 */
export function accrueWallBudget(pool: number | undefined, elapsedTicks: number): number {
  const next = (pool ?? 0) + WALL_BUDGET_RATE * Math.max(0, elapsedTicks);
  return Math.min(WALL_BUDGET_CAP, next);
}

/**
 * 本房此刻是否豁免预算闸（备战期 / 正在挨打）。
 * 注意**不含**受袭记忆窗（siegeMemoryTicks）——「记住挨过打」≠「正在挨打」，
 * 10K 拍的记忆窗豁免会让预算闸在大多数时间里形同虚设（repair.ts/tower-defense
 * 同族教训：W8N3 一次 invader 目击后 10,000 拍持续灌墙）。
 */
export function isWallBudgetExempt(
  liveThreat: boolean,
  colonyState: string,
  posture: string,
): boolean {
  return liveThreat || colonyState === "defense" || posture === "war";
}

/** 扣账结果：granted = 实际扣到的量（min(want, 池内水位)），pool = 扣账后水位。 */
export interface WallBudgetSpend {
  granted: number;
  pool: number;
}

/**
 * 从池扣账。调用方语义：
 *  - 整笔动作（塔一次 repair=TOWER_ENERGY_COST）：granted < want ⇒ 动作不执行、**不扣账**
 *   （池空不放空炮 —— 返回值 pool 未扣）。
 *  - 按实际量扣账（builder 修墙 landed 后）：want=实际 intent 能量，granted=min(want, pool)。
 */
export function spendWallBudget(pool: number | undefined, want: number): WallBudgetSpend {
  const available = pool ?? 0;
  const granted = Math.min(available, Math.max(0, want));
  return { granted, pool: available - granted };
}
