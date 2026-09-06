/**
 * MMO 能量流转 + creep 效率分析器 — 消费 empire-collector.js 的 JSONL 时间序列。
 *
 * 方法论：不做单点判断，全部结论来自差分窗口（Δt）：
 *   - 能量台账：ΔtotalStored（全仓位+在途携带）与已知支出（升级/建造/孵化/维修）
 *     反推隐含收入 incomeImplied，对照 source 再生上限（srcCap×Δt/300）得开采利用率。
 *   - 角色效率：segment 4 的 work/idle/travel 比（bot 内部 10-tick 普查）+ 地面携带量。
 *   - 决策态：colonyState/phase/skipReasons 增量，用于解释「为什么低效」。
 *
 * 数据成熟度分级（短窗口数据只出阶段性结论）：
 *   samples / ticks 跨度 / 是否覆盖多时段 → preliminary(<1h) / staged(1-6h) /
 *   solid(6-24h) / mature(>24h 且跨多时段)。
 *
 * 用法：
 *   node tools/mmo/analyze-flow.js                       # 全量历史
 *   node tools/mmo/analyze-flow.js --last-hours 6       # 最近 6 小时
 *   node tools/mmo/analyze-flow.js --max-gap 9000       # 窗口 Δt 上限（tick）
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data", "collect");
const OUT_FILE = path.join(DATA_DIR, "report-latest.md");

function argVal(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}
const LAST_HOURS = argVal("--last-hours", 0);
const MAX_GAP = argVal("--max-gap", 9000);

// ─── 加载 ───────────────────────────────────────────────
function loadRows() {
  const rows = [];
  for (const f of fs.readdirSync(DATA_DIR).filter((x) => /^timeseries-\d+\.jsonl$/.test(x)).sort()) {
    const raw = fs.readFileSync(path.join(DATA_DIR, f), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* 跳过坏行 */ }
    }
  }
  rows.sort((a, b) => (a.t || 0) - (b.t || 0));
  if (LAST_HOURS > 0) {
    const cutoff = Date.now() - LAST_HOURS * 3600 * 1000;
    return rows.filter((r) => new Date(r.ts).getTime() >= cutoff);
  }
  return rows;
}

// ─── 统计工具 ────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function pctl(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
function fmtE(n) { return n == null ? "?" : Math.round(n).toLocaleString("en-US"); }
function fmtR(n) { return n == null ? "?" : (Math.round(n * 100) / 100).toFixed(2); }
function fmtP(n) { return n == null ? "?" : Math.round(n * 100) + "%"; }

// ─── 差分窗口 ────────────────────────────────────────────
function roomAt(row, name) { return (row.rooms || []).find((r) => r.name === name); }

function sumSiteProg(sites) { return (sites || []).reduce((a, s) => a + (s.prog || 0), 0); }

