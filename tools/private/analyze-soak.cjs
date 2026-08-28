const fs = require('fs');
const lines = fs.readFileSync('tools/private/data/collect/timeseries-13232.jsonl', 'utf8').trim().split('\n');

// Parse all and extract key metrics at 10% intervals
const milestones = [0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
let results = [];

for (const m of milestones) {
  const idx = Math.floor(lines.length * m) - 1;
  if (idx < 0) continue;
  const d = JSON.parse(lines[idx]);
  const r = d.rooms?.[0];
  results.push({
    milestone: m,
    line: idx,
    tick: d.t,
    sv: d.sv,
    cpu: d.cpu,
    bucket: d.cpuTop?.bucket,
    tier: d.kernel?.tier,
    posture: d.kernel?.strategy?.posture,
    rcl: r?.rcl,
    prog: r?.prog,
    colonyState: r?.colonyState,
    economyPressure: r?.economyPressure,
    spawnQueue: r?.spawnQueue,
    buildQueue: r?.buildQueue,
    sites: r?.sites,
    spawning: r?.spawning,
    hostiles: r?.hostiles,
    struct: r?.struct,
    gaps: r?.gaps,
    layoutBlocked: d.layoutBlocked?.[r?.room],
    layoutRev: r?.layout?.revision,
    remoteOps: r?.remoteOps ? Object.keys(r.remoteOps).length : 0,
    remoteOpStates: r?.remoteOps,
    creepCount: r?.creeps ? Object.values(r.creeps).reduce((a,b)=>a+b,0) : 0,
    storage: r?.energy?.stor,
    creeps: r?.creeps,
    skipReasons: Object.keys(d.kernel?.skipReasons ?? {}).length,
    gapsCount: r?.gaps ? Object.keys(r.gaps).length : 0,
  });
}

console.log('=== Soak trend analysis (50,086 samples, tick 13232→2353236) ===');
console.log('Total tick span:', 2353236 - 13232, 'ticks');
console.log('');
for (const r of results) {
  console.log(`--- ${r.milestone*100}% (line ${r.line}) tick=${r.tick} ---`);
  console.log(`  CPU=${r.cpu} bucket=${r.bucket} tier=${r.tier} posture=${r.posture}`);
  console.log(`  RCL=${r.rcl} colonyState=${r.colonyState} econPressure=${r.economyPressure}`);
  console.log(`  spawnQueue=${r.spawnQueue} buildQueue=${r.buildQueue} sites=${r.sites} spawning=${r.spawning}`);
  console.log(`  hostiles=${r.hostiles} creeps=${r.creepCount} storage=${r.storage}`);
  console.log(`  layoutRev=${r.layoutRev} layoutBlocked=${r.layoutBlocked} gaps=${r.gapsCount}=${JSON.stringify(r.gaps)}`);
  console.log(`  remoteOps=${r.remoteOps} skipReasons=${r.skipReasons}`);
  if (r.remoteOpStates) {
    for (const [room, op] of Object.entries(r.remoteOpStates)) {
      console.log(`    remote ${room}: ${op.state} threat=${op.threat} haulerNeed=${op.haulerNeed}`);
    }
  }
  console.log(`  struct=${JSON.stringify(r.struct)}`);
  console.log(`  creeps=${JSON.stringify(r.creeps)}`);
  console.log('');
}

// Count unique states and transitions
let colonyStateTransitions = [];
let prevCS = null;
for (let i = 2; i < lines.length; i++) { // skip first 2 empty entries
  const d = JSON.parse(lines[i]);
  const r = d.rooms?.[0];
  if (!r) continue;
  if (r.colonyState !== prevCS) {
    colonyStateTransitions.push({ tick: d.t, from: prevCS, to: r.colonyState });
    prevCS = r.colonyState;
  }
}
console.log('=== Colony state transitions ===');
colonyStateTransitions.forEach(t => console.log(`  tick ${t.tick}: ${t.from} → ${t.to}`));

// RCL progression
console.log('=== RCL progression ===');
let prevRcl = null;
for (let i = 2; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const r = d.rooms?.[0];
  if (!r) continue;
  if (r.rcl !== prevRcl) {
    // Get struct at this point
    console.log(`  tick ${d.t}: RCL ${prevRcl} → ${r.rcl} (struct=${JSON.stringify(r.struct)})`);
    prevRcl = r.rcl;
  }
}

// Posture changes
console.log('=== Posture changes ===');
let prevPosture = null;
for (let i = 2; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const p = d.kernel?.strategy?.posture;
  if (p && p !== prevPosture) {
    console.log(`  tick ${d.t}: ${prevPosture} → ${p}`);
    prevPosture = p;
  }
}

// Remote ops lifecycle
console.log('=== Remote ops lifecycle ===');
let prevOps = {};
for (let i = 2; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const r = d.rooms?.[0];
  if (!r?.remoteOps) continue;
  for (const [room, op] of Object.entries(r.remoteOps)) {
    const prev = prevOps[room];
    if (!prev || prev.state !== op.state) {
      console.log(`  tick ${d.t}: ${room} ${prev?.state ?? 'none'} → ${op.state}`);
    }
    prevOps[room] = { state: op.state };
  }
}

// CPU trend (percentiles)
let cpus = [];
for (let i = 2; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.cpu) cpus.push(d.cpu);
}
cpus.sort((a,b)=>a-b);
console.log('=== CPU trend ===');
console.log(`  min=${cpus[0]} p25=${cpus[Math.floor(cpus.length*0.25)]} median=${cpus[Math.floor(cpus.length*0.5)]} p75=${cpus[Math.floor(cpus.length*0.75)]} p90=${cpus[Math.floor(cpus.length*0.9)]} p95=${cpus[Math.floor(cpus.length*0.95)]} max=${cpus[cpus.length-1]}`);

