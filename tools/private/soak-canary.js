/**
 * 私服 Canary Soak 采集器 — CANARY_SOAK_PROCEDURE.md §3 指标快照落地。
 *
 * 数据源：CLI 后门（storage.db + storage.env），与 empire-collector 同通道，
 * 但采样面向 soak 验证项（OC/MEM/PIPE/CPU）而非离线分析：
 *   - 每 100 tick 保存一行 §3 格式快照（cpu/memory/creeps/rooms/errors）
 *   - CPU used/bucket/tier 取自 segment 1（telemetry ring 最后一条样本）
 *   - errors/warnings 取自 users.console 最近 tick 的 error 行
 *   - 结束时输出 summary（通过率判定交给 analyze 阶段）
 *
 * 用法：
 *   node tools/private/soak-canary.js --ticks 10000     # 运行到起始 tick + N
 *   node tools/private/soak-canary.js --until 10000     # 运行到绝对 tick
 *   node tools/private/soak-canary.js --sample           # 单次采样（探针）
 *
 * 环境变量：SCREEPS_CONTAINER / SCREEPS_CLI_PORT（见 load-env）
 */
require("../load-env");
const fs = require("fs");
const path = require("path");
const { runCli } = require("./screeps-cli");

const OUT_DIR = path.join(__dirname, "data", "soak");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_FILE = path.join(OUT_DIR, `canary-${Date.now()}.jsonl`);

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const REL_TICKS = Number(argValue("--ticks") || 0);
const UNTIL_TICK = Number(argValue("--until") || 0);
const ONCE = args.includes("--sample");

// ─── 服务端采样表达式 ────────────────────────────────────────────
// 一次 CLI 聚合：gametime + 用户(cpu 限额/bucket) + Memory + segment1(CPU ring)
// + 己方房间 controller 概要 + 己方 creep 角色分布 + console 最近错误。
const SAMPLE_EXPR = `
(function(){
  return storage.db.users.findOne({username:'111'}).then(function(u){
     if(!u) return JSON.stringify({err:"no-user"});
     var uid=""+u._id;
    return Promise.all([
      storage.env.get(storage.env.keys.GAMETIME),
      storage.db["rooms.objects"].find({}),
      storage.env.get(storage.env.keys.MEMORY+uid),
      storage.env.hgetall(storage.env.keys.MEMORY_SEGMENTS+uid)
    ]).then(function(r){
      var tick=r[0], objs=r[1], memRaw=r[2], segs=r[3]||{};
      var mem={}; try{ mem=JSON.parse(memRaw)||{}; }catch(e){}
      var kernel=mem.kernel||{};
      var cpuSeg=null; try{ cpuSeg=JSON.parse(segs["1"]||"null"); }catch(e){}
      // segment 1 CPU ring 最后一条样本（框架自采样，含 used/bucket/tier）
      var cpuLast=null;
      if(cpuSeg&&cpuSeg.cpu&&cpuSeg.cpu.d&&cpuSeg.cpu.d.length){
        cpuLast=cpuSeg.cpu.d[cpuSeg.cpu.d.length-1];
      }
      var myCtrls=objs.filter(function(o){return o.type==="controller"&&o.user===uid;});
      var rooms={};
      myCtrls.forEach(function(c){
        rooms[c.room]={rcl:c.level, prog:c.progress, progTotal:c.progressTotal};
      });
      var byRoom={};
      var creeps={total:0, byRole:{}};
      var energyByRoom={};
      objs.forEach(function(o){
        if(o.type==="creep"&&o.user===uid){
          creeps.total++;
          var rn=(o.name||"").split("-")[0];
          creeps.byRole[rn]=(creeps.byRole[rn]||0)+1;
        }
        if(o.type==="spawn"&&o.user===uid){
          if(!energyByRoom[o.room]) energyByRoom[o.room]={energyAvailable:0, energyCapacityAvailable:0};
          energyByRoom[o.room].energyAvailable+=(o.store&&o.store.energy)||0;
          energyByRoom[o.room].energyCapacityAvailable+=300;
        }
        if(o.type==="extension"){
          if(!energyByRoom[o.room]) energyByRoom[o.room]={energyAvailable:0, energyCapacityAvailable:0};
          energyByRoom[o.room].energyAvailable+=(o.store&&o.store.energy)||0;
          energyByRoom[o.room].energyCapacityAvailable+=o.energyCapacity||0;
        }
      });
      Object.keys(rooms).forEach(function(rn){
        if(energyByRoom[rn]){
          rooms[rn].energyAvailable=energyByRoom[rn].energyAvailable;
          rooms[rn].energyCapacityAvailable=energyByRoom[rn].energyCapacityAvailable;
        }
      });
      var oc=kernel.outcomeEvents||{};
      return JSON.stringify({
        tick: tick,
        cpu: {
          used: cpuLast ? cpuLast.cpu : null,
          bucket: cpuLast ? cpuLast.bk : null,
          limit: u.cpu || null,
          cpuAvailable: u.cpuAvailable != null ? u.cpuAvailable : null,
          tier: cpuLast && cpuLast.tier ? cpuLast.tier : (kernel.budgetTier || null)
        },
        memory: {
          size: memRaw ? memRaw.length : 0,
          schemaVersion: mem.schemaVersion != null ? mem.schemaVersion : (kernel.schemaVersion || null),
          outcomeEvents: {
            q_len: (oc.q||[]).length,
            s_len: (oc.s||[]).length,
            dr: oc.dr||0,
            oe: oc.oe||0,
            legacyFields: (oc.queue!==undefined||oc.seen!==undefined||oc.duplicateRejected!==undefined||oc.overflowEvicted!==undefined)
          }
        },
        creeps: creeps,
        rooms: rooms,
        kernel: {
          tier: kernel.budgetTier || null,
          strategy: kernel.strategy || null,
          skips: kernel.skipReasons ? Object.keys(kernel.skipReasons).length : 0
        }
      });
    });
  });
})()
`;

