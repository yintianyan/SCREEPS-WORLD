/**
 * 快照精读脚本：从单条 snapshot 抽取关键诊断信息。
 * 输出：房间结构清单 + creep 清单 + Memory 决策态 + 事件 + segment
 *
 * 用法：node tools/private/inspect-snapshot.js <snapshot-file.json>
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("用法：node inspect-snapshot.js <snapshot-file.json>");
  process.exit(1);
}

const snap = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`快照 tick=${snap.t}  rooms=${snap.rooms?.join(",")}`);
console.log(`═══════════════════════════════════════════════════════════════`);

const objs = snap.objects || [];
const mem = snap.memory || {};

// ─── 按房聚合结构 ────────────────────────────────────────────
function summarizeRoom(room) {
  const o = objs.filter(x => x.r === room);
  const byType = {};
  o.forEach(x => {
    byType[x.t] = (byType[x.t] || 0) + 1;
  });
  console.log(`\n┌─ 房间 ${room}  objects=${o.length}`);
  console.log(`│ 类型分布：${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(" ")}`);

  // 关键结构
  const controller = o.find(x => x.t === "controller");
  if (controller) {
    console.log(`│ Controller: level=${controller.lv} progress=${controller.pr}/${controller.pt} downgrade=${controller.dg ?? "-"}`);
  }
  const spawns = o.filter(x => x.t === "spawn");
  spawns.forEach(s => {
    console.log(`│ Spawn @(${s.x},${s.y}) energy=${s.store?.energy ?? 0}/${s.storeCapacityResource?.energy ?? 300} spawning=${s.sp ?? "-"}`);
  });
  const storage = o.find(x => x.t === "storage");
  if (storage) {
    console.log(`│ Storage @(${storage.x},${storage.y}) store=${JSON.stringify(storage.store)}`);
  }
  const terminal = o.find(x => x.t === "terminal");
  if (terminal) {
    console.log(`│ Terminal @(${terminal.x},${terminal.y}) store=${JSON.stringify(terminal.store)}`);
  }
  const towers = o.filter(x => x.t === "tower");
  towers.forEach(tw => {
    console.log(`│ Tower @(${tw.x},${tw.y}) energy=${tw.store?.energy ?? 0}`);
  });
  const containers = o.filter(x => x.t === "container");
  containers.forEach(c => {
    console.log(`│ Container @(${c.x},${c.y}) energy=${c.store?.energy ?? 0}`);
  });
  const sources = o.filter(x => x.t === "source");
  sources.forEach(s => {
    console.log(`│ Source @(${s.x},${s.y}) energy=${s.e}/${s.ec}`);
  });
  // construction sites
  const sites = o.filter(x => x.t === "constructionSite");
  if (sites.length) {
    const bySt = {};
    sites.forEach(s => { bySt[s.st] = (bySt[s.st] || 0) + 1; });
    console.log(`│ ConstructionSites=${sites.length}: ${Object.entries(bySt).map(([k, v]) => `${k}×${v}`).join(" ")}`);
  }
  // dropped
  const dropped = o.filter(x => x.t === "energy");
  if (dropped.length) {
    console.log(`│ Dropped energy: ${dropped.length} 堆, 总量 ${dropped.reduce((a, d) => a + (d.amt || d.e || 0), 0)}`);
  }
  // tombstones
  const tombs = o.filter(x => x.t === "tombstone");
  if (tombs.length) console.log(`│ Tombstones=${tombs.length}`);

  // creeps
  const creeps = o.filter(x => x.t === "creep");
  const myCreeps = creeps.filter(c => c.u === true);
  const hostile = creeps.filter(c => !c.u);
  console.log(`│ Creeps: 我方=${myCreeps.length} 敌方=${hostile.length}`);
  if (myCreeps.length) {
    const byRole = {};
    myCreeps.forEach(c => {
      const role = (c.name || "").split("-")[0]; // name 不在 slim 里，可能需要从其他字段
      // 注意：snapshot 里可能没有 name，只能用 body
      const bodyKey = (c.body || []).join(",");
      byRole[bodyKey] = (byRole[bodyKey] || 0) + 1;
    });
    console.log(`│ 我方 creep body 分布：`);
    Object.entries(byRole).forEach(([k, v]) => console.log(`│   ${v}× [${k}]`));
    // ttl 范围
    const ttls = myCreeps.map(c => c.ttl).filter(t => t !== undefined).sort((a, b) => a - b);
    if (ttls.length) {
      console.log(`│ ttl 范围：${ttls[0]} ~ ${ttls[ttls.length - 1]}，中位数 ${ttls[Math.floor(ttls.length / 2)]}`);
    }
    // 携带能量
    const carriers = myCreeps.filter(c => c.store && c.store.energy > 0);
    const totalCarry = carriers.reduce((a, c) => a + (c.store?.energy || 0), 0);
    console.log(`│ 携带能量 creep=${carriers.length} 总计=${totalCarry}`);
  }
  if (hostile.length) {
    console.log(`│ 敌方 creep：`);
    hostile.forEach(c => {
      console.log(`│   @(${c.x},${c.y}) body=[${(c.body || []).join(",")}] ttl=${c.ttl ?? "-"} owner=${c.owner ?? "?"}`);
    });
  }
  console.log(`└${"─".repeat(60)}`);
}

for (const room of snap.rooms || []) summarizeRoom(room);

// ─── Memory 决策态 ────────────────────────────────────────────
console.log(`\n═══════════════ Memory 决策态 ═══════════════`);
const kernel = mem.kernel || {};
console.log(`schemaVersion=${mem.schemaVersion}  kernel.tier=${kernel.tier}`);
console.log(`kernel.strategy=${JSON.stringify(kernel.strategy)}`);
console.log(`kernel.skipReasons=${JSON.stringify(kernel.skipReasons)}`);
console.log(`kernel.recoveryTicks=${kernel.recoveryTicks}`);
console.log(`kernel.layoutGaps=${JSON.stringify(kernel.layoutGaps)}`);

// 房间 memory
for (const [room, rmem] of Object.entries(mem.rooms || {})) {
  console.log(`\n--- 房间 ${room} Memory ---`);
  console.log(`  colonyState=${rmem.colonyState}  phase=${JSON.stringify(rmem.phase)}`);
  console.log(`  economyPressure=${rmem.economyPressure}  storageNearFull=${rmem.storageNearFull}`);
  console.log(`  spawnQueue.length=${(rmem.spawnQueue || []).length}`);
  if ((rmem.spawnQueue || []).length) {
    console.log(`  spawnQueue: ${JSON.stringify(rmem.spawnQueue.slice(0, 5))}`);
  }
  console.log(`  buildQueue.length=${(rmem.buildQueue || []).length}`);
  if ((rmem.buildQueue || []).length) {
    const byState = {};
    rmem.buildQueue.forEach(t => {
      byState[t.state] = (byState[t.state] || 0) + 1;
    });
    console.log(`  buildQueue by state: ${JSON.stringify(byState)}`);
    // 阻塞的项
    const blocked = rmem.buildQueue.filter(t => t.state === "blocked");
    if (blocked.length) {
      console.log(`  blocked 项：`);
      blocked.slice(0, 5).forEach(t => console.log(`    ${t.structureType} @(${t.x},${t.y}) reason=${t.blockReason ?? "?"}`));
    }
  }
  console.log(`  layout: state=${rmem.layout?.state} revision=${rmem.layout?.revision} nextPlanTick=${rmem.layout?.nextPlanTick} anchorScore=${rmem.layout?.anchorScore}`);
  console.log(`  remoteOps=${JSON.stringify(rmem.remoteOps)}`);
  console.log(`  intel entries=${Object.keys(rmem.intel || {}).length}`);
  // creep 数量
  const creepCount = Object.keys(mem.creeps || {}).filter(cn => (mem.creeps[cn].home) === room).length;
  console.log(`  Memory.creeps 中归属本房=${creepCount}`);
}

// ─── Creep Memory 详情 ────────────────────────────────────────
console.log(`\n═══════════════ Memory.creeps ═══════════════`);
const creepMems = mem.creeps || {};
const creepRoleCount = {};
const creepModeCount = {};
const stuckCreeps = [];
for (const [name, cm] of Object.entries(creepMems)) {
  const role = cm.role || "?";
  const mode = cm.mode || "?";
  creepRoleCount[role] = (creepRoleCount[role] || 0) + 1;
  creepModeCount[mode] = (creepModeCount[mode] || 0) + 1;
  if ((cm.stuckTicks || 0) > 5) stuckCreeps.push({ name, role, mode, stuckTicks: cm.stuckTicks, home: cm.home });
}
console.log(`  总 creep Memory 数=${Object.keys(creepMems).length}`);
console.log(`  按角色：${JSON.stringify(creepRoleCount)}`);
console.log(`  按模式：${JSON.stringify(creepModeCount)}`);
if (stuckCreeps.length) {
  console.log(`  卡位 creep (${stuckCreeps.length})：`);
  stuckCreeps.slice(0, 10).forEach(c => console.log(`    ${c.name} role=${c.role} mode=${c.mode} stuck=${c.stuckTicks} home=${c.home}`));
}

// ─── segment 内容（CPU 遥测 + 事件 + 布局）─────────────────
console.log(`\n═══════════════ Segments ═══════════════`);
const segs = snap.segments || {};
for (const [idx, seg] of Object.entries(segs)) {
  if (!seg) { console.log(`  segment[${idx}]: null`); continue; }
  if (idx === "1") {
    // CPU 遥测
    const last = seg?.cpu?.d?.[seg.cpu.d.length - 1];
    if (last) {
      console.log(`  segment[1] CPU 最新: tick=${last.t} bucket=${last.bk} cpu=${last.cpu}`);
      console.log(`    系统：${last.s1}=${last.v1}, ${last.s2}=${last.v2}, ${last.s3}=${last.v3}`);
    }
  } else if (idx === "2") {
    // 事件
    const ev = seg?.events?.d || [];
    console.log(`  segment[2] 事件缓冲：${ev.length} 条`);
    const recent = ev.slice(-10);
    recent.forEach(e => console.log(`    t=${e.t} k=${e.k} r=${e.r} d=${JSON.stringify(e.d)}`));
  } else if (idx === "0") {
    // 布局
    console.log(`  segment[0] 布局：${Object.keys(seg).length} 房`);
    for (const [rm, ld] of Object.entries(seg)) {
      if (!ld) continue;
      const blockedN = ld.blocked ? Object.keys(ld.blocked).length : 0;
      console.log(`    ${rm}: state=${ld.state} revision=${ld.revision} blocked=${blockedN} overrides=${ld.overrides ? Object.keys(ld.overrides).length : 0}`);
    }
  } else {
    console.log(`  segment[${idx}]: ${JSON.stringify(seg).slice(0, 200)}`);
  }
}
