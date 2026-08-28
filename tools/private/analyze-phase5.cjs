#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const COLLECT_DIR = path.join(__dirname, "data", "collect");
const SOAK_DIR = path.join(__dirname, "data", "soak");

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

const timeseries = loadJsonl(path.join(COLLECT_DIR, "timeseries-13232.jsonl"));
const soakLatest = loadJsonl(path.join(SOAK_DIR, "canary-1787865819093.jsonl"));
const soakPrev = loadJsonl(path.join(SOAK_DIR, "canary-1787842064350.jsonl"));
const snapshots = loadJsonl(path.join(COLLECT_DIR, "snapshots-13232.jsonl"));

function P(s) { console.log(s); }

P("\n" + "=".repeat(80));
P("Phase 5 Private Server Data Analysis Report");
P("=".repeat(80) + "\n");

P("## Data Sources\n");
P("| source | file | rows | tick range |");
P("|--------|------|------|------------|");
if (timeseries.length) {
  P("| timeseries | timeseries-13232.jsonl | " + timeseries.length + " | " + timeseries[0].t + "-" + timeseries[timeseries.length-1].t + " |");
}
if (soakLatest.length) {
  P("| soak-latest | canary-1787865819093.jsonl | " + soakLatest.length + " | " + soakLatest[0].tick + "-" + soakLatest[soakLatest.length-1].tick + " |");
}
if (soakPrev.length) {
  P("| soak-prev | canary-1787842064350.jsonl | " + soakPrev.length + " | " + soakPrev[0].tick + "-" + soakPrev[soakPrev.length-1].tick + " |");
}
if (snapshots.length) {
  P("| snapshots | snapshots-13232.jsonl | " + snapshots.length + " | " + snapshots[0].t + "-" + snapshots[snapshots.length-1].t + " |");
}

// ─── 1. RCL Progression ───────────────────────────────────────────
P("\n## 1. RCL Progression\n");

const rclProgression = [];
const lastRcl = {};
if (timeseries.length) {
  for (const row of timeseries) {
    if (!row.rooms) continue;
    for (const room of row.rooms) {
      const rcl = room.rcl;
      if (rcl !== undefined && rcl !== lastRcl[room.room]) {
        rclProgression.push({
          tick: row.t, room: room.room, rcl: rcl,
          prog: room.prog || 0, progTotal: room.progTotal || 0,
          colonyState: room.colonyState, phase: room.phase,
        });
        lastRcl[room.room] = rcl;
      }
    }
  }
}

P("### RCL Change Events\n");
P("| tick | room | RCL | progress | colonyState | phase |");
P("|------|------|-----|----------|-------------|-------|");
for (const e of rclProgression) {
  P("| " + e.tick + " | " + e.room + " | RCL" + e.rcl + " | " + e.prog + "/" + (e.progTotal || "?") + " | " + (e.colonyState || "?") + " | " + (e.phase || "?") + " |");
}

P("\n### Latest Soak RCL Status\n");
if (soakLatest.length) {
  const first = soakLatest[0];
  const last = soakLatest[soakLatest.length - 1];
  for (const [roomName, roomData] of Object.entries(first.rooms || {})) {
    const lastRoomData = (last.rooms || {})[roomName] || {};
    P("| room | start RCL | start tick | end RCL | end tick | change |");
    P("| " + roomName + " | RCL" + roomData.rcl + " | " + first.tick + " | RCL" + lastRoomData.rcl + " | " + last.tick + " | " + (roomData.rcl !== lastRoomData.rcl ? "CHANGED" : "STABLE") + " |");
  }
}

// ─── 2. CPU/bucket trends ─────────────────────────────────────────
P("\n## 2. CPU and bucket Trends\n");

