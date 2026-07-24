/**
 * Diagnose Screeps API response format and fetch all available data.
 */
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.SCREEPS_TOKEN || "1db484c6-6689-4274-9d62-1b2efd421f46";
const SHARD = process.env.SCREEPS_SHARD || "shard3";
const EXPORT_DIR = "./data/export";

function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "screeps.com",
      port: 443,
      path: pathname,
      method: "GET",
      headers: { "X-Token": TOKEN, "Content-Type": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function decodeData(resp) {
  if (!resp || !resp.data) return null;
  let d = resp.data;
  if (typeof d !== "string") return d;
  if (d.startsWith("gz:")) {
    try {
      const buf = Buffer.from(d.slice(3), "base64");
      const json = zlib.gunzipSync(buf).toString("utf8");
      return JSON.parse(json);
    } catch (e) {
      console.error("  gunzip failed:", e.message);
      return d;
    }
  }
  if (d.startsWith("b64:")) {
    return JSON.parse(Buffer.from(d.slice(4), "base64").toString("utf8"));
  }
  if (d === "undefined" || d === "[undefined]") return null;
  try { return JSON.parse(d); } catch { return d; }
}

function saveJson(data, filename) {
  const filepath = path.join(EXPORT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`Saved ${filepath} (${JSON.stringify(data).length} bytes)`);
}

async function main() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.mkdirSync(path.join(EXPORT_DIR, "archive"), { recursive: true });

  // 1. Fetch full Memory root
  console.log("=== Fetching full Memory ===");
  const memRoot = await apiGet(`/api/user/memory?shard=${SHARD}`);
  const mem = decodeData(memRoot);
  if (mem) {
    saveJson(mem, "memory-full.json");
    console.log("Memory keys:", Object.keys(mem));
    if (mem.kernel) {
      console.log("kernel:", JSON.stringify(mem.kernel, null, 2));
    }
    if (mem.rooms) {
      console.log("rooms:", Object.keys(mem.rooms));
      for (const [name, room] of Object.entries(mem.rooms)) {
        console.log(`  ${name}:`, JSON.stringify(room).slice(0, 300));
      }
    }
    if (mem.creeps) {
      console.log("creeps count:", Object.keys(mem.creeps).length);
    }
  } else {
    console.log("Memory is empty or null");
  }

  // 2. Fetch segment 1 (CPU + population)
  console.log("\n=== Fetching Segment 1 (CPU + population) ===");
  const seg1 = await apiGet(`/api/user/memory-segment?segment=1&shard=${SHARD}`);
  const s1 = decodeData(seg1);
  if (s1) {
    saveJson(s1, "cpu.json");
    saveJson(s1, `archive/cpu-${Date.now()}.json`);
    console.log("Segment 1 data loaded");
  } else {
    console.log("Segment 1 is empty or not yet populated");
  }

  // 3. Fetch segment 2 (event log)
  console.log("\n=== Fetching Segment 2 (event log) ===");
  const seg2 = await apiGet(`/api/user/memory-segment?segment=2&shard=${SHARD}`);
  const s2 = decodeData(seg2);
  if (s2) {
    saveJson(s2, "events.json");
    saveJson(s2, `archive/events-${Date.now()}.json`);
    console.log("Segment 2 data loaded");
  } else {
    console.log("Segment 2 is empty or not yet populated");
  }

  // 3b. Fetch segment 3 (economy)
  console.log("\n=== Fetching Segment 3 (economy) ===");
  const seg3 = await apiGet(`/api/user/memory-segment?segment=3&shard=${SHARD}`);
  const s3 = decodeData(seg3);
  if (s3) {
    saveJson(s3, "economy.json");
    saveJson(s3, `archive/economy-${Date.now()}.json`);
    console.log("Segment 3 data loaded");
  } else {
    console.log("Segment 3 is empty or not yet populated");
  }

  // 4. Fetch segment 0 (layout)
  console.log("\n=== Fetching Segment 0 (layout) ===");
  const seg0 = await apiGet(`/api/user/memory-segment?segment=0&shard=${SHARD}`);
  const s0 = decodeData(seg0);
  if (s0) {
    saveJson(s0, "layout-segment.json");
    console.log("Segment 0 data loaded");
  } else {
    console.log("Segment 0 is empty");
  }

  // 5. Fetch overview
  console.log("\n=== Fetching overview ===");
  const overview = await apiGet(`/api/user/overview?shard=${SHARD}&interval=100`);
  if (overview.ok !== undefined) {
    saveJson(overview, "overview.json");
    console.log("Overview data loaded");
  }

  // 6. Fetch user info
  console.log("\n=== Fetching user info ===");
  const userInfo = await apiGet("/api/user/me");
  if (userInfo.ok !== undefined) {
    const user = userInfo.data || userInfo;
    console.log("User:", user.username, "badge:", user.badge?.type);
    saveJson(userInfo, "user-info.json");
  }
}

main().catch(console.error);
