/**
 * 帝国全面数据采集器（私服）— 从 RCL1 全程记录，供离线后分析。
 *
 * 数据源：CLI 后门（storage.db + storage.env）— 与 monitor-empire 同通道，
 * 但输出面向**后分析**而非实时看板：
 *   - timeseries.jsonl：每 20 tick（私服 100ms/tick → 2s）一行紧凑时间序列，
 *     覆盖经济/人口/队列/布局缺口/CPU 遥测/事件摘要/决策状态
 *   - snapshots.jsonl：每 1000 tick 一行全量快照（己方房间 objects 全量
 *     + Memory 全量 + layout segment），用于回溯结构/资源/决策的精确状态
 *   - session.json：会话元信息（重置感知：gameTime 回退 → 新会话新文件，
 *     保证从 RCL1 开始的完整生命周期可分段重建）
 *
 * 用法：
 *   node tools/private/empire-collector.js              # 常驻采集（默认 20 tick 间隔）
 *   node tools/private/empire-collector.js --once       # 单次 timeseries 采样
 *   node tools/private/empire-collector.js --snapshot   # 单次全量快照采样
 *   node tools/private/empire-collector.js --interval-tick 10   # 10 tick 间隔
 *   node tools/private/empire-collector.js --snapshot-tick 500  # 快照频率
 *
 * 环境变量：SCREEPS_CONTAINER / SCREEPS_CLI_PORT（见 load-env）
 */
require("../load-env");
const fs = require("fs");
const path = require("path");
const { runCli } = require("./screeps-cli");

const COLLECT_DIR = path.join(__dirname, "data", "collect");
const TICK_MS = 100; // 私服 tick 间隔（用户提供）

