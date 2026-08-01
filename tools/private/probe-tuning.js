/**
 * Tuning 状态探测器 — 采集 Memory.kernel.tuning 并对照 CONFIG 基线分析。
 *
 * 数据源：CLI 后门读 storage.env MEMORY[userId] + storage.db["rooms.objects"]。
 * 输出：
 *   1. 顶层 kernel 元数据（tier/strategy/skipReasons Top）
 *   2. tuning 全量（baselineVersion/lastTuned/rooms/lastEval）
 *   3. per-room：CONFIG 基线 vs 调优覆盖 delta + lastAdjusted 距今 tick + lastEval 信号
 *   4. 跨房经济实况（storage/RCL/colonyState）供判断「是否值得调」
 *
 * 用法：node tools/private/probe-tuning.js
 */
require("../load-env");
const { runCliJson } = require("./screeps-cli");

// CONFIG.roles 静态基线（与 src/config/index.ts 一致，client-side 对照）
const CONFIG_ROLES = {
  harvester: { minCount: 2, maxCount: 4 },
  hauler: { minCount: 2, maxCount: 6 },
  distributor: { minCount: 1, maxCount: 3 },
  upgrader: { minCount: 1, maxCount: 3 },
  builder: { minCount: 1, maxCount: 4 },
};

// TUNING_BOUNDS 硬边界（src/domain/tuning/bounds.ts）
const TUNING_BOUNDS = {
  "hauler.maxCount": { floor: 2, ceiling: 8 },
  "hauler.minCount": { floor: 1, ceiling: 4 },
  "harvester.maxCount": { floor: 2, ceiling: 6 },
  "upgrader.maxCount": { floor: 1, ceiling: 4 },
  "builder.maxCount": { floor: 1, ceiling: 6 },
};

const PROBE_EXPR = `
(function(){
  return storage.db.users.find({steam:{$exists:true}}).then(function(us){
    var u = us[0]; if(!u) return {err:"no-user"};
    var uid = ""+u._id;
    return Promise.all([
      storage.env.get(storage.env.keys.MEMORY+uid),
      storage.env.get(storage.env.keys.GAMETIME),
      storage.db["rooms.objects"].find({})
    ]).then(function(r){
      var memRaw = r[0], tick = r[2] && r[2].time ? r[2].time : (typeof r[1] === "string" ? parseInt(r[1],10) : r[1]);
      var mem = {}; try{ mem = JSON.parse(memRaw) || {}; }catch(e){}
      var objs = r[2] || [];
      var kernel = mem.kernel || {};
      var tuning = kernel.tuning || null;
      // 找我方 controller 所在房
      var myCtrls = objs.filter(function(o){return o.type==="controller" && o.user===uid;});
      // 按房聚合结构能量（storage/terminal/spawn+ext/container/source）
      var byRoom = {};
      objs.forEach(function(o){
        var b = byRoom[o.room] || (byRoom[o.room] = {storE:0, termE:0, spawnE:0, spawnCap:0, extE:0, extCap:0, contE:0, contN:0, srcE:0, srcCap:0, struct:{}, creeps:{}});
        if(o.type === "creep"){
          if(o.user === uid){ var rn = (o.name||"").split("-")[0]; b.creeps[rn] = (b.creeps[rn]||0)+1; }
          return;
        }
        if(o.type === "source"){ b.srcE += (o.energy||0); b.srcCap += (o.energyCapacity||0); return; }
        if(o.type === "container"){ b.contE += ((o.store&&o.store.energy)||0); b.contN++; return; }
        if(o.type === "constructionSite"){ return; }
        if(o.user !== uid) return;
        b.struct[o.type] = (b.struct[o.type]||0)+1;
        if(o.type === "spawn"){ b.spawnE += ((o.store&&o.store.energy)||0); b.spawnCap += ((o.storeCapacityResource&&o.storeCapacityResource.energy)||300); }
        if(o.type === "extension"){ b.extE += ((o.store&&o.store.energy)||0); b.extCap += ((o.storeCapacityResource&&o.storeCapacityResource.energy)||50); }
        if(o.type === "storage"){ b.storE += ((o.store&&o.store.energy)||0); }
        if(o.type === "terminal"){ b.termE += ((o.store&&o.store.energy)||0); }
      });
      var myRooms = myCtrls.map(function(c){ return c.room; });
      var roomViews = myRooms.map(function(rm){
        var b = byRoom[rm] || {storE:0,spawnE:0,spawnCap:0,extE:0,extCap:0,contE:0,contN:0,srcE:0,srcCap:0,struct:{},creeps:{}};
        var ctrl = myCtrls.find(function(c){return c.room===rm;});
        var rmem = (mem.rooms && mem.rooms[rm]) || {};
        return {
          room: rm,
          rcl: ctrl ? ctrl.level : 0,
          storageEnergy: b.storE,
          terminalEnergy: b.termE,
          spawnFill: b.spawnCap ? (b.spawnE / b.spawnCap) : 0,
          extFill: b.extCap ? (b.extE / b.extCap) : 0,
          contFill: b.contN ? (b.contE / (b.contN * 2000)) : 0,
          contTotal: b.contE,
          srcAvail: b.srcE,
          srcCap: b.srcCap,
          colonyState: rmem.colonyState || "?",
          phase: (rmem.phase && rmem.phase.phase) || rmem.phase || "?",
          reserve: (rmem.phase && rmem.phase.reserve) || 0,
          reserveDelta: (rmem.phase && rmem.phase.reserveDelta),
          economyPressure: rmem.economyPressure,
          creeps: b.creeps,
          struct: b.struct
        };
      });
      // skipReasons Top5
      var sr = kernel.skipReasons || {};
      var srTop = Object.keys(sr).map(function(k){return [k, sr[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0, 5);
      return {
        tick: tick,
        user: u.username,
        cpu: u.lastUsedCpu,
        kernelTier: kernel.tier || "?",
        strategy: kernel.strategy || null,
        skipReasonsTop5: srTop,
        tuning: tuning,
        rooms: roomViews
      };
    });
  });
})()
`;

