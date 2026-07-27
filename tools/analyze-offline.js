/**
 * 离线遥测综合分析 — 存档锯齿演化 + 危机/pixel 关联 + 事件构成。
 * 用法：node tools/analyze-offline.js
 */
const fs = require("fs");
const path = require("path");

const EXPORT = path.join(__dirname, "data/export");
const ARCHIVE = path.join(EXPORT, "archive");

// ═══ 1. 存档锯齿演化：每个 cpu 存档的 bucket 形态 ═══
console.log("═══ 1. bucket 锯齿演化（按存档时间排序）═══");
const files = fs.readdirSync(ARCHIVE).filter(f => f.startsWith("cpu-")).sort();
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f)));
    const arr = (j.cpu?.d || []).filter(x => x).sort((a, b) => a.t - b.t);
    if (arr.length === 0) { continue; }
    const bks = arr.map(s => s.bk);
    const min = Math.min(...bks), max = Math.max(...bks);
    let drops = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].bk - arr[i - 1].bk < -4000) drops++;
    }
    const tiers = arr.reduce((a, s) => { a[s.ti] = (a[s.ti] || 0) + 1; return a; }, {});
    const wallTime = new Date(parseInt(f.slice(4, 17), 10)).toISOString().slice(5, 16);
    console.log(
      wallTime, "ticks", arr[0].t, "->", arr[arr.length - 1].t,
      "bk[" + min + "-" + max + "]", "骤降:", drops,
      "tier:", JSON.stringify(tiers),
    );
  } catch { /* skip */ }
}

// ═══ 2. 主导出：危机(ph=2)时刻 vs pixel 放血时刻关联 ═══
console.log("\n═══ 2. 危机相位与 bucket 低谷关联 ═══");
const eco = JSON.parse(fs.readFileSync(path.join(EXPORT, "economy.json")));
const cpu = JSON.parse(fs.readFileSync(path.join(EXPORT, "cpu.json")));
const ecoArr = (eco.economy?.d || []).filter(x => x).sort((a, b) => a.t - b.t);
const cpuArr = (cpu.cpu?.d || []).filter(x => x).sort((a, b) => a.t - b.t);

// pixel 放血时刻 = bucket 骤降点
const pixelTicks = [];
for (let i = 1; i < cpuArr.length; i++) {
  if (cpuArr[i].bk - cpuArr[i - 1].bk < -4000) pixelTicks.push(cpuArr[i - 1].t);
}
console.log("pixel 放血点（bucket 骤降前沿）:", pixelTicks.join(", "));

// 危机采样（ph=2 或 p>50）
const crisis = ecoArr.filter(s => s.ph === 2 || (s.p ?? 0) > 50);
console.log("危机/高压采样点:");
for (const s of crisis) {
  // 距最近 pixel 放血点的距离
  const nearest = pixelTicks.reduce((m, t) => Math.abs(s.t - t) < Math.abs(s.t - m) ? t : m, pixelTicks[0] ?? 0);
  console.log(" ", s.t, "ph:" + s.ph, "pressure:" + s.p, "drainScore:" + (s.ds ?? 0), "ea:" + s.ea + "/" + s.ec, "距pixel:", s.t - nearest);
}

// ═══ 3. 能量经济健康度 ═══
console.log("\n═══ 3. 经济健康度概览 ═══");
const rsArr = ecoArr.map(s => s.rs);
console.log("reserve(rs) 区间:", Math.min(...rsArr), "-", Math.max(...rsArr), "均值:", Math.round(rsArr.reduce((a, b) => a + b, 0) / rsArr.length));
const deltas = ecoArr.map(s => s.d);
console.log("delta(d) 均值:", (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1), "负值采样:", deltas.filter(d => d < 0).length + "/" + deltas.length);
const cap = ecoArr.map(s => s.ec);
console.log("energyCapacity 演化:", cap[0], "->", cap[cap.length - 1], "(RCL 爬升中)");
const fillRatios = ecoArr.map(s => s.ea / s.ec);
console.log("spawn 填充率均值:", (fillRatios.reduce((a, b) => a + b, 0) / fillRatios.length * 100).toFixed(0) + "%", "低于30%采样:", fillRatios.filter(r => r < 0.3).length + "/" + fillRatios.length);
// cte/cce = controller ticksToDowngrade 相关? container energy?
console.log("cte(容器能量?) 末值:", ecoArr[ecoArr.length - 1].cte, "cce 末值:", ecoArr[ecoArr.length - 1].cce);

// ═══ 4. 事件流构成与 assignment 健康度 ═══
console.log("\n═══ 4. 事件流构成 ═══");
const ev = JSON.parse(fs.readFileSync(path.join(EXPORT, "events.json")));
const evArr = (ev.events?.d || []).filter(x => x);
const KIND = ["Phase", "TierDown", "TierUp", "ColonyState", "RCLUp", "DowngradeRisk", "P0Spawn", "Invasion", "EnemyCleared", "SafeMode", "PluginCooldown", "CreepStuck", "BuildDone", "StructDestroyed", "AssignRenew", "AssignNew", "AssignExpired"];
const byKind = {};
for (const e of evArr) byKind[KIND[e.k] ?? e.k] = (byKind[KIND[e.k] ?? e.k] || 0) + 1;
console.log(JSON.stringify(byKind, null, 0));
// AssignmentExpired 的失效原因分布
const expired = evArr.filter(e => e.k === 16);
console.log("AssignExpired 原因码分布:", JSON.stringify(expired.reduce((a, e) => { a[e.d[0]] = (a[e.d[0]] || 0) + 1; return a; }, {})));
// 入侵事件
const inv = evArr.filter(e => e.k === 7 || e.k === 8);
console.log("入侵/清除事件:", inv.map(e => e.t + ":" + (e.k === 7 ? "入侵" : "清除") + ":" + e.r).join(" "));
