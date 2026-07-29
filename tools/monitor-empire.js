/**
 * 私服帝国全景监控 — 覆盖经济/孵化/建造/军事/远矿/CPU 的全维度状态。
 *
 * 数据源：CLI 后门（screeps-cli）读两处——
 *   1. storage.db["rooms.objects"]：结构/creep/能量的物理实况（跨全部己方房间）；
 *   2. storage.env MEMORY[userId]：框架决策状态（kernel.tier/strategy、room.colonyState/
 *      spawnQueue/buildQueue/remoteOps/economyPressure 等）。
 * 二者交叉，既看"地面真相"又看"框架意图"。
 *
 * 用法：
 *   node tools/monitor-empire.js            # 打印一次全景快照
 *   node tools/monitor-empire.js --watch    # 每 INTERVAL 秒刷新（前台）
 *   node tools/monitor-empire.js --once     # 采样一次并追加日志（供外部定时驱动）
 *   node tools/monitor-empire.js --json      # 输出原始 JSON（供二次处理）
 *
 * 环境变量：MONITOR_INTERVAL（默认 60）
 */
require("./load-env");
const fs = require("fs");
const path = require("path");
const { runCli } = require("./screeps-cli");

const INTERVAL_SEC = Number(process.env.MONITOR_INTERVAL || 60);
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "empire-monitor.log");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// 服务端采样：遍历己方所有房间的 objects + 解析 Memory，聚合成结构化快照。
const SAMPLE_EXPR = `
(function(){
  return storage.db.users.find({steam:{$exists:true}}).then(function(us){
    var u=us[0]; if(!u) return JSON.stringify({err:"no-user"});
    var uid=""+u._id;
    return Promise.all([
      storage.db["rooms.objects"].find({}),
      storage.env.get(storage.env.keys.MEMORY+uid),
      storage.env.get(storage.env.keys.GAMETIME)
    ]).then(function(r){
      var objs=r[0], memRaw=r[1], tick=r[2];
      var mem={}; try{ mem=JSON.parse(memRaw)||{}; }catch(e){}
      var kernel=mem.kernel||{};
      // 找出所有己方 controller 所在房（主房集合）。
      var myCtrls=objs.filter(function(o){return o.type==="controller"&&o.user===uid;});
      var myRooms=myCtrls.map(function(c){return c.room;});
      // 按房聚合。
      var rooms={};
      myCtrls.forEach(function(c){
        rooms[c.room]={rcl:c.level,prog:c.progress,progTotal:c.progressTotal,
          safeMode:c.safeMode||0,downgrade:c.downgradeTime||0};
      });
      // 遍历全部 objects 一次，归类。
      var byRoom={};
      function slot(room){ if(!byRoom[room]) byRoom[room]={struct:{},creeps:{},spawnE:0,spawnCap:0,extE:0,extCap:0,contE:0,storE:0,termE:0,srcE:0,srcCap:0,towerE:0,towerCap:0,sites:0,hostiles:0,tombs:0,spawning:0}; return byRoom[room]; }
      objs.forEach(function(o){
        var b=slot(o.room);
        if(o.type==="creep"){
          if(o.user===uid){ var rn=(o.name||"").split("-")[0]; b.creeps[rn]=(b.creeps[rn]||0)+1; }
          else { b.hostiles++; }
          return;
        }
        if(o.type==="source"){ b.srcE+=(o.energy||0); b.srcCap+=(o.energyCapacity||0); return; }
        if(o.type==="container"){ b.contE+=((o.store&&o.store.energy)||0); b.struct.container=(b.struct.container||0)+1; return; }
        if(o.type==="tombstone"){ b.tombs++; return; }
        if(o.type==="constructionSite"){ if(o.user===uid) b.sites++; return; }
        // 己方结构。
        if(o.user!==uid) return;
        b.struct[o.type]=(b.struct[o.type]||0)+1;
        if(o.type==="spawn"){ b.spawnE+=((o.store&&o.store.energy)||0); b.spawnCap+=((o.storeCapacityResource&&o.storeCapacityResource.energy)||300); if(o.spawning) b.spawning++; }
        if(o.type==="extension"){ b.extE+=((o.store&&o.store.energy)||0); b.extCap+=((o.storeCapacityResource&&o.storeCapacityResource.energy)||50); }
        if(o.type==="storage"){ b.storE+=((o.store&&o.store.energy)||0); }
        if(o.type==="terminal"){ b.termE+=((o.store&&o.store.energy)||0); }
        if(o.type==="tower"){ b.towerE+=((o.store&&o.store.energy)||0); b.towerCap+=((o.storeCapacityResource&&o.storeCapacityResource.energy)||1000); }
      });
      // 组装每个主房的完整视图（含 Memory 决策态）。
      var roomViews=myRooms.map(function(rm){
        var b=byRoom[rm]||slot(rm);
        var rmem=(mem.rooms&&mem.rooms[rm])||{};
        return {
          room:rm, rcl:rooms[rm].rcl, prog:rooms[rm].prog, progTotal:rooms[rm].progTotal,
          safeMode:rooms[rm].safeMode, downgrade:rooms[rm].downgrade,
          colonyState:rmem.colonyState||"?", phase:(rmem.phase&&rmem.phase.phase)||rmem.phase||"?",
          reserve:(rmem.phase&&rmem.phase.reserve)||0, reserveDelta:(rmem.phase&&rmem.phase.reserveDelta),
          economyPressure:rmem.economyPressure, storageNearFull:rmem.storageNearFull,
          spawnQueue:(rmem.spawnQueue||[]).length, buildQueue:(rmem.buildQueue||[]).filter(function(t){return t.state==="queued"||t.state==="site";}).length,
          struct:b.struct, creeps:b.creeps, sites:b.sites, hostiles:b.hostiles, spawning:b.spawning,
          energy:{spawn:b.spawnE,spawnCap:b.spawnCap,ext:b.extE,extCap:b.extCap,cont:b.contE,stor:b.storE,term:b.termE,src:b.srcE,srcCap:b.srcCap,tower:b.towerE,towerCap:b.towerCap},
          remoteOps:rmem.remoteOps||{}
        };
      });
      // 远矿房实况：仅纳入①我方有 creep 活动的房 ②我方 remoteOps 声明的目标房。
      // 排除纯 bot 家（全世界扫描会混入大量无关 bot 房间的 hostiles）。
      var remoteTargets={};
      myRooms.forEach(function(rm){
        var rmem=(mem.rooms&&mem.rooms[rm])||{};
        var ro=rmem.remoteOps||{};
        Object.keys(ro).forEach(function(k){ remoteTargets[k]=true; });
      });
      var remoteRooms={};
      Object.keys(byRoom).forEach(function(rm){
        if(myRooms.indexOf(rm)>=0) return;
        var b=byRoom[rm];
        var myCreeps=Object.keys(b.creeps).reduce(function(s,k){return s+b.creeps[k];},0);
        // 只保留：我方有 creep 的房，或我方远矿目标房（后者可能有威胁需预警）。
        if(myCreeps>0 || remoteTargets[rm]){
          remoteRooms[rm]={creeps:b.creeps,hostiles:b.hostiles,contE:b.contE,isTarget:!!remoteTargets[rm]};
        }
      });
      return JSON.stringify({
        tick:tick, user:u.username||"(空)", cpu:u.lastUsedCpu,
        kernelTier:kernel.tier||"?", strategy:kernel.strategy||null,
        skipReasons:kernel.skipReasons||{},
        rooms:roomViews, remoteRooms:remoteRooms
      });
    });
  });
})()`;

