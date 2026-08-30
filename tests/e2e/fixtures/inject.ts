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

/**
 * L1 环境注入：spawn 能量水位（FREEZE R20/T6；07-energy-crisis 前提真实化）。
 * store 与 legacy energy 双写 —— mockup 分裂脑缺陷：孵化容量检查读 legacy
 * .energy 字段（见 ScenarioRunner.syncSpawnEnergyLegacy），只写 store 不生效。
 */
export async function injectSpawnEnergy(
  runner: ScenarioRunner, room: string, energy: number,
): Promise<void> {
  const { db } = (runner as any)._server.server.common.storage;
  const spawn = await db["rooms.objects"].findOne({ room, type: "spawn" });
  if (!spawn) throw new Error(`injectSpawnEnergy: room ${room} 无 spawn`);
  const store = { ...(spawn.store ?? {}), energy };
  await db["rooms.objects"].update(
    { _id: spawn._id },
    { $set: { store, energy } },
  );
}

/**
 * L1 环境注入：夹具塔收编为 bot 现役塔 + canonical store 补能（R20/T6）。
 * 夹具结构先于 addBot 插入（bot user id 当时未知）→ 缺 user 字段，
 * FIND_MY_STRUCTURES 永远看不到它，塔防不可能开火（E2E-004 真值断言根因）。
 * 同时补 canonical store 形态——mockup 分裂脑：引擎读 store，legacy energy 不生效。
 */
export async function injectFriendlyTower(
  runner: ScenarioRunner, room: string, energy: number,
): Promise<void> {
  const { db } = (runner as any)._server.server.common.storage;
  const [bot] = await db.users.find({ username: "bot" });
  if (!bot) throw new Error("injectFriendlyTower: bot user 不存在");
  const tower = await db["rooms.objects"].findOne({ room, type: "tower" });
  if (!tower) throw new Error(`injectFriendlyTower: room ${room} 无塔`);
  await db["rooms.objects"].update(
    { _id: tower._id },
    {
      $set: {
        user: bot._id,
        store: { energy },
        storeCapacityResource: { energy: 1000 },
        hits: tower.hits ?? 3000,
        hitsMax: tower.hitsMax ?? 3000,
      },
    },
  );
}
