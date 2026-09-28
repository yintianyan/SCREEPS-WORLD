/**
 * 领土处置 — 把「放弃一间自有房」这条过渡走通：排空 → unclaim → 清账 → 防重占。
 *
 * 阶段判据在 domain/empire/room-release（唯一真相源），本系统只做副作用。指令来自
 * `Memory.kernel.roomRelease`（运维边界下达，或未来由殖民地失败判据自填），系统负责
 * 把它执行到底 —— 没有任何一步需要人工在场。
 *
 * 为什么先排空再 unclaim（顺序不可颠倒）：unclaim 之后该房立刻从 `ctx.snapshots()`
 * 消失，而 snapshots 是「自有房」的唯一遍历口径 —— 于是它的远矿 op 再没有人维护、
 * 它的 creep 再没有人回收、它的 site 计数再没有人清零，全部变成幽灵账本反噬剩下的房。
 * 排空期间房还在我手里，所有既有通道（recyclePass、op-lifecycle、road-planner）照常工作。
 *
 * CPU 纪律：无指令时本系统只做一次空判断即返回；全量 `Game.creeps` 遍历只在排空窗口内
 * 发生（受 drainDeadlineTicks 上界约束）。
 */
import { CONFIG } from "../../config";
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { EventKind, recordEvent } from "../../kernel/event-log";
import { log } from "../../kernel/log";
import {
  planReleaseStep,
  RELEASE_REASON,
  type RoomReleaseDirective,
} from "../../domain/empire/room-release";
import { abandonOpsForReleasedHome } from "../remote/op-lifecycle";

/** 角色名 → 稳定编码（与 event-log 的 roleCode 无关，此处只用于日志体积控制）。 */
const LABEL = "territory-manager";

export const territoryManagerSystem: System = {
  name: "territory-manager",
  priority: 1 as Priority,
  interval: CONFIG.territory.interval,
  run(ctx: TickContext): void {
    Memory.kernel ??= {};
    const kernel = Memory.kernel;

    // 事后清扫先跑：无家 creep 的冻结是「房没了」的第一后果，不该等在途指令之后。
    sweepHomelessCreeps(ctx);

    const directives = kernel.roomRelease;
    if (!directives) return;
    const roomNames = Object.keys(directives);
    if (roomNames.length === 0) {
      kernel.roomRelease = undefined;
      return;
    }

    const owned = new Set<string>();
    for (const snap of ctx.snapshots()) owned.add(snap.roomName);

    for (const room of roomNames) {
      const directive = directives[room];
      if (!directive) continue;
      // 已放弃过的房不该再挂在在途表里（重占排除项已生效，指令无活可干）。
      if (kernel.releasedRooms?.[room] !== undefined) {
        delete directives[room];
        continue;
      }

      const stillOwned = owned.has(room);
      if (stillOwned) drainRoom(room, directive, ctx.tick);

      const step = planReleaseStep({
        stillOwned,
        activeOps: countActiveOps(room),
        creepsHomedHere: countHomeCreeps(room),
        pendingRequests: Memory.rooms[room]?.spawnQueue?.length ?? 0,
        drainingFor: ctx.tick - directive.startedAt,
        unclaimAttempts: directive.unclaimAttempts ?? 0,
      });

      switch (step.action) {
        case "keep-draining":
          break;
        case "unclaim":
          issueUnclaim(room, directive, ctx.tick);
          break;
        case "abort":
          log.warn(
            LABEL,
            `[${ctx.tick}] ${LABEL}: ${room} unclaim 连续 ${
              directive.unclaimAttempts ?? 0
            } 次未成交（lastCode=${directive.lastUnclaimCode}），本次不再尝试；保留指令下轮再试`,
          );
          // 保留指令但停止喊话：把 attempts 归零，等下一次 interval 再给一轮机会。
          // 归零而不是删除 —— 删除等于承认这房还在手里是正当状态，而释放的原因从未消失。
          directive.unclaimAttempts = 0;
          break;
        case "finalize":
          finalizeRelease(room, directive, ctx.tick, step.involuntary);
          delete directives[room];
          break;
      }
    }

    pruneReleasedExclusions(ctx.tick);
  },
};

/**
 * 排空一间待放弃的房：停补员、弃远矿、把编队送进回收通道。
 * 每轮重做（幂等）—— 指令可能在任意一步之后被 global reset 打断。
 */
function drainRoom(room: string, directive: RoomReleaseDirective, tick: number): void {
  const roomMem = Memory.rooms[room];
  if (!roomMem) return;
  // releaseAt 是下游系统的「不要再为这房花钱」标记：
  // spawn-manager 见之即清空队列并跳过需求评估，construction-manager 见之即不再开 site。
  roomMem.releaseAt ??= directive.startedAt;

  const abandoned = abandonOpsForReleasedHome(room, tick);
  if (abandoned > 0) {
    log.info(LABEL, `[${tick}] ${LABEL}: ${room} 放弃远矿 op ${abandoned} 处（主房即将释放）`);
  }

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep || creep.memory.home !== room || creep.memory.recycle) continue;
    creep.memory.recycle = true;
  }
}

