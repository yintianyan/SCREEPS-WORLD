/**
 * Analyze exported telemetry data — CPU hotspots, economic trends, build queue, and operational diagnostics.
 *
 * Reads from data/export/:
 *   cpu.json       — Segment 1 (CPU timeseries + population)
 *   economy.json   — Segment 3 (economy timeseries per room)
 *   events.json    — Segment 2 (event log)
 *   memory-full.json — Full Memory root (kernel stats, rooms, creeps)
 *   overview.json  — Screeps API overview
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

function ringData(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw.d && Array.isArray(raw.d)) return raw.d;
  return [];
}

// ─── 1. CPU Timeseries ─────────────────────────────────────

function analyzeCpu() {
  const cpuSeg = loadJson("cpu.json");
  if (!cpuSeg) {
    console.log("=== CPU: No data (cpu.json not found) ===\n");
    return;
  }

  const cpuSamples = ringData(cpuSeg.cpu).filter(s => s != null);
  console.log(`=== CPU Timeseries: ${cpuSamples.length} samples ===`);

  if (cpuSamples.length === 0) return;

  const systemTotals = {};
  let totalCpu = 0;
  let maxCpu = 0;
  let minBucket = Infinity;
  let tiers = { 0: 0, 1: 0, 2: 0, 3: 0 };

  for (const s of cpuSamples) {
    totalCpu += s.cpu;
    if (s.cpu > maxCpu) maxCpu = s.cpu;
    if (s.bk < minBucket) minBucket = s.bk;
    tiers[s.ti] = (tiers[s.ti] || 0) + 1;

    if (s.s1) systemTotals[s.s1] = (systemTotals[s.s1] || 0) + s.v1;
    if (s.s2) systemTotals[s.s2] = (systemTotals[s.s2] || 0) + s.v2;
    if (s.s3) systemTotals[s.s3] = (systemTotals[s.s3] || 0) + s.v3;
  }

  const avgCpu = totalCpu / cpuSamples.length;
  console.log(`  Avg CPU: ${avgCpu.toFixed(1)} | Max: ${maxCpu} | Min Bucket: ${minBucket}`);
  console.log(`  Tier distribution: healthy=${tiers[0]} guarded=${tiers[1]} conserve=${tiers[2]} recovery=${tiers[3]}`);

  // CPU 趋势：将采样分为 4 段，看趋势
  const quarter = Math.floor(cpuSamples.length / 4);
  if (quarter > 0) {
    const segAvg = [];
    for (let i = 0; i < 4; i++) {
      const seg = cpuSamples.slice(i * quarter, (i + 1) * quarter);
      const avg = seg.reduce((a, b) => a + b.cpu, 0) / seg.length;
      segAvg.push(avg.toFixed(1));
    }
    console.log(`  CPU trend (Q1→Q4): ${segAvg.join(" → ")} — ${segAvg[3] > segAvg[0] ? "↑ rising" : segAvg[3] < segAvg[0] ? "↓ falling" : "→ stable"}`);
  }

  console.log(`\n  System CPU breakdown (sum across all samples):`);
  const sorted = Object.entries(systemTotals).sort((a, b) => b[1] - a[1]);
  for (const [name, total] of sorted.slice(0, 10)) {
    const pct = (total / totalCpu * 100).toFixed(1);
    const avg = (total / cpuSamples.length).toFixed(2);
    console.log(`    ${name.padEnd(30)} total=${total.toFixed(1).padStart(7)} avg=${avg.padStart(6)} (${pct}%)`);
  }

  // 最近 15 个采样
  console.log(`\n  Last 15 CPU samples:`);
  for (const s of cpuSamples.slice(-15)) {
    const top1 = `${s.s1 || ""}=${s.v1 || 0}`;
    const top2 = `${s.s2 || ""}=${s.v2 || 0}`;
    console.log(`    t=${s.t} cpu=${s.cpu} bk=${s.bk} tier=${s.ti} skip=${s.sk} err=${s.er} | ${top1} ${top2}`);
  }

  // 人口普查
  const pop = cpuSeg.population;
  if (pop) {
    console.log(`\n  Population Snapshot (t=${pop.t}):`);
    console.log(`    harvester=${pop.hv} hauler=${pop.ha} upgrader=${pop.up} builder=${pop.bd} worker=${pop.wk}`);
    console.log(`    TTL: hv=${pop.hvTtl} ha=${pop.haTtl} up=${pop.upTtl} bd=${pop.bdTtl}`);
    console.log(`    spawnQueue=${pop.sq} spawning=${pop.sp} p0=${pop.p0}`);
    // mode 分布（P1 遥测改进）
    const total = pop.hv + pop.ha + pop.up + pop.bd + pop.wk;
    const idlePct = total > 0 ? Math.round(pop.mi / total * 100) : 0;
    console.log(`    Mode: acquire=${pop.ma ?? 0} work=${pop.mw ?? 0} idle=${pop.mi ?? 0} (${idlePct}% idle) flee=${pop.mf ?? 0}`);
  }
  console.log();
}

// ─── 2. Economy Timeseries ─────────────────────────────────

function analyzeEconomy() {
  const ecoSeg = loadJson("economy.json");
  if (!ecoSeg) {
    console.log("=== Economy: No data (economy.json not found) ===\n");
    return;
  }

  const ecoSamples = ringData(ecoSeg.economy).filter(s => s != null);
  console.log(`=== Economy Timeseries: ${ecoSamples.length} samples ===`);

  if (ecoSamples.length === 0) return;

  // 按房间分组
  const byRoom = {};
  for (const s of ecoSamples) {
    if (!byRoom[s.r]) byRoom[s.r] = [];
    byRoom[s.r].push(s);
  }

  for (const [room, samples] of Object.entries(byRoom)) {
    console.log(`\n  Room ${room} (${samples.length} samples):`);

    // 统计
    let avgReserve = 0, avgDelta = 0, avgPressure = 0, avgStorage = 0;
    let maxPressure = 0, crisisCount = 0;
    let avgContainer = 0, avgCtrlContainer = 0;
    for (const s of samples) {
      avgReserve += s.rs;
      avgDelta += s.d;
      avgPressure += s.p;
      avgStorage += s.se;
      if (s.p > maxPressure) maxPressure = s.p;
      if (s.ph === 2) crisisCount++;
      if (s.cte != null) avgContainer += s.cte;
      if (s.cce != null) avgCtrlContainer += s.cce;
    }
    const n = samples.length;
    avgReserve /= n; avgDelta /= n; avgPressure /= n; avgStorage /= n;
    avgContainer /= n; avgCtrlContainer /= n;

    console.log(`    Avg Reserve: ${avgReserve.toFixed(0)} | Avg Delta: ${avgDelta.toFixed(1)}/tick | Avg Pressure: ${avgPressure.toFixed(1)}%`);
    console.log(`    Max Pressure: ${maxPressure}% | Crisis samples: ${crisisCount}/${n} (${(crisisCount/n*100).toFixed(0)}%)`);
    console.log(`    Avg Storage: ${avgStorage.toFixed(0)} | Avg Container: ${avgContainer.toFixed(0)} | Avg CtrlContainer: ${avgCtrlContainer.toFixed(0)}`);

    // 最近 10 个采样
    console.log(`    Last 10 samples:`);
    for (const s of samples.slice(-10)) {
      const phName = ["bootstrap","growth","crisis","recovery","steady"][s.ph] || "?";
      console.log(`      t=${s.t} reserve=${s.rs} delta=${s.d} drain=${s.ds} pressure=${s.p}% ea=${s.ea}/${s.ec} storage=${s.se} container=${s.cte || 0} ctrlCt=${s.cce || 0} hv=${s.hc} phase=${phName}`);
    }
  }
  console.log();
}

// ─── 3. Memory & Kernel ────────────────────────────────────

function analyzeMemory() {
  const mem = loadJson("memory-full.json");
  if (!mem) {
    console.log("=== Memory: No data (memory-full.json not found) ===\n");
    return;
  }

  console.log(`=== Memory Analysis ===`);
  if (mem.kernel) {
    console.log(`  tier=${mem.kernel.tier} recoveryTicks=${mem.kernel.recoveryTicks}`);
    if (mem.kernel.stats) {
      const s = mem.kernel.stats;
      console.log(`  stats: cpuAvg10=${s.cpuAvg10} cpuMax10=${s.cpuMax10} bucketMin10=${s.bucketMin10} crisis=${s.crisisCount}`);
      console.log(`  errorHotspot=${s.errorHotspot || "(none)"} skipHotspot=${s.skipHotspot || "(none)"}`);
    }
    if (mem.kernel.skipReasons) {
      console.log(`\n  Skip Reasons (top 15):`);
      const skips = Object.entries(mem.kernel.skipReasons).sort((a, b) => b[1] - a[1]);
      for (const [reason, count] of skips.slice(0, 15)) {
        const pct = (count / mem.kernel.stats?.lastSample || 1 * 100).toFixed(0);
        console.log(`    ${reason.padEnd(45)} ${String(count).padStart(5)}`);
      }
    }
    if (mem.kernel.tuning) {
      console.log(`\n  Tuning: lastTuned=${mem.kernel.tuning.lastTuned}`);
      if (mem.kernel.tuning.lastEval) {
        const evals = Array.isArray(mem.kernel.tuning.lastEval) ? mem.kernel.tuning.lastEval : Object.values(mem.kernel.tuning.lastEval);
        for (const e of evals) {
          if (!e || !e.signals) continue;
          console.log(`    room=${e.room || "?"} tick=${e.tick}`);
          const sig = e.signals;
          console.log(`      rcl=${sig.rcl} tier=${sig.tierRank} | hv=${sig.harvesterCount} ha=${sig.haulerCount} up=${sig.upgraderCount} bd=${sig.builderCount}`);
          console.log(`      reserveDelta=${sig.avgReserveDelta} pressure=${sig.avgPressure} drain=${sig.avgDrainScore} crisisRatio=${sig.crisisRatio}`);
          console.log(`      storageEnergy=${sig.avgStorageEnergy} containerFill=${sig.containerFillRatio} buildBacklog=${sig.buildQueueBacklog}`);
          if (e.adjustments && e.adjustments.length > 0) {
            console.log(`      adjustments: ${JSON.stringify(e.adjustments)}`);
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
        const byType = {};
        for (const t of r.buildQueue) {
          byState[t.state] = (byState[t.state] || 0) + 1;
          byType[t.structureType] = (byType[t.structureType] || 0) + 1;
        }
        console.log(`    buildQueue=${r.buildQueue.length} states=${JSON.stringify(byState)}`);
        console.log(`    byType: ${JSON.stringify(byType)}`);

        // 找出 storage 任务
        const storageTasks = r.buildQueue.filter(t => t.structureType === "storage");
        if (storageTasks.length > 0) {
          console.log(`    ** STORAGE TASKS: ${storageTasks.length} **`);
          for (const t of storageTasks) {
            console.log(`       key=${t.key} pos=${t.pos.x},${t.pos.y} state=${t.state} priority=${t.priority} attempts=${t.attempts}`);
          }
        } else {
          console.log(`    ** NO STORAGE TASK IN QUEUE **`);
        }

        // 找出 priority 0 的任务
        const p0Tasks = r.buildQueue.filter(t => t.priority === 0 && t.state === "queued");
        if (p0Tasks.length > 0) {
          console.log(`    P0 queued tasks:`);
          for (const t of p0Tasks) {
            console.log(`       ${t.structureType} at ${t.pos.x},${t.pos.y} key=${t.key}`);
          }
        }
      }
      if (r.layout) console.log(`    layout=${r.layout.templateId} v${r.layout.version} rev${r.layout.revision} state=${r.layout.state}`);
    }
  }

  if (mem.creeps) {
    const creepCount = Object.keys(mem.creeps).length;
    const roles = {};
    const ttls = {};
    for (const c of Object.values(mem.creeps)) {
      const role = (c || {}).role || "unknown";
      roles[role] = (roles[role] || 0) + 1;
      const ttl = (c || {}).ticksToLive ?? 0;
      if (!ttls[role]) ttls[role] = [];
      ttls[role].push(ttl);
    }
    console.log(`\n=== Creeps: ${creepCount} total ===`);
    for (const [role, count] of Object.entries(roles)) {
      const ttlArr = ttls[role] || [];
      const minTtl = ttlArr.length > 0 ? Math.min(...ttlArr) : "?";
      const maxTtl = ttlArr.length > 0 ? Math.max(...ttlArr) : "?";
      console.log(`  ${role}: ${count} (TTL ${minTtl}–${maxTtl})`);
    }
  }
  console.log();
}

// ─── 4. Events ─────────────────────────────────────────────

function analyzeEvents() {
  const events = loadJson("events.json");
  if (!events) {
    console.log("=== Events: No data ===\n");
    return;
  }

  const eventList = ringData(events.events || events);
  const valid = eventList.filter(e => e != null);
  console.log(`=== Events: ${valid.length} total ===`);

  const kindNames = [
    "PhaseTransition",      // 0
    "TierDowngrade",       // 1
    "TierUpgrade",         // 2
    "ColonyStateChange",   // 3
    "ControllerLevelUp",   // 4
    "DowngradeRisk",       // 5
    "P0Spawn",             // 6
    "EnemyInvasion",       // 7
    "EnemyCleared",        // 8
    "SafeMode",            // 9
    "PluginCooldown",      // 10
    "CreepStuck",          // 11
    "BuildComplete",       // 12
    "StructureDestroyed",  // 13
    "AssignmentRenewed",   // 14
    "AssignmentAssigned",  // 15
    "AssignmentExpired",   // 16
  ];

  const byKind = {};
  for (const e of valid) {
    byKind[e.k] = (byKind[e.k] || 0) + 1;
  }
  for (const [k, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kindNames[k] || `kind=${k}`}: ${count}`);
  }

  // 最近 15 个事件
  console.log(`\n  Last 15 events:`);
  for (const e of valid.slice(-15)) {
    const kindName = kindNames[e.k] || e.k;
    let extra = "";
    if (e.k === 13 && e.d) {
      // StructureDestroyed: [typeCode, oldCount, newCount]
      const typeNames = ["spawn", "tower", "container"];
      extra = ` ${typeNames[e.d[0]] || e.d[0]}: ${e.d[1]}→${e.d[2]}`;
    } else if (e.k === 16 && e.d) {
      // AssignmentExpired: [failReasonCode]
      const reasons = ["lease", "revision", "target", "source"];
      extra = ` reason=${reasons[e.d[0]] || e.d[0]}`;
    } else if (e.k === 15 && e.d) {
      // AssignmentAssigned: [priority]
      extra = ` priority=${e.d[0]}`;
    }
    console.log(`    t=${e.t} ${kindName} room=${e.r || ""}${extra} data=${JSON.stringify(e.d || [])}`);
  }
  console.log();
}

// ─── 5. Overview ───────────────────────────────────────────

function analyzeOverview() {
  const overview = loadJson("overview.json");
  if (!overview) return;

  console.log(`=== Overview ===`);
  if (overview.data) {
    const d = overview.data;
    if (d.cpu) console.log(`  CPU (last 5): ${JSON.stringify(d.cpu.slice(-5))}`);
    if (d.bucket) console.log(`  Bucket (last 5): ${JSON.stringify(d.bucket.slice(-5))}`);
    if (d.rooms) console.log(`  Rooms: ${JSON.stringify(d.rooms)}`);
  } else if (overview.totals) {
    console.log(`  ${JSON.stringify(overview.totals)}`);
  }
  console.log();
}

// ─── 6. Diagnostic Summary ─────────────────────────────────

function diagnosticSummary() {
  const mem = loadJson("memory-full.json");
  const cpuSeg = loadJson("cpu.json");
  const ecoSeg = loadJson("economy.json");

  console.log("=== DIAGNOSTIC SUMMARY ===\n");

  const findings = [];

  // 1. Tier check
  if (mem?.kernel?.tier) {
    const tier = mem.kernel.tier;
    if (tier === "recovery") {
      findings.push({
        severity: "CRITICAL",
        title: "System in RECOVERY tier",
        detail: `Kernel tier=recovery, recoveryTicks=${mem.kernel.recoveryTicks}. Non-critical systems are being skipped.`,
      });
    } else if (tier === "conserve") {
      findings.push({
        severity: "WARNING",
        title: "System in CONSERVE tier",
        detail: `Non-critical systems are being skipped. Bucket may be low.`,
      });
    }
  }

  // 2. Bucket check
  if (mem?.kernel?.stats?.bucketMin10 != null) {
    const minBucket = mem.kernel.stats.bucketMin10;
    if (minBucket < 1000) {
      findings.push({
        severity: "CRITICAL",
        title: `Bucket critically low: ${minBucket}`,
        detail: "Bucket < 1000 — system will skip most systems. Risk of CPU death spiral.",
      });
    } else if (minBucket < 5000) {
      findings.push({
        severity: "WARNING",
        title: `Bucket low: ${minBucket}`,
        detail: "Bucket < 5000 — heavy operations should be deferred.",
      });
    }
  }

  // 3. Crisis count
  if (mem?.kernel?.stats?.crisisCount != null) {
    const crisis = mem.kernel.stats.crisisCount;
    if (crisis > 10) {
      findings.push({
        severity: "WARNING",
        title: `High crisis count: ${crisis}`,
        detail: "Room has entered crisis phase frequently. Economy is unstable.",
      });
    }
  }

  // 4. Storage energy
  if (ecoSeg?.economy) {
    const ecoSamples = ringData(ecoSeg.economy).filter(s => s != null);
    const recent = ecoSamples.slice(-10);
    const avgStorage = recent.reduce((a, b) => a + (b.se || 0), 0) / Math.max(recent.length, 1);
    if (avgStorage < 100 && recent.length > 0) {
      findings.push({
        severity: "CRITICAL",
        title: `Storage energy near zero: ${avgStorage.toFixed(0)}`,
        detail: "Storage is empty or destroyed. Haulers have no central deposit. Economy chain is broken.",
      });
    }
  }

  // 5. Build queue analysis
  if (mem?.rooms) {
    for (const [roomName, room] of Object.entries(mem.rooms)) {
      const r = room || {};
      if (r.buildQueue) {
        const queued = r.buildQueue.filter(t => t.state === "queued");
        const storageTask = r.buildQueue.find(t => t.structureType === "storage");
        const storageQueued = storageTask && storageTask.state === "queued";
        const storageMissing = !r.buildQueue.some(t => t.structureType === "storage");

        if (storageMissing) {
          findings.push({
            severity: "CRITICAL",
            title: `[${roomName}] No storage task in build queue`,
            detail: `RCL=${r.phase?.rcl || "?"}, storage is missing but no build task exists. Layout planner may not have run.`,
          });
        } else if (storageQueued) {
          findings.push({
            severity: "INFO",
            title: `[${roomName}] Storage task queued (state=queued)`,
            detail: `pos=${storageTask.pos.x},${storageTask.pos.y} priority=${storageTask.priority} attempts=${storageTask.attempts}`,
          });
        }

        if (queued.length > 50) {
          findings.push({
            severity: "WARNING",
            title: `[${roomName}] Large build queue backlog: ${queued.length} queued`,
            detail: "Construction manager may be blocked by budget tier or site limits.",
          });
        }
      }
    }
  }

  // 6. Skip reasons analysis
  if (mem?.kernel?.skipReasons) {
    const skips = Object.entries(mem.kernel.skipReasons);
    const budgetSkips = skips.filter(([k]) => k.includes("/budget"));
    const totalBudgetSkips = budgetSkips.reduce((a, [, v]) => a + v, 0);
    if (totalBudgetSkips > 100) {
      findings.push({
        severity: "WARNING",
        title: `Budget skips total: ${totalBudgetSkips}`,
        detail: `Top: ${budgetSkips.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      });
    }
  }

  // 7. Population check
  if (cpuSeg?.population) {
    const pop = cpuSeg.population;
    if (pop.hv < 2) {
      findings.push({
        severity: "CRITICAL",
        title: `Harvester count low: ${pop.hv}`,
        detail: "Less than 2 harvesters — energy income at risk.",
      });
    }
    if (pop.ha === 0) {
      findings.push({
        severity: "CRITICAL",
        title: `No haulers alive`,
        detail: "Hauler population is 0 — energy logistics chain is broken.",
      });
    }
    // TTL check — any role with min TTL < 100
    const ttlChecks = [
      ["harvester", pop.hvTtl],
      ["hauler", pop.haTtl],
      ["upgrader", pop.upTtl],
      ["builder", pop.bdTtl],
    ];
    for (const [role, ttl] of ttlChecks) {
      if (ttl > 0 && ttl < 100) {
        findings.push({
          severity: "WARNING",
          title: `${role} approaching death: TTL=${ttl}`,
          detail: "Replacement creep should be spawning. Check spawn queue.",
        });
      }
    }
  }

  // 8. Economy pressure trend
  if (ecoSeg?.economy) {
    const ecoSamples = ringData(ecoSeg.economy).filter(s => s != null);
    if (ecoSamples.length >= 4) {
      const recent = ecoSamples.slice(-4);
      const avgPressure = recent.reduce((a, b) => a + b.p, 0) / recent.length;
      if (avgPressure > 50) {
        findings.push({
          severity: "WARNING",
          title: `Economy pressure high: ${avgPressure.toFixed(0)}%`,
          detail: "Pressure > 50% — construction may be blocked by development gate.",
        });
      }
    }
  }

  // Output findings
  if (findings.length === 0) {
    console.log("  No significant findings. System appears healthy.\n");
  } else {
    for (const f of findings) {
      const icon = f.severity === "CRITICAL" ? "[!!!]" : f.severity === "WARNING" ? "[!]" : "[i]";
      console.log(`  ${icon} ${f.severity}: ${f.title}`);
      console.log(`       ${f.detail}\n`);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────

function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║         SCREEPS EMPIRE DIAGNOSTIC REPORT                 ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  analyzeCpu();
  analyzeEconomy();
  analyzeMemory();
  analyzeEvents();
  analyzeOverview();
  diagnosticSummary();
}

main();
