/**
 * 跨会话 snapshot 抽样分析 —— 从全部 snapshots-*.jsonl 流式提取关键指标。
 *
 * 输入：tools/private/data/collect/snapshots-*.jsonl + snapshot-sampled-*.json
 * 输出：每会话时间序列摘要 + 跨会话演化报告（stdout + snapshot-analysis.json）
 *
 * 用法：node tools/private/analyze-snapshots.js [--sample-every N]（默认每 50 行取 1 行）
 *
 * 提取指标：
 *   - tick / RCL / GCL / colonyState / phase / posture / tier
 *   - storage / terminal / source energy / container energy
 *   - population (per role) / spawnQueue / buildQueue (state 分布)
 *   - 关键结构计数（spawn/extension/tower/link/lab/terminal/storage/rampart/wall）
 *   - 远矿状态（W3N8 等）
 *   - CPU / bucket / skipReasons top3
 *   - 事件累加（k15/k16/k17/k7/k8 等）
 *   - layoutBlocked / frozenParams / pendingValidation
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const COLLECT_DIR = path.join(__dirname, "data", "collect");
const args = process.argv.slice(2);
const sampleEveryIdx = args.indexOf("--sample-every");
const SAMPLE_EVERY = parseInt(args[sampleEveryIdx + 1] ?? "50", 10);

// ─── 单 snapshot 提取关键指标 ─────────────────────────────────
function extractMetrics(snap) {
  const t = Number(snap.t);
  const objs = snap.objects || [];
  const mem = snap.memory || {};
  const segs = snap.segments || {};
  const sv = mem.schemaVersion || 0;
  const kernel = mem.kernel || {};

  // 按房间聚合
  const byRoom = {};
  objs.forEach(o => {
    if (!byRoom[o.r]) byRoom[o.r] = [];
    byRoom[o.r].push(o);
  });

  // 我方主房（有 controller 且属于自己）
  const myRooms = [];
  for (const [rm, list] of Object.entries(byRoom)) {
    const ctrl = list.find(o => o.t === "controller" && o.u);
    if (ctrl) myRooms.push({ room: rm, list, ctrl });
  }

  // 全局指标
  const gcl = mem.gcl || 0;
  const cpuTop = segs["1"] && segs["1"].cpu && segs["1"].cpu.d;
  const lastCpu = cpuTop ? cpuTop[cpuTop.length - 1] : null;
  const evSeg = segs["2"] && segs["2"].events && segs["2"].events.d;

  // 事件累加（环形缓冲）
  const eventStats = {};
  if (evSeg) {
    evSeg.forEach(ev => {
      if (!ev) return;
      eventStats["k" + ev.k] = (eventStats["k" + ev.k] || 0) + 1;
    });
  }

  // 每个主房的视图
  const rooms = myRooms.map(({ room, list, ctrl }) => {
    const rmem = (mem.rooms && mem.rooms[room]) || {};
    const types = {};
    list.forEach(o => { types[o.t] = (types[o.t] || 0) + 1; });

    const storage = list.find(o => o.t === "storage");
    const terminal = list.find(o => o.t === "terminal");
    const sources = list.filter(o => o.t === "source");
    const containers = list.filter(o => o.t === "container");
    const myCreeps = list.filter(o => o.t === "creep" && o.u);
    const hostiles = list.filter(o => o.t === "creep" && !o.u);
    const sites = list.filter(o => o.t === "constructionSite");

    // per-role creep 计数
    const roleCount = {};
    myCreeps.forEach(c => {
      const role = (c.name || "").split("-")[0] || "?";
      roleCount[role] = (roleCount[role] || 0) + 1;
    });

    // buildQueue 状态
    const bq = rmem.buildQueue || [];
    const bqState = { queued: 0, site: 0, blocked: 0, done: 0 };
    const bqBlockedTypes = {};
    bq.forEach(task => {
      if (bqState[task.state] !== undefined) bqState[task.state]++;
      if (task.state === "blocked") bqBlockedTypes[task.structureType] = (bqBlockedTypes[task.structureType] || 0) + 1;
    });

    // spawnQueue
    const sq = rmem.spawnQueue || [];
    const sqByRole = {};
    sq.forEach(r => { sqByRole[r.role] = (sqByRole[r.role] || 0) + 1; });

    // 远矿
    const remoteOps = rmem.remoteOps || {};

    return {
      room,
      rcl: ctrl.lv,
      rclProgress: ctrl.pr,
      rclTotal: ctrl.pt,
      downgrade: ctrl.dg,
      safeMode: ctrl.safeMode || 0,
      colonyState: rmem.colonyState,
      phase: rmem.phase && rmem.phase.phase,
      economyPressure: rmem.economyPressure,
      storageNearFull: rmem.storageNearFull,
      struct: types,
      storage: storage ? storage.store : null,
      terminal: terminal ? terminal.store : null,
      srcEnergy: sources.map(s => s.e),
      srcCap: sources.map(s => s.ec),
      containerEnergy: containers.map(c => (c.store && c.store.energy) || 0),
      myCreeps: myCreeps.length,
      roleCount,
      hostiles: hostiles.length,
      sites: sites.length,
      spawnQueueLen: sq.length,
      spawnQueueByRole: sqByRole,
      buildQueueLen: bq.length,
      buildQueueState: bqState,
      buildQueueBlockedTypes: bqBlockedTypes,
      layout: rmem.layout,
      remoteOps: Object.keys(remoteOps).map(k => ({
        target: k,
        state: remoteOps[k].state,
        haulerNeed: remoteOps[k].haulerNeed,
        dangerUntil: remoteOps[k].dangerUntil,
        lastSeen: remoteOps[k].lastSeen,
      })),
    };
  });

  // 远矿房（有我方 creep 但非主房）
  const remoteRooms = [];
  for (const [rm, list] of Object.entries(byRoom)) {
    const isMy = myRooms.some(m => m.room === rm);
    if (isMy) continue;
    const myCreeps = list.filter(o => o.t === "creep" && o.u);
    if (myCreeps.length === 0) continue;
    const sources = list.filter(o => o.t === "source");
    const ctrl = list.find(o => o.t === "controller");
    remoteRooms.push({
      room: rm,
      myCreeps: myCreeps.length,
      srcEnergy: sources.map(s => s.e),
      ctrlLevel: ctrl ? ctrl.lv : null,
      ctrlReservation: ctrl ? ctrl.reservation : null,
    });
  }

  // tuning
  const tuning = kernel.tuning;
  const tuningSummary = tuning && tuning.rooms ? Object.entries(tuning.rooms).map(([rm, tr]) => ({
    room: rm,
    roleBounds: tr.roleBounds,
    frozenParams: Object.keys(tr.frozenParams || {}),
    pendingValidation: Object.keys(tr.pendingValidation || {}),
    lastTrend: tr.lastTrend,
  })) : [];

  // skipReasons top3
  const skipReasons = kernel.skipReasons || {};
  const skipTop = Object.entries(skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return {
    t,
    sv,
    gcl,
    rooms,
    remoteRooms,
    kernel: {
      tier: kernel.tier,
      recoveryTicks: kernel.recoveryTicks,
      strategy: kernel.strategy,
      skipTop,
      tuning: tuningSummary,
    },
    cpu: lastCpu ? { cpu: lastCpu.cpu, bucket: lastCpu.bk } : null,
    eventStats,
  };
}

// ─── 流式读取 jsonl，按间隔抽样 ──────────────────────────────
async function processJsonl(file, sampleEvery) {
  const samples = [];
  const fileStream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let lineIdx = 0;
  let totalLines = 0;
  let firstTick = null;
  let lastTick = null;

  for await (const line of rl) {
    if (!line) continue;
    totalLines++;
    if (totalLines === 1 || totalLines % sampleEvery === 0) {
      try {
        const snap = JSON.parse(line);
        const tick = Number(snap.t);
        if (firstTick === null) firstTick = tick;
        lastTick = tick;
        samples.push(extractMetrics(snap));
      } catch (e) { /* skip malformed line */ }
    }
    lineIdx++;
  }
  return { file, totalLines, samples, firstTick, lastTick };
}

