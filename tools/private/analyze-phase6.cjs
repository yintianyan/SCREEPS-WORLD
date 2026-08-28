const fs = require('fs');
const lines = fs.readFileSync('tools/private/data/collect/timeseries-13232.jsonl', 'utf8').trim().split('\n');
console.log('Total lines:', lines.length);

// First 3 and last 3
for (let i = 0; i < Math.min(3, lines.length); i++) {
  const d = JSON.parse(lines[i]);
  console.log('Line', i, 'tick:', d.t, 'sv:', d.sv, 'rcl:', d.rooms?.[0]?.rcl, 'room:', d.rooms?.[0]?.room, 'tier:', d.kernel?.tier);
}
console.log('...');
for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  console.log('Line', i, 'tick:', d.t, 'sv:', d.sv, 'rcl:', d.rooms?.[0]?.rcl, 'room:', d.rooms?.[0]?.room, 'tier:', d.kernel?.tier);
}

// Tick gaps
let gaps = [];
let prevTick = null;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (prevTick !== null) {
    const diff = d.t - prevTick;
    if (diff > 200 || diff < 0) gaps.push({ line: i, prev: prevTick, curr: d.t, diff });
  }
  prevTick = d.t;
}
console.log('---Tick gaps (>200 or negative):');
gaps.slice(0, 20).forEach(g => console.log(JSON.stringify(g)));
console.log('Total gaps:', gaps.length);

// RCL progression
let rclChanges = [];
let prevRcl = null;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const rcl = d.rooms?.[0]?.rcl;
  if (rcl !== undefined && rcl !== prevRcl) {
    rclChanges.push({ tick: d.t, rcl: rcl, prev: prevRcl });
    prevRcl = rcl;
  }
}
console.log('---RCL changes:');
rclChanges.forEach(c => console.log(JSON.stringify(c)));

// Rooms seen
let roomCounts = new Set();
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.rooms) d.rooms.forEach(r => roomCounts.add(r.room));
}
console.log('---Rooms seen:', [...roomCounts]);

// Remote rooms
let remoteRoomSet = new Set();
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.remoteRooms) Object.keys(d.remoteRooms).forEach(r => remoteRoomSet.add(r));
}
console.log('---Remote rooms seen:', [...remoteRoomSet]);

// Schema version regressions
let resets = [];
let prevSv = null;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (prevSv !== null && d.sv < prevSv) resets.push({ line: i, tick: d.t, prev: prevSv, curr: d.sv });
  prevSv = d.sv;
}
console.log('---Schema version regressions (possible resets):', resets.length);
resets.slice(0, 5).forEach(r => console.log(JSON.stringify(r)));

// CPU and bucket stats
let cpus = [], buckets = [];
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.cpu) cpus.push(d.cpu);
  if (d.cpuTop?.bucket) buckets.push(d.cpuTop.bucket);
}
if (cpus.length) {
  cpus.sort((a, b) => a - b);
  console.log('---CPU stats: min:', cpus[0], 'max:', cpus[cpus.length - 1], 'median:', cpus[Math.floor(cpus.length / 2)], 'p90:', cpus[Math.floor(cpus.length * 0.9)], 'count:', cpus.length);
}
if (buckets.length) {
  buckets.sort((a, b) => a - b);
  console.log('---Bucket stats: min:', buckets[0], 'max:', buckets[buckets.length - 1], 'median:', buckets[Math.floor(buckets.length / 2)], 'count:', buckets.length);
}

// Colony states
let colonyStates = new Set();
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  d.rooms?.forEach(r => { if (r.colonyState) colonyStates.add(r.colonyState); });
}
console.log('---Colony states seen:', [...colonyStates]);

// Tiers
let tiers = new Set();
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.kernel?.tier) tiers.add(d.kernel.tier);
}
console.log('---Tiers seen:', [...tiers]);

// Hostile events
let hostileEvents = 0;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  d.rooms?.forEach(r => { if (r.hostiles > 0) hostileEvents++; });
}
console.log('---Hostile snapshots:', hostileEvents);

