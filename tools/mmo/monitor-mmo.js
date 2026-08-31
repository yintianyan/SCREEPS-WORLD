/**
 * MMO 帝国实时监控 — 盯 shard3 线上运行状态。
 *
 * 数据通道（均走官方 REST API + X-Token 鉴权，仅读取）：
 *   1. /api/user/memory       — 框架决策意图（kernel 档位/战略姿态、各房
 *      colonyState/phase/economyPressure/spawnQueue/buildQueue/remoteOps/intel）。
 *   2. /api/game/room-objects — 地面真相（controller 进度、塔/spawn/storage
 *      能量、敌方 creep 兵种构成、工地数）。
 *   3. /api/game/time         — 当前 tick（算 downgrade/safeMode 剩余）。
 *
 * 与 tools/private/monitor-empire.js 同源渲染，但面向 MMO（非私服 docker-cli）。
 *
 * 用法：
 *   node tools/mmo/monitor-mmo.js            # 打印一次全景
 *   node tools/mmo/monitor-mmo.js --watch    # 每 INTERVAL 秒刷新
 *   node tools/mmo/monitor-mmo.js --json      # 输出原始 JSON
 *
 * 环境变量：SCREEPS_TOKEN / SCREEPS_SHARD / MONITOR_INTERVAL(默认 60)
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..", "..");
function loadEnv() {
  const p = path.join(ROOT, "tools", ".env");
  const out = {};
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[k] = v;
    }
  }
  return out;
}
const env = loadEnv();
const TOKEN = env.SCREEPS_TOKEN;
const SHARD = env.SCREEPS_SHARD || "shard3";
const BASE = "https://screeps.com/api";
const INTERVAL_SEC = Number(env.MONITOR_INTERVAL || 60);

function decodeGz(raw) {
  if (typeof raw !== "string") return raw;
  if (raw.startsWith("gz:")) {
    return zlib.gunzipSync(Buffer.from(raw.slice(3), "base64")).toString("utf8");
  }
  return raw;
}
async function api(pathname, qs) {
  const url = `${BASE}${pathname}?${qs}&shard=${SHARD}`;
  const res = await fetch(url, { headers: { "X-Token": TOKEN } });
  const text = await res.text();
  let env1 = null;
  try { env1 = JSON.parse(text); } catch { return { raw: text }; }
  if (env1 && env1.error) return { error: env1.error };
  if (env1 && env1.data !== undefined) return { data: decodeGz(env1.data) };
  return { data: text };
}
async function getJson(pathname, qs) {
  const r = await api(pathname, qs);
  if (r.error) throw new Error(`${pathname} -> ${r.error}`);
  return JSON.parse(r.data);
}

// ─── 聚合：单房地面真相 ───────────────────────────────────
function aggregateRoom(objects, myId) {
  const ctrl = objects.find(o => o.type === "controller" && o.user === myId) ||
               objects.find(o => o.type === "controller");
  const r = {
    rcl: ctrl ? ctrl.level : "?",
    prog: ctrl ? ctrl.progress : 0,
    progTotal: ctrl ? ctrl.progressTotal : 0,
    safeMode: ctrl ? (ctrl.safeMode || 0) : 0,
    downgrade: ctrl ? (ctrl.downgradeTime || 0) : 0,
    myId: ctrl ? ctrl.user : myId,
    struct: {},
    energy: { spawn: 0, spawnCap: 0, ext: 0, extCap: 0, cont: 0, stor: 0, term: 0, src: 0, srcCap: 0, tower: 0, towerCap: 0 },
    creeps: {}, hostileBody: {}, hostiles: 0, sites: 0, tombstones: 0, dropped: 0,
    towers: [], links: [], nukers: [], remoteTargets: {},
  };
  for (const o of objects) {
    if (o.type === "creep") {
      if (o.user === r.myId) {
        const rn = (o.name || "").split("-")[0];
        r.creeps[rn] = (r.creeps[rn] || 0) + 1;
      } else {
        r.hostiles++;
        (o.body || []).forEach(p => {
          const key = p.type + (p.boost ? "+b" : "");
          if (["attack", "rangedAttack", "heal", "rangedHeal", "dismantle", "claim", "work"].includes(p.type) || p.boost)
            r.hostileBody[key] = (r.hostileBody[key] || 0) + 1;
        });
      }
      continue;
    }
    if (o.type === "source") { r.energy.src += (o.energy || 0); r.energy.srcCap += (o.energyCapacity || 0); continue; }
    if (o.type === "container") { r.energy.cont += ((o.store && o.store.energy) || 0); r.struct.container = (r.struct.container || 0) + 1; continue; }
    if (o.type === "tombstone") { r.tombstones++; continue; }
    if (o.type === "energy") { r.dropped += (o.amount || 0); continue; }
    if (o.type === "constructionSite") { if (o.user === r.myId) r.sites++; continue; }
    if (o.type === "mineral") { continue; }
    if (o.user !== r.myId) continue;
    r.struct[o.type] = (r.struct[o.type] || 0) + 1;
    if (o.type === "spawn") { r.energy.spawn += ((o.store && o.store.energy) || 0); r.energy.spawnCap += ((o.storeCapacityResource && o.storeCapacityResource.energy) || 300); }
    if (o.type === "extension") { r.energy.ext += ((o.store && o.store.energy) || 0); r.energy.extCap += ((o.storeCapacityResource && o.storeCapacityResource.energy) || 50); }
    if (o.type === "storage") { r.energy.stor += ((o.store && o.store.energy) || 0); }
    if (o.type === "terminal") { r.energy.term += ((o.store && o.store.energy) || 0); }
    if (o.type === "tower") { r.energy.tower += ((o.store && o.store.energy) || 0); r.energy.towerCap += ((o.storeCapacityResource && o.storeCapacityResource.energy) || 1000); r.towers.push({ x: o.x, y: o.y, e: (o.store && o.store.energy) || 0 }); }
    if (o.type === "link") r.links.push({ x: o.x, y: o.y, e: (o.store && o.store.energy) || 0 });
    if (o.type === "nuker") r.nukers.push({ x: o.x, y: o.y, cd: o.cooldown || 0 });
  }
  return r;
}

// ─── 渲染 ────────────────────────────────────────────────
function bar(cur, cap, width) {
  width = width || 10;
  if (!cap) return "─".repeat(width);
  const filled = Math.round((cur / cap) * width);
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(0, width - filled));
}
function pct(cur, cap) { return cap ? Math.round((cur / cap) * 100) + "%" : "n/a"; }
function fmtCreeps(c) {
  const keys = Object.keys(c).sort();
  return keys.length ? keys.map(k => `${k}:${c[k]}`).join(" ") : "无";
}
function renderRoom(rm, phys, mem, tick) {
  const lines = [];
  const progTxt = phys.progTotal ? `${phys.prog}/${phys.progTotal} (${pct(phys.prog, phys.progTotal)})` : `${phys.prog}`;
  const stateTag = mem.colonyState === "normal" ? mem.colonyState : `⚠️${mem.colonyState}`;
  lines.push(`┌─ 🏛  ${rm}  RCL${phys.rcl} ${progTxt}  [${stateTag}] phase=${mem.phase && mem.phase.phase || mem.phase || "?"}`);
  const e = phys.energy;
  const econ = [];
  econ.push(`spawn ${bar(e.spawn, e.spawnCap, 6)} ${e.spawn}/${e.spawnCap}`);
  econ.push(`ext ${bar(e.ext, e.extCap, 6)} ${e.ext}/${e.extCap}`);
  if (e.cont > 0) econ.push(`container ${e.cont}`);
  if (e.stor > 0 || phys.struct.storage) econ.push(`storage ${e.stor}`);
  if (e.term > 0 || phys.struct.terminal) econ.push(`terminal ${e.term}`);
  lines.push(`│ 💰 经济: ${econ.join(" · ")}`);
  lines.push(`│    source: ${bar(e.src, e.srcCap, 8)} ${e.src}/${e.srcCap}` +
    (mem.economyPressure !== undefined ? `  压力=${(mem.economyPressure * 100).toFixed(0)}%` : "") +
    (mem.storageNearFull ? "  storage近满" : ""));
  const totalCreeps = Object.keys(phys.creeps).reduce((s, k) => s + phys.creeps[k], 0);
  lines.push(`│ 🥚 孵化: ${totalCreeps}只 [${fmtCreeps(phys.creeps)}]  队列=${(mem.spawnQueue || []).length}`);
  const structTxt = Object.keys(phys.struct).sort().map(k => `${k}×${phys.struct[k]}`).join(" ");
  lines.push(`│ 🏗  建造: ${structTxt || "无"}`);
  lines.push(`│    工地=${phys.sites}  buildQueue=${((mem.buildQueue || []).filter(t => t.state === "queued" || t.state === "site").length)}` +
    (((mem.buildQueue || []).filter(t => t.state === "queued" || t.state === "site").length) > 15 ? " ⚠️积压" : ""));
  const mil = [];
  mil.push(`tower×${phys.struct.tower || 0} ${phys.struct.tower ? bar(e.tower, e.towerCap, 5) + " " + e.tower : ""}`);
  mil.push(`rampart×${phys.struct.rampart || 0}`);
  mil.push(`wall×${phys.struct.constructedWall || 0}`);
  if (phys.hostiles > 0) mil.push(`🚨敌×${phys.hostiles}`);
  // room-objects 的 controller.safeMode 是「结束时的绝对 tick」：激活期为未来值，
  // 过期后残留旧值不清零 — 只有大于当前 tick 才算在保，残留值一律视为 0。
  const safeRemain = phys.safeMode > tick ? phys.safeMode - tick : 0;
  if (safeRemain > 0) mil.push(`🛡safeMode(剩${safeRemain}t)`);
  const downRemain = phys.downgrade > tick ? phys.downgrade - tick : (phys.downgrade ? -1 : 0);
  if (downRemain > 0 && downRemain < 20000) mil.push(`⏳降级(剩${downRemain}t)`);
  else if (downRemain === -1) mil.push(`⏳已降级`);
  if (mem.controllerDowngradeRisk) mil.push(`⏳降级风险`);
  lines.push(`│ ⚔️  军事: ${mil.join("  ")}`);
  if (phys.hostiles > 0) {
    const hb = Object.entries(phys.hostileBody).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}×${v}`).join(" ");
    lines.push(`│    敌兵构成: ${hb || "未知"}`);
  }
  const ro = mem.remoteOps || {};
  const roKeys = Object.keys(ro);
  if (roKeys.length > 0) {
    const roTxt = roKeys.map(k => `${k}[${ro[k].state}${ro[k].threat ? " 🚨威胁" : ""}]`).join(" ");
    lines.push(`│ ⛏  远矿: ${roTxt}`);
  }
  if (mem.intel) {
    const danger = Object.keys(mem.intel).filter(k => mem.intel[k].dangerUntil && mem.intel[k].dangerUntil > tick).length;
    if (danger > 0) lines.push(`│ 🗺  情报: ${danger}个危险房`);
  }
  lines.push(`└${"─".repeat(50)}`);
  return lines.join("\n");
}

function render(state) {
  const out = [];
  const k = state.kernel;
  out.push(`╔══════ 帝国全景 @ tick ${state.tick} (shard ${SHARD}) ══════╗`);
  const posture = k.strategy && k.strategy.posture;
  const postureTag = posture === "war" ? "🔴战争" : posture === "defense" ? "🟡防御" : posture || "?";
  out.push(`内核档位=${k.tier || "?"}  帝国姿态=${postureTag}` +
    (k.recoveryTicks ? `  恢复中=${k.recoveryTicks}t` : ""));
  const skips = Object.entries(k.skipReasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (skips.length) out.push(`跳过Top3: ` + skips.map(kv => `${kv[0]}=${kv[1]}`).join("  "));
  // 全局告警横幅
  const alerts = [];
  if (posture === "war") alerts.push("战争姿态");
  let totalHostiles = 0, anySafe = 0, anyDown = 0;
  state.rooms.forEach(r => {
    totalHostiles += r.phys.hostiles;
    // 同 renderRoom 口径：safeMode 为绝对结束 tick，过期残留值不算在保。
    const sr = r.phys.safeMode > state.tick ? r.phys.safeMode - state.tick : 0;
    if (sr > 0) anySafe++;
    if (r.mem.controllerDowngradeRisk) anyDown++;
  });
  if (totalHostiles > 0) alerts.push(`敌方creep×${totalHostiles}`);
  if (anySafe > 0) alerts.push(`safeMode激活×${anySafe}`);
  if (anyDown > 0) alerts.push(`降级风险×${anyDown}`);
  if (alerts.length) out.push(`🔔 告警: ${alerts.join("  ")}`);
  out.push("");
  state.rooms.forEach(r => out.push(renderRoom(r.room, r.phys, r.mem, state.tick)));
  return out.join("\n");
}

// ─── 采样 ────────────────────────────────────────────────
async function sampleOnce() {
  const [mem, timeRes] = await Promise.all([
    getJson("/user/memory", "path="),
    api("/game/time", ""),
  ]);
  let tick = 0;
  const timeBody = timeRes.data || timeRes.raw;
  if (timeBody) { try { tick = JSON.parse(timeBody).time || 0; } catch {} }
  const kernel = mem.kernel || {};
  const rooms = [];
  for (const [rm, rmem] of Object.entries(mem.rooms || {})) {
    let phys = null;
    try {
      const objRes = await api("/game/room-objects", `room=${rm}`);
      const objs = objRes.data ? JSON.parse(objRes.data).objects : [];
      phys = aggregateRoom(objs, null);
    } catch (e) {
      phys = aggregateRoom([], null);
      phys.err = e.message;
    }
    rooms.push({ room: rm, phys, mem: rmem });
  }
  return { tick, kernel, rooms, creeps: mem.creeps || {}, raw: { mem, tick } };
}

// ─── 入口 ────────────────────────────────────────────────
function ts() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
async function main() {
  if (!TOKEN) { console.error("缺少 SCREEPS_TOKEN（tools/.env）"); process.exit(1); }
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const watch = args.includes("--watch");
  const daemon = args.includes("--daemon");
  if (daemon) return daemonRun();
  async function tick() {
    try {
      const s = await sampleOnce();
      if (asJson) { console.log(JSON.stringify(s.raw, null, 2)); return; }
      console.log(render(s));
    } catch (e) {
      console.error(`[${ts()}] 采样失败: ${e.message}`);
    }
  }
  await tick();
  if (watch) setInterval(tick, INTERVAL_SEC * 1000);
}

// ─── 守护模式：状态对比 + 告警阈值（供定时任务静默盯盘）─────────
const STATE_FILE = path.join(__dirname, ".watch-state.json");
const HEARTBEAT_EVERY = 6; // 每 6 次运行发一次心跳（约 2h @20min）
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return null; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }

function daemonRun() {
  return sampleOnce().then(s => {
    const tick = s.tick;
    const k = s.kernel;
    const posture = (k.strategy && k.strategy.posture) || "?";
    const prev = loadState();
    const alerts = [];
    const rooms = s.rooms.map(r => {
      // 同 renderRoom 口径：safeMode 为绝对结束 tick，过期残留值不算在保。
      const sr = r.phys.safeMode > tick ? r.phys.safeMode - tick : 0;
      const dr = r.phys.downgrade > tick ? r.phys.downgrade - tick : (r.phys.downgrade ? -1 : 0);
      const bq = (r.mem.buildQueue || []).filter(t => t.state === "queued" || t.state === "site").length;
      const sq = (r.mem.spawnQueue || []).length;
      if (r.phys.hostiles > 0) alerts.push(`[${r.room}] 敌方creep×${r.phys.hostiles} ${Object.entries(r.phys.hostileBody).map(([x, v]) => x + "×" + v).join(" ")}`);
      if (sr > 0 && sr < 5000) alerts.push(`[${r.room}] safeMode剩${sr}t即将耗尽`);
      if (dr > 0 && dr < 20000) alerts.push(`[${r.room}] controller ${dr}t后降级`);
      if (r.mem.controllerDowngradeRisk) alerts.push(`[${r.room}] controller降级风险`);
      if (bq > 15) alerts.push(`[${r.room}] 建造积压=${bq}`);
      return { room: r.room, rcl: r.phys.rcl, colonyState: r.mem.colonyState, hostiles: r.phys.hostiles, safeRemain: sr, downRemain: dr, bq, sq, econ: r.mem.economyPressure };
    });
    if (k.tier && k.tier !== "healthy") alerts.push(`内核档位=${k.tier}`);
    if (prev) {
      if (prev.posture && prev.posture !== posture) alerts.push(`帝国姿态 ${prev.posture}→${posture}`);
      if (prev.newRemoteOpsAllowed !== undefined && prev.newRemoteOpsAllowed !== (k.strategy && k.strategy.newRemoteOpsAllowed))
        alerts.push(`newRemoteOpsAllowed=${k.strategy && k.strategy.newRemoteOpsAllowed}`);
      if (prev.expansionAllowed !== undefined && prev.expansionAllowed !== (k.strategy && k.strategy.expansionAllowed))
        alerts.push(`expansionAllowed=${k.strategy && k.strategy.expansionAllowed}`);
    }
    const next = {
      tick, tier: k.tier, posture,
      newRemoteOpsAllowed: k.strategy && k.strategy.newRemoteOpsAllowed,
      expansionAllowed: k.strategy && k.strategy.expansionAllowed,
      runCount: (prev ? prev.runCount || 0 : 0) + 1,
      ts: Date.now(),
    };
    saveState(next);
    if (alerts.length) {
      console.log(`ALERT @tick${tick} shard${SHARD} 档位=${k.tier} 姿态=${posture}\n - ` + alerts.join("\n - "));
    } else if (next.runCount % HEARTBEAT_EVERY === 0) {
      const totalHost = rooms.reduce((a, r) => a + r.hostiles, 0);
      console.log(`HEARTBEAT @tick${tick} 档位=${k.tier} 姿态=${posture} 主房=${rooms.length} 敌=${totalHost} safeMode=${rooms.map(r => r.safeRemain > 0 ? r.safeRemain + "t" : "无").join("/")}`);
    } else {
      console.log("quiet");
    }
  }).catch(e => { console.log(`ERROR 采样失败: ${e.message}`); });
}
main();
