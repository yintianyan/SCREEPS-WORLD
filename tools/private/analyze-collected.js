/**
 * timeseries 后分析脚本 —— 按 Screeps Grandmaster 视角聚合全周期数据。
 *
 * 输入：tools/private/data/collect/timeseries-<tick>.jsonl
 * 输出：分段统计 + 关键转折点 + 资源流/人口/CPU/事件摘要
 *
 * 用法：node tools/private/analyze-collected.js [--window 1000]
 *   --window N：分段窗口（tick 数，默认 1000）
 */
const fs = require("fs");
const path = require("path");

const COLLECT_DIR = path.join(__dirname, "data", "collect");
const session = JSON.parse(fs.readFileSync(path.join(COLLECT_DIR, "session.json"), "utf8"));
const TS_FILE = path.join(COLLECT_DIR, session.timeseries);

const args = process.argv.slice(2);
const winArgIdx = args.indexOf("--window");
const WINDOW = parseInt(args[winArgIdx + 1] ?? "1000", 10);

// ─── 读取全部 timeseries 行（29MB 可一次性载入）────────────────
const lines = fs.readFileSync(TS_FILE, "utf8").split("\n").filter(Boolean);
console.log(`[Load] ${lines.length} 行来自 ${session.timeseries}`);
console.log(`[Session] start=${session.startTick} last=${session.lastTick} 跨度=${parseInt(session.lastTick) - parseInt(session.startTick)} tick`);

/** 把行解析为对象，过滤无效行（t 可能是字符串或数字，统一为数字） */
const samples = [];
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    if (o && o.t !== undefined && o.t !== null) {
      o.t = Number(o.t);
      samples.push(o);
    }
  } catch (e) { /* skip */ }
}
samples.sort((a, b) => a.t - b.t);
console.log(`[Parsed] ${samples.length} 个有效样本，tick ${samples[0].t} → ${samples[samples.length - 1].t}`);

// ─── 工具：按窗口分段 ────────────────────────────────────────
function bucketOf(tick) {
  return Math.floor(tick / WINDOW) * WINDOW;
}
const buckets = new Map();
for (const s of samples) {
  const b = bucketOf(s.t);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(s);
}