function buildWindows(rows) {
  const wins = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const dt = (b.t || 0) - (a.t || 0);
    if (!(dt > 0) || dt > MAX_GAP) continue; // 跳过回退/断档
    const roomNames = new Set([...(a.rooms || []), ...(b.rooms || [])].map((r) => r.name));
    // 全局 creep 普查：跨采样房判定「真新生」（远矿房相邻，haul 穿房会被误判出生/死亡）。
    // 真新生口径：上一行所有采样房都没见过的名字，且 TTL≈满（≥1400；出生寿命恒 1500）。
    // 出生/离场按「实际出现的房间」归属——同一窗口不得被多个自有房重复计入。
    const seenA = new Map(), seenB = new Map();
    const census = (row, m) => {
      for (const r of row.rooms || []) {
        for (const c of r.creeps || []) m.set(c.n, { c, room: r.name });
      }
    };
    census(a, seenA);
    census(b, seenB);
    // 真新生 TTL 门槛随窗口长度自适应：窗口 [a,b] 内出生的 creep 首见于 b 时
    // ttl = 1500 - age，age ≤ dt → 门槛 = 1500 - dt（固定 1400 会在大间隔采样下漏计）。
    const bornTtlFloor = Math.max(600, 1500 - dt - 5);
    const bornByRoom = {}, goneByRoom = {};
    for (const [n, { c, room }] of seenB) {
      if (!seenA.has(n) && (c.ttl ?? 1500) >= bornTtlFloor) (bornByRoom[room] = bornByRoom[room] || []).push(c);
    }
    for (const [n, { c, room }] of seenA) {
      if (!seenB.has(n)) (goneByRoom[room] = goneByRoom[room] || []).push(c);
    }
    const perRoom = {};
    for (const name of roomNames) {
      const ra = roomAt(a, name), rb = roomAt(b, name);
      if (!ra || !rb) continue;
      const own = ra.own && rb.own;
      const L = (r) => (r && r.ledger) || {};
      const la = L(ra), lb = L(rb);
      const dTotal = (lb.totalStored ?? 0) - (la.totalStored ?? 0);
      if (!own) {
        // 远矿房：dTotal（容器+携带+掉落）本身就是对帝国的能量供给（负=被运走）
        perRoom[name] = {
          own: false, dt, dTotal, upgradeE: 0, buildE: 0, spawnE: 0, dHits: null,
          incomeImplied: dTotal, regenCeiling: (lb.srcCap || 0) * dt / 300,
          ceilingUtil: null, buckets: {}, srcUtilA: null, srcUtilB: null,
          hostiles: Math.max(ra.hostiles || 0, rb.hostiles || 0),
          born: [], dead: [], decisionB: null, creepsB: (rb.creeps || []).length,
          carrySumB: (rb.creeps || []).reduce((x, c) => x + c.carry, 0),
        };
        continue;
      }
      const dCtrl = rb.ctrlProg != null && ra.ctrlProg != null ? rb.ctrlProg - ra.ctrlProg : 0;
      // 工地差分：REST room-objects 的 site 无稳定 id，按 structureType 分组、
      // 组内按 prog 升序配对；组内数量差按「完成（prog≈total）计尾款 / 取消计 0」处理。
      let buildE = 0;
      const groupByType = (sites) => {
        const g = {};
        for (const s of sites || []) (g[s.type] = g[s.type] || []).push(s);
        for (const arr of Object.values(g)) arr.sort((x, y) => x.prog - y.prog);
        return g;
      };
      const ga = groupByType(ra.sites), gb = groupByType(rb.sites);
      for (const [type, arrB] of Object.entries(gb)) {
        const arrA = ga[type] || [];
        const n = Math.min(arrA.length, arrB.length);
        for (let i = 0; i < n; i++) buildE += Math.max(0, arrB[i].prog - arrA[i].prog);
        for (let i = n; i < arrB.length; i++) buildE += 0; // 新开的工地：无增量
        for (let i = n; i < arrA.length; i++) {
          const s = arrA[i];
          if (s.total && s.prog >= s.total - 1) buildE += s.total - s.prog; // 窗口内完成
        }
      }
      // 孵化：全局普查中「新名字且 TTL 满」才算真新生，按出生所在房归属 → Σ bodyCost。
      // gone 只作「离开观测」计数，不进台账（可能只是走到了未采样房）。
      const born = bornByRoom[name] || [];
      const gone = goneByRoom[name] || [];
      const spawnE = born.reduce((x, c) => x + (c.cost || 0), 0);
      // 维修/战损参考项（≈hits 增量；含衰减与缓存噪声，不进收支恒等式）。
      let dHits = null;
      if (ra.ledger?.hits && rb.ledger?.hits) {
        dHits = (rb.ledger.hits.rampart + rb.ledger.hits.wall + rb.ledger.hits.road)
          - (ra.ledger.hits.rampart + ra.ledger.hits.wall + ra.ledger.hits.road);
      }
      const dBucket = (k) => (lb[k] ?? 0) - (la[k] ?? 0);
      const regenCeiling = (lb.srcCap || 0) * dt / 300;
      // 核心收支恒等式：维修能量走 hits 参考项，不进收入（避免衰减/缓存噪声污染台账）。
      const incomeImplied = dTotal + dCtrl + buildE + spawnE;
      perRoom[name] = {
        own: true, dt,
        dTotal, dCtrl, buildE, spawnE, dHits,
        upgradeE: dCtrl,
        incomeImplied,
        regenCeiling,
        ceilingUtil: regenCeiling > 0 ? incomeImplied / regenCeiling : null,
        buckets: {
          storage: dBucket("stor"), terminal: dBucket("term"),
          spawnExt: dBucket("spawn") + dBucket("ext"), container: dBucket("cont"),
          tower: dBucket("tower"), link: dBucket("link"), carry: dBucket("carry"),
          dropped: dBucket("dropped"), tombE: dBucket("tombE"),
        },
        srcUtilA: la.srcCap ? la.srcE / la.srcCap : null,
        srcUtilB: lb.srcCap ? lb.srcE / lb.srcCap : null,
        hostiles: Math.max(ra.hostiles || 0, rb.hostiles || 0),
        born: born.map((c) => ({ role: c.role, cost: c.cost })),
        gone: gone.map((c) => ({ role: c.role })),
        decisionB: rb.decision || null,
        creepsB: (rb.creeps || []).length,
        carrySumB: (rb.creeps || []).reduce((x, c) => x + c.carry, 0),
      };
    }
    const remote = [];
    for (const name of roomNames) {
      const ra = roomAt(a, name), rb = roomAt(b, name);
      if (!ra || !rb || ra.own || rb.own) continue;
      const dCont = (rb.ledger?.cont ?? 0) - (ra.ledger?.cont ?? 0);
      const dCarry = (rb.creeps || []).reduce((x, c) => x + c.carry, 0) - (ra.creeps || []).reduce((x, c) => x + c.carry, 0);
      remote.push({
        name, dCont, dCarry,
        delivered: dCarry - dCont, // 携带走强且容器不涨 = 正在回运
        srcUtilB: rb.ledger?.srcCap ? rb.ledger.srcE / rb.ledger.srcCap : null,
        creeps: (rb.creeps || []).map((c) => c.role),
      });
    }
    wins.push({ ta: a.t, tb: b.t, dt, tsB: b.ts, perRoom, remote,
      postureB: b.kernel?.posture, tierB: b.kernel?.tier });
  }
  return wins;
}