/** 该房名下仍未 abandoned 的远矿 op 数（planReleaseStep 的排空判据之一）。 */
function countActiveOps(room: string): number {
  const ops = Memory.rooms[room]?.remoteOps;
  if (!ops) return 0;
  let n = 0;
  for (const op of Object.values(ops)) {
    if (op.state !== "abandoned") n++;
  }
  return n;
}

/** home 指向该房的存活 creep 数 —— 含身处远矿房的（它们要靠 recyclePass 跨房归航）。 */
function countHomeCreeps(room: string): number {
  let n = 0;
  for (const name in Game.creeps) {
    if (Game.creeps[name]?.memory.home === room) n++;
  }
  return n;
}

/**
 * 喊一次 unclaim。返回码写进指令供日志与归因，判定仍由 planReleaseStep 做。
 *
 * 引擎语义（typings）：OK = 已受理，ERR_NOT_OWNER = 已经不是我们的房。两者都意味着
 * 「下一轮这房不该再出现在 snapshots 里」；若仍出现，attempts 递增，够数即 abort。
 */
function issueUnclaim(room: string, directive: RoomReleaseDirective, tick: number): void {
  const controller = Game.rooms[room]?.controller;
  directive.unclaimAttempts = (directive.unclaimAttempts ?? 0) + 1;
  if (!controller || !controller.my) {
    directive.lastUnclaimCode = ERR_NOT_OWNER;
    return;
  }
  const code = controller.unclaim();
  directive.lastUnclaimCode = code;
  log.info(
    LABEL,
    `[${tick}] ${LABEL}: unclaim ${room} → code=${code}（attempt ${directive.unclaimAttempts}）`,
  );
}

/**
 * 释放收尾：登记重占排除项，并把该房在本帝国账本里的每一处引用一次清掉。
 *
 * 为什么不等 `kernel.lostRooms` 的 20,000 tick 宽限：那条通道是为「意外失守」设计的，
 * 保守是它的美德；而这里是主动决定，账本里每个幽灵字段的代价都算得清（见 room-release
 * 文件头）。清完即这间房对帝国等同于从未拥有 —— 剩下的价值（道路、容器、link）仍在
 * 世界里，别的房可以按远矿重新捡起来，那是另一条路径的判断。
 */
function finalizeRelease(
  room: string,
  directive: RoomReleaseDirective,
  tick: number,
  involuntary: boolean,
): void {
  const kernel = Memory.kernel;
  if (!kernel) return;
  kernel.releasedRooms ??= {};
  kernel.releasedRooms[room] = tick;

  const roomMem = Memory.rooms[room];
  const opsDropped = roomMem?.remoteOps ? Object.keys(roomMem.remoteOps).length : 0;
  if (roomMem) delete Memory.rooms[room];
  const tuning = kernel.tuning;
  if (tuning?.rooms) delete tuning.rooms[room];
  if (tuning?.lastEval) delete tuning.lastEval[room];
  if (kernel.lostRooms) delete kernel.lostRooms[room];
  // 跨房调拨的两本账也按房名引用它，unclaim 后没人再清 —— 线上实证代价：释放 W37S55 后
  // 留下一只 carrier remoteTarget=W37S55，取满能却无处卸（那间房已无我方 storage），
  // 把整段寿命 idle 在源房烧掉编制；而 supplyContract 没有 deadline，会永久挂在账上被
  // logistics-planner 每轮读。二者都只按「两端有一端是这间房」判，不猜语义。
  dropCrossRoomLedgersFor(kernel, room);
  // 驻留该房的 power creep 换房：条目留着会让 power-creep-manager 指向一间已失去的房。
  if (kernel.powerCreeps?.homeAssignments) {
    for (const [pcName, assigned] of Object.entries(kernel.powerCreeps.homeAssignments)) {
      if (assigned === room) delete kernel.powerCreeps.homeAssignments[pcName];
    }
  }

  try {
    recordEvent(EventKind.RoomReleased, room, [
      directive.reason,
      involuntary ? 1 : 0,
      opsDropped,
      tick - directive.startedAt,
      directive.unclaimAttempts ?? 0,
      directive.lastUnclaimCode ?? -99,
    ]);
  } catch {
    // 观测写不进不能挡住清账 —— 日志仍然会留下这一笔。
  }
  log.info(
    LABEL,
    `[${tick}] ${LABEL}: ${room} 释放完成 reason=${
      RELEASE_LABEL[directive.reason] ?? directive.reason
    } opsDropped=${opsDropped} drainingFor=${tick - directive.startedAt}t` +
      ` unclaimAttempts=${directive.unclaimAttempts ?? 0} lastCode=${directive.lastUnclaimCode ?? "n/a"}`,
  );
}

/**
 * 摘掉指向这间房的跨房调拨账：Operation（`agendas`）与 SupplyContract 各一份，
 * 两端任一命中即算，顺带释放这些 Operation 名下的预留。
 *
 * 为什么不等各自的过期通道：Operation 的 `verifying` 确实会自己超时判失败，但
 * SupplyContract 没有 deadline —— 它会永久留在账上被 logistics-planner 每轮读，
 * 而 `releasedExclusionTicks` 只管得住「重占」，管不住账本。
 */
