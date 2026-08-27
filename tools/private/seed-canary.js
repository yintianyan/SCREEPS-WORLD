#!/usr/bin/env node
/**
 * Canary Soak 种子脚本 — 在默认世界（resetAllData 后含 4 个官方 bot）种下 canary bot。
 *
 * 与 seed-p3.js 的差异：
 *   - 不再盲选 (25,25)：扫描地形找中心附近的 plain 地块（带 8 邻域开阔度评分）
 *   - 目标房间默认 W5N2（与四个角落 bot 房 W1N1/W1N9/W9N1/W9N9 均距 ≥4，非 SK 区）
 *   - cpuAvailable 设为 10000（满 bucket），cpu limit 100
 *   - 幂等：用户已存在则复用；spawn 已存在则跳过
 *   - 使用 Web 注册的用户 111（命令行创建的用户缺少 active 字段会被引擎禁用）
 *
 * 用法：node tools/private/seed-canary.js [roomName]
 * 前置：docker compose 私服已启动且 resetAllData 已执行（世界含地形与 controller）。
 * 前置：用户 111 须已通过 Web 界面注册。
 */
"use strict";
const { execFileSync } = require("child_process");

const ROOM = process.argv[2] || "W5N2";
const CONTAINER = process.env.SCREEPS_MONGO_CONTAINER || "screeps-mongo";

function die(msg) {
  console.error(`[seed-canary] FATAL: ${msg}`);
  process.exit(1);
}

// ─── mongosh 脚本（在 mongo 容器内执行）──────────────────────────
// 1) 找/建用户 yty；2) 读 W5N2 地形；3) 选中心附近 plain 地块；
// 4) 认领 controller L1；5) 插 spawn(300E)。幂等。
const SCRIPT = `
const ROOM = ${JSON.stringify(ROOM)};
var u = db.users.findOne({ username: "111" });
if (!u) { print("ERR:no-user-111:请先通过 Web 界面注册用户 111"); quit(1); }
print("EXISTING-USER:" + u._id);
const uid = String(u._id);

// 已有 spawn → 幂等退出
var existing = db.getCollection("rooms.objects").findOne({ room: ROOM, type: "spawn", user: uid });
if (existing) {
  print("SPAWN-EXISTS:" + existing._id);
  quit(0);
}

// 地形扫描：plain 优先、开阔度评分
var terr = db.getCollection("rooms.terrain").findOne({ room: ROOM });
if (!terr || !terr.terrain) { print("ERR:no-terrain:" + ROOM); quit(1); }
var T = terr.terrain; // 2500 chars: 0=plain 1=wall 2=swamp
function tileAt(x, y) { return T[y * 50 + x]; }
function openness(x, y) {
  var n = 0;
  for (var dx = -1; dx <= 1; dx++)
    for (var dy = -1; dy <= 1; dy++) {
      var nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 49 || ny > 49) continue;
      var t = tileAt(nx, ny);
      if (t === "0") n += 2; else if (t === "2") n += 1;
    }
  return n;
}
var best = null;
for (var y = 18; y <= 32; y++) {
  for (var x = 18; x <= 32; x++) {
    if (tileAt(x, y) !== "0") continue;
    var o = openness(x, y);
    if (!best || o > best.o) best = { x: x, y: y, o: o };
  }
}
if (!best) { print("ERR:no-plain-tile"); quit(1); }

// 认领 controller L1（清掉可能残留的旧 owner）
db.rooms.updateOne(
  { _id: ROOM },
  { $set: { controller: { user: uid, level: 1, progress: 0, downgradeTime: null, safeMode: null, safeModeAvailable: 0, safeModeCooldown: null, reservation: null, signs: [] } } }
);

// 插 spawn（满血、300 能量、无 owner 冲突）
db.getCollection("rooms.objects").insertOne({
  _id: "spawn-canary-" + ROOM, type: "spawn", room: ROOM,
  x: best.x, y: best.y, user: uid,
  name: "Spawn1", store: { energy: 300 }, storeCapacityResource: { energy: 300 },
  hits: 5000, hitsMax: 5000, notifyWhenAttacked: false, spawning: null
});

// 清理该房旧 creeps（防脏数据）
db.getCollection("rooms.objects").deleteMany({ room: ROOM, type: "creep" });

print("SEEDED:" + JSON.stringify({ uid: uid, room: ROOM, x: best.x, y: best.y, openness: best.o }));
`;

function main() {
  console.log(`[seed-canary] Seeding room ${ROOM}...`);
  const tmpFile = "/tmp/seed-canary.js";
  // 脚本经 stdin 传入 mongosh，避免 docker cp + 转义问题
  try {
    const out = execFileSync(
      "docker",
      ["exec", "-i", CONTAINER, "mongosh", "--quiet", "screeps"],
      { input: SCRIPT, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 }
    ).trim();
    console.log(out.split("\n").map((l) => `  ${l}`).join("\n"));
    if (/ERR:/.test(out)) die("mongosh seed reported ERR");
    console.log(`[seed-canary] Done. Room ${ROOM} seeded.`);
  } catch (e) {
    die(`mongosh failed: ${e.message}\n${(e.stdout || "").slice(0, 500)}`);
  }
}

main();