// ─── 角色效率聚合 ────────────────────────────────────────
function roleStats(rows) {
  const agg = {};
  for (const row of rows) {
    for (const [role, s] of Object.entries(row.roles || {})) {
      agg[role] = agg[role] || { alive: [], ttl: [], work: [], idle: [], travel: [], prod: [], carry: [] };
      agg[role].alive.push(s.alive ?? 0);
      agg[role].ttl.push(s.ttl ?? 0);
      agg[role].work.push(s.work_ratio ?? 0);
      agg[role].idle.push(s.idle_ratio ?? 0);
      agg[role].travel.push(s.travel_ratio ?? 0);
      agg[role].prod.push(s.productivity ?? 0);
    }
    for (const r of row.rooms || []) {
      if (!r.own || !r.creeps) continue;
      const byRole = {};
      for (const c of r.creeps) { (byRole[c.role] = byRole[c.role] || []).push(c.carry); }
      for (const [role, arr] of Object.entries(byRole)) {
        if (!agg[role]) continue;
        agg[role].carry.push(mean(arr));
      }
    }
  }
  const out = {};
  for (const [role, s] of Object.entries(agg)) {
    out[role] = {
      aliveMean: mean(s.alive), aliveMin: Math.min(...s.alive), aliveMax: Math.max(...s.alive),
      ttlMean: mean(s.ttl),
      work: mean(s.work), idle: mean(s.idle), travel: mean(s.travel), prod: mean(s.prod),
      carryMean: s.carry.length ? mean(s.carry) : null,
      samples: s.alive.length,
    };
  }
  return out;
}

function decisionTimeline(rows, key) {
  const out = [];
  let last = null;
  for (const row of rows) {
    const cur = {};
    for (const r of row.rooms || []) {
      if (!r.own) continue;
      cur[r.name] = key === "colonyState" ? r.decision?.colonyState
        : key === "phase" ? r.decision?.phase
        : key === "posture" ? row.kernel?.posture : null;
    }
    const sig = JSON.stringify(cur);
    if (sig !== last) { out.push({ t: row.t, ts: row.ts, ...cur }); last = sig; }
  }
  return out;
}

function skipRate(rows) {
  if (rows.length < 2) return {};
  const a = rows[0].kernel?.skipReasons || {}, b = rows[rows.length - 1].kernel?.skipReasons || {};
  const dt = (rows[rows.length - 1].t || 0) - (rows[0].t || 0) || 1;
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d > 0) out[k] = { delta: d, perKtick: Math.round(d / dt * 1000) / 1000 };
  }
  return Object.fromEntries(Object.entries(out).sort((x, y) => y[1].delta - x[1].delta));
}