async function main() {
  const data = await runCliJson(PROBE_EXPR, { timeoutMs: 25000 });
  if (data.err) { console.error("err:", data.err); process.exit(1); }
  // 分块渲染
  renderHeader(data);
  renderTuning(data);
  renderRooms(data);
}

function renderHeader(d) {
  console.log("╔══════ Tuning 探测 @ tick " + d.tick + " ══════╗");
  console.log("用户=" + d.user + "  CPU=" + d.cpu + "  内核=" + d.kernelTier +
    (d.strategy && d.strategy.posture ? "  姿态=" + d.strategy.posture : "") +
    (d.strategy && typeof d.strategy.expansionAllowed === "boolean" ? "  扩张=" + (d.strategy.expansionAllowed?"允许":"关闭") : ""));
  console.log("跳过Top5:");
  (d.skipReasonsTop5 || []).forEach(function(kv){ console.log("  " + kv[0] + " = " + kv[1]); });
  console.log("");
}

function renderTuning(d) {
  const t = d.tuning;
  if (!t) { console.log("⚠️  Memory.kernel.tuning 不存在 — 调优引擎尚未运行过"); return; }
  console.log("╭── tuning 全量 ──");
  console.log("│ baselineVersion = " + t.baselineVersion + " (CONFIG.tuning.baselineVersion=1)");
  console.log("│ lastTuned       = " + t.lastTuned + " (距今 " + (d.tick - t.lastTuned) + " tick)");
  console.log("│ rooms count     = " + Object.keys(t.rooms || {}).length);
  if (t.lastEval) {
    console.log("│ lastEval rooms  = " + Object.keys(t.lastEval).join(", "));
  } else {
    console.log("│ lastEval        = (无)");
  }
  console.log("");
  // per-room roleBounds 对比
  Object.keys(t.rooms || {}).forEach(function(rm){
    const rt = t.rooms[rm];
    console.log("╭── " + rm + " roleBounds ──");
    console.log("│ lastAdjusted:");
    Object.keys(rt.lastAdjusted || {}).forEach(function(p){
      const ago = d.tick - rt.lastAdjusted[p];
      console.log("│   " + p + " @ " + rt.lastAdjusted[p] + " (距今 " + ago + " tick, 冷却=" + (ago < 1000 ? "内" : "已过") + ")");
    });
    console.log("│ lastTrend:");
    Object.keys(rt.lastTrend || {}).forEach(function(p){
      console.log("│   " + p + " → " + rt.lastTrend[p]);
    });
    console.log("│ roleBounds (CONFIG 基线 → 当前覆盖):");
    Object.keys(CONFIG_ROLES).forEach(function(role){
      const base = CONFIG_ROLES[role];
      const ov = rt.roleBounds && rt.roleBounds[role];
      const minOv = ov && ov.minCount !== undefined ? ov.minCount : base.minCount;
      const maxOv = ov && ov.maxCount !== undefined ? ov.maxCount : base.maxCount;
      const minDelta = minOv - base.minCount;
      const maxDelta = maxOv - base.maxCount;
      const minChg = minDelta === 0 ? "  " : (minDelta > 0 ? " +" + minDelta : " " + minDelta);
      const maxChg = maxDelta === 0 ? "  " : (maxDelta > 0 ? " +" + maxDelta : " " + maxDelta);
      const mark = (minDelta !== 0 || maxDelta !== 0) ? " ★" : "";
      console.log("│   " + role.padEnd(10) + " min[" + base.minCount + "→" + minOv + "]" + minChg + mark +
        "  max[" + base.maxCount + "→" + maxOv + "]" + maxChg + mark);
    });
  });
  console.log("");
  // lastEval 信号
  if (t.lastEval) {
    Object.keys(t.lastEval).forEach(function(rm){
      const le = t.lastEval[rm];
      console.log("╭── " + rm + " lastEval @ tick " + le.tick + " (距今 " + (d.tick - le.tick) + " tick) ──");
      console.log("│ adjustments: " + (le.adjustments.length ? le.adjustments.join(", ") : "(无)"));
      console.log("│ skipped: " + (le.skipped || "(无)"));
      console.log("│ trend: " + JSON.stringify(le.trend));
      console.log("│ signals:");
      Object.keys(le.signals).forEach(function(k){
        console.log("│   " + k.padEnd(20) + " = " + le.signals[k]);
      });
    });
  }
}