// ─── 服务端采样表达式：timeseries（紧凑，每 20 tick）────────────────
//
// 一次 CLI 调用聚合：己方房间地面真相（structures/creeps/energy/资源全量）
// + Memory 决策态（队列/压力/布局/远矿）+ kernel（tier/skip/gaps/strategy）
// + segment 1 CPU 遥测 + segment 2 事件摘要。
const TIMESERIES_EXPR = `
(function(){
  return storage.db.users.find({steam:{$exists:true}}).then(function(us){
    var u=us[0]; if(!u) return JSON.stringify({err:"no-user"});
    var uid=""+u._id;
    return Promise.all([
      storage.db["rooms.objects"].find({}),
      storage.env.get(storage.env.keys.MEMORY+uid),
      storage.env.get(storage.env.keys.GAMETIME),
      storage.env.hgetall(storage.env.keys.MEMORY_SEGMENTS+uid)
    ]).then(function(r){
      var objs=r[0], memRaw=r[1], tick=r[2], segs=r[3]||{};
      var mem={}; try{ mem=JSON.parse(memRaw)||{}; }catch(e){}
      var kernel=mem.kernel||{};
      var cpuSeg=null, evSeg=null;
      try{ cpuSeg=JSON.parse(segs["1"]||"null"); }catch(e){}
      try{ evSeg=JSON.parse(segs["2"]||"null"); }catch(e){}
      var myCtrls=objs.filter(function(o){return o.type==="controller"&&o.user===uid;});
      var myRooms=myCtrls.map(function(c){return c.room;});
      var rooms={};
      myCtrls.forEach(function(c){rooms[c.room]={rcl:c.level,prog:c.progress,progTotal:c.progressTotal,safeMode:c.safeMode||0,downgrade:c.downgradeTime||0};});
      var byRoom={};
      function slot(room){
        if(!byRoom[room]) byRoom[room]={struct:{},creeps:{},body:{},creepCarry:0,creepTtl:0,creepN:0,
          energy:{spawnE:0,spawnCap:0,extE:0,extCap:0,contE:0,storE:0,termE:0,srcE:0,srcCap:0,towerE:0,towerCap:0},
          res:{},towers:[],links:[],nukers:[],powerSpawns:[],hostileBody:{},
          sites:0,hostiles:0,spawning:0,dropped:0,tombs:0,minerals:{}};
        return byRoom[room];
      }
      objs.forEach(function(o){
        var b=slot(o.room);
        if(o.type==="creep"){
          if(o.user===uid){
            var rn=(o.name||"").split("-")[0];
            b.creeps[rn]=(b.creeps[rn]||0)+1;
            b.creepN++; b.creepTtl+=(o.ticksToLive||0);
            var carry=0; for(var k in (o.store||{})){ if(k==="energy") carry+=o.store[k]; }
            b.creepCarry+=carry;
            (o.body||[]).forEach(function(p){ b.body[p.type]=(b.body[p.type]||0)+1; });
          } else {
            b.hostiles++;
            // 敌方 body 构成（军事威胁评估）：攻击/治疗/拆迁/boost 部件聚合。
            (o.body||[]).forEach(function(p){
              var key=p.type+(p.boost?"+b":"");
              if(p.type==="attack"||p.type==="rangedAttack"||p.type==="heal"||p.type==="rangedHeal"||p.type==="dismantle"||p.type==="claim"||p.type==="work"||p.boost){
                b.hostileBody[key]=(b.hostileBody[key]||0)+1;
              }
            });
          }
          return;
        }
        if(o.type==="source"){ b.energy.srcE+=(o.energy||0); b.energy.srcCap+=(o.energyCapacity||0); return; }
        if(o.type==="container"){ b.energy.contE+=((o.store&&o.store.energy)||0); b.struct.container=(b.struct.container||0)+1; return; }
        if(o.type==="tombstone"){ b.tombs++; return; }
        if(o.type==="energy"){ b.dropped+=(o.amount||0); return; }
        if(o.type==="mineral"){ b.minerals[o.mineralType||o.resourceType||"?"]=(o.amount||0); return; }
        if(o.type==="constructionSite"){ if(o.user===uid) b.sites++; return; }
        if(o.user!==uid) return;
        b.struct[o.type]=(b.struct[o.type]||0)+1;
        if(o.type==="spawn"){ b.energy.spawnE+=((o.store&&o.store.energy)||0); b.energy.spawnCap+=((o.storeCapacityResource&&o.storeCapacityResource.energy)||300); if(o.spawning) b.spawning++; }
        if(o.type==="extension"){ b.energy.extE+=((o.store&&o.store.energy)||0); b.energy.extCap+=((o.storeCapacityResource&&o.storeCapacityResource.energy)||50); }
        if(o.type==="tower"){ b.energy.towerE+=((o.store&&o.store.energy)||0); b.energy.towerCap+=((o.storeCapacityResource&&o.storeCapacityResource.energy)||1000); b.towers.push({x:o.x,y:o.y,e:(o.store&&o.store.energy)||0}); }
        if(o.type==="link"){ b.links.push({x:o.x,y:o.y,e:(o.store&&o.store.energy)||0}); }
        if(o.type==="nuker"){ b.nukers.push({x:o.x,y:o.y,cd:o.cooldown||0}); }
        if(o.type==="powerSpawn"){ b.powerSpawns.push({x:o.x,y:o.y}); }
        if(o.type==="storage"||o.type==="terminal"||o.type==="factory"||o.type==="lab"||o.type==="powerSpawn"||o.type==="nuker"){
          b.res[o.type]={};
          for(var rk in (o.store||{})){ b.res[o.type][rk]=o.store[rk]; }
          if(o.type==="storage") b.energy.storE+=((o.store&&o.store.energy)||0);
          if(o.type==="terminal") b.energy.termE+=((o.store&&o.store.energy)||0);
        }
      });
      // CPU 遥测：segment 1 最新样本（top3 系统 + bucket）。
      var seg0=null; try{ seg0=JSON.parse(segs["0"]||"null"); }catch(e){}
      var layoutBlocked={};
      if(seg0){
        Object.keys(seg0).forEach(function(rm){
          var d=seg0[rm]; if(!d||!d.blocked) return;
          var n=0; Object.keys(d.blocked).forEach(function(k){ n++; });
          layoutBlocked[rm]=n;
        });
      }
      var cpuTop=null;
      if(cpuSeg&&cpuSeg.cpu&&cpuSeg.cpu.d&&cpuSeg.cpu.d.length){
        var last=cpuSeg.cpu.d[cpuSeg.cpu.d.length-1];
        cpuTop={bucket:last.bk,cpu:last.cpu,
          s:[{n:last.s1,v:last.v1},{n:last.s2,v:last.v2},{n:last.s3,v:last.v3}].filter(function(x){return x.n;})};
      }
      // 事件摘要：segment 2 最近 10 条（含入侵/清除/safeMode/结构被毁等军事事件）。
      var events=[];
      var eventStats={};
      if(evSeg&&evSeg.events&&evSeg.events.d){
        var evd=evSeg.events.d;
        for(var i=Math.max(0,evd.length-10);i<evd.length;i++){ events.push(evd[i]); }
        // 环形缓冲全量事件分布（找趋势：入侵频率/塔战/死亡/调参回滚）。
        evd.forEach(function(ev){
          if(!ev) return;
          eventStats["k"+ev.k]=(eventStats["k"+ev.k]||0)+1;
          if(ev.k===17){
            eventStats.deaths=(eventStats.deaths||0)+1;
            if(ev.d&&ev.d.length>4&&ev.d[4]===0) eventStats.deathsViolent=(eventStats.deathsViolent||0)+1;
          }
        });
      }
      // creep 状态聚合（从 Memory.creeps）：per-room per-role 空转/卡位/任务分布。
      var creepMode={};
      var mcreeps=mem.creeps||{};
      Object.keys(mcreeps).forEach(function(cn){
        var c=mcreeps[cn]; if(!c||!c.home) return;
        var hm=c.home, role=c.role||"?";
        if(!creepMode[hm]) creepMode[hm]={};
        var st=creepMode[hm][role]||(creepMode[hm][role]={total:0,acquire:0,work:0,stuck:0,assigned:0});
        st.total++;
        if(c.mode==="acquire") st.acquire++; else if(c.mode==="work") st.work++;
        if((c.stuckTicks||0)>10) st.stuck++;
        if(c.assignment&&c.assignment.id) st.assigned++;
      });
      // tuning 引擎摘要（调参有效性后分析）。
      var tuning=null;
      var tun=mem.kernel&&mem.kernel.tuning;
      if(tun){
        var tunRooms=tun.rooms||{};
        var params=0, frozen=0, pending=0;
        Object.keys(tunRooms).forEach(function(rm){
          var tr=tunRooms[rm];
          params+=Object.keys(tr.lastAdjusted||{}).length;
          frozen+=Object.keys(tr.frozenParams||{}).length;
          pending+=Object.keys(tr.pendingValidation||{}).length;
        });
        tuning={lastTuned:tun.lastTuned||0,lastTunedAge:(tick-(tun.lastTuned||0)),
          baselineMatch:tun.baselineVersion===undefined?null:tun.baselineVersion,
          rooms:Object.keys(tunRooms).length,params:frozen,pending:pending};
      }
      var roomViews=myRooms.map(function(rm){
        var b=byRoom[rm]||slot(rm);
        var rmem=(mem.rooms&&mem.rooms[rm])||{};
        var layout=rmem.layout||{};
        var bq=rmem.buildQueue||[];
        var bqBy={};
        var bqBlocked={};
        bq.forEach(function(t){
          if(t.state==="queued"||t.state==="site") bqBy[t.structureType]=(bqBy[t.structureType]||0)+1;
          if(t.state==="blocked") bqBlocked[t.structureType]=(bqBlocked[t.structureType]||0)+1;
        });
        var sq=rmem.spawnQueue||[];
        var sqBy={}; var sqCost=0;
        sq.forEach(function(r){ sqBy[r.role]=(sqBy[r.role]||0)+1; if(r.body) sqCost+=r.body.reduce(function(a,p){return a+(p.cost||0);},0); });
        var ro={}; var rop=rmem.remoteOps||{};
        Object.keys(rop).forEach(function(k){ ro[k]={state:rop[k].state,haulerNeed:rop[k].haulerNeed,
          threat:!!rop[k].threat,threatUntil:rop[k].threatUntil||0,
          blockedUntil:rop[k].blockedUntil||0,lastSeen:rop[k].lastSeen||0}; });
        // 邻居情报摘要（扩张/威胁决策依据）：条目数 + 未过期危险房数。
        var intel=rmem.intel||{};
        var intelDanger=0;
        Object.keys(intel).forEach(function(k){ if(intel[k].dangerUntil&&intel[k].dangerUntil>tick) intelDanger++; });
        return {
          room:rm, rcl:rooms[rm].rcl, prog:rooms[rm].prog, progTotal:rooms[rm].progTotal,
          safeMode:rooms[rm].safeMode, downgrade:rooms[rm].downgrade,
          colonyState:rmem.colonyState||null, phase:(rmem.phase&&rmem.phase.phase)||null,
          economyPressure:rmem.economyPressure, storageNearFull:rmem.storageNearFull,
          spawnQueue:(rmem.spawnQueue||[]).length, spawnQueueByRole:sqBy, spawnQueueCost:sqCost,
          buildQueue:bq.length, buildQueueByType:bqBy, buildQueueBlocked:bqBlocked,
          droppedEnergy:b.dropped, tombstones:b.tombs, minerals:b.minerals,
          gaps:(kernel.layoutGaps&&kernel.layoutGaps[rm])||null,
          layout:{state:layout.state,revision:layout.revision,nextPlan:layout.nextPlanTick,nextGapPlan:layout.nextGapPlanTick,anchorScore:layout.anchorScore},
          struct:b.struct, sites:b.sites, spawning:b.spawning, hostiles:b.hostiles,
          hostileBody:b.hostileBody, nukers:b.nukers, powerSpawns:b.powerSpawns,
          intel:{entries:Object.keys(intel).length,danger:intelDanger},
          creepMode:creepMode[rm]||{},
          energy:{spawn:b.energy.spawnE,spawnCap:b.energy.spawnCap,ext:b.energy.extE,extCap:b.energy.extCap,
            cont:b.energy.contE,stor:b.energy.storE,term:b.energy.termE,src:b.energy.srcE,srcCap:b.energy.srcCap,
            tower:b.energy.towerE,towerCap:b.energy.towerCap},
          resources:b.res,
          creeps:b.creeps, creepCarry:b.creepCarry, creepTtlMean:b.creepN?Math.round(b.creepTtl/b.creepN):0,
          towers:b.towers, links:b.links, remoteOps:ro
        };
      });
      // 远矿/活动房实况：有我方 creep 或远程目标的非主房。
      var remoteTargets={};
      myRooms.forEach(function(rm){
        var rmem=(mem.rooms&&mem.rooms[rm])||{};
        var rop=rmem.remoteOps||{};
        Object.keys(rop).forEach(function(k){ remoteTargets[k]=true; });
      });
      var remoteRooms={};
      Object.keys(byRoom).forEach(function(rm){
        if(myRooms.indexOf(rm)>=0) return;
        var b=byRoom[rm];
        var myN=Object.keys(b.creeps).reduce(function(s,k){return s+b.creeps[k];},0);
        if(myN>0||remoteTargets[rm]){
          remoteRooms[rm]={creeps:b.creeps,hostiles:b.hostiles,contE:b.energy.contE,
            srcE:b.energy.srcE,dropped:b.dropped,isTarget:!!remoteTargets[rm]};
        }
      });
      return JSON.stringify({
        t:Number(tick), ts:Date.now(), sv:mem.schemaVersion||0, cpu:u.lastUsedCpu, gcl:u.gcl||0,
        kernel:{tier:kernel.tier||null,recoveryTicks:kernel.recoveryTicks||0,
          skipReasons:kernel.skipReasons||{},strategy:kernel.strategy||null,
          expansion:kernel.expansion||null,
          expansionBlacklist:Object.keys(kernel.expansionBlacklist||{}).length,
          tuning:tuning,
          gaps:kernel.layoutGaps||{}},
        layoutBlocked:layoutBlocked, cpuTop:cpuTop, events:events, eventStats:eventStats,
        rooms:roomViews, remoteRooms:remoteRooms
      });
    });
  });
})()`;