// Remote op states
let remoteOpStates = {};
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  d.rooms?.forEach(r => {
    if (r.remoteOps) {
      Object.entries(r.remoteOps).forEach(([room, op]) => {
        if (!remoteOpStates[room]) remoteOpStates[room] = new Set();
        remoteOpStates[room].add(op.state);
      });
    }
  });
}
console.log('---Remote op states:', Object.fromEntries(Object.entries(remoteOpStates).map(([k, v]) => [k, [...v]])));

// Posture changes
let postures = new Set();
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.kernel?.strategy?.posture) postures.add(d.kernel.strategy.posture);
}
console.log('---Postures seen:', [...postures]);

// GCL changes
let gclChanges = [];
let prevGcl = null;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.gcl !== undefined && d.gcl !== prevGcl) {
    gclChanges.push({ tick: d.t, gcl: d.gcl, prev: prevGcl });
    prevGcl = d.gcl;
  }
}
console.log('---GCL changes (first 5 and last 5):');
gclChanges.slice(0, 5).forEach(c => console.log(JSON.stringify(c)));
if (gclChanges.length > 10) console.log('...');
gclChanges.slice(-5).forEach(c => console.log(JSON.stringify(c)));
console.log('Total GCL changes:', gclChanges.length);

// Tick range
const firstTick = JSON.parse(lines[0]).t;
const lastTick = JSON.parse(lines[lines.length - 1]).t;
console.log('---Tick range:', firstTick, 'to', lastTick, 'span:', lastTick - firstTick);

// Check for sv=0 entries (indicates pre-bot or reset)
let svZero = 0;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (d.sv === 0) svZero++;
}
console.log('---sv=0 entries:', svZero);

// Check for empty rooms array (indicates no rooms visible)
let emptyRooms = 0;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  if (!d.rooms || d.rooms.length === 0) emptyRooms++;
}
console.log('---Empty rooms entries:', emptyRooms);

// Memory size from snapshots
try {
  const snapLines = fs.readFileSync('tools/private/data/collect/snapshots-13232.jsonl', 'utf8').trim().split('\n');
  console.log('---Snapshot lines:', snapLines.length);
  let memSizes = [];
  for (let i = 0; i < snapLines.length; i++) {
    const d = JSON.parse(snapLines[i]);
    if (d.memory?.size) memSizes.push({ tick: d.tick, size: d.memory.size });
  }
  if (memSizes.length) {
    const sizes = memSizes.map(m => m.size).sort((a, b) => a - b);
    console.log('---Memory size: min:', sizes[0], 'max:', sizes[sizes.length - 1], 'median:', sizes[Math.floor(sizes.length / 2)]);
    console.log('---Memory first:', memSizes[0], 'last:', memSizes[memSizes.length - 1]);
  }
} catch (e) {
  console.log('---Snapshot file not available');
}

// Check structure progression at key RCL points
let structProgression = {};
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const r = d.rooms?.[0];
  if (r && r.rcl !== undefined) {
    const key = `rcl${r.rcl}`;
    if (!structProgression[key]) {
      structProgression[key] = { tick: d.t, struct: r.struct, gaps: r.gaps, layout: r.layout };
    }
  }
}
console.log('---Structure at first RCL appearance:');
Object.entries(structProgression).forEach(([k, v]) => {
  console.log(k, 'tick:', v.tick, 'struct:', JSON.stringify(v.struct), 'gaps:', JSON.stringify(v.gaps));
});

// Defense wall coordinates check
let wallCoords = new Set();
let rampartCoords = [];
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const r = d.rooms?.[0];
  if (r && r.struct) {
    // Check if defense-planner generated any wall tasks
    if (r.buildQueueByType) {
      Object.entries(r.buildQueueByType).forEach(([type, count]) => {
        if (type.includes('wall') || type.includes('rampart')) {
          console.log(`Tick ${d.t}: buildQueue has ${count} ${type} tasks`);
        }
      });
    }
  }
}