// ─── 处理 single-snapshot JSON ───────────────────────────────
function processSingleJson(file) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    file,
    totalLines: 1,
    samples: [extractMetrics(snap)],
    firstTick: Number(snap.t),
    lastTick: Number(snap.t),
  };
}

// ─── 主流程 ──────────────────────────────────────────────────
async function main() {
  const allFiles = fs.readdirSync(COLLECT_DIR)
    .filter(f => f.startsWith("snapshot") && (f.endsWith(".jsonl") || f.endsWith(".json")))
    .sort();

  console.log(`[Scan] 发现 ${allFiles.length} 个 snapshot 文件`);
  console.log(`[Config] 每 ${SAMPLE_EVERY} 行抽样 1 行\n`);

  const results = [];
  for (const f of allFiles) {
    const full = path.join(COLLECT_DIR, f);
    const stat = fs.statSync(full);
    const sizeMB = (stat.size / 1048576).toFixed(1);
    process.stdout.write(`[Processing] ${f} (${sizeMB}MB) ... `);
    try {
      let r;
      if (f.endsWith(".jsonl")) {
        r = await processJsonl(full, SAMPLE_EVERY);
      } else {
        r = processSingleJson(full);
      }
      console.log(`lines=${r.totalLines} samples=${r.samples.length} tick ${r.firstTick}→${r.lastTick}`);
      results.push(r);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  // 输出每个会话的精简摘要
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("跨会话演化摘要");
  console.log("═══════════════════════════════════════════════════════════════");
  for (const r of results) {
    if (r.samples.length === 0) continue;
    console.log(`\n┌─ ${r.file}`);
    console.log(`│ lines=${r.totalLines} samples=${r.samples.length} tick ${r.firstTick}→${r.lastTick} (跨度=${Number(r.lastTick)-Number(r.firstTick)})`);
    // 首末样本对比
    const first = r.samples[0];
    const last = r.samples[r.samples.length - 1];
    console.log(`│ 首样本: tick=${first.t} sv=${first.sv} gcl=${first.gcl} tier=${first.kernel.tier} posture=${first.kernel.strategy && first.kernel.strategy.posture}`);
    for (const room of first.rooms) {
      console.log(`│   ${room.room}: RCL=${room.rcl} state=${room.colonyState} phase=${room.phase} stor=${room.storage ? room.storage.energy : 0} pop=${room.myCreeps} srcE=${JSON.stringify(room.srcEnergy)}`);
    }
    if (first.remoteRooms.length) {
      console.log(`│   远矿: ${first.remoteRooms.map(rr => `${rr.room}(creeps=${rr.myCreeps},srcE=${JSON.stringify(rr.srcEnergy)},ctrl=${rr.ctrlLevel})`).join(" ")}`);
    }
    console.log(`│ 末样本: tick=${last.t} sv=${last.sv} gcl=${last.gcl} tier=${last.kernel.tier} posture=${last.kernel.strategy && last.kernel.strategy.posture}`);
    for (const room of last.rooms) {
      console.log(`│   ${room.room}: RCL=${room.rcl} state=${room.colonyState} phase=${room.phase} stor=${room.storage ? room.storage.energy : 0} pop=${room.myCreeps} srcE=${JSON.stringify(room.srcEnergy)}`);
      if (Object.keys(room.buildQueueBlockedTypes).length) {
        console.log(`│     buildQueueBlocked: ${JSON.stringify(room.buildQueueBlockedTypes)}`);
      }
      if (room.spawnQueueLen) {
        console.log(`│     spawnQueue: ${JSON.stringify(room.spawnQueueByRole)}`);
      }
    }
    if (last.remoteRooms.length) {
      console.log(`│   远矿: ${last.remoteRooms.map(rr => `${rr.room}(creeps=${rr.myCreeps},srcE=${JSON.stringify(rr.srcEnergy)},ctrl=${rr.ctrlLevel})`).join(" ")}`);
    }
    if (last.kernel.tuning.length) {
      const tr = last.kernel.tuning[0];
      console.log(`│   tuning: roleBounds=${JSON.stringify(tr.roleBounds)} frozen=${JSON.stringify(tr.frozenParams)} pending=${JSON.stringify(tr.pendingValidation)}`);
    }
    // 中间样本的 RCL 变化
    const rclChanges = [];
    let prevRcl = first.rooms[0] ? first.rooms[0].rcl : null;
    for (const s of r.samples) {
      const cur = s.rooms[0] ? s.rooms[0].rcl : null;
      if (cur !== null && cur !== prevRcl) {
        rclChanges.push({ tick: s.t, from: prevRcl, to: cur });
        prevRcl = cur;
      }
    }
    if (rclChanges.length) {
      console.log(`│ RCL 变化: ${rclChanges.map(c => `${c.tick}:${c.from}→${c.to}`).join(", ")}`);
    }
  }

  // 写入 JSON
  const outFile = path.join(COLLECT_DIR, "snapshot-analysis.json");
  const compact = results.map(r => ({
    file: r.file,
    totalLines: r.totalLines,
    firstTick: r.firstTick,
    lastTick: r.lastTick,
    samples: r.samples,
  }));
  fs.writeFileSync(outFile, JSON.stringify(compact, null, 2));
  console.log(`\n[Output] ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