// ─── 成熟度 ──────────────────────────────────────────────
function maturity(rows, wins) {
  if (rows.length < 2) return { level: "preliminary", note: "样本不足（<2），无法差分" };
  const ticks = (rows[rows.length - 1].t || 0) - (rows[0].t || 0);
  const hours = ticks * 3 / 3600; // 按 ~3s/tick 估算
  const days = new Set(rows.map((r) => (r.ts || "").slice(0, 10))).size;
  let level, note;
  if (hours < 1) { level = "preliminary"; note = "窗口 <1h：只能证阶段性快照，流向结论待多窗口验证"; }
  else if (hours < 6) { level = "staged"; note = "窗口 1-6h：流向速率属阶段性水平，未覆盖昼夜/攻击/重置等扰动"; }
  else if (hours < 24 || days < 2) { level = "solid"; note = "窗口 6-24h：单日水平可信，跨日稳定性待验"; }
  else { level = "mature"; note = `跨 ${days} 天 / ~${Math.round(hours)}h：多时段覆盖，结论可用于调参决策`; }
  return { level, note, ticks, hours: Math.round(hours * 10) / 10, days, samples: rows.length, windows: wins.length };
}

// ─── 异常规则 ────────────────────────────────────────────
function anomalies(wins, roles, rows) {
  const A = [];
  const add = (id, sev, msg, evidence) => A.push({ id, sev, msg, evidence });
  const lastRow = rows[rows.length - 1];

  for (const roomName of Object.keys(lastRow.roomCensus || {})) {
    const perWins = wins.map((w) => w.perRoom[roomName]).filter(Boolean);
    if (!perWins.length) continue;
    const util = mean(perWins.map((w) => w.ceilingUtil).filter((x) => x != null));
    const dTotalSum = perWins.reduce((a, w) => a + w.dTotal, 0);
    const upgradeRate = mean(perWins.map((w) => w.upgradeE / w.dt)); // e/tick
    const spawnTotal = perWins.reduce((a, w) => a + w.spawnE, 0);
    const srcUtilB = mean(perWins.map((w) => w.srcUtilB).filter((x) => x != null));

    // R1 采集利用率
    if (srcUtilB > 0.9) add("R1-src-idle", "warn",
      `[${roomName}] source 长期近满（均 srcUtil=${fmtP(srcUtilB)}）→ 再生被浪费，采集端欠员/断档`,
      `ceilingUtil=${fmtR(util)}`);
    // R2 存量净流向
    if (dTotalSum < 0) add("R2-net-drain", "warn",
      `[${roomName}] 全仓位净流出 ${fmtE(dTotalSum)}：支出>收入`,
      `upgradeRate=${fmtR(upgradeRate)}e/t spawn累计=${fmtE(spawnTotal)}`);
    // R3 升级吞吐
    if (upgradeRate < 1 && lastRow.roomCensus[roomName]?.rcl < 8) add("R3-upgrade-slow",
      "info", `[${roomName}] controller 吞吐仅 ${fmtR(upgradeRate)}e/tick（RCL<8 理论上限远高于此）`,
      `upgrader alive=${roles.upgrader?.aliveMean?.toFixed(1)} work=${fmtP(roles.upgrader?.work)}`);
    // R4 决策态与库存矛盾
    const decision = perWins[perWins.length - 1].decisionB;
    if (decision && (decision.colonyState === "recovery" || decision.colonyState === "crisis")) {
      const storB = lastRow.rooms?.find((r) => r.name === roomName)?.ledger?.stor ?? 0;
      if (storB > 20000) add("R4-state-vs-stock", "warn",
        `[${roomName}] colonyState=${decision.colonyState} 但 storage=${fmtE(storB)}：危机判定与库存矛盾（drainScore/pressure 阈值疑失真）`,
        `phase=${decision.phase} srcStall=${decision.srcStallTicks} drainScore=${decision.drainScore}`);
    }
  }

  // R5 角色空转
  for (const [role, s] of Object.entries(roles)) {
    if (role === "scout" || role === "defender" || role === "remoteDefender") continue;
    if (s.aliveMean >= 1 && s.idle > 0.5) add("R5-idle", "warn",
      `[role] ${role} idle=${fmtP(s.idle)}（alive 均 ${s.aliveMean.toFixed(1)}）：编制冗余或任务分配不足`,
      `work=${fmtP(s.work)} travel=${fmtP(s.travel)}`);
    if (s.aliveMean >= 1 && s.travel > 0.6 && role !== "reserver" && role !== "remoteHarvester")
      add("R6-travel", "info", `[role] ${role} travel=${fmtP(s.travel)}：在途占比过高（距离/路损/缺容器）`,
        `work=${fmtP(s.work)}`);
  }

  // R7 远矿积压
  const lastRemote = {};
  for (const w of wins) for (const r of w.remote) lastRemote[r.name] = r;
  for (const [name, r] of Object.entries(lastRemote)) {
    if (r.srcUtilB != null && r.srcUtilB > 0.9) add("R7-remote-idle", "warn",
      `[remote ${name}] source 近满（${fmtP(r.srcUtilB)}）：远矿开采端断档`,
      `creeps=${r.creeps.join(",") || "无"}`);
  }
  return A;
}

