/**
 * E2E-029 CPU 定标基线 — 真实引擎下的 CPU 消耗画像与引擎 API 单位成本测量。
 *
 * 目的不是断言行为，而是把「优化了什么、省了多少」变成可复现的数字。两个通道：
 *   1. 沙箱内 console 探针读取 kernel 每 tick 已经采集、随即丢弃的
 *      global.telemetry（systemCpu / roleCpu）——不新增任何生产侧测量开销。
 *   2. 一次性单位成本探针直接测量 find / PathFinder / CostMatrix / Memory 读写 /
 *      Game.cpu.getUsed 的真实单价，用于给静态审计的热点排序定权。
 *
 * 探针输出走 `key=value` 线格式而非 JSON —— console 通道会把双引号转义成
 * &#x22;，JSON.parse 必然失败。
 *
 * 产物写入 tmp/cpu-baseline.json（已 gitignore）；各优化阶段前后各跑一次做 diff。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { C } from "../../support/constants";
import { isJsError } from "../../support/errors";
import {
  buildProbe,
  collectProbes,
  toProbeSample,
  unescapeLog,
  percentile,
  sumNumbers,
  aggregate,
  type ProbeSample,
  type IntentTally,
} from "../framework/CpuProbe";

const HOME = "W0N1";

/** 暖机 tick 数：把人口/建筑推到稳态，避免测到 bootstrap 期的临时成本。 */
const WARMUP = Number(process.env.CPU_BASE_WARMUP ?? 1200);
/** 计窗口：每 tick 一条探针样本。 */
const MEASURED = Number(process.env.CPU_BASE_WINDOW ?? 150);

interface UnitCost {
  op: string;
  times: number;
  perCall: number;
}

/**
 * 错误码数值 → 名称，取自 @screeps/driver 的官方常量表（与引擎同源，不手抄数值）。
 */
const ERR_NAMES: Record<number, string> = (() => {
  const map: Record<number, string> = { 0: "OK" };
  for (const [key, val] of Object.entries(C as Record<string, unknown>)) {
    if ((key.startsWith("ERR_") || key === "OK") && typeof val === "number") map[val] = key;
  }
  return map;
})();

/** 单位成本探针：每个被测操作的计时窗口只包住该操作本身。
 * getUsed() 是回溯性的，故以 EMPTY_LOOP 作为空循环+测量开销基线，报告侧扣除。 */
