/**
 * L1/L2 注入统一 API — 具名注入收编（E2E_ENV_BASE_CONTRACT §2）。
 * 白名单注入 = 引擎合法语义；测试后门（console/DB 直改状态）仅限构造前提，
 * 禁入被断言的执行路径。每条注入须具名登记于场景证据行。
 */
import type { ScenarioRunner } from "../framework/ScenarioRunner";

/** L1 环境注入：RCL 等级（addBot 后 DB 修正）。声明此环境非自举所得。 */
export async function injectRcl(runner: ScenarioRunner, room: string, level: number): Promise<void> {
  const { db } = (runner as any)._server.server.common.storage;
  await db["rooms.objects"].update(
    { room, type: "controller" }, { $set: { level, progress: 0, downgradeTime: null } });
}

/** L1 环境注入：GCL 等级（扩张余量门）。 */
export async function injectGcl(runner: ScenarioRunner, level: number): Promise<void> {
  await runner.setUserGcl(level);
}

/** L1 环境注入：引擎 CPU 账户（tier/ESM 驱动）。 */
export async function injectCpu(
  runner: ScenarioRunner, opts: { cpu?: number; cpuAvailable?: number },
): Promise<void> {
  await runner.setUserCpu(opts);
}

/** L2 场景注入：敌袭 creep（NPC 或具名敌对用户）。 */
export async function injectHostile(
  runner: ScenarioRunner, room: string, x: number, y: number,
  body: string[], name: string, owner = "invader",
): Promise<void> {
  await runner.worldBuilder.addHostileCreep(room, x, y, body, name, owner);
}

/** L2 场景注入：移除指定房间全部 creep（故障注入）。 */
export async function injectWipeCreeps(runner: ScenarioRunner, room: string): Promise<void> {
  await runner.removeCreeps(room);
}

/** L1 环境注入：敌对玩家占有 controller（war 目标形态）。 */
export async function injectEnemyRoom(
  runner: ScenarioRunner, room: string, username = "Enemy", level = 1,
): Promise<void> {
  await runner.addEnemyOwnedRoom(room, username, level);
}

/** L1 环境注入：bot 友方 creep（生产采集路径的视野/人口源）。 */
export async function injectFriendlyCreep(
  runner: ScenarioRunner, room: string, x: number, y: number,
  body: string[], name: string, memory: Record<string, unknown>,
): Promise<void> {
  await runner.worldBuilder.addFriendlyCreep(room, x, y, body, name, memory);
}