if (timeseries.length) {
  const cpuData = timeseries
    .filter(r => r.cpuTop && r.cpuTop.bucket != null)
    .map(r => ({ tick: r.t, cpu: r.cpuTop.cpu, bucket: r.cpuTop.bucket, tier: r.kernel && r.kernel.tier }));

  if (cpuData.length) {
    const buckets = cpuData.map(d => d.bucket);
    const cpus = cpuData.map(d => d.cpu).filter(c => c != null);
    const tiers = new Set(cpuData.map(d => d.tier).filter(Boolean));

    const minB = Math.min.apply(null, buckets);
    const maxB = Math.max.apply(null, buckets);
    const minC = Math.min.apply(null, cpus);
    const maxC = Math.max.apply(null, cpus);
    const avgC = cpus.reduce((a, b) => a + b, 0) / cpus.length;

    cpus.sort((a, b) => a - b);
    const q25 = cpus[Math.floor(cpus.length * 0.25)];
    const q50 = cpus[Math.floor(cpus.length * 0.5)];
    const q75 = cpus[Math.floor(cpus.length * 0.75)];

    P("| metric | value |");
    P("|--------|-------|");
    P("| samples | " + cpuData.length + " |");
    P("| tick range | " + cpuData[0].tick + "-" + cpuData[cpuData.length-1].tick + " |");
    P("| bucket min | " + minB + " |");
    P("| bucket max | " + maxB + " |");
    P("| bucket stable 10000 | " + (minB === maxB && maxB === 10000 ? "YES" : "NO") + " |");
    P("| CPU min | " + minC + " |");
    P("| CPU max | " + maxC + " |");
    P("| CPU avg | " + avgC.toFixed(2) + " |");
    P("| CPU Q25 | " + q25 + " |");
    P("| CPU Q50 | " + q50 + " |");
    P("| CPU Q75 | " + q75 + " |");
    P("| tier set | " + Array.from(tiers).join(",") + " |");

    const segments = [0, 0.25, 0.5, 0.75, 1.0];
    P("\n### CPU Segmented Trend\n");
    P("| segment | tick range | CPU avg | CPU max | bucket min |");
    P("|---------|-------------|---------|---------|------------|");
    for (let i = 0; i < segments.length - 1; i++) {
      const start = Math.floor(cpuData.length * segments[i]);
      const end = Math.floor(cpuData.length * segments[i + 1]);
      const slice = cpuData.slice(start, end);
      if (slice.length === 0) continue;
      const avg = slice.reduce((a, b) => a + (b.cpu || 0), 0) / slice.length;
      const max = Math.max.apply(null, slice.map(d => d.cpu || 0));
      const bMin = Math.min.apply(null, slice.map(d => d.bucket || 0));
      P("| " + (segments[i]*100) + "%-" + (segments[i+1]*100) + "% | " + slice[0].tick + "-" + slice[slice.length-1].tick + " | " + avg.toFixed(2) + " | " + max + " | " + bMin + " |");
    }
  }
}

// ─── 3. Memory growth ─────────────────────────────────────────────
P("\n## 3. Memory Growth Trend\n");

if (soakLatest.length) {
  const memSizes = soakLatest.map(s => s.memory.size);
  const minM = Math.min.apply(null, memSizes);
  const maxM = Math.max.apply(null, memSizes);
  const firstM = memSizes[0];
  const lastM = memSizes[memSizes.length - 1];
  const growth = ((maxM - minM) / minM * 100).toFixed(1);

  P("| metric | value |");
  P("|--------|-------|");
  P("| samples | " + soakLatest.length + " |");
  P("| tick range | " + soakLatest[0].tick + "-" + soakLatest[soakLatest.length-1].tick + " |");
  P("| Memory min | " + minM + "B (" + (minM/1024).toFixed(1) + "KB) |");
  P("| Memory max | " + maxM + "B (" + (maxM/1024).toFixed(1) + "KB) |");
  P("| Memory start | " + firstM + "B |");
  P("| Memory end | " + lastM + "B |");
  P("| growth rate | " + growth + "% |");
  P("| schemaVersion | " + (new Set(soakLatest.map(s => s.memory.schemaVersion)).size === 1 ? "STABLE" : "CHANGED") + " (" + Array.from(new Set(soakLatest.map(s => s.memory.schemaVersion))).join(",") + ") |");

  const seg = [0, 0.25, 0.5, 0.75, 1.0];
  P("\n### Memory Segmented Trend\n");
  P("| segment | tick | size(B) | size(KB) |");
  P("|---------|------|---------|----------|");
  for (let i = 0; i < seg.length - 1; i++) {
    const start = Math.floor(soakLatest.length * seg[i]);
    const end = Math.floor(soakLatest.length * seg[i + 1]);
    const slice = soakLatest.slice(start, end);
    if (!slice.length) continue;
    const avg = slice.reduce((a, b) => a + b.memory.size, 0) / slice.length;
    P("| " + (seg[i]*100) + "%-" + (seg[i+1]*100) + "% | " + slice[0].tick + " | " + Math.round(avg) + " | " + (avg/1024).toFixed(1) + " |");
  }
}