// ─── 服务端采样表达式：全量快照（每 1000 tick）──────────────────────
const SNAPSHOT_EXPR = `
(function(){
  return storage.db.users.find({steam:{$exists:true}}).then(function(us){
    var u=us[0]; if(!u) return JSON.stringify({err:"no-user"});
    var uid=""+u._id;
    return Promise.all([
      storage.db["rooms.objects"].find({}),
      storage.env.get(storage.env.keys.MEMORY+uid),
      storage.env.get(storage.env.keys.GAMETIME),
      storage.env.hgetall(storage.env.keys.MEMORY_SEGMENTS+uid)
    ]).then(function(r){
      var objs=r[0], memRaw=r[1], tick=r[2], segs=r[3]||{};
      var mem={}; try{ mem=JSON.parse(memRaw)||{}; }catch(e){}
      var myCtrls=objs.filter(function(o){return o.type==="controller"&&o.user===uid;});
      var myRooms={}; myCtrls.forEach(function(c){ myRooms[c.room]=true; });
      // 己方房间 + 有我方 creep 的活动房（含远矿）。
      var keep={}; Object.keys(myRooms).forEach(function(k){ keep[k]=true; });
      objs.forEach(function(o){
        if(o.type==="creep"&&o.user===uid&&!keep[o.room]) keep[o.room]=true;
      });
      var keepArr=Object.keys(keep);
      var objsOut=[];
      objs.forEach(function(o){
        if(!keep[o.room]) return;
        var slim={r:o.room,t:o.type,st:o.structureType,x:o.x,y:o.y};
        if(o.user===uid||o.type==="source"||o.type==="controller"||o.type==="mineral") slim.u=true;
        if(o.user&&o.user!==uid) slim.owner=String(o.user).slice(0,8); // 敌方/中立归属
        if(o.store) slim.store=o.store;
        if(o.energy!==undefined) slim.e=o.energy;
        if(o.energyCapacity!==undefined) slim.ec=o.energyCapacity;
        if(o.amount!==undefined) slim.amt=o.amount;
        if(o.mineralType!==undefined) slim.mt=o.mineralType;
        if(o.hits!==undefined) slim.h=o.hits;
        if(o.ticksToLive!==undefined) slim.ttl=o.ticksToLive;
        if(o.body) slim.body=o.body.map(function(p){return p.boost?p.type+"+"+p.boost:p.type;});
        if(o.spawning) slim.sp=o.spawning.name;
        if(o.cooldown!==undefined) slim.cd=o.cooldown;
        if(o.actionLog) slim.al=o.actionLog;
        if(o.level!==undefined) slim.lv=o.level;
        if(o.progress!==undefined) slim.pr=o.progress;
        if(o.progressTotal!==undefined) slim.pt=o.progressTotal;
        if(o.decayTime!==undefined) slim.dc=o.decayTime;
        if(o.downgradeTime!==undefined) slim.dg=o.downgradeTime;
        if(o.resourceType!==undefined) slim.rt=o.resourceType;
        objsOut.push(slim);
      });
      var segAll={};
      for(var si=0;si<=3;si++){
        try{ segAll[si]=JSON.parse(segs[""+si]||"null"); }catch(e){ segAll[si]=null; }
      }
      return JSON.stringify({
        t:Number(tick), ts:Date.now(), kind:"snapshot",
        objects:objsOut,
        memory:mem,
        segments:segAll,
        rooms:keepArr
      });
    });
  });
})()`;