const UNIT_COST = `(function(){
  var out = [];
  function meter(name, times, fn){
    var a = Game.cpu.getUsed();
    for (var i = 0; i < times; i++) fn(i);
    var b = Game.cpu.getUsed();
    out.push(name + ':' + times + ':' + ((b - a) / times));
  }
  function safe(name, times, fn){ try { meter(name, times, fn); } catch (e) { out.push(name + ':0:0'); } }
  // 单次执行、按逻辑次数归一 —— move 签发必须每个 creep 只调一次（同 creep 再调走
  // 意图覆盖的廉价路径），无法用 times 循环，故单独一次跑完再除。
  function once(name, logicalN, fn){
    var a = Game.cpu.getUsed();
    fn();
    var b = Game.cpu.getUsed();
    out.push(name + ':' + logicalN + ':' + ((b - a) / logicalN));
  }
  var room = Game.rooms['${HOME}'];
  meter('EMPTY_LOOP', 200, function(){});
  meter('cpu_getUsed', 200, function(){ Game.cpu.getUsed(); });
  meter('cpu_bucket_read', 200, function(){ return Game.cpu.bucket; });
  meter('rawMemory_get_length', 20, function(){ RawMemory.get().length; });
  safe('rawMemory_jsonParse', 3, function(){ JSON.parse(RawMemory.get()); });
  if (room) {
    var sp = room.find(FIND_MY_SPAWNS);
    var from = sp.length ? sp[0].pos : room.controller.pos;
    var to = room.controller.pos;
    var terr = room.getTerrain();
    meter('room_getTerrain', 100, function(){ return room.getTerrain(); });
    meter('terrain_get', 200, function(){ return terr.get(25, 25); });
    meter('map_set_60', 100, function(){
      var m = new Map();
      for (var j = 0; j < 60; j++) m.set(j, 'n' + j);
      return m.get(30);
    });
    meter('set_add_has_60', 100, function(){
      var s = new Set();
      for (var j = 0; j < 60; j++) s.add(j);
      return s.has(30);
    });
    meter('find_STRUCTURES', 20, function(){ room.find(FIND_STRUCTURES); });
    meter('find_MY_STRUCTURES', 20, function(){ room.find(FIND_MY_STRUCTURES); });
    meter('find_CREEPS', 20, function(){ room.find(FIND_CREEPS); });
    meter('find_MY_CREEPS', 20, function(){ room.find(FIND_MY_CREEPS); });
    meter('find_HOSTILE_CREEPS', 20, function(){ room.find(FIND_HOSTILE_CREEPS); });
    meter('find_CONSTRUCTION_SITES', 20, function(){ room.find(FIND_CONSTRUCTION_SITES); });
    meter('find_SOURCES', 20, function(){ room.find(FIND_SOURCES); });
    meter('find_MINERALS', 20, function(){ room.find(FIND_MINERALS); });
    meter('find_DROPPED_RESOURCES', 20, function(){ room.find(FIND_DROPPED_RESOURCES); });
    meter('find_TOMBSTONES', 20, function(){ room.find(FIND_TOMBSTONES); });
    meter('lookForAt_single', 200, function(){ room.lookForAt(LOOK_CREEPS, 25, 25); });
    safe('lookForAtArea_5x5', 20, function(){ room.lookForAtArea(LOOK_CREEPS, 20, 20, 24, 24, true); });
    meter('costMatrix_new', 100, function(){ return new PathFinder.CostMatrix(); });
    meter('costMatrix_new_set100', 20, function(){
      var m = new PathFinder.CostMatrix();
      for (var j = 0; j < 100; j++) m.set(j % 50, (j / 50) | 0, 1);
      return m;
    });
    safe('pathFinder_search', 10, function(){
      PathFinder.search(to, { pos: from, range: 1 }, { maxRooms: 1 });
    });
  }
  // 纯 JS 侧分配：creep 层候选重算的成本形态（filter/map/sort 链）。
  var seed = [];
  for (var q = 0; q < 60; q++) seed.push({ id: q, energy: q * 3, ticks: q });
  meter('js_filter60', 100, function(){ return seed.filter(function(x){ return x.energy > 20; }); });
  meter('js_filter_map_sort60', 100, function(){
    return seed.filter(function(x){ return x.energy > 20; })
      .map(function(x){ return { id: x.id, w: x.energy / x.ticks }; })
      .sort(function(a, b){ return a.w - b.w; });
  });
  meter('js_objectLiteral_alloc', 200, function(){ return { a: 1, b: 2, c: 3, d: 4, e: 5 }; });
  var names = Object.keys(Game.creeps);
  if (names.length) {
    var c = Game.creeps[names[names.length - 1]];
    meter('creep_pos_getRangeTo', 200, function(){ return c.pos.getRangeTo(10, 10); });
    meter('creep_getDirectionTo', 200, function(){ return c.pos.getDirectionTo(10, 10); });
    // move 是签发意图的原语；traffic-manager 的成本假设全部压在它身上，必须单独定价。
    var dirs = [1, 2, 3, 4, 5, 6, 7, 8];
    meter('creep_move', 200, function(i){ return c.move(dirs[i % 8]); });
    meter('creep_store_usedCap', 200, function(){ return c.store.getUsedCapacity(RESOURCE_ENERGY); });
    meter('creep_memory_read', 200, function(){ return c.memory.home; });
    meter('creep_memory_write_same', 200, function(){ c.memory.__b = 42; });
    var n = 0;
    meter('creep_memory_write_changing', 200, function(){ c.memory.__b = ++n; });
    delete c.memory.__b;
  }
  // move 签发单价：A 只碰 creep 对象（对照），B 每个 creep 首次签发，C 对同一批
  // creep 再签一次（此时意图必已存在 → 走覆盖廉价路径）。
  // 原 creep_move 用 200 次循环打在同一 creep 上，等价于 C，故 B 与 C 的差才是真实
  // 「首次签发」成本，而 C 用来复核旧测量到底测在哪条路径上。
  var cns = Object.keys(Game.creeps);
  var kk = Math.min(cns.length, 8);
  if (kk >= 4) {
    var dd = 1 + (Game.time % 8);
    once('move_A_accessOnly', kk, function(){
      for (var j = 0; j < kk; j++) { Game.creeps[cns[j]].pos.getDirectionTo(25, 25); }
    });
    once('move_B_firstIssue', kk, function(){
      for (var j = 0; j < kk; j++) { Game.creeps[cns[j]].move(dd); }
    });
    once('move_C_overwrite', kk, function(){
      for (var j = 0; j < kk; j++) { Game.creeps[cns[j]].move(dd); }
    });
  }
  if (Memory.rooms && Memory.rooms['${HOME}']) {
    meter('mem_read_shallow', 200, function(){ return Memory.rooms['${HOME}'].colonyState; });
    meter('mem_read_queue', 50, function(){
      var q = Memory.rooms['${HOME}'].buildQueue; return q ? q.length : 0;
    });
    meter('mem_write_same_scalar', 200, function(){ Memory.rooms['${HOME}'].__b = 42; });
    meter('mem_write_same_object', 50, function(){
      Memory.rooms['${HOME}'].__bo = { a: 1, b: 2, c: 3, d: 4 };
    });
    // 区分「同值写」与「变值写」——决定 change-guard 类优化是否真的省。
    var m = 0;
    meter('mem_write_changing_scalar', 200, function(){ Memory.rooms['${HOME}'].__b = ++m; });
    meter('mem_write_changing_object', 50, function(){
      Memory.rooms['${HOME}'].__bo = { a: ++m, b: 2, c: 3, d: 4 };
    });
    meter('mem_keys_rooms', 20, function(){ return Object.keys(Memory.rooms).length; });
    delete Memory.rooms['${HOME}'].__b;
    delete Memory.rooms['${HOME}'].__bo;
  }
  console.log('CPUU|' + out.join(','));
})();`;