// ─── 4. Queue trends ─────────────────────────────────────────────
P("\n## 4. Queue Trends\n");

if (timeseries.length) {
  const queueData = timeseries
    .filter(r => r.rooms && r.rooms.length > 0)
    .map(r => ({
      tick: r.t,
      buildQueue: r.rooms.reduce((s, rm) => s + (rm.buildQueue || 0), 0),
      spawnQueue: r.rooms.reduce((s, rm) => s + (rm.spawnQueue || 0), 0),
      sites: r.rooms.reduce((s, rm) => s + (rm.sites || 0), 0),
      rooms: r.rooms.length,
    }));

  if (queueData.length) {
    const bq = queueData.map(d => d.buildQueue);
    const sq = queueData.map(d => d.spawnQueue);
    const st = queueData.map(d => d.sites);

    P("### buildQueue Trend\n");
    P("| metric | value |");
    P("|--------|-------|");
    P("| samples | " + queueData.length + " |");
    P("| min | " + Math.min.apply(null, bq) + " |");
    P("| max | " + Math.max.apply(null, bq) + " |");
    P("| start | " + bq[0] + " |");
    P("| end | " + bq[bq.length-1] + " |");
    P("| unbounded growth | " + (Math.max.apply(null, bq) > 20 ? "YES (check)" : "NO") + " |");

    P("\n### spawnQueue Trend\n");
    P("| metric | value |");
    P("|--------|-------|");
    P("| min | " + Math.min.apply(null, sq) + " |");
    P("| max | " + Math.max.apply(null, sq) + " |");
    P("| start | " + sq[0] + " |");
    P("| end | " + sq[sq.length-1] + " |");
    P("| unbounded growth | " + (Math.max.apply(null, sq) > 20 ? "YES (check)" : "NO") + " |");

    P("\n### construction sites Trend\n");
    P("| metric | value |");
    P("|--------|-------|");
    P("| min | " + Math.min.apply(null, st) + " |");
    P("| max | " + Math.max.apply(null, st) + " |");
    P("| start | " + st[0] + " |");
    P("| end | " + st[st.length-1] + " |");
  }
}

// ─── 5. Creep population ──────────────────────────────────────────
P("\n## 5. Creep Population\n");

if (soakLatest.length) {
  const creepCounts = soakLatest.map(s => s.creeps.total);
  P("### Latest Soak Population\n");
  P("| metric | value |");
  P("|--------|-------|");
  P("| min | " + Math.min.apply(null, creepCounts) + " |");
  P("| max | " + Math.max.apply(null, creepCounts) + " |");
  P("| start | " + creepCounts[0] + " |");
  P("| end | " + creepCounts[creepCounts.length-1] + " |");

  const lastSoak = soakLatest[soakLatest.length - 1];
  P("\n### End Role Distribution\n");
  P("| role | count |");
  for (const [role, count] of Object.entries(lastSoak.creeps.byRole || {})) {
    P("| " + role + " | " + count + " |");
  }
}

if (timeseries.length) {
  const creepData = timeseries
    .filter(r => r.rooms && r.rooms.length > 0)
    .map(r => ({
      tick: r.t,
      total: r.rooms.reduce((s, rm) => s + Object.values(rm.creeps || {}).reduce((a, b) => a + b, 0), 0),
    }));

  if (creepData.length) {
    const totals = creepData.map(d => d.total);
    P("\n### Long-term Timeseries Population\n");
    P("| metric | value |");
    P("|--------|-------|");
    P("| samples | " + creepData.length + " |");
    P("| min | " + Math.min.apply(null, totals) + " |");
    P("| max | " + Math.max.apply(null, totals) + " |");
    P("| start | " + totals[0] + " |");
    P("| end | " + totals[totals.length-1] + " |");
  }
}