// console 错误探针：最近 console 输出中的 error 行。
const CONSOLE_EXPR = `
(function(){
  return storage.db.users.findOne({username:'111'}).then(function(u){
     if(!u) return JSON.stringify([]);
     var uid=""+u._id;
    return storage.db["users.console"].find({user:uid, error:{$exists:true}}, {sort:{_id:-1}, limit:20})
      .then(function(rows){
        return JSON.stringify(rows.map(function(r){
          return {tick:r.tick||null, error:String(r.error||"").slice(0,300), lines:(r.output||[]).slice(0,10)};
        }));
      });
  });
})()
`;

function round(v) {
  return typeof v === "number" ? Math.round(v * 10) / 10 : v;
}

async function sample() {
  const raw = await runCli(SAMPLE_EXPR, { timeoutMs: 60000 });
  let snap;
  try {
    snap = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message} | raw[0:300]=${String(raw).slice(0, 300)} | exprBytes=${Buffer.byteLength(SAMPLE_EXPR)} | exprTail=${JSON.stringify(SAMPLE_EXPR.slice(-40))}`);
  }
  if (snap.err) throw new Error(snap.err);
  return snap;
}

async function main() {
  const first = await sample();
  const startTick = Number(first.tick);
  const targetTick = UNTIL_TICK > 0 ? UNTIL_TICK : startTick + REL_TICKS;
  console.log(`[soak] start tick=${startTick}, target=${targetTick}`);
  if (ONCE) {
    console.log(JSON.stringify(first, null, 2));
    return;
  }

  let lastSaved = -Infinity;
  let lastTick = startTick;
  const t0 = Date.now();
  let stallCount = 0;
  let lastTickTs = Date.now();

  // 起始快照（tick 0 基线）
  fs.appendFileSync(OUT_FILE, JSON.stringify(first) + "\n");
  lastSaved = startTick;
  console.log(`[soak] baseline saved @ tick ${startTick}`);

  while (true) {
    await new Promise((r) => setTimeout(r, 5000));
    let snap;
    try {
      snap = await sample();
    } catch (e) {
      console.error(`[soak] sample failed: ${e.message}`);
      continue;
    }
    if (Number(snap.tick) === lastTick) {
      stallCount++;
      if (stallCount % 12 === 0) {
        console.warn(`[soak] tick stalled at ${snap.tick} for ${stallCount * 5}s`);
      }
      if (stallCount > 120) {
        // 10 分钟无 tick 推进 → 判定 soak 失败退出
        throw new Error(`tick stalled at ${snap.tick} for >10min — soak aborted`);
      }
      continue;
    }
    stallCount = 0;
    const tickN = Number(snap.tick);
    const dt = tickN - lastTickTs ? Date.now() - lastTickTs : 0;
    lastTickTs = Date.now();
    lastTick = tickN;

    if (tickN - lastSaved >= 100) {
      // 每帧错误探针（仅在保存点拉取，控制 CLI 频率）
      let errors = [];
      try {
        errors = JSON.parse(await runCli(CONSOLE_EXPR, { timeoutMs: 30000 }));
      } catch { /* console 采集失败不致命 */ }
      snap.errors = errors;
      snap.sampleTs = Date.now() - t0;
      fs.appendFileSync(OUT_FILE, JSON.stringify(snap) + "\n");
      lastSaved = tickN;
      const memKb = Math.round(snap.memory.size / 1024);
      const oc = snap.memory.outcomeEvents;
      console.log(
        `[soak] tick=${snap.tick} cpu=${snap.cpu.used}/${snap.cpu.limit} bk=${snap.cpu.bucket} ` +
        `tier=${snap.cpu.tier} mem=${memKb}B sv=${snap.memory.schemaVersion} ` +
        `q=${oc.q_len} s=${oc.s_len} dr=${oc.dr} oe=${oc.oe} creeps=${snap.creeps.total} ` +
        `rooms=${Object.keys(snap.rooms).length} dt=${Math.round(dt / 1000)}s`
      );
    }

    if (tickN >= targetTick) {
      console.log(`[soak] target reached: tick ${tickN} >= ${targetTick}`);
      break;
    }
  }

  // 终点全量快照
  const final = await sample();
  fs.appendFileSync(OUT_FILE, JSON.stringify(final) + "\n");
  console.log(`[soak] final saved @ tick ${final.tick}`);
  console.log(`[soak] output: ${OUT_FILE}`);
  console.log(`[soak] wall time: ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((err) => {
  console.error("[soak] Fatal:", err.message);
  process.exit(1);
});