// ─── 全局摘要 ────────────────────────────────────────────────
function summarizeGlobal() {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const gclFirst = first.gcl ?? 0, gclLast = last.gcl ?? 0;
  const cpuMax = Math.max(...samples.map(s => s.cpu ?? 0));
  const cpuMean = samples.reduce((a, s) => a + (s.cpu ?? 0), 0) / samples.length;
  const cpuP95 = samples.map(s => s.cpu ?? 0).sort((a, b) => a - b)[Math.floor(samples.length * 0.95)];
  // bucket/CPU Top
  const bucketSamples = samples.filter(s => s.cpuTop).map(s => s.cpuTop.bucket);
  const bucketMin = bucketSamples.length ? Math.min(...bucketSamples) : null;
  const bucketMax = bucketSamples.length ? Math.max(...bucketSamples) : null;
  const bucketLow = bucketSamples.filter(b => b < 2000).length;
  const bucketCritical = bucketSamples.filter(b => b < 500).length;
  // schemaVersion 变化
  const svSeen = new Set();
  samples.forEach(s => svSeen.add(s.sv));
  // kernel tier 分布
  const tierCount = {};
  samples.forEach(s => {
    const t = s.kernel?.tier ?? "?";
    tierCount[t] = (tierCount[t] || 0) + 1;
  });
  // skipReasons 累加
  const skipSum = {};
  samples.forEach(s => {
    Object.entries(s.kernel?.skipReasons || {}).forEach(([k, v]) => {
      skipSum[k] = (skipSum[k] || 0) + (typeof v === "number" ? v : 0);
    });
  });
  // strategy.posture 分布
  const postureCount = {};
  samples.forEach(s => {
    const p = s.kernel?.strategy?.posture ?? "?";
    postureCount[p] = (postureCount[p] || 0) + 1;
  });
  return {
    tickRange: [first.t, last.t],
    span: last.t - first.t,
    gclDelta: gclLast - gclFirst,
    gclLast,
    schemaVersions: [...svSeen],
    cpu: { mean: +cpuMean.toFixed(2), max: cpuMax, p95: cpuP95 },
    bucket: { min: bucketMin, max: bucketMax, lowUnder2000: bucketLow, criticalUnder500: bucketCritical, sampled: bucketSamples.length },
    tier: tierCount,
    posture: postureCount,
    skipSum: Object.entries(skipSum).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

// ─── 房间演化 ────────────────────────────────────────────────
function summarizeRooms() {
  // 在 first / mid / last 三个时间点快照每房 RCL 与 colonyState
  const first = samples[0];
  const mid = samples[Math.floor(samples.length / 2)];
  const last = samples[samples.length - 1];
  const extract = (s) => {
    const out = {};
    (s.rooms || []).forEach(r => {
      out[r.room] = {
        rcl: r.rcl,
        state: r.colonyState,
        phase: r.phase,
        stor: r.energy.stor,
        term: r.energy.term,
        creepN: Object.values(r.creeps || {}).reduce((a, b) => a + b, 0),
        spawnQ: r.spawnQueue,
        buildQ: r.buildQueue,
      };
    });
    return out;
  };
  return { first: extract(first), mid: extract(mid), last: extract(last) };
}

// ─── 资源流：每窗口 storage/terminal/dropped 趋势 ───────────
function summarizeResourceFlow() {
  const out = [];
  for (const [b, arr] of buckets) {
    const last = arr[arr.length - 1];
    const rooms = last.rooms || [];
    const sumStor = rooms.reduce((a, r) => a + (r.energy?.stor || 0), 0);
    const sumTerm = rooms.reduce((a, r) => a + (r.energy?.term || 0), 0);
    const sumDropped = rooms.reduce((a, r) => a + (r.droppedEnergy || 0), 0);
    const sumSrc = rooms.reduce((a, r) => a + (r.energy?.src || 0), 0);
    const sumSrcCap = rooms.reduce((a, r) => a + (r.energy?.srcCap || 0), 0);
    const sumCont = rooms.reduce((a, r) => a + (r.energy?.cont || 0), 0);
    out.push({
      tickStart: b,
      samples: arr.length,
      stor: sumStor,
      term: sumTerm,
      dropped: sumDropped,
      src: sumSrc,
      srcCap: sumSrcCap,
      srcRatio: sumSrcCap ? +(sumSrc / sumSrcCap).toFixed(3) : null,
      cont: sumCont,
    });
  }
  return out;
}

// ─── 人口与 spawn 压力 ───────────────────────────────────────
function summarizePopulation() {
  // 各窗口末尾的 per-role 总数（跨房）和 spawnQueueByRole 累加
  const out = [];
  for (const [b, arr] of buckets) {
    const last = arr[arr.length - 1];
    const roleTotal = {};
    const spawnQ = {};
    let totalPop = 0, totalSpawnQ = 0;
    let ttlMin = Infinity, ttlMax = 0;
    for (const r of last.rooms || []) {
      Object.entries(r.creeps || {}).forEach(([k, v]) => {
        roleTotal[k] = (roleTotal[k] || 0) + v;
        totalPop += v;
      });
      Object.entries(r.spawnQueueByRole || {}).forEach(([k, v]) => {
        spawnQ[k] = (spawnQ[k] || 0) + v;
        totalSpawnQ += v;
      });
      if (r.creepTtlMean) {
        ttlMin = Math.min(ttlMin, r.creepTtlMean);
        ttlMax = Math.max(ttlMax, r.creepTtlMean);
      }
    }
    // spawnQueueCost 总和
    const spawnCost = (last.rooms || []).reduce((a, r) => a + (r.spawnQueueCost || 0), 0);
    out.push({
      tickStart: b, totalPop, totalSpawnQ, spawnCost,
      ttlMin: ttlMin === Infinity ? null : ttlMin,
      ttlMax,
      role: roleTotal,
      spawnQ,
    });
  }
  return out;
}

// ─── CPU 热点系统分布 ────────────────────────────────────────
function summarizeCpuHeat() {
  const sysAgg = {};
  for (const s of samples) {
    if (!s.cpuTop?.s) continue;
    for (const e of s.cpuTop.s) {
      if (!e.n) continue;
      if (!sysAgg[e.n]) sysAgg[e.n] = { count: 0, sum: 0, max: 0 };
      sysAgg[e.n].count++;
      sysAgg[e.n].sum += e.v || 0;
      sysAgg[e.n].max = Math.max(sysAgg[e.n].max, e.v || 0);
    }
  }
  return Object.entries(sysAgg)
    .map(([n, d]) => ({ sys: n, count: d.count, mean: +(d.sum / d.count).toFixed(3), max: d.max }))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 15);
}

// ─── 事件统计 ────────────────────────────────────────────────
function summarizeEvents() {
  // eventStats 全局累加（k0-22 含入侵/塔战/死亡/调参回滚等）
  const agg = { deaths: 0, deathsViolent: 0 };
  for (const s of samples) {
    const es = s.eventStats || {};
    agg.deaths += es.deaths || 0;
    agg.deathsViolent += es.deathsViolent || 0;
    Object.entries(es).forEach(([k, v]) => {
      if (k.startsWith("k")) agg[k] = (agg[k] || 0) + v;
    });
  }
  // 按 k 排序
  const sorted = Object.entries(agg)
    .filter(([k]) => k.startsWith("k"))
    .sort((a, b) => b[1] - a[1]);
  return { deaths: agg.deaths, deathsViolent: agg.deathsViolent, byKind: sorted };
}

// ─── 建造与布局 ──────────────────────────────────────────────
function summarizeBuild() {
  // 每窗口末尾 buildQueue 总长 / blocked 总数 / 各 type 队列
  const out = [];
  for (const [b, arr] of buckets) {
    const last = arr[arr.length - 1];
    let totalBq = 0, totalSites = 0;
    const bqBy = {}, bqBlocked = {};
    let layoutBlockedRooms = 0;
    for (const r of last.rooms || []) {
      totalBq += r.buildQueue || 0;
      totalSites += r.sites || 0;
      Object.entries(r.buildQueueByType || {}).forEach(([k, v]) => bqBy[k] = (bqBy[k] || 0) + v);
      Object.entries(r.buildQueueBlocked || {}).forEach(([k, v]) => bqBlocked[k] = (bqBlocked[k] || 0) + v);
    }
    const lb = last.layoutBlocked || {};
    Object.values(lb).forEach(v => { if (v > 0) layoutBlockedRooms++; });
    out.push({
      tickStart: b, totalBq, totalSites,
      bqBy, bqBlocked, layoutBlockedRooms,
      gapRooms: Object.keys(last.kernel?.gaps || {}).length,
    });
  }
  return out;
}

// ─── 远矿 ────────────────────────────────────────────────────
function summarizeRemote() {
  // 每窗口末尾 remoteRooms 数 / remoteOps 状态分布
  const out = [];
  for (const [b, arr] of buckets) {
    const last = arr[arr.length - 1];
    const rr = last.remoteRooms || {};
    const stateCount = {};
    let withThreat = 0, totalTargets = 0;
    for (const r of last.rooms || []) {
      const ro = r.remoteOps || {};
      Object.entries(ro).forEach(([k, v]) => {
        totalTargets++;
        stateCount[v.state] = (stateCount[v.state] || 0) + 1;
        if (v.threat) withThreat++;
      });
    }
    out.push({
      tickStart: b,
      activeRooms: Object.keys(rr).length,
      totalTargets,
      withThreat,
      stateDist: stateCount,
    });
  }
  return out;
}

// ─── 调参引擎 ────────────────────────────────────────────────
function summarizeTuning() {
  // lastTunedAge 趋势 / params / frozen / pending / baselineMatch
  const out = [];
  let lastBaseline = null, baselineChanges = 0;
  let maxPending = 0, maxFrozen = 0;
  for (const s of samples) {
    const t = s.kernel?.tuning;
    if (!t) continue;
    if (t.baselineMatch !== null && t.baselineMatch !== lastBaseline) {
      lastBaseline = t.baselineMatch;
      baselineChanges++;
    }
    maxPending = Math.max(maxPending, t.pending || 0);
    maxFrozen = Math.max(maxFrozen, t.params || 0); // 注意 params 字段在 collector 里是 frozen 数
    out.push({
      t: s.t,
      lastTunedAge: t.lastTunedAge,
      baseline: t.baselineMatch,
      rooms: t.rooms,
      frozen: t.params,
      pending: t.pending,
    });
  }
  return {
    samples: out.length,
    baselineChanges,
    maxPending,
    maxFrozen,
    lastSample: out[out.length - 1] || null,
    firstSample: out[0] || null,
  };
}

// ─── 军事与威胁 ──────────────────────────────────────────────
function summarizeMilitary() {
  // hostile 出现的样本数 + 各房 safeMode 使用情况
  let samplesWithHostiles = 0;
  const hostileByRoom = {};
  let safeModeActivations = 0;
  const towerEnergyByRoom = {};
  for (const s of samples) {
    let hasHostile = false;
    for (const r of s.rooms || []) {
      if (r.hostiles > 0) {
        hasHostile = true;
        hostileByRoom[r.room] = (hostileByRoom[r.room] || 0) + 1;
      }
      if (r.safeMode > 0) safeModeActivations++;
      const te = r.energy?.tower || 0;
      towerEnergyByRoom[r.room] = (towerEnergyByRoom[r.room] || 0) + te;
    }
    if (hasHostile) samplesWithHostiles++;
  }
  return {
    samplesWithHostiles,
    hostileByRoom: Object.entries(hostileByRoom).sort((a, b) => b[1] - a[1]),
    safeModeSamples: safeModeActivations,
    towerEnergyAvg: Object.entries(towerEnergyByRoom).map(([r, sum]) => ({
      room: r,
      avg: +(sum / samples.length).toFixed(0),
    })),
  };
}

// ─── 输出 ────────────────────────────────────────────────────
const report = {
  meta: {
    file: session.timeseries,
    samples: samples.length,
    window: WINDOW,
    buckets: buckets.size,
    generatedAt: new Date().toISOString(),
  },
  global: summarizeGlobal(),
  rooms: summarizeRooms(),
  resourceFlow: summarizeResourceFlow(),
  population: summarizePopulation(),
  cpuHeat: summarizeCpuHeat(),
  events: summarizeEvents(),
  build: summarizeBuild(),
  remote: summarizeRemote(),
  tuning: summarizeTuning(),
  military: summarizeMilitary(),
};

const OUT_FILE = path.join(COLLECT_DIR, "analysis-report.json");
fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
console.log(`\n[Output] ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);

// ─── 控制台精简摘要 ──────────────────────────────────────────
console.log("\n═══════════════ 全局摘要 ═══════════════");
console.log(JSON.stringify(report.global, null, 2));

console.log("\n═══════════════ 房间演化（首/中/末）═══════════════");
const r = report.rooms;
const allRooms = new Set([...Object.keys(r.first), ...Object.keys(r.mid), ...Object.keys(r.last)]);
for (const room of allRooms) {
  const f = r.first[room] || {}, m = r.mid[room] || {}, l = r.last[room] || {};
  console.log(`  ${room}: RCL ${f.rcl ?? "?"}→${m.rcl ?? "?"}→${l.rcl ?? "?"}  state ${f.state ?? "?"}/${m.state ?? "?"}/${l.state ?? "?"}  pop ${f.creepN ?? 0}/${m.creepN ?? 0}/${l.creepN ?? 0}  stor ${f.stor ?? 0}/${m.stor ?? 0}/${l.stor ?? 0}`);
}

console.log("\n═══════════════ 资源流（每窗口末尾）═══════════════");
console.log("tickStart | stor    | term   | dropped | srcRatio | cont    | samples");
for (const e of report.resourceFlow) {
  console.log(`  ${e.tickStart} | ${String(e.stor).padStart(7)} | ${String(e.term).padStart(6)} | ${String(e.dropped).padStart(7)} | ${(e.srcRatio ?? "-").toString().padStart(8)} | ${String(e.cont).padStart(7)} | ${e.samples}`);
}

console.log("\n═══════════════ 人口趋势 ═══════════════");
console.log("tickStart | pop | spawnQ | spawnCost | ttlMin | ttlMax");
for (const e of report.population) {
  console.log(`  ${e.tickStart} | ${String(e.totalPop).padStart(3)} | ${String(e.totalSpawnQ).padStart(6)} | ${String(e.spawnCost).padStart(9)} | ${String(e.ttlMin ?? "-").padStart(6)} | ${e.ttlMax}`);
}
// 末窗口的 role 分布
const lastPop = report.population[report.population.length - 1];
if (lastPop) {
  console.log("  末窗口 role 分布：" + Object.entries(lastPop.role).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log("  末窗口 spawnQ 分布：" + Object.entries(lastPop.spawnQ).map(([k, v]) => `${k}=${v}`).join(" "));
}

console.log("\n═══════════════ CPU 热点系统 Top15 ═══════════════");
console.log("sys                              | samples | mean   | max");
for (const e of report.cpuHeat) {
  console.log(`  ${e.sys.padEnd(32)} | ${String(e.count).padStart(7)} | ${e.mean.toFixed(3).padStart(7)} | ${e.max.toFixed(3)}`);
}

console.log("\n═══════════════ 事件统计（全周期累加）═══════════════");
const ev = report.events;
console.log(`  死亡事件：${ev.deaths} (暴力 ${ev.deathsViolent})`);
console.log("  按 kind Top：");
for (const [k, v] of ev.byKind.slice(0, 10)) console.log(`    ${k} = ${v}`);

console.log("\n═══════════════ 建造/布局 ═══════════════");
console.log("tickStart | bq | sites | bqBlocked | layoutBlockedRooms | gapRooms");
for (const e of report.build) {
  const blockedTypes = Object.entries(e.bqBlocked).map(([k, v]) => `${k}=${v}`).join(",") || "-";
  console.log(`  ${e.tickStart} | ${String(e.totalBq).padStart(2)} | ${String(e.totalSites).padStart(5)} | ${blockedTypes.padEnd(20)} | ${e.layoutBlockedRooms} | ${e.gapRooms}`);
}

console.log("\n═══════════════ 远矿 ═══════════════");
console.log("tickStart | activeRooms | targets | threat | stateDist");
for (const e of report.remote) {
  const sd = Object.entries(e.stateDist).map(([k, v]) => `${k}=${v}`).join(",") || "-";
  console.log(`  ${e.tickStart} | ${String(e.activeRooms).padStart(11)} | ${String(e.totalTargets).padStart(7)} | ${String(e.withThreat).padStart(6)} | ${sd}`);
}

console.log("\n═══════════════ 调参引擎 ═══════════════");
console.log(JSON.stringify(report.tuning, null, 2));

console.log("\n═══════════════ 军事 ═══════════════");
console.log(`  有敌情的样本数：${report.military.samplesWithHostiles} / ${samples.length}`);
console.log(`  各房敌情样本数：${report.military.hostileByRoom.map(([r, c]) => `${r}=${c}`).join(", ") || "无"}`);
console.log(`  safeMode 激活样本数：${report.military.safeModeSamples}`);
console.log(`  Tower 平均能量：${report.military.towerEnergyAvg.map(t => `${t.room}=${t.avg}`).join(", ") || "无"}`);