// ─── 6. Events and errors ─────────────────────────────────────────
P("\n## 6. Events and Errors\n");

if (timeseries.length) {
  const eventTypes = {};
  const deaths = [];
  for (const row of timeseries) {
    if (row.eventStats) {
      for (const [k, v] of Object.entries(row.eventStats)) {
        eventTypes[k] = (eventTypes[k] || 0) + v;
      }
      if (row.eventStats.deaths) {
        deaths.push({ tick: row.t, count: row.eventStats.deaths });
      }
    }
  }
  P("### Event Type Summary (entire timeseries)\n");
  P("| event type | count |");
  for (const [k, v] of Object.entries(eventTypes).sort((a, b) => b[1] - a[1])) {
    P("| " + k + " | " + v + " |");
  }

  if (deaths.length) {
    P("\n### Death Events (" + deaths.length + " ticks with deaths)\n");
    P("| tick | deaths |");
    for (const d of deaths.slice(0, 20)) {
      P("| " + d.tick + " | " + d.count + " |");
    }
    if (deaths.length > 20) P("| ... | " + (deaths.length - 20) + " more ticks |");
  }
}

if (soakLatest.length) {
  const allErrors = soakLatest.flatMap(s => s.errors || []);
  P("\n### Soak Errors (" + allErrors.length + " items)\n");
  if (allErrors.length === 0) {
    P("No errors");
  } else {
    P("| tick | error (first 300 chars) |");
    for (const e of allErrors.slice(0, 20)) {
      P("| " + (e.tick || "?") + " | " + String(e.error || "").slice(0, 300) + " |");
    }
  }
}

// ─── 7. Structures ────────────────────────────────────────────────
P("\n## 7. Structures\n");

