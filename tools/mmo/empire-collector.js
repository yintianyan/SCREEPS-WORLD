/**
 * MMO 帝国长期采集器 — 官服能量流转 + creep 效率时间序列（JSONL 落盘）。
 *
 * 数据通道（官方 REST API + X-Token，仅读取，不写游戏状态）：
 *   1. /api/user/memory        — 全量 Memory（kernel 决策态 + 各房决策态 + remoteOps）。
 *   2. /api/user/memory-segment?segment=4 — bot 自导出的 Prometheus 文本
 *      （creep 角色 work/idle/travel 比、spawn 忙闲、CPU 等）。
 *   3. /api/game/room-objects  — 每房地面真相（能量各仓位、source 能量、
 *      controller 进度、工地进度、creep 构成与携带量）→ 后分析差分出能量台账。
 *
 * 输出：tools/mmo/data/collect/timeseries-YYYYMMDD.jsonl（按天分文件，逐行追加）。
 * 每行一条紧凑快照；分析由 tools/mmo/analyze-flow.js 差分完成，采集器不做推理。
 *
 * 用法：
 *   node tools/mmo/empire-collector.js            # 采样一次（供 cron 定时任务）
 *   node tools/mmo/empire-collector.js --watch    # 本地常驻（INTERVAL_MIN 分钟间隔）
 * 环境变量：SCREEPS_TOKEN / SCREEPS_SHARD / INTERVAL_MIN（默认 15）
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..", "..");
(function loadEnv() {
  const p = path.join(ROOT, "tools", ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    const hi = v.indexOf(" #");
    if (hi >= 0) v = v.slice(0, hi).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined && v !== "") process.env[k] = v;
  }
})();

const TOKEN = process.env.SCREEPS_TOKEN;
const SHARD = process.env.SCREEPS_SHARD || "shard3";
const BASE = "https://screeps.com/api";
const INTERVAL_MIN = Number(process.env.INTERVAL_MIN || 15);
const OUT_DIR = path.join(__dirname, "data", "collect");

const PART_COST = { work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600 };

function decodeGz(raw) {
  if (typeof raw !== "string") return raw;
  if (raw.startsWith("gz:")) return zlib.gunzipSync(Buffer.from(raw.slice(3), "base64")).toString("utf8");
  return raw;
}

async function api(pathname, qs) {
  const url = `${BASE}${pathname}${qs ? "?" + qs : ""}${qs ? "&" : "?"}shard=${SHARD}`;
  const res = await fetch(url, { headers: { "X-Token": TOKEN } });
  if (res.status === 429) throw new Error("rate-limited(429)");
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${pathname} -> 非 JSON 响应`); }
  if (body.error) throw new Error(`${pathname} -> ${body.error}`);
  return body;
}

/** 解析 Prometheus 文本为 { "name{label=v,w=x}": value }（无标签 key 为裸名）。 */
function parseProm(text) {
  const out = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const sp = line.lastIndexOf(" ");
    if (sp <= 0) continue;
    const key = line.slice(0, sp);
    const val = Number(line.slice(sp + 1));
    if (Number.isNaN(val)) continue;
    out[key] = val;
  }
  return out;
}

function roleOfName(name) {
  return (name || "").split("-")[0];
}

function bodyCost(body) {
  if (!Array.isArray(body)) return null;
  let sum = 0;
  for (const p of body) sum += PART_COST[p.type] ?? 0;
  return sum;
}