// ===== 渲染层 =====

function bar(cur, cap, width) {
  width = width || 10;
  if (!cap) return "─".repeat(width);
  const filled = Math.round((cur / cap) * width);
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(0, width - filled));
}

function pct(cur, cap) { return cap ? Math.round((cur / cap) * 100) + "%" : "n/a"; }

function fmtCreeps(creeps) {
  const keys = Object.keys(creeps).sort();
  if (keys.length === 0) return "无";
  return keys.map(function (k) { return k + ":" + creeps[k]; }).join(" ");
}

function renderRoom(r) {
  const lines = [];
  const progTxt = r.progTotal ? `${r.prog}/${r.progTotal} (${pct(r.prog, r.progTotal)})` : `${r.prog}`;
  const stateTag = r.colonyState === "normal" ? r.colonyState
    : `⚠️${r.colonyState}`;
  lines.push(`┌─ 🏛  ${r.room}  RCL${r.rcl} ${progTxt}  [${stateTag}] phase=${r.phase}`);

  // 经济：能量各仓位。
  const e = r.energy;
  const econ = [];
  econ.push(`spawn ${bar(e.spawn, e.spawnCap, 6)} ${e.spawn}/${e.spawnCap}`);
  econ.push(`ext ${bar(e.ext, e.extCap, 6)} ${e.ext}/${e.extCap}`);
  if (e.cont > 0) econ.push(`container ${e.cont}`);
  if (e.stor > 0 || r.struct.storage) econ.push(`storage ${e.stor}`);
  if (e.term > 0 || r.struct.terminal) econ.push(`terminal ${e.term}`);
  lines.push(`│ 💰 经济: ${econ.join(" · ")}`);
  lines.push(`│    source: ${bar(e.src, e.srcCap, 8)} ${e.src}/${e.srcCap}` +
    (r.economyPressure !== undefined ? `  压力=${(r.economyPressure * 100).toFixed(0)}%` : "") +
    (r.storageNearFull ? "  storage近满" : ""));

  // 孵化：人口 + 队列。
  const totalCreeps = Object.keys(r.creeps).reduce(function (s, k) { return s + r.creeps[k]; }, 0);
  lines.push(`│ 🥚 孵化: ${totalCreeps}只 [${fmtCreeps(r.creeps)}]` +
    `  队列=${r.spawnQueue}` + (r.spawning ? `  孵化中×${r.spawning}` : ""));

  // 建造：结构统计 + 工地 + buildQueue。
  const structTxt = Object.keys(r.struct).sort().map(function (k) { return k + "×" + r.struct[k]; }).join(" ");
  lines.push(`│ 🏗  建造: ${structTxt || "无"}`);
  lines.push(`│    工地=${r.sites}  buildQueue=${r.buildQueue}` +
    (r.buildQueue > 15 ? " ⚠️积压" : ""));

  // 军事：tower + rampart + 敌情 + safeMode。
  const mil = [];
  mil.push(`tower×${r.struct.tower || 0} ${r.struct.tower ? bar(e.tower, e.towerCap, 5) + " " + e.tower : ""}`);
  mil.push(`rampart×${r.struct.rampart || 0}`);
  mil.push(`wall×${r.struct.constructedWall || 0}`);
  if (r.hostiles > 0) mil.push(`🚨敌×${r.hostiles}`);
  if (r.safeMode > 0) mil.push(`🛡safeMode(剩${r.safeMode}t)`);
  lines.push(`│ ⚔️  军事: ${mil.join("  ")}`);

  // 远矿（该主房的远矿操作）。
  const ro = r.remoteOps || {};
  const roKeys = Object.keys(ro);
  if (roKeys.length > 0) {
    const roTxt = roKeys.map(function (k) {
      const o = ro[k];
      return `${k}[${o.state} haulerNeed=${o.haulerNeed}${o.threat ? " 🚨威胁" : ""}]`;
    }).join(" ");
    lines.push(`│ ⛏  远矿: ${roTxt}`);
  }
  lines.push(`└${"─".repeat(50)}`);
  return lines.join("\n");
}

