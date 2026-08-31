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

/**
 * L1 环境注入：市场订单（NPC 卖单/买单）— 验证 terminal 市场交易链路。
 *
 * 向 db['market.orders'] 插入 NPC 订单，使 Game.market.getAllOrders 在
 * screeps-server-mockup 引擎中返回真实订单数据。订单 user 字段设为
 * "npc-trader"（非 bot 用户），active=true 使驱动层缓存可见。
 *
 * price 在 DB 中以 ×1000 存储（引擎 createOrder 处理器中 price/=1000），
 * 但 getAllOrders 返回时也 /1000（driver runtime data.js）。为与 bot 代码
 * 看到的价格一致，此处直接写入引擎运行时返回的 price 值（不 ×1000）。
 *
 * 证据效力：本注入只构造市场前提（订单存在性），不修改 bot 代码执行路径。
 */
export async function injectMarketOrder(
  runner: ScenarioRunner,
  opts: {
    type: "buy" | "sell";
    resourceType: string;
    price: number;
    amount: number;
    roomName: string;
  },
): Promise<void> {
  const { db } = (runner as any)._server.server.common.storage;
  // 确认 npc-trader 用户存在（getAllOrders 不要求对方在线，但 deal 需要）
  let [npcUser] = await db.users.find({ username: "npc-trader" });
  if (!npcUser) {
    npcUser = await db.users.insert({
      username: "npc-trader",
      cpu: 100,
      cpuAvailable: 10000,
      gcl: 1,
      active: 10000,
      badge: "npc",
      money: 1000000,
    });
  }
  // 确保 NPC 房间有 terminal（deal 需要对方有 terminal）
  const npcRoom = opts.roomName;
  const existingTerminal = await db["rooms.objects"].findOne({ room: npcRoom, type: "terminal" });
  if (!existingTerminal) {
    await db["rooms.objects"].insert({
      type: "terminal",
      room: npcRoom,
      x: 20, y: 20,
      user: npcUser._id,
      store: opts.type === "sell"
        ? { energy: 100000, [opts.resourceType]: opts.amount + 10000 }
        : { energy: 100000 },
      storeCapacity: 300000,
      hits: 1,
      hitsMax: 1,
      cooldownTime: null,
    });
    const { env } = (runner as any)._server.server.common.storage;
    await env.sadd(env.keys.ACTIVE_ROOMS, npcRoom);
    await db.rooms.update({ _id: npcRoom }, { $set: { active: true } });
  } else {
    // 补货：确保 NPC terminal 有足够能量和资源
    const store = existingTerminal.store ?? {};
    store.energy = Math.max(store.energy ?? 0, 100000);
    if (opts.type === "sell") {
      store[opts.resourceType] = Math.max(store[opts.resourceType] ?? 0, opts.amount + 10000);
    }
    await db["rooms.objects"].update(
      { _id: existingTerminal._id },
      { $set: { store, user: npcUser._id } },
    );
  }

  // 插入市场订单（price 在 DB 中以引擎运行时返回值存储）
  const gameTime = await (runner as any)._server.server.world.gameTime;
  await db["market.orders"].insert({
    _id: `order-${opts.type}-${opts.resourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user: npcUser._id,
    active: true,
    type: opts.type,
    resourceType: opts.resourceType,
    price: opts.price,
    amount: 0,
    remainingAmount: opts.amount,
    roomName: opts.roomName,
    created: gameTime,
    createdTimestamp: Date.now(),
  });
}

/**
 * L1 环境注入：bot 用户 credits（市场交易前提）。
 * Game.market.deal 需要 credits >= price × amount + fee。
 */
export async function injectCredits(
  runner: ScenarioRunner, credits: number,
): Promise<void> {
  const { db } = (runner as any)._server.server.common.storage;
  await db.users.update(
    { username: "bot" },
    { $set: { money: credits } },
  );
}
