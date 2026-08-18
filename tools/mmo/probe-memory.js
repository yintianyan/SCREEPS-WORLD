/**
 * MMO 内存/Segment 探针 — 解码 shard3 的 Memory 与 segment，打印结构摘要。
 * 用途：确认线上 Memory 的真实字段布局，为 monitor-mmo.js 的渲染层提供依据。
 * 仅读取，不写入。
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

function decodeGz(raw) {
  if (typeof raw !== "string") return raw;
  if (raw.startsWith("gz:")) {
    const buf = Buffer.from(raw.slice(3), "base64");
    return zlib.gunzipSync(buf).toString("utf8");
  }
  return raw;
}

async function api(pathname, qs) {
  const url = `${BASE}${pathname}?${qs}&shard=${SHARD}`;
  const res = await fetch(url, { headers: { "X-Token": TOKEN } });
  const text = await res.text();
  return text;
}

(async () => {
  console.log(`[probe] user=${env.SCREEPS_TOKEN ? "(token set)" : "NONE"} shard=${SHARD}`);

  // 1) Memory root — 返回信封 {ok,data}，data 为 gz 字符串
  const memRaw = await api("/user/memory", "path=");
  let env0;
  try { env0 = JSON.parse(memRaw); } catch (e) { console.log("[probe] mem envelope parse fail:", memRaw.slice(0, 200)); process.exit(1); }
  const memJson = decodeGz(env0.data);
  let mem;
  try { mem = JSON.parse(memJson); } catch (e) { console.log("[probe] mem parse fail:", memJson.slice(0, 200)); process.exit(1); }
  console.log("\n=== Memory top-level keys ===");
  console.log(Object.keys(mem).join(", "));

  console.log("\n=== kernel ===");
  const k = mem.kernel || {};
  console.log("tier:", k.tier, "| recoveryTicks:", k.recoveryTicks, "| strategy:", JSON.stringify(k.strategy || null));
  console.log("skipReasons:", JSON.stringify(k.skipReasons || {}));
  console.log("expansion:", JSON.stringify(k.expansion || null));

  console.log("\n=== rooms (", Object.keys(mem.rooms || {}).length, ") ===");
  for (const [rn, r] of Object.entries(mem.rooms || {})) {
    const rs = r.roomState || r;
    console.log(`  ${rn}: keys=[${Object.keys(r).join(",")}]`);
    console.log(`     colonyState=${r.colonyState} phase=${r.phase && r.phase.phase} rcl=${(r.roomState||{}).rcl} economyPressure=${r.economyPressure}`);
    console.log(`     spawnQueue=${((r.spawnQueue)||[]).length} buildQueue=${((r.buildQueue)||[]).filter(t=>t.state==="queued"||t.state==="site").length} remoteOps=${Object.keys(r.remoteOps||{}).length}`);
  }

  // 2) Segments 1 (CPU) and 2 (event log)
  for (const id of [1, 2, 3]) {
    const raw = await api("/user/memory-segment", `id=${id}`);
    let env1 = null; try { env1 = JSON.parse(raw); } catch {}
    if (env1 && env1.error) { console.log(`\n=== segment ${id} === ERROR: ${env1.error}`); continue; }
    const dec = decodeGz(env1 && env1.data !== undefined ? env1.data : raw);
    let obj = null; try { obj = JSON.parse(dec); } catch {}
    const size = dec ? dec.length : 0;
    console.log(`\n=== segment ${id} (${size} bytes) ===`);
    if (obj) {
      console.log("keys:", Object.keys(obj).join(","));
      if (obj.cpu && obj.cpu.d) {
        const d = obj.cpu.d.filter(Boolean);
        console.log(`  cpu ring entries=${d.length} last=`, JSON.stringify(d[d.length-1]));
      }
      if (obj.economy && obj.economy.d) {
        const d = obj.economy.d.filter(Boolean);
        console.log(`  economy ring entries=${d.length} last=`, JSON.stringify(d[d.length-1]));
      }
      if (obj.events && obj.events.d) {
        const d = obj.events.d.filter(Boolean);
        console.log(`  events ring entries=${d.length} last 3=`, JSON.stringify(d.slice(-3)));
      }
    } else {
      console.log("  (empty or raw):", String(dec).slice(0, 120));
    }
  }
  console.log("\n[probe] done");
})().catch(e => { console.error("PROBE ERROR:", e.message); process.exit(1); });
