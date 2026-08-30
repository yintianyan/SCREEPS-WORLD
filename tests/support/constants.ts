/**
 * 常量唯一真相源（FREEZE R20②）— 全仓测试侧唯一允许出现官方常量字面值的地方。
 *
 * 来源：@screeps/driver 的 constants 模块（官方引擎发行组件，423 键，含 FIND_* /
 * CONTROLLER_LEVELS / CONSTRUCTION_COST / BODYPART_COST / CONTROLLER_STRUCTURES /
 * SAFE_MODE_* 等）。依赖树内既有（screeps 的依赖 + screeps-server-mockup
 * peerDep ^5.1.0），已升为显式 devDependency 锁定版本；类型经 driver.d.ts 声明。
 *
 * 防漂移：tests/e2e/scenarios/27-constants-parity.test.ts（T1）将玩家可见常量
 * 子集与真实引擎运行时全局逐键比对。需要新增 driver 未覆盖的表时，必须在本文件
 * 登记并注释官方出处——禁止在 setup.ts / TestWorld / 场景文件里再出现常量字面值表。
 */
import { constants as driverConstants } from "@screeps/driver";

export const C = driverConstants;

/**
 * driver 未覆盖的官方全局常量补充表 — 本文件是唯一登记处（R20②）。
 * 新增条目必须注释官方出处。
 */
export const SUPPLEMENTAL_CONSTANTS = {
  // 官方全局 BASE_MINERALS（docs.screeps.com constants；driver constants 未导出，
  // 消费方 src/domain/industry/procurement.ts）。
  BASE_MINERALS: ["H", "O", "U", "L", "K", "Z", "X"],
} as const;

/** setup.ts 注入 globalThis 的完整官方常量集（driver 全量 + 补充表）。 */
export const GAME_GLOBAL_CONSTANTS: Record<string, any> = {
  ...C,
  ...SUPPLEMENTAL_CONSTANTS,
};
