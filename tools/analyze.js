/**
 * Analyze exported telemetry data for CPU hotspots and economic trends.
 */
const fs = require("fs");
const path = require("path");

const EXPORT_DIR = "./data/export";

function loadJson(filename) {
  const filepath = path.join(EXPORT_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return null;
  }
}

function analyze() {
  // 1. Timeseries analysis
  const ts = loadJson("timeseries.json");
  if (!ts) {
    console.log("No timeseries data found.");
    return;
  }

  const cpuRaw = ts.cpu || {};
  const cpuSamples = Array.isArray(cpuRaw) ? cpuRaw : (cpuRaw.d || []);
  const validCpu = cpuSamples.filter(s => s != null);

  console.log(`\n=== CPU Timeseries: ${validCpu.length} samples ===`);

  if (validCpu.length > 0) {
    // Aggregate by top system
    const systemTotals = {};
    let totalCpu = 0;
    let maxCpu = 0;
    let minBucket = Infinity;
    let tiers = { 0: 0, 1: 0, 2: 0, 3: 0 };

    for (const s of validCpu) {
      totalCpu += s.cpu;
      if (s.cpu > maxCpu) maxCpu = s.cpu;
      if (s.bk < minBucket) minBucket = s.bk;
      tiers[s.ti] = (tiers[s.ti] || 0) + 1;

      if (s.s1) systemTotals[s.s1] = (systemTotals[s.s1] || 0) + s.v1;
      if (s.s2) systemTotals[s.s2] = (systemTotals[s.s2] || 0) + s.v2;
      if (s.s3) systemTotals[s.s3] = (systemTotals[s.s3] || 0) + s.v3;
    }

    const avgCpu = totalCpu / validCpu.length;
    console.log(`  Avg CPU: ${avgCpu.toFixed(1)} | Max: ${maxCpu} | Min Bucket: ${minBucket}`);
    console.log(`  Tier distribution: healthy=${tiers[0]} guarded=${tiers[1]} conserve=${tiers[2]} recovery=${tiers[3]}`);

    console.log(`\n  System CPU breakdown (sum across all samples):`);
    const sorted = Object.entries(systemTotals).sort((a, b) => b[1] - a[1]);
    for (const [name, total] of sorted.slice(0, 10)) {
      const pct = (total / totalCpu * 100).toFixed(1);
      const avg = (total / validCpu.length).toFixed(2);
      console.log(`    ${name.padEnd(25)} total=${total.toFixed(1).padStart(7)} avg=${avg.padStart(6)} (${pct}%)`);
    }

    // Last 15 samples
    console.log(`\n  Last 15 samples:`);
    for (const s of validCpu.slice(-15)) {
      const top1 = `${s.s1 || ""}=${s.v1 || 0}`;
      const top2 = `${s.s2 || ""}=${s.v2 || 0}`;
      console.log(`    t=${s.t} cpu=${s.cpu} bk=${s.bk} tier=${s.ti} skip=${s.sk} err=${s.er} | ${top1} ${top2}`);
    }
  }

  // 2. Economy analysis
  const ecoRaw = ts.economy || {};
  const ecoSamples = Array.isArray(ecoRaw) ? ecoRaw : (ecoRaw.d || []);
  const validEco = ecoSamples.filter(s => s != null);

  console.log(`\n=== Economy Timeseries: ${validEco.length} samples ===`);
  if (validEco.length > 0) {
    for (const s of validEco.slice(-10)) {
      const phName = ["bootstrap","growth","crisis","recovery","steady"][s.ph] || "?";
      console.log(`  t=${s.t} r=${s.r} reserve=${s.rs} delta=${s.d} drain=${s.ds} pressure=${s.p}% ea=${s.ea}/${s.ec} storage=${s.se} hv=${s.hc} phase=${phName}`);
    }
  }

  // 3. Population
  const pop = ts.population;
  if (pop) {
    console.log(`\n=== Population Snapshot (t=${pop.t}) ===`);
    console.log(`  harvester=${pop.hv} hauler=${pop.ha} upgrader=${pop.up} builder=${pop.bd} worker=${pop.wk}`);
    console.log(`  TTL: hv=${pop.hvTtl} ha=${pop.haTtl} up=${pop.upTtl} bd=${pop.bdTtl}`);
    console.log(`  spawnQueue=${pop.sq} spawning=${pop.sp} p0=${pop.p0}`);
  }

  // 4. Memory analysis
  const mem = loadJson("memory-full.json");
  if (mem) {
    console.log(`\n=== Memory Analysis ===`);
    if (mem.kernel) {
      console.log(`  tier=${mem.kernel.tier} recoveryTicks=${mem.kernel.recoveryTicks}`);
      if (mem.kernel.stats) {
        console.log(`  stats: cpuAvg10=${mem.kernel.stats.cpuAvg10} cpuMax10=${mem.kernel.stats.cpuMax10} bucketMin10=${mem.kernel.stats.bucketMin10} crisis=${mem.kernel.stats.crisisCount}`);
        console.log(`  errorHotspot=${mem.kernel.stats.errorHotspot || "(none)"} skipHotspot=${mem.kernel.stats.skipHotspot || "(none)"}`);
      }
      if (mem.kernel.skipReasons) {
        console.log(`\n  Skip Reasons (top 10):`);
        const skips = Object.entries(mem.kernel.skipReasons).sort((a, b) => b[1] - a[1]);
        for (const [reason, count] of skips.slice(0, 10)) {
          console.log(`    ${reason.padEnd(40)} ${count}`);
        }
      }
      if (mem.kernel.tuning) {
        console.log(`\n  Tuning: lastTuned=${mem.kernel.tuning.lastTuned}`);
        if (mem.kernel.tuning.lastEval) {
          const evals = Array.isArray(mem.kernel.tuning.lastEval) ? mem.kernel.tuning.lastEval : Object.values(mem.kernel.tuning.lastEval);
          for (const e of evals) {
            console.log(`    room=${e.room || "?"} tick=${e.tick} adjustments=${JSON.stringify(e.adjustments || [])}`);
            if (e.signals) {
              console.log(`    signals: ${JSON.stringify(e.signals)}`);
            }
          }
        }
      }
    }

    if (mem.rooms) {
      console.log(`\n=== Room Memory ===`);
      for (const [name, room] of Object.entries(mem.rooms)) {
        const r = room || {};
        console.log(`  ${name}: colonyState=${r.colonyState} pressure=${r.economyPressure}`);
        if (r.phase) {
          console.log(`    phase=${r.phase.phase} reserve=${r.phase.reserve} delta=${r.phase.reserveDelta} drain=${r.phase.drainScore} hv=${r.phase.harvesterCount} rcl=${r.phase.rcl}`);
        }
        if (r.spawnQueue) console.log(`    spawnQueue=${r.spawnQueue.length}`);
        if (r.buildQueue) {
          const byState = {};
          for (const t of r.buildQueue) byState[t.state] = (byState[t.state] || 0) + 1;
          console.log(`    buildQueue=${r.buildQueue.length} states=${JSON.stringify(byState)}`);
        }
        if (r.layout) console.log(`    layout=${r.layout.templateId} v${r.layout.version} rev${r.layout.revision} state=${r.layout.state}`);
      }
    }

    if (mem.creeps) {
      const creepCount = Object.keys(mem.creeps).length;
      const roles = {};
      for (const c of Object.values(mem.creeps)) {
        const role = (c || {}).role || "unknown";
        roles[role] = (roles[role] || 0) + 1;
      }
      console.log(`\n=== Creeps: ${creepCount} total ===`);
      for (const [role, count] of Object.entries(roles)) {
        console.log(`  ${role}: ${count}`);
      }
    }
  }

  // 5. Events
  const events = loadJson("events.json");
  if (events) {
    const eventList = events.events || events.d || events;
    if (Array.isArray(eventList)) {
      const valid = eventList.filter(e => e != null);
      console.log(`\n=== Events: ${valid.length} total ===`);
      const kindNames = ["TierDown","TierUp","PhaseChange","ColonyChange","RclUp","Invasion","EnemyCleared","DowngradeRisk"];
      const byKind = {};
      for (const e of valid) {
        byKind[e.k] = (byKind[e.k] || 0) + 1;
      }
      for (const [k, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
        console.log(`  kind=${k} (${kindNames[k] || "?"}): ${count}`);
      }
      // Last 10 events
      console.log(`\n  Last 10 events:`);
      for (const e of valid.slice(-10)) {
        console.log(`    t=${e.t} kind=${kindNames[e.k] || e.k} room=${e.r || ""} data=${JSON.stringify(e.d || [])}`);
      }
    }
  }

  // 6. Overview
  const overview = loadJson("overview.json");
  if (overview && overview.data) {
    const d = overview.data;
    console.log(`\n=== Overview ===`);
    if (d.cpu) console.log(`  CPU: ${JSON.stringify(d.cpu.slice(-5))}`);
    if (d.bucket) console.log(`  Bucket: ${JSON.stringify(d.bucket.slice(-5))}`);
    if (d.rooms) console.log(`  Rooms: ${JSON.stringify(d.rooms)}`);
  }
}

analyze();