// ─── 报告 ────────────────────────────────────────────────
function render(rows, wins, roles, mat, A) {
  const L = [];
  L.push(`# 官服能量流转与 creep 效率分析（${new Date().toISOString().replace("T", " ").slice(0, 16)}）`);
  L.push("");
  L.push(`**数据成熟度：${mat.level}** — ${mat.note}`);
  L.push(`样本=${mat.samples} 差分窗口=${mat.windows} 跨度≈${mat.hours}h（${mat.ticks} ticks / ${mat.days} 天）`);
  L.push("");
  L.push(`> 结论口径：速率均为窗口均值。${mat.level === "preliminary" || mat.level === "staged" ? "**当前为短窗口数据，只能作为阶段性证据**；持续采集至 mature 后复核。" : "窗口已足够长，结论可用于决策。"}`);
  L.push("");

  // 1. 帝国概览
  const last = rows[rows.length - 1];
  L.push(`## 1. 帝国概览（最新样本 t=${last.t}）`);
  L.push(`- CPU ${fmtR(last.cpu?.used)}/${last.cpu?.limit}，bucket=${last.cpu?.bucket}；姿态=${last.kernel?.posture}，档位=${last.kernel?.tier}`);
  L.push(`- 帝国 health=${fmtR(last.empire?.health)}，creep=${last.empire?.creeps}，GCL=${last.empire?.gcl}`);
  L.push(`- spawn: busy=${last.spawn?.busy}/${last.spawn?.count}，queue=${last.spawn?.queue}`);
  L.push("");

  // 2. 帝国级能量总账（自有房+远矿房闭环，无跨房转移误差）
  L.push(`## 2. 帝国级能量总账（差分窗口合并）`);
  {
    let inc = 0, upg = 0, bld = 0, spn = 0, dtSum = 0, ceil = 0, dTot = 0, hitsRef = 0, hasHits = false;
    for (const w of wins) {
      const entries = Object.values(w.perRoom);
      if (!entries.length) continue;
      dtSum += w.dt; // 每窗口只计一次 dt（不按房间重复累计）
      for (const pr of entries) {
        inc += pr.incomeImplied; upg += pr.upgradeE; bld += pr.buildE; spn += pr.spawnE;
        ceil += pr.regenCeiling; dTot += pr.dTotal;
        if (pr.dHits != null) { hitsRef += pr.dHits; hasHits = true; }
      }
    }
    if (dtSum === 0) L.push(`（无差分窗口）`);
    else {
      L.push("");
      L.push(`| 项目 | e/tick | 窗口累计 |`);
      L.push(`|---|---|---|`);
      L.push(`| 隐含收入（=净存+升级+建造+孵化） | ${fmtR(inc / dtSum)} | ${fmtE(inc)} |`);
      L.push(`| ├ 全仓位净存 Δ（含 link/掉落/墓碑/携带） | ${fmtR(dTot / dtSum)} | ${fmtE(dTot)} |`);
      L.push(`| ├ 升级 controller | ${fmtR(upg / dtSum)} | ${fmtE(upg)} |`);
      L.push(`| ├ 建造 | ${fmtR(bld / dtSum)} | ${fmtE(bld)} |`);
      L.push(`| └ 孵化 | ${fmtR(spn / dtSum)} | ${fmtE(spn)} |`);
      L.push(`| source 再生上限（全部采样房） | ${fmtR(ceil / dtSum)} | ${fmtE(ceil)} |`);
      L.push(`| **帝国开采利用率** | **${fmtP(ceil > 0 ? inc / ceil : null)}** | — |`);
      if (hasHits) L.push(`| （参考）hits 净增量，含维修/战损/噪声 | — | ${fmtE(hitsRef)} |`);
      L.push("");
      L.push(`> 口径：收入侧只含 source 再生；塔射击、掉落衰减、hits 噪声未入恒等式，利用率 >100% 说明仍有未建模流入或测量噪声。`);
    }
  }
  L.push("");

  // 3. 分房台账
  L.push(`## 3. 分房能量台账（差分窗口均值，e/tick）`);
  for (const roomName of Object.keys(last.roomCensus || {})) {
    const perWins = wins.map((w) => w.perRoom[roomName]).filter(Boolean);
    if (!perWins.length) { L.push(`\n### ${roomName}\n\n（窗口内无自有房差分数据）`); continue; }
    const n = perWins.length;
    const avg = (f) => mean(perWins.map(f));
    const dtSum = perWins.reduce((a, w) => a + w.dt, 0);
    L.push(`\n### ${roomName}（${n} 个窗口 / ${dtSum} ticks）`);
    L.push("");
    L.push(`| 流向 | e/tick | 窗口累计 |`);
    L.push(`|---|---|---|`);
    L.push(`| 隐含收入 incomeImplied | ${fmtR(avg((w) => w.incomeImplied / w.dt))} | ${fmtE(perWins.reduce((a, w) => a + w.incomeImplied, 0))} |`);
    L.push(`| 升级（controller） | ${fmtR(avg((w) => w.upgradeE / w.dt))} | ${fmtE(perWins.reduce((a, w) => a + w.upgradeE, 0))} |`);
    L.push(`| 建造 | ${fmtR(avg((w) => w.buildE / w.dt))} | ${fmtE(perWins.reduce((a, w) => a + w.buildE, 0))} |`);
    L.push(`| 孵化 | ${fmtR(avg((w) => w.spawnE / w.dt))} | ${fmtE(perWins.reduce((a, w) => a + w.spawnE, 0))} |`);
    L.push(`| 全仓位净存 Δ | ${fmtR(avg((w) => w.dTotal / w.dt))} | ${fmtE(perWins.reduce((a, w) => a + w.dTotal, 0))} |`);
    L.push(`| source 再生上限 ceiling | ${fmtR(avg((w) => w.regenCeiling / w.dt))} | — |`);
    L.push(`| **本房开采利用率** | **${fmtP(mean(perWins.map((w) => w.ceilingUtil).filter((x) => x != null)))}** | — |`);
    const bkt = {};
    for (const w of perWins) for (const [k, v] of Object.entries(w.buckets)) bkt[k] = (bkt[k] || 0) + v;
    L.push(`- 仓位分布（窗口累计 Δ）：${Object.entries(bkt).filter(([k, v]) => k !== "dropped" && k !== "tombE" || v !== 0).map(([k, v]) => `${k}=${fmtE(v)}`).join(" · ")}`);
    const bornTotal = perWins.flatMap((w) => w.born);
    const deadTotal = perWins.flatMap((w) => w.gone || []);
    if (bornTotal.length || deadTotal.length) {
      const bs = {}; bornTotal.forEach((c) => bs[c.role] = (bs[c.role] || 0) + 1);
      const ds = {}; deadTotal.forEach((c) => ds[c.role] = (ds[c.role] || 0) + 1);
      L.push(`- 孵化（帝国全范围） ${bornTotal.length} 只（${Object.entries(bs).map(([k, v]) => `${k}×${v}`).join(" ")}）｜离场 ${deadTotal.length} 只（${Object.entries(ds).map(([k, v]) => `${k}×${v}`).join(" ") || "-"}；含死亡与走出采样房）`);
    }
    const stateB = perWins[perWins.length - 1].decisionB;
    if (stateB) L.push(`- 决策态（窗口末）：colonyState=${stateB.colonyState} phase=${stateB.phase} reserve=${fmtE(stateB.reserve)} pressure=${fmtR(stateB.economyPressure)} drainScore=${stateB.drainScore}`);
  }
  L.push("");

  // 3. 远矿
  L.push(`## 4. 远矿中转（容器+携带差分）`);
  const remoteAgg = {};
  for (const w of wins) for (const r of w.remote) {
    remoteAgg[r.name] = remoteAgg[r.name] || { n: 0, dCont: 0, delivered: 0, srcUtilB: [] };
    remoteAgg[r.name].n++;
    remoteAgg[r.name].dCont += r.dCont;
    remoteAgg[r.name].delivered += r.delivered;
    if (r.srcUtilB != null) remoteAgg[r.name].srcUtilB.push(r.srcUtilB);
  }
  if (!Object.keys(remoteAgg).length) L.push(`（窗口内无远矿差分数据）`);
  else {
    L.push(`| 远矿房 | 容器净 Δ | 估算回运 | 末窗 src 水位 |`);
    L.push(`|---|---|---|---|`);
    for (const [name, s] of Object.entries(remoteAgg)) {
      // src 水位语义：满速开采时 source 呈锯齿（满→空→瞬时回满），均值≈50%；
      // 水位持续 >60% 才代表开采不足（停采时间过长），<40% 属采样混叠噪声。
      const lvl = s.srcUtilB.length ? fmtP(mean(s.srcUtilB)) : "?";
      const hint = s.srcUtilB.length ? (mean(s.srcUtilB) > 0.6 ? " ⚠️开采不足" : "（≈满速）") : "";
      L.push(`| ${name} | ${fmtE(s.dCont)} | ${fmtE(s.delivered)} | ${lvl}${hint} |`);
    }
  }
  L.push("");

  // 4. 角色效率
  L.push(`## 5. 各角色运行效率（窗口内均值，bot 内 10-tick 普查口径）`);
  L.push(`work=干正事 idle=空转 travel=在途(acquire)；carry=地面实测平均携带`);
  L.push("");
  L.push(`| 角色 | 存活均 | work | idle | travel | productivity | 平均TTL | 平均carry |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  for (const [role, s] of Object.entries(roles).sort((a, b) => b[1].aliveMean - a[1].aliveMean)) {
    L.push(`| ${role} | ${s.aliveMean.toFixed(1)} (${s.aliveMin}-${s.aliveMax}) | ${fmtP(s.work)} | ${fmtP(s.idle)} | ${fmtP(s.travel)} | ${fmtP(s.prod)} | ${Math.round(s.ttlMean)} | ${s.carryMean != null ? Math.round(s.carryMean) : "-"} |`);
  }
  L.push("");

  // 5. 决策态时间线
  L.push(`## 6. 决策态变迁`);
  for (const key of ["colonyState", "posture"]) {
    const tl = decisionTimeline(rows, key);
    L.push(`- **${key}**: ${tl.slice(-6).map((x) => `t=${x.t} ${Object.entries(x).filter(([k]) => !["t", "ts"].includes(k)).map(([k, v]) => `${k}=${v}`).join(" ")}`).join(" → ")}`);
  }
  const sr = skipRate(rows);
  const srEntries = Object.entries(sr).slice(0, 8);
  if (srEntries.length) {
    L.push(`- **skipReasons 增速**（次/ktick）：${srEntries.map(([k, v]) => `${k}=${v.perKtick}`).join(" · ")}`);
  }
  L.push("");

  // 6. 异常与疑似根因
  L.push(`## 7. 异常与疑似根因（规则触发，按严重度）`);
  if (!A.length) L.push(`（无规则触发）`);
  for (const a of A) {
    L.push(`- **[${a.sev}] ${a.id}** ${a.msg}`);
    L.push(`  - 证据：${a.evidence}`);
  }
  L.push("");
  L.push(`---`);
  L.push(`*分析口径：incomeImplied = Δ(全仓位含link/掉落/墓碑/携带) + 升级 + 建造 + 孵化；维修/塔射击/衰减走 hits 参考项不进恒等式。ceiling = srcCap×Δt/300（远矿房 ceiling 计入帝国上限）。孵化判定 = 全局普查新名字且 TTL≥1400。*`);
  return L.join("\n");
}

function main() {
  const rows = loadRows();
  if (!rows.length) { console.error("无数据：先运行 tools/mmo/empire-collector.js"); process.exit(1); }
  const wins = buildWindows(rows);
  const roles = roleStats(rows);
  const mat = maturity(rows, wins);
  const A = anomalies(wins, roles, rows);
  const report = render(rows, wins, roles, mat, A);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, report);
  console.log(report);
  console.log(`\n[analyze] 报告已写入 ${OUT_FILE}`);
}

main();