// ─── 本地循环 ──────────────────────────────────────────────

function sessionFile(name) {
  return path.join(COLLECT_DIR, name);
}

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(sessionFile("session.json"), "utf8"));
  } catch {
    return null;
  }
}

async function sample(expr) {
  const raw = await runCli(expr, { timeoutMs: 30000 });
  const s = JSON.parse(raw);
  if (s && s.err) throw new Error(s.err);
  return s;
}

/** 采样一次 timeseries（返回 {data, tick}；gameTime 回退 → 新会话信号）。 */
async function sampleOnce() {
  const data = await sample(TIMESERIES_EXPR);
  return data;
}

async function snapshotOnce() {
  return sample(SNAPSHOT_EXPR);
}

/** 会话切换：重置感知（tick 回退 >= 1000）或首次运行。 */
function ensureSession(tick) {
  fs.mkdirSync(COLLECT_DIR, { recursive: true });
  const cur = loadSession();
  tick = Number(tick);
  const resetDetected = cur && tick !== undefined &&
    (tick + 1000 < cur.lastTick || (tick < cur.startTick));
  if (!cur || resetDetected) {
    const session = {
      id: `${tick ?? Date.now()}`,
      startedAt: new Date().toISOString(),
      startTick: tick ?? 0,
      lastTick: tick ?? 0,
      timeseries: `timeseries-${tick ?? Date.now()}.jsonl`,
      snapshots: `snapshots-${tick ?? Date.now()}.jsonl`,
      count: 0,
    };
    fs.writeFileSync(sessionFile("session.json"), JSON.stringify(session, null, 2));
    console.log(`[Collector] 新会话 ${session.id} @tick ${tick} (startTick=${session.startTick})`);
    return session;
  }
  cur.lastTick = tick ?? cur.lastTick;
  fs.writeFileSync(sessionFile("session.json"), JSON.stringify(cur, null, 2));
  return cur;
}