function renderRooms(d) {
  console.log("");
  console.log("╔══════ 主房实况（cross-ref） ══════╗");
  (d.rooms || []).forEach(function(r){
    const creepsTxt = Object.keys(r.creeps).sort().map(function(k){return k+":"+r.creeps[k];}).join(" ");
    const totalCreeps = Object.keys(r.creeps).reduce(function(s,k){return s+r.creeps[k];},0);
    console.log("┌─ " + r.room + "  RCL" + r.rcl + "  [" + r.colonyState + "]  phase=" + r.phase);
    console.log("│ storage=" + r.storageEnergy + "  terminal=" + r.terminalEnergy +
      "  spawn=" + Math.round(r.spawnFill*100) + "%  ext=" + Math.round(r.extFill*100) + "%" +
      "  cont=" + Math.round(r.contFill*100) + "% (" + r.contTotal + ")");
    console.log("│ reserve=" + r.reserve + (r.reserveDelta !== undefined && r.reserveDelta !== null ? "  Δ=" + r.reserveDelta : "") +
      "  pressure=" + (r.economyPressure !== undefined ? Math.round(r.economyPressure*100)+"%" : "?"));
    console.log("│ creeps=" + totalCreeps + " [" + creepsTxt + "]");
    const structTxt = Object.keys(r.struct).sort().map(function(k){return k+"×"+r.struct[k];}).join(" ");
    console.log("│ struct: " + (structTxt || "无"));
  });
}

main().catch(function(e){ console.error(e); process.exit(1); });