/** 聚合单房 ground truth（room-objects）。myId 来自自有房 controller.user（远矿房也用它识别己方 creep）。 */
function aggregateRoom(objects, myIdHint) {
  const ctrl = objects.find((o) => o.type === "controller" && o.user);
  const myId = myIdHint || (ctrl ? ctrl.user : null);
  const r = {
    myId,
    rcl: null, ctrlProg: null, ctrlProgTotal: null, safeMode: 0, downgrade: 0,
    energy: { spawn: 0, spawnCap: 0, ext: 0, extCap: 0, cont: 0, stor: 0, term: 0, tower: 0, towerCap: 0, link: 0 },
    srcCap: 0, srcE: 0, sources: [],
    dropped: 0, tombE: 0,
    hits: { rampart: 0, wall: 0, road: 0 },
    sites: [], struct: {},
    creeps: [], hostiles: 0, hostileBody: {},
  };
  for (const o of objects) {
    switch (o.type) {
      case "controller":
        if (o.user === myId) {
          r.rcl = o.level ?? null;
          r.ctrlProg = o.progress ?? null;
          r.ctrlProgTotal = o.progressTotal ?? null;
          r.safeMode = o.safeMode || 0;
          r.downgrade = o.downgradeTime || 0;
        }
        break;
      case "source":
        r.srcE += o.energy || 0;
        r.srcCap += o.energyCapacity || 0;
        r.sources.push({ id: o._id || o.id, e: o.energy || 0, cap: o.energyCapacity || 0, ttl: o.ticksToRegeneration ?? null });
        break;
      case "container":
        r.energy.cont += (o.store && o.store.energy) || 0;
        r.struct.container = (r.struct.container || 0) + 1;
        break;
      case "tombstone":
        r.tombE += (o.store && o.store.energy) || 0;
        break;
      case "energy":
        r.dropped += o.amount || 0;
        break;
      case "constructionSite":
        if (o.user && o.user === myId) r.sites.push({ id: o._id || o.id, type: o.structureType, prog: o.progress || 0, total: o.progressTotal || 0 });
        break;
      case "creep": {
        if (o.user === myId) {
          r.creeps.push({
            n: o.name, role: roleOfName(o.name),
            carry: (o.store && o.store.energy) || 0,
            cost: bodyCost(o.body),
            ttl: o.age ?? o.ticksToLive ?? null,
          });
        } else {
          r.hostiles++;
          for (const p of o.body || []) {
            if (["attack", "ranged_attack", "heal", "work", "claim", "dismantle"].includes(p.type) || p.boost) {
              r.hostileBody[p.type + (p.boost ? "+b" : "")] = (r.hostileBody[p.type + (p.boost ? "+b" : "")] || 0) + 1;
            }
          }
        }
        break;
      }
      default: {
        if (!o.user || o.user !== myId) break;
        r.struct[o.type] = (r.struct[o.type] || 0) + 1;
        if (o.type === "rampart" || o.type === "constructedWall" || o.type === "road") {
          r.hits[o.type === "constructedWall" ? "wall" : o.type] += o.hits || 0;
        }
        const se = (o.store && o.store.energy) || 0;
        if (o.type === "spawn") { r.energy.spawn += se; r.energy.spawnCap += (o.storeCapacityResource && o.storeCapacityResource.energy) || 300; }
        else if (o.type === "extension") { r.energy.ext += se; r.energy.extCap += (o.storeCapacityResource && o.storeCapacityResource.energy) || 50; }
        else if (o.type === "storage") r.energy.stor += se;
        else if (o.type === "terminal") r.energy.term += se;
        else if (o.type === "tower") { r.energy.tower += se; r.energy.towerCap += (o.storeCapacityResource && o.storeCapacityResource.energy) || 1000; }
        else if (o.type === "link") r.energy.link += se;
        break;
      }
    }
  }
  return r;
}

function todayTag() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 以 UTC+8 归日，便于国内用户读档
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function sampleOnce() {
  const errors = [];
  // 1. 全量 Memory（kernel + rooms 决策态）
  let mem = null;
  try {
    const r = await api("/user/memory", "path=");
    mem = JSON.parse(decodeGz(r.data));
  } catch (e) { errors.push("memory:" + e.message); }

  // 2. segment 4 Prometheus
  let prom = null;
  try {
    const r = await api("/user/memory-segment", "segment=4");
    prom = parseProm(decodeGz(r.data));
  } catch (e) { errors.push("segment:" + e.message); }

  // 3. 当前 tick（/api/game/time 返回 {ok,time}，无 data 包装）
  let tick = null;
  try {
    const r = await api("/game/time", "");
    tick = typeof r.time === "number" ? r.time : (typeof r.data === "number" ? r.data : JSON.parse(r.data).time);
  } catch (e) { errors.push("time:" + e.message); }

  // 4. 每房 room-objects：自有房 + 远矿目标房
  const ownRooms = Object.keys((mem && mem.rooms) || {});
  const remoteTargets = new Set();
  for (const rm of ownRooms) {
    const ops = (((mem || {}).rooms || {})[rm] || {}).remoteOps || {};
    for (const [k, v] of Object.entries(ops)) {
      if (v && v.state && v.state !== "abandoned") remoteTargets.add(k);
    }
  }
  const rooms = [];
  let myId = null;
  const fetched = [];
  for (const rm of [...new Set([...ownRooms, ...remoteTargets])]) {
    const isOwn = ownRooms.includes(rm);
    try {
      const body = await api("/game/room-objects", `room=${rm}`);
      // 响应形状：{ ok, objects, users }（顶层 objects，无 data 包装）
      const objs = body.objects || (body.data && body.data.objects) || [];
      fetched.push({ rm, objs, isOwn });
    } catch (e) {
      rooms.push({ name: rm, own: isOwn, err: e.message });
    }
  }
  // 先从自有房确定 myId，再统一聚合（保证远矿房能识别己方 creep）
  for (const f of fetched) {
    if (f.isOwn) {
      const c = f.objs.find((o) => o.type === "controller" && o.user);
      if (c) { myId = c.user; break; }
    }
  }
  for (const f of fetched) {
    const phys = aggregateRoom(f.objs, myId);
    rooms.push({ name: f.rm, own: f.isOwn, phys });
  }

  return { t: tick, ts: new Date().toISOString(), errors, rooms, prom, mem };
}