// Memory size from snapshots
try {
  const snapLines = fs.readFileSync('tools/private/data/collect/snapshots-13232.jsonl', 'utf8').trim().split('\n');
  let memSizes = [];
  for (let i = 0; i < snapLines.length; i++) {
    const d = JSON.parse(snapLines[i]);
    if (d.memory?.size) memSizes.push({ tick: d.tick, size: d.memory.size });
  }
  if (memSizes.length) {
    const sizes = memSizes.map(m=>m.size).sort((a,b)=>a-b);
    console.log('=== Memory size ===');
    console.log(`  min=${sizes[0]} max=${sizes[sizes.length-1]} median=${sizes[Math.floor(sizes.length/2)]}`);
    console.log(`  first=${JSON.stringify(memSizes[0])} last=${JSON.stringify(memSizes[memSizes.length-1])}`);
    // Check for growth
    if (memSizes.length > 10) {
      const first10avg = memSizes.slice(0,10).reduce((s,m)=>s+m.size,0)/10;
      const last10avg = memSizes.slice(-10).reduce((s,m)=>s+m.size,0)/10;
      console.log(`  first10avg=${first10avg.toFixed(0)} last10avg=${last10avg.toFixed(0)} growth=${((last10avg-first10avg)/first10avg*100).toFixed(1)}%`);
    }
  }
} catch (e) { console.log('No snapshot data'); }

// Events summary
let eventKinds = {};
for (let i = 2; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.eventStats) {
    for (const [k, v] of Object.entries(d.eventStats)) {
      eventKinds[k] = (eventKinds[k] ?? 0) + (typeof v === 'number' ? v : 0);
    }
  }
}
console.log('=== Event summary (cumulative) ===');
for (const [k, v] of Object.entries(eventKinds).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k}: ${v}`);
}

// Hostile snapshots
let hostileTicks = [];
for (let i = 2; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const r = d.rooms?.[0];
  if (r?.hostiles > 0) hostileTicks.push({ tick: d.t, count: r.hostiles });
}
console.log('=== Hostile encounters ===');
console.log(`  Total snapshots with hostiles: ${hostileTicks.length}`);
if (hostileTicks.length > 0) {
  console.log(`  First: tick ${hostileTicks[0].tick} (${hostileTicks[0].count} hostiles)`);
  console.log(`  Last: tick ${hostileTicks[hostileTicks.length-1].tick} (${hostileTicks[hostileTicks.length-1].count} hostiles)`);
  // Group by time windows
  let windows = {};
  for (const h of hostileTicks) {
    const w = Math.floor(h.tick / 100000) * 100000;
    if (!windows[w]) windows[w] = 0;
    windows[w]++;
  }
  console.log('  By 100k tick window:', JSON.stringify(windows));
}