function render(s) {
  const out = [];
  out.push(`╔══════ 帝国全景 @ tick ${s.tick} ══════╗`);
  const cpuTag = s.cpu > 15 ? `⚠️${s.cpu}` : s.cpu;
  out.push(`用户=${s.user}  CPU=${cpuTag}  内核档位=${s.kernelTier}` +
    (s.strategy && s.strategy.posture ? `  帝国姿态=${s.strategy.posture}` : ""));
  // skipReasons Top3（框架降级/跳过信号）。
  const skips = Object.entries(s.skipReasons || {}).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
  if (skips.length > 0) {
    out.push(`跳过Top3: ` + skips.map(function (kv) { return kv[0] + "=" + kv[1]; }).join("  "));
  }
  out.push("");
  // 主房逐个渲染。
  (s.rooms || []).forEach(function (r) { out.push(renderRoom(r)); });
  // 远矿房实况汇总。
  const rr = s.remoteRooms || {};
  const rrKeys = Object.keys(rr);
  if (rrKeys.length > 0) {
    out.push("");
    out.push(`⛏ ═══ 远矿房实况 ═══`);
    rrKeys.forEach(function (rm) {
      const d = rr[rm];
      out.push(`  ${rm}: creep[${fmtCreeps(d.creeps)}]` +
        (d.contE > 0 ? ` container=${d.contE}` : "") +
        (d.hostiles > 0 ? ` 🚨敌×${d.hostiles}` : ""));
    });
  }
  return out.join("\n");
}

// ===== 入口 =====

function ts() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

async function sampleOnce() {
  const raw = await runCli(SAMPLE_EXPR, { timeoutMs: 25000 });
  const s = JSON.parse(raw);
  if (s.err) throw new Error(s.err);
  return s;
}

// 压缩单行摘要（供日志/趋势追踪）。
function summaryLine(s) {
  const parts = [`tick=${s.tick}`, `cpu=${s.cpu}`, `tier=${s.kernelTier}`];
  (s.rooms || []).forEach(function (r) {
    const tc = Object.keys(r.creeps).reduce(function (a, k) { return a + r.creeps[k]; }, 0);
    parts.push(`${r.room}:RCL${r.rcl}/${r.colonyState}/creep${tc}/bq${r.buildQueue}` +
      (r.hostiles ? `/敌${r.hostiles}` : ""));
  });
  const rrn = Object.keys(s.remoteRooms || {}).length;
  if (rrn) parts.push(`remote房=${rrn}`);
  return `[${ts()}] ` + parts.join(" ");
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const watch = args.includes("--watch");
  const once = args.includes("--once");

  async function tick() {
    try {
      const s = await sampleOnce();
      if (asJson) { console.log(JSON.stringify(s, null, 2)); return; }
      if (once) {
        const line = summaryLine(s);
        console.log(line);
        fs.appendFileSync(LOG_FILE, line + "\n");
        return;
      }
      // 面板模式：输出到 TTY 时清屏刷新；被重定向（后台/日志）时追加摘要行。
      if (watch && !process.stdout.isTTY) {
        const line = summaryLine(s);
        console.log(line);
        fs.appendFileSync(LOG_FILE, line + "\n");
        return;
      }
      if (watch) process.stdout.write("\x1b[2J\x1b[H");
      console.log(render(s));
    } catch (e) {
      console.error(`[${ts()}] 采样失败: ${e.message}`);
    }
  }

  await tick();
  if (watch) setInterval(tick, INTERVAL_SEC * 1000);
}

main();
