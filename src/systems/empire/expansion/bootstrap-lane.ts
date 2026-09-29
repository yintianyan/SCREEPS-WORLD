/** Expansion 自举车道 — owned 无 spawn 房间的姊妹房代孵通道（独立于扩张状态机）。 */
import { CONFIG } from "../../../config";
import type { TickContext } from "../../../kernel/contracts";
import { EventKind, recordEvent } from "../../../kernel/event-log";
import { log } from "../../../kernel/log";
import {
  decideBootstrapRooms,
  BOOTSTRAP_WORKER_BODY,
  BOOTSTRAP_DEFENDER_BODY,
} from "../../../domain/expansion/bootstrap";
import { roomLinearDistance } from "../../../domain/remote/targeting";
import { submitRequest, cancelRequestsByHome } from "../../../domain/spawn/queue";

export function runBootstrapLane(ctx: TickContext): void {
  const kernel = Memory.kernel!;
  kernel.bootstrap ??= {};

  // 防重门禁：已 COMPLETED 的 Colony 不重新进入 Bootstrap
  // 只有 owned 无 spawn 的房间才需要 Bootstrap
  const rooms: {
    room: string;
    ttd?: number;
    hostileCount: number;
    sponsor?: { room: string; capacityAvailable: number };
  }[] = [];
  const sponsorPool: { room: string; capacityAvailable: number }[] = [];
  // 纯观测：车道"看得见房却没接管"时唯一能分清是哪一道筛子的读数（不参与任何判据）。
  const diag = {
    tick: ctx.tick,
    owned: 0,
    noVision: 0,
    hasSpawn: 0,
    notMine: 0,
    pushed: 0,
    sponsor: 0,
    decisions: 0,
  };

  for (const snapshot of ctx.snapshots()) {
    diag.owned++;
    const room = Game.rooms[snapshot.roomName] as Room | undefined;
    if (!room || typeof room.find !== "function") {
      diag.noVision++;
      continue;
    }
    if (room.find(FIND_MY_SPAWNS).length > 0) {
      diag.hasSpawn++;
      delete kernel.bootstrap[snapshot.roomName];
      if (
        snapshot.rcl >= CONFIG.expansion.sponsorMinRcl &&
        Memory.rooms[snapshot.roomName]?.colonyState === "normal"
      ) {
        sponsorPool.push({
          room: snapshot.roomName,
          capacityAvailable: snapshot.energyCapacityAvailable,
        });
      }
      continue;
    }
    // ⚠️ 这里**不要**拿 `colonyState === "normal"` 当"已激活、可以放掉"的证据。
    // 走到这一行已经由上面那个分支证明：该房**没有自己的 spawn**（有的话早就 delete+continue 了）。
    // 而"没有 spawn"恰恰就是需要代孵的唯一情形 ⇒ 旧门禁对它的**意图**永远是空转，
    // 只做一件坏事：在补给通道还有用时把它关掉。
    // 线上实证（2026-09-29 第一次自主扩张 W38S56）：claim 后 148 拍 colonyState 就被置成
    // "normal"，当时 `spawns=0`、两个工地 `progress=0`、拓荒队还在隔壁房通勤，
    // 于是 `kernel.bootstrap` 被清空 ⇒ 途中任何减员都不会有替补。
    // 防重入的真正判据在第一个分支里（有自有 spawn = 能自孵 = 不再代孵）。
    if (snapshot.controller?.my !== true) {
      diag.notMine++;
      continue;
    }
    rooms.push({
      room: snapshot.roomName,
      ttd: room.controller?.ticksToDowngrade,
      hostileCount: snapshot.threatCreeps.length,
    });
  }
  if (rooms.length === 0) {
    // 纯观测（不参与任何判据）：车道"看着有房却没接管"时，唯一能分清是哪一道筛子把房
    // 掉出去的手段。堆里的 ctx.snapshots() 从 console 读不到（console 与 module code
    // 各有 globalThis），所以落 Memory。
    diag.sponsor = sponsorPool.length;
    kernel.bootstrapDiag = diag;
    return;
  }

  for (const r of rooms) {
    let best: { room: string; capacityAvailable: number } | undefined;
    let bestD = Infinity;
    for (const s of sponsorPool) {
      if (s.room === r.room) continue;
      const d = roomLinearDistance(s.room, r.room);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) r.sponsor = { room: best.room, capacityAvailable: best.capacityAvailable };
  }

  const { decisions, ledgerUpdates } = decideBootstrapRooms({
    tick: ctx.tick,
    rooms,
    ledger: kernel.bootstrap,
  });
  for (const [room, upd] of Object.entries(ledgerUpdates)) kernel.bootstrap[room] = upd;

  for (const d of decisions) {
    if (d.action === "abandon") {
      // 车道请求写在 **sponsor** 的队列里、home 指向殖民地。旧写法清的是殖民地的
      // 队列（且用 `spawnQueue = []` 整组覆盖，正好绕过 splice 守卫的判据），
      // sponsor 里那批 `bootstrap.<room>.*` 一条没清 —— 失守之后 TTL 窗口内
      // 继续孵拓荒者送往已放弃的房。
      // 改为按 home 精确撤销（domain/spawn/queue 里属主认可的出口，覆盖所有宿主房，
      // sponsor 自己的编制 home=sponsor 不受影响）。
      for (const hostMem of Object.values(Memory.rooms)) {
        if (hostMem?.spawnQueue) cancelRequestsByHome(hostMem.spawnQueue, d.room);
      }
      log.info("expansion", `[${ctx.tick}] bootstrap: abandon ${d.room} — ${d.reason}`);
      recordEvent(EventKind.ExpansionOutcome, d.room, [1, 4, 0]);
      continue;
    }
    if (d.action !== "dispatch" || !d.sponsor) continue;
    const queue = Memory.rooms[d.sponsor]?.spawnQueue;
    if (!queue) continue;
    const room = d.room;
    const hostile = rooms.find(r => r.room === room)?.hostileCount ?? 0;
    const wave = kernel.bootstrap[room]?.waves ?? 0;
    const base = `bootstrap.${room}.${wave}`;
    submitRequest(queue, {
      key: `${base}.worker`,
      role: "worker",
      home: room,
      priority: 1,
      survival: false, // 殖民地的拓荒者由 sponsor 代孵：慌的是那块新房，不是 sponsor 自己
      body: [...BOOTSTRAP_WORKER_BODY],
      memory: { role: "worker", home: room, mode: "acquire" },
      createdAt: ctx.tick,
      expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
      retries: 0,
    });
    // ⚠️ 必须**连 builder 一起代孵** —— 只派 worker 会让殖民地的建造能力归零。
    // 实测（2026-09-29 第一次自主扩张 W38S56，19:55:47）：
    //   `ROLE_TASK_KINDS` 里 **只有 builder 能领 build 任务**（worker/harvester 只有 fill），
    //   而殖民地自己没有 spawn ⇒ spawn-manager 不给它孵人 ⇒ 现有 builder 全灭
    //   （ttl 46/46/200/222）之后，spawn 工地就永久停在 ~4400/15000 ——
    //   第一次扩张正是差这一座 spawn 就能自养。
    // 也别指望"把殖民地自己的队列镜像过来"能解决：那张队列里压根没有 builder 请求
    //   （实测 hauler×2 / upgrader×3 / harvester×2，builder 0 条）。
    // body 复用 BOOTSTRAP_WORKER_BODY（3W2C）：建造既要有 WORK 出工、也要有 CARRY 带料。
    submitRequest(queue, {
      key: `${base}.builder`,
      role: "builder",
      home: room,
      priority: 1,
      survival: false,
      body: [...BOOTSTRAP_WORKER_BODY],
      memory: { role: "builder", home: room, mode: "acquire" },
      createdAt: ctx.tick,
      expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
      retries: 0,
    });
    if (hostile > 0) {
      submitRequest(queue, {
        key: `${base}.defender`,
        role: "defender",
        home: room,
        priority: 1,
        survival: false,
        body: [...BOOTSTRAP_DEFENDER_BODY],
        memory: { role: "defender", home: room, mode: "acquire" },
        createdAt: ctx.tick,
        expiresAt: ctx.tick + CONFIG.spawn.requestTtl,
        retries: 0,
      });
    }
    log.info(
      "expansion",
      `[${ctx.tick}] bootstrap: dispatch ${room} wave${wave} via ${d.sponsor} (hostile=${hostile})`,
    );
  }
  diag.pushed = rooms.length;
  diag.sponsor = sponsorPool.length;
  diag.decisions = decisions.length;
  kernel.bootstrapDiag = diag;
}