/** 单 tick 总量：main 先于 console 执行时 cpuAtProbe 是权威值，否则退回分项求和。 */
function tickTotal(s: ProbeSample, afterMain: boolean): number {
  return afterMain ? s.cpuAtProbe : sumNumbers(s.systemCpu) + sumNumbers(s.roleCpu);
}

describe("E2E-029 CPU 定标基线 — 引擎单位成本 + 逐系统/逐角色画像", () => {
  const runner = new ScenarioRunner();
  const samples: ProbeSample[] = [];
  let unitCosts: UnitCost[] = [];
  let errorsSeen = 0;

  beforeAll(async () => {
    await runner.setup({
      roomName: HOME,
      rooms: [standardRoom(HOME, 300, 6)],
      controllerLevel: 6,
      maxTicks: WARMUP + MEASURED + 400,
    });
  }, 180000);

  afterAll(async () => {
    await runner.teardown();
  });

  it("稳态画像采样 + 单位成本标定 → tmp/cpu-baseline.json", async () => {
    const warm = await runner.runTicks(WARMUP);
    errorsSeen += warm.flatMap(s => s.consoleLogs).filter(isJsError).length;

    const first = warm.at(-1);
    expect(first, "暖机未产生任何快照").toBeTruthy();
    expect(first!.totalCreeps, "暖机后人口为 0，经济未闭环，画像无意义").toBeGreaterThan(0);

    // 先取画像，再打单位成本探针 —— 单位成本里的 creep_move 会真实签发移动意图，
    // 放在采样之后可避免污染稳态人口/位置。
    for (let i = 0; i < MEASURED; i++) {
      await runner.bot.sendConsole(buildProbe());
      const snap = await runner.tick();
      errorsSeen += snap.consoleLogs.filter(isJsError).length;
      for (const p of collectProbes(snap.consoleLogs, "CPUB|", toProbeSample)) {
        if (!samples.some(s => s.tick === p.tick)) samples.push(p);
      }
    }

    await runner.bot.sendConsole(UNIT_COST);
    const tail: string[] = [];
    for (let i = 0; i < 4; i++) tail.push(...(await runner.tick()).consoleLogs);
    const rawU = tail.map(unescapeLog).find(l => l.includes("CPUU|"));
    if (rawU) {
      unitCosts = rawU
        .slice(rawU.indexOf("CPUU|") + 5)
        .split(",")
        .map(entry => {
          const [op, times, perCall] = entry.split(":");
          return { op: op!, times: Number(times), perCall: Number(perCall) };
        })
        .filter(u => u.op && Number.isFinite(u.perCall));
    }

    expect(errorsSeen, `定标过程出现 ${errorsSeen} 条 JS 致命错误`).toBe(0);
    expect(samples.length, "探针未取回任何样本，检查 console 通道").toBeGreaterThan(0);
    expect(unitCosts.length, "单位成本探针未取回数据").toBeGreaterThan(0);

    const afterMain = samples.every(s => s.telemetryTick === s.tick);
    const totals = samples.map(s => tickTotal(s, afterMain));
    const bySystem = aggregate(samples, s => s.systemCpu);
    const byRole = aggregate(samples, s => s.roleCpu);
    const byAction = aggregate(samples, s => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.actionCpu)) out[k] = v.totalCpu;
      return out;
    });

    const meanIntents =
      samples.reduce((a, s) => a + Math.max(s.moveIntents, 0), 0) / samples.length;
    const meanSearches =
      samples.reduce((a, s) => a + sumNumbers(s.pathSearchByRoom), 0) / samples.length;
    const meanPathCache =
      samples.reduce((a, s) => a + Math.max(s.pathCacheEntries, 0), 0) / samples.length;
    const emptyTally = (): IntentTally => ({ ok: 0, total: 0, codes: {} });
    const byKind: Record<string, IntentTally> = {};
    const codeTotals: Record<number, number> = {};
    for (const s of samples) {
      for (const [k, b] of Object.entries(s.issued)) {
        const cur = byKind[k] ?? emptyTally();
        cur.ok += b.ok;
        cur.total += b.total;
        for (const [code, n] of Object.entries(b.codes)) {
          cur.codes[Number(code)] = (cur.codes[Number(code)] ?? 0) + n;
          codeTotals[Number(code)] = (codeTotals[Number(code)] ?? 0) + n;
        }
        byKind[k] = cur;
      }
    }
    const perTick = (n: number): number => n / Math.max(samples.length, 1);
    const totalIssued = perTick(Object.values(byKind).reduce((a, b) => a + b.total, 0));
    const totalRefused = perTick(Object.values(codeTotals).reduce((a, n) => a + n, 0));
    const tmMean = bySystem.find(s => s.name === "traffic-manager")?.meanCpu ?? 0;
    const moveTally = byKind.move ?? emptyTally();
    // 核心校验：traffic-manager 成本 ÷ move 签发次数，应与隔离标定的 move 首次签发单价
    // （≈0.177 CPU）吻合。对不上即说明交通路径混入了与签发无关的成本。
    const cpuPerMove = moveTally.total > 0 ? (tmMean * samples.length) / moveTally.total : 0;
    const intentGap = meanIntents - perTick(moveTally.total);
    // 返回码按语义排序呈现：通勤型（ERR_NOT_IN_RANGE）与浪费型分开。
    const codeReport = Object.entries(codeTotals)
      .map(([c, n]) => ({
        code: Number(c),
        name: ERR_NAMES[Number(c)] ?? `code${c}`,
        perTick: perTick(n),
      }))
      .sort((a, b) => b.perTick - a.perTick);

    const artifact = {
      meta: {
        room: HOME,
        rcl: 6,
        warmupTicks: WARMUP,
        measuredTicks: samples.length,
        creepsAtMeasure: samples.at(-1)?.creeps ?? 0,
        memorySizeAtMeasure: samples.at(-1)?.memorySize ?? 0,
        consoleRunsAfterMain: afterMain,
        actionProfilingEnabled: byAction.length > 0,
      },
      intents: {
        perTick: totalIssued,
        wastedPerTick: totalRefused,
        byKind,
        codes: codeReport,
        tmPerMove: cpuPerMove,
      },
      total: {
        meanCpuPerTick: totals.reduce((a, b) => a + b, 0) / Math.max(totals.length, 1),
        p50: percentile(totals, 0.5),
        p95: percentile(totals, 0.95),
        max: Math.max(...totals, 0),
        bucketMin: Math.min(...samples.map(s => s.bucket)),
        skippedMean: samples.reduce((a, s) => a + s.skipped, 0) / samples.length,
        botSelfSampledAvg10: samples.at(-1)?.statsCpuAvg10 ?? 0,
      },
      bySystem,
      byRole,
      byAction,
      unitCosts,
      samples,
    };

    mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
    const outPath = resolve(process.cwd(), "tmp/cpu-baseline.json");
    writeFileSync(outPath, JSON.stringify(artifact, null, 2), "utf8");

    const loop = unitCosts.find(u => u.op === "EMPTY_LOOP")?.perCall ?? 0;
    // 单位是「微 CPU」= getUsed() 计数 × 1e-6。getUsed 与 cpu 上限同口径（引擎 CPU 单位），
    // 不是墙钟时间；绝对值跨环境不可直接搬运，用于同机前后对比与占比定权。
    const costLines = unitCosts
      .filter(u => u.op !== "EMPTY_LOOP")
      .map(
        u =>
          `  ${u.op.padEnd(30)} n=${String(u.times).padEnd(4)} ${(Math.max(u.perCall - loop, 0) * 1e6).toFixed(1)} uCPU/call`,
      )
      .join("\n");

    console.log(
      [
        `[CPU-BASELINE] samples=${samples.length} creeps=${artifact.meta.creepsAtMeasure} afterMain=${afterMain} mem=${artifact.meta.memorySizeAtMeasure}`,
        `[CPU-BASELINE] cpu/tick mean=${artifact.total.meanCpuPerTick.toFixed(3)} p50=${artifact.total.p50.toFixed(3)} p95=${artifact.total.p95.toFixed(3)} max=${artifact.total.max.toFixed(3)} (bot avg10=${artifact.total.botSelfSampledAvg10.toFixed(3)})`,
        `[CPU-BASELINE] intents/tick=${totalIssued.toFixed(2)} nonOK=${totalRefused.toFixed(2)} (${
          totalIssued > 0 ? ((100 * totalRefused) / totalIssued).toFixed(0) : "0"
        }%) | byKind: ${Object.entries(byKind)
          .map(([k, b]) => `${k}=${perTick(b.total).toFixed(2)}/ok${perTick(b.ok).toFixed(2)}`)
          .join(" ")}`,
        `[CPU-BASELINE] intent codes/tick: ${
          codeReport.map(c => `${c.name}(${c.code})=${c.perTick.toFixed(2)}`).join(" ") || "none"
        }`,
        `[CPU-BASELINE] movement: registrations/tick=${meanIntents.toFixed(2)} issued/tick=${perTick(
          moveTally.total,
        ).toFixed(2)} gap=${intentGap.toFixed(2)} searches=${meanSearches.toFixed(
          2,
        )} pathCache=${meanPathCache.toFixed(1)}`,
        `[CPU-BASELINE] canary: tmPerMove=${cpuPerMove.toFixed(
          4,
        )} CPU/move (isolated price ~0.177)`,
        `[CPU-BASELINE] systems: ${bySystem
          .slice(0, 10)
          .map(s => `${s.name}=${s.meanCpu.toFixed(3)}(${s.sharePct.toFixed(0)}%)`)
          .join(" ")}`,
        `[CPU-BASELINE] roles: ${byRole
          .slice(0, 8)
          .map(s => `${s.name}=${s.meanCpu.toFixed(3)}(${s.sharePct.toFixed(0)}%)`)
          .join(" ")}`,
        byAction.length
          ? `[CPU-BASELINE] actions: ${byAction
              .slice(0, 12)
              .map(s => `${s.name}=${s.meanCpu.toFixed(3)}`)
              .join(" ")}`
          : "[CPU-BASELINE] actions: (需 CONFIG.debug.actionProfiling=true 构建)",
        `[CPU-BASELINE] unit costs:\n${costLines}`,
        `[CPU-BASELINE] artifact -> ${outPath}`,
      ].join("\n"),
    );
  }, 900000);
});