/** 压缩为紧凑 JSONL 行（决策态裁剪 + prom 瘦身）。 */
function compact(s) {
  const mem = s.mem || {};
  const kernel = mem.kernel || {};
  const roomsOwn = (mem.rooms || {});
  const roleAgg = {};
  for (const key of Object.keys(s.prom || {})) {
    const m = key.match(/^screeps_creep_(alive|ttl|work_ratio|idle_ratio|travel_ratio|productivity)\{role="([^"]+)"\}$/);
    if (m) {
      roleAgg[m[2]] = roleAgg[m[2]] || {};
      roleAgg[m[2]][m[1]] = s.prom[key];
    }
  }
  const roomCensus = {};
  for (const key of Object.keys(s.prom || {})) {
    const m = key.match(/^screeps_room_(rcl|storage_energy|terminal_energy|creeps)\{room="([^"]+)"\}$/);
    if (m) {
      roomCensus[m[2]] = roomCensus[m[2]] || {};
      roomCensus[m[2]][m[1]] = s.prom[key];
    }
  }
  const g = (name) => s.prom ? s.prom[name] : null;

  return {
    t: s.t, ts: s.ts, errors: s.errors,
    cpu: { used: g("screeps_runtime_cpu_used"), limit: g("screeps_runtime_cpu_limit"), bucket: g("screeps_runtime_cpu_bucket") },
    kernel: {
      tier: kernel.tier || null,
      posture: kernel.strategy && kernel.strategy.posture,
      skipReasons: kernel.skipReasons || {},
      strategy: kernel.strategy ? {
        expansionAllowed: kernel.strategy.expansionAllowed,
        newRemoteOpsAllowed: kernel.strategy.newRemoteOpsAllowed,
      } : null,
    },
    empire: {
      health: g("screeps_empire_health"), energy: g("screeps_empire_energy"),
      creeps: g("screeps_empire_creeps"), rooms: g("screeps_empire_rooms"), gcl: g("screeps_empire_gcl"),
    },
    spawn: {
      count: g("screeps_spawn_count"), busy: g("screeps_spawn_busy"),
      idle: g("screeps_spawn_idle"), queue: g("screeps_spawn_queue_length"),
    },
    roles: roleAgg,
    roomCensus,
    rooms: s.rooms.map((r) => {
      const memr = roomsOwn[r.name] || {};
      const p = r.phys;
      if (!p) return { name: r.name, own: r.own, err: r.err || "no-objects" };
      const carryTotal = p.creeps.reduce((a, c) => a + c.carry, 0);
      const totalStored = p.energy.spawn + p.energy.ext + p.energy.cont + p.energy.stor + p.energy.term + p.energy.tower
        + p.energy.link + p.dropped + p.tombE + carryTotal;
      return {
        name: r.name, own: r.own,
        rcl: p.rcl, ctrlProg: p.ctrlProg, ctrlProgTotal: p.ctrlProgTotal,
        ledger: { ...p.energy, srcE: p.srcE, srcCap: p.srcCap, dropped: p.dropped, tombE: p.tombE, hits: p.hits, carry: carryTotal, totalStored },
        srcDetail: p.sources,
        sites: p.sites,
        struct: p.struct,
        creeps: p.creeps.length ? p.creeps : undefined,
        hostiles: p.hostiles || undefined,
        hostileBody: Object.keys(p.hostileBody).length ? p.hostileBody : undefined,
        safeModeRemain: p.safeMode && s.t && p.safeMode > s.t ? p.safeMode - s.t : 0,
        downgradeRemain: p.downgrade && s.t && p.downgrade > s.t ? p.downgrade - s.t : (p.downgrade ? -1 : 0),
        decision: r.own ? {
          colonyState: memr.colonyState,
          phase: memr.phase && memr.phase.phase,
          reserve: memr.phase && memr.phase.reserve,
          liquidity: memr.phase && memr.phase.liquidityScore,
          drainScore: memr.phase && memr.phase.drainScore,
          srcStallTicks: memr.phase && memr.phase.srcStallTicks,
          economyPressure: memr.economyPressure,
          spawnQueueLen: (memr.spawnQueue || []).length,
          spawnQueueRoles: (memr.spawnQueue || []).map((q) => q.role),
          buildQueueLen: (memr.buildQueue || []).filter((x) => x.state === "queued" || x.state === "site").length,
          remoteOps: memr.remoteOps ? Object.fromEntries(Object.entries(memr.remoteOps).map(([k, v]) => [k, { state: v.state, haulerNeed: v.haulerNeed, threat: v.threat || undefined }])) : undefined,
        } : undefined,
      };
    }),
  };
}

function appendLine(obj) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `timeseries-${todayTag()}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
  return file;
}

async function runOnce() {
  if (!TOKEN) { console.error("缺少 SCREEPS_TOKEN（tools/.env）"); process.exit(1); }
  const started = Date.now();
  try {
    const s = await sampleOnce();
    const row = compact(s);
    const file = appendLine(row);
    const n = Object.keys(row.roles).length;
    console.log(`[collect] t=${row.t} rooms=${row.rooms.length} roles=${n} errors=${row.errors.length ? row.errors.join(";") : "none"} -> ${file} (${Date.now() - started}ms)`);
    if (row.errors.length) process.exitCode = 2;
  } catch (e) {
    console.error(`[collect] FAILED: ${e.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const watch = process.argv.includes("--watch");
  if (!watch) return runOnce();
  console.log(`[collect] watch mode: every ${INTERVAL_MIN} min`);
  await runOnce();
  setInterval(runOnce, INTERVAL_MIN * 60 * 1000);
}

main();
