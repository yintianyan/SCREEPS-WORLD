// 综合监测：心跳存活 + creep 两拍位置/store 对比 + 经济关键点。
// 用法：node tools/monitor.js [room] [间隔秒]
require("./load-env");
const https = require("https");
const zlib = require("zlib");
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";
const room = process.argv[2] || "W37S58";
const gapSec = parseInt(process.argv[3] || "20", 10);

function get(path) {
  return new Promise((r) => {
    https.get({ host: "screeps.com", path, headers: { "X-Token": token } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => r(d));
    }).on("error", () => r(""));
  });
}
function gunzip(data) {
  let c = data;
  if (typeof c === "string" && c.startsWith("gz:")) c = zlib.gunzipSync(Buffer.from(c.slice(3), "base64")).toString("utf8");
  return typeof c === "object" ? c : JSON.parse(c);
}
async function gameTime() { return JSON.parse(await get(`/api/game/time?shard=${shard}`)).time; }
async function kernel() { return gunzip(JSON.parse(await get(`/api/user/memory?shard=${shard}&path=kernel`)).data); }
async function roomObjs() {
  const j = JSON.parse(await get(`/api/game/room-objects?room=${room}&shard=${shard}`));
  return j.objects || [];
}
function creepSnap(objs) {
  const m = {};
  for (const o of objs) {
    if (o.type === "creep" && o.name) m[o.name] = { x: o.x, y: o.y, e: o.store?.energy ?? 0 };
  }
  return m;
}
function econSnap(objs) {
  let extFilled = 0, extTotal = 0, extEnergy = 0, spawnE = 0, storageE = 0;
  for (const o of objs) {
    if (o.type === "extension") { extTotal++; const e = o.store?.energy ?? 0; extEnergy += e; if (e > 0) extFilled++; }
    if (o.type === "spawn") spawnE = o.store?.energy ?? 0;
    if (o.type === "storage") storageE = o.store?.energy ?? 0;
  }
  return { extFilled, extTotal, extEnergy, spawnE, storageE };
}

(async () => {
  const t1 = await gameTime();
  const k = await kernel();
  const beat = t1 - (k.stats?.lastSample ?? 0);
  console.log(`═══ ${new Date().toISOString().slice(11, 19)} gameTime=${t1} ═══`);
  console.log(`心跳: tier=${k.tier} recoveryTicks=${k.recoveryTicks} 滞后=${beat}tick ${beat < 30 ? "✅存活" : "🔴主循环疑似死亡"}`);
  const objs1 = await roomObjs();
  const c1 = creepSnap(objs1);
  const e1 = econSnap(objs1);
  console.log(`经济: ext ${e1.extFilled}/${e1.extTotal}(${e1.extEnergy}E) spawn=${e1.spawnE} storage=${e1.storageE}`);
  console.log(`creep 数=${Object.keys(c1).length}，等待 ${gapSec}s 后对比活动...`);

  await new Promise((r) => setTimeout(r, gapSec * 1000));

  const t2 = await gameTime();
  const objs2 = await roomObjs();
  const c2 = creepSnap(objs2);
  console.log(`── ${gapSec}s 后 (gameTime=${t2}, +${t2 - t1}tick) creep 活动对比 ──`);
  let moved = 0, worked = 0, idle = 0;
  for (const name of Object.keys(c2)) {
    const a = c1[name], b = c2[name];
    if (!a) continue;
    const posChg = a.x !== b.x || a.y !== b.y;
    const eChg = a.e !== b.e;
    if (posChg) moved++;
    if (eChg) worked++;
    if (!posChg && !eChg) { idle++; console.log(`  静止: ${name.slice(0, 34)} @(${b.x},${b.y}) e=${b.e}`); }
  }
  console.log(`活动统计: 移动=${moved} 背包变化=${worked} 完全静止=${idle} / 总${Object.keys(c2).length}`);
  console.log(`判定: ${idle === 0 ? "✅ 全部 creep 在活动" : moved + worked > 0 ? "⚠️ 部分静止（可能待命/卡位）" : "🔴 全部静止 = creep 停摆"}`);
})();