if (timeseries.length) {
  const structData = timeseries
    .filter(r => r.rooms && r.rooms.length > 0 && r.rooms[0].struct)
    .map(r => ({
      tick: r.t,
      rooms: r.rooms.map(rm => ({
        room: rm.room, rcl: rm.rcl, struct: rm.struct,
        sites: rm.sites, buildQueue: rm.buildQueue, gaps: rm.gaps,
        layout: rm.layout, energy: rm.energy,
      })),
    }));

  if (structData.length) {
    const lastStruct = structData[structData.length - 1];
    P("### End Structure Snapshot\n");
    for (const rm of lastStruct.rooms) {
      P("\n**Room " + rm.room + " (RCL" + rm.rcl + ")**\n");
      P("| structure | count |");
      for (const [type, count] of Object.entries(rm.struct || {}).sort((a, b) => b[1] - a[1])) {
        P("| " + type + " | " + count + " |");
      }
      P("| constructionSites | " + rm.sites + " |");
      P("| buildQueue | " + rm.buildQueue + " |");
      P("| layout gaps | " + JSON.stringify(rm.gaps) + " |");
    }

    const rcl8Point = structData.find(r => r.rooms.some(rm => rm.rcl >= 8));
    if (rcl8Point) {
      P("\n### RCL8 Reached (tick " + rcl8Point.tick + ")\n");
      const rcl8Room = rcl8Point.rooms.find(rm => rm.rcl >= 8);
      if (rcl8Room) {
        P("Room " + rcl8Room.room + ":\n");
        P("| structure | count |");
        for (const [type, count] of Object.entries(rcl8Room.struct || {}).sort((a, b) => b[1] - a[1])) {
          P("| " + type + " | " + count + " |");
        }
      }
    }

    P("\n### First Appearance per RCL\n");
    const rclFirsts = {};
    for (const row of structData) {
      for (const rm of row.rooms) {
        if (rm.rcl && !rclFirsts[rm.rcl]) {
          rclFirsts[rm.rcl] = { tick: row.tick, room: rm.room, struct: rm.struct, sites: rm.sites, buildQueue: rm.buildQueue };
        }
      }
    }
    P("| RCL | tick | room | key structures | sites | buildQueue |");
    P("|-----|------|------|-----------------|-------|------------|");
    for (const [rcl, data] of Object.entries(rclFirsts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const s = data.struct || {};
      const key = "spawn:" + (s.spawn||0) + " ext:" + (s.extension||0) + " tower:" + (s.tower||0) + " stor:" + (s.storage||0) + " link:" + (s.link||0) + " term:" + (s.terminal||0) + " lab:" + (s.lab||0) + " fact:" + (s.factory||0) + " obs:" + (s.observer||0) + " nuke:" + (s.nuker||0) + " ps:" + (s.powerSpawn||0) + " cont:" + (s.container||0) + " road:" + (s.road||0) + " rmp:" + (s.rampart||0) + " wall:" + (s.constructedWall||0);
      P("| RCL" + rcl + " | " + data.tick + " | " + data.room + " | " + key + " | " + data.sites + " | " + data.buildQueue + " |");
    }
  }
}

// ─── 8. Layout gaps and blocked ───────────────────────────────────
P("\n## 8. Layout Gaps and Blocked\n");

if (timeseries.length) {
  const gapData = timeseries
    .filter(r => r.kernel && r.kernel.gaps && Object.keys(r.kernel.gaps).length > 0)
    .map(r => ({ tick: r.t, gaps: r.kernel.gaps }));

  const blockedData = timeseries
    .filter(r => r.layoutBlocked && Object.keys(r.layoutBlocked).length > 0)
    .map(r => ({ tick: r.t, blocked: r.layoutBlocked }));

  P("| metric | value |");
  P("|--------|-------|");
  P("| ticks with gaps | " + gapData.length + " |");
  P("| ticks with blocked | " + blockedData.length + " |");

  if (gapData.length) {
    P("\n### gap Samples (first 5)\n");
    P("| tick | gaps |");
    for (const g of gapData.slice(0, 5)) {
      P("| " + g.tick + " | " + JSON.stringify(g.gaps) + " |");
    }
  }

  if (blockedData.length) {
    P("\n### blocked Samples (first 5)\n");
    P("| tick | blocked |");
    for (const b of blockedData.slice(0, 5)) {
      P("| " + b.tick + " | " + JSON.stringify(b.blocked) + " |");
    }
  }
}

// ─── 9. skipReasons ───────────────────────────────────────────────
P("\n## 9. SkipReasons Analysis\n");

if (timeseries.length) {
  const skipData = timeseries
    .filter(r => r.kernel && r.kernel.skipReasons && Object.keys(r.kernel.skipReasons).length > 0)
    .map(r => ({ tick: r.t, skips: r.kernel.skipReasons }));

  const skipTypes = {};
  for (const row of skipData) {
    for (const [k, v] of Object.entries(row.skips)) {
      if (!skipTypes[k]) skipTypes[k] = { count: 0, ticks: [] };
      skipTypes[k].count++;
      skipTypes[k].ticks.push(row.tick);
    }
  }

  P("| skip type | tick count | first | last |");
  P("|-----------|------------|-------|------|");
  for (const [k, v] of Object.entries(skipTypes).sort((a, b) => b[1].count - a[1].count).slice(0, 30)) {
    P("| " + k + " | " + v.count + " | " + v.ticks[0] + " | " + v.ticks[v.ticks.length-1] + " |");
  }
}

// ─── 10. End state ────────────────────────────────────────────────
P("\n## 10. End State Snapshot\n");

if (soakLatest.length) {
  const last = soakLatest[soakLatest.length - 1];
  P("### Latest Soak End\n");
  P("```json");
  P(JSON.stringify(last, null, 2).slice(0, 2000));
  P("```");
}

if (timeseries.length) {
  const last = timeseries[timeseries.length - 1];
  P("\n### Timeseries End\n");
  P("```json");
  P(JSON.stringify(last, null, 2).slice(0, 3000));
  P("```");
}

P("\n" + "=".repeat(80));
P("Phase 5 Data Analysis Complete");
P("=".repeat(80) + "\n");