function dropCrossRoomLedgersFor(kernel: KernelMemory, room: string): void {
  const operations = (kernel.agendas ?? []) as Array<{
    id?: string;
    sourceRoom?: string;
    targetRoom?: string;
  }>;
  const droppedIds: string[] = [];
  for (const op of operations) {
    if (op.sourceRoom === room || op.targetRoom === room) {
      if (typeof op.id === "string") droppedIds.push(op.id);
    }
  }
  if (droppedIds.length > 0) {
    kernel.agendas = operations.filter(
      op => op.sourceRoom !== room && op.targetRoom !== room,
    ) as unknown[];
    if (kernel.reservations) {
      for (const id of droppedIds) delete kernel.reservations[id];
    }
  }

  const contracts = kernel.supplyContracts as Array<{ s?: string; t?: string }> | undefined;
  if (Array.isArray(contracts)) {
    const kept = contracts.filter(c => c.s !== room && c.t !== room);
    if (kept.length !== contracts.length) {
      kernel.supplyContracts = kept;
    }
  }
}

/**
 * 事后清扫：home 仍指向「已释放且不再属于我们」的房的 creep。
 *
 * 后果若不处理是永久性的：role-runner 见 `home && !snapshot` 直接 return —— 这些 creep
 * 既不工作也不移动也不 flee，站在原地直到自然死亡（最长 1,500 tick），期间连 recyclePass
 * 都看不到它们（回收索引按 home 归桶，home 是一间已不在 snapshots 里的房）。
 * 修法是把 home 改到它**当前所在的自有房**并打上 recycle：home 落在自有房后，那间房的
 * recyclePass 就会正常接管（同房引导至最近 spawn 回收残值）。
 *
 * 第二类同族后果是 **carrier 的 remoteTarget**：carrier 只在自有房之间调拨（acquire 在
 * home 取能、work 去 remoteTarget 卸能），目标房一旦不再是我们的，它就再没有任何可做的
 * 动作 —— 取满能、导航到那间房、找不到我方 storage、回空、再取，把整段寿命烧成编制与 CPU。
 * 线上实证：释放 W37S55 后留下一只 `carrier-W37S58-…` remoteTarget=W37S55、mode=idle。
 * 只对 carrier 收，不对其它带 remoteTarget 的角色收 —— 远矿角色的目标本来就该是无主房，
 * 且「把已放弃的房按远矿重新捡起来」是扩张路径的合法判断，不能在这里替它否决。
 */
function sweepHomelessCreeps(ctx: TickContext): void {
  const released = Memory.kernel?.releasedRooms;
  if (!released) return;
  // 清扫窗口：只在最近一次释放后的有限 tick 内扫，避免为一次性的历史事件永久付遍历成本。
  let fresh = false;
  for (const at of Object.values(released)) {
    if (ctx.tick - at < CONFIG.territory.homelessSweepTicks) {
      fresh = true;
      break;
    }
  }
  if (!fresh) return;

  const owned = new Set<string>();
  for (const snap of ctx.snapshots()) owned.add(snap.roomName);

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep) continue;
    const home = creep.memory.home;
    const homeless = home !== undefined && released[home] !== undefined && !owned.has(home);
    if (homeless) {
      if (!owned.has(creep.room.name)) continue; // 身处远矿房：留给它自己走到有主的房
      creep.memory.home = creep.room.name;
      creep.memory.recycle = true;
      continue;
    }
    // carrier 的调拨两端都必须是自有房：目标房被放弃后它再没有任何可做的动作
    // （取满能 → 导航过去 → 无我方 storage → 回空 → 重复），留着就是白烧一段编制。
    const target = creep.memory.remoteTarget;
    if (
      creep.memory.role === "carrier" &&
      target !== undefined &&
      released[target] !== undefined &&
      !owned.has(target)
    ) {
      creep.memory.recycle = true;
    }
  }
}

/** 重占排除项的生命周期：过期即放手，超容量丢最旧的。 */
function pruneReleasedExclusions(tick: number): void {
  const released = Memory.kernel?.releasedRooms;
  if (!released) return;
  const entries = Object.entries(released);
  for (const [room, at] of entries) {
    if (tick - at > CONFIG.territory.releasedExclusionTicks) delete released[room];
  }
  // 条数帽：一间房的排除项只服务于「别把它捡回来」这一个短期判断，历史久了没有信息量。
  const kept = Object.entries(released);
  if (kept.length <= CONFIG.territory.releasedRoomsCap) return;
  kept.sort((a, b) => a[1] - b[1]);
  for (const [room] of kept.slice(0, kept.length - CONFIG.territory.releasedRoomsCap)) {
    delete released[room];
  }
}

/** 归因码 → 可读名（日志用；与 RELEASE_REASON 同生命周期）。 */
const RELEASE_LABEL: Record<number, string> = {
  [RELEASE_REASON.ManualDirective]: "人工领土指令",
  [RELEASE_REASON.ColonyFailure]: "殖民地失败",
};