function append(session, fileKey, line) {
  fs.appendFileSync(sessionFile(session[fileKey]), JSON.stringify(line) + "\n");
  session.count++;
  session.lastTick = Number(line.t ?? session.lastTick);
  fs.writeFileSync(sessionFile("session.json"), JSON.stringify(session, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const snapshotOnly = args.includes("--snapshot");
  const intervalTick = parseInt(args[args.indexOf("--interval-tick") + 1] ?? "20", 10);
  const snapshotTick = parseInt(args[args.indexOf("--snapshot-tick") + 1] ?? "1000", 10);
  const intervalMs = intervalTick * TICK_MS;

  if (once) {
    const data = await sampleOnce();
    const session = ensureSession(data.t);
    append(session, "timeseries", data);
    console.log(`[Collector] #${session.count} tick=${data.t} rooms=${data.rooms.length}`);
    return;
  }
  if (snapshotOnly) {
    const data = await snapshotOnce();
    const session = ensureSession(data.t);
    append(session, "snapshots", data);
    console.log(`[Collector] snapshot #${session.count} tick=${data.t} objects=${data.objects.length}`);
    return;
  }

  console.log(`[Collector] 常驻采集：timeseries 每 ${intervalTick} tick (${intervalMs}ms)，快照每 ${snapshotTick} tick`);
  let lastTick = 0;
  let snapshotAt = 0;
  for (;;) {
    try {
      const data = await sampleOnce();
      const session = ensureSession(data.t);
      append(session, "timeseries", data);
      if (data.t >= snapshotAt) {
        const snap = await snapshotOnce();
        append(ensureSession(snap.t), "snapshots", snap);
        snapshotAt = snap.t + snapshotTick;
        console.log(`[Collector] @tick ${snap.t} snapshot objects=${snap.objects.length}`);
      }
      if (data.t !== lastTick) {
        lastTick = data.t;
      }
      console.log(`[Collector] @tick ${data.t} #${session.count} rooms=${data.rooms.length} cpu=${data.cpu}`);
    } catch (e) {
      console.error(`[Collector] 采样失败：${e.message}`);
    }
    // 固定墙钟间隔；采样耗时超过间隔时自然跳过（不补偿堆积）。
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
