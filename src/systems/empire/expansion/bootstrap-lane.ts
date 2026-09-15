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
import { submitRequest } from "../../../domain/spawn/queue";

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

  for (const snapshot of ctx.snapshots()) {
    const room = Game.rooms[snapshot.roomName] as Room | undefined;
    if (!room || typeof room.find !== "function") continue;
    if (room.find(FIND_MY_SPAWNS).length > 0) {
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
    // 防重门禁：colonyState 为 "normal" 的房间不进入 Bootstrap
    // — normal 意味着已通过 Economic Activation，不应重新 Bootstrap
    const colonyState = Memory.rooms[snapshot.roomName]?.colonyState;
    if (colonyState === "normal") {
      delete kernel.bootstrap[snapshot.roomName];
      continue;
    }
    if (snapshot.controller?.my !== true) continue;
    rooms.push({
      room: snapshot.roomName,
      ttd: room.controller?.ticksToDowngrade,
      hostileCount: snapshot.threatCreeps.length,
    });
  }
  if (rooms.length === 0) return;

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
      if (Memory.rooms[d.room]) Memory.rooms[d.room]!.spawnQueue = [];
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
      body: [...BOOTSTRAP_WORKER_BODY],
      memory: { role: "worker", home: room, mode: "acquire" },
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
}
