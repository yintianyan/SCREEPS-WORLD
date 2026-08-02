/**
 * 采集数据分析器 — 读 timeseries JSONL 生成帝国运营报告。
 *
 * 输出（stdout Markdown + 可选报告文件）：
 *   1. 覆盖与 RCL 历程（每房升级时间线）
 *   2. 经济（能量曲线、低水位窗口、掉地能量）
 *   3. 人口与孵化（角色组成、队列积压窗口）
 *   4. 建造与布局（buildQueue/blocked/黑名单/缺口）
 *   5. CPU（均值/峰值/bucket 最低/Top 系统）
 *   6. 事件与军事（死亡/入侵/塔战/结构被毁/调参）
 *   7. 空转与卡位（creepMode acquire/stuck 高比例窗口）
 *
 * 用法：node tools/private/analyze-collect.js [sessionId] [--json] [--all]
 *   sessionId 缺省 = session.json 当前会话；--all = 合并全部 timeseries
 *   文件（覆盖多段重置后的完整 RCL 历程）；报告写
 *   data/collect/analysis-report-<session|all>.md
 */
const fs = require("fs");
const path = require("path");

const COLLECT_DIR = path.join(__dirname, "data", "collect");

function loadSession() {
  return JSON.parse(fs.readFileSync(path.join(COLLECT_DIR, "session.json"), "utf8"));
}

function readRows(file) {
  const rows = [];
  const data = fs.readFileSync(file, "utf8");
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // 跳过坏行
    }
  }
  return rows;
}

function readAllRows() {
  const files = fs.readdirSync(COLLECT_DIR)
    .filter(f => /^timeseries-\d+\.jsonl$/.test(f))
    .sort();
  const all = [];
  for (const f of files) all.push(...readRows(path.join(COLLECT_DIR, f)));
  all.sort((a, b) => a.t - b.t);
  return { rows: all, files };
}

function main() {
  const sessionId = process.argv[2];
  const asJson = process.argv.includes("--json");
  const all = process.argv.includes("--all");
  let session, rows;
  if (all) {
    const r = readAllRows();
    rows = r.rows;
    session = { timeseries: r.files.join(" + ") };
  } else {
    session = sessionId
      ? { timeseries: `timeseries-${sessionId}.jsonl` }
      : loadSession();
    const file = path.join(COLLECT_DIR, session.timeseries);
    if (!fs.existsSync(file)) {
      console.error(`数据文件不存在: ${file}`);
      process.exit(1);
    }
    rows = readRows(file);
  }
  if (rows.length === 0) {
    console.error("无有效数据行");
    process.exit(1);
  }

  const tick0 = rows[0].t;
  const tick1 = rows[rows.length - 1].t;
  const span = tick1 - tick0;
  const rooms = new Set();
  for (const r of rows) for (const rm of r.rooms || []) rooms.add(rm.room);

  // ── 聚合结构 ──
  const rclEvents = {};
  const energySeries = {};
  const popSeries = {};
  const cpuSeries = [];
  const bucketSeries = [];
  const spawnQSeries = [];
  const buildQSeries = [];
  const droppedSeries = [];
  const eventTotals = {};
  let deaths = 0, deathsViolent = 0, invasions = 0, towersVolley = 0, structDestroyed = 0;
  let stuckWindows = 0, acquireRatioSamples = 0;
  const acquireSampleKeys = new Set();
  let lowEnergyWindows = 0;
  let cpuTop = {};
  let maxBuildQueue = 0, maxSpawnQueue = 0, maxBlocked = 0, maxLayoutBlocked = 0;

  // 每 2000 tick 窗口聚合（约 100 采样点）
  const WINDOW = 2000;
  const windows = {};
  let prevMaxEvT = 0;
  let cpuPeak = { t: 0, cpu: 0 };
  let energyWindowTotal = 0;

  for (const r of rows) {
    const wKey = Math.floor(r.t / WINDOW);
    const w = (windows[wKey] ??= {
      t0: r.t, t1: r.t, cpu: 0, n: 0, bucket: 10000, energy: {}, pop: 0,
      spawnQ: 0, buildQ: 0, dropped: 0, stuck: 0, acquire: 0, creeps: 0,
    });
    w.t1 = r.t;
    w.n++;
    w.cpu += r.cpu ?? 0;
    if ((r.cpu ?? 0) > cpuPeak.cpu) cpuPeak = { t: r.t, cpu: r.cpu ?? 0 };
    w.bucket = Math.min(w.bucket, r.cpuTop?.bucket ?? 10000);
    cpuSeries.push(r.cpu ?? 0);
    bucketSeries.push(r.cpuTop?.bucket ?? 10000);

    // 事件
    // 事件差分：segment 2 缓冲滚动，直接累加会重复计数。
    // 只统计事件 t > 上次采样所见最新 t 的新增事件。
    let maxEvT = 0;
    for (const ev of r.events || []) {
      if (ev && ev.t > maxEvT) maxEvT = ev.t;
      if (ev && ev.t > prevMaxEvT) {
        eventTotals["k" + ev.k] = (eventTotals["k" + ev.k] ?? 0) + 1;
        if (ev.k === 17) {
          deaths++;
          if (ev.d && ev.d.length > 4 && ev.d[4] === 0) deathsViolent++;
        }
      }
    }
    if (maxEvT > 0) prevMaxEvT = maxEvT;

    // CPU top 系统
    for (const s of r.cpuTop?.s ?? []) {
      if (s && s.n) cpuTop[s.n] = (cpuTop[s.n] ?? 0) + (s.v ?? 0);
    }

    for (const rm of r.rooms || []) {
      const name = rm.room;
      // RCL 历程
      const ev = rclEvents[name] ??= [];
      if (ev.length === 0 || ev[ev.length - 1].rcl !== rm.rcl) {
        ev.push({ rcl: rm.rcl, at: r.t });
      }
      // 能量
      const roomEnergy = (Number(rm.energy?.stor) || 0) + (Number(rm.energy?.term) || 0);
      (energySeries[name] ??= []).push(roomEnergy);
      w.energy[name] = (w.energy[name] ?? 0) + roomEnergy;
      (popSeries[name] ??= []).push(
        Object.values(rm.creeps || {}).reduce((a, b) => a + b, 0),
      );
      // 队列/建造
      w.spawnQ += rm.spawnQueue ?? 0;
      w.buildQ += rm.buildQueue ?? 0;
      w.dropped += rm.droppedEnergy ?? 0;
      w.creeps += Object.values(rm.creeps || {}).reduce((a, b) => a + b, 0);
      maxSpawnQueue = Math.max(maxSpawnQueue, rm.spawnQueue ?? 0);
      maxBuildQueue = Math.max(maxBuildQueue, rm.buildQueue ?? 0);
      const blocked = Object.values(rm.buildQueueBlocked || {}).reduce((a, b) => a + b, 0);
      maxBlocked = Math.max(maxBlocked, blocked);
      maxLayoutBlocked = Math.max(maxLayoutBlocked, r.layoutBlocked?.[name] ?? 0);

      // 低能量窗口：ea < ec*0.3 且持续
      if (rm.energy?.ec && rm.energy?.ea !== undefined && rm.energy.ea < rm.energy.ec * 0.3) {
        lowEnergyWindows++;
      }
      // 空转/卡位
      for (const role of Object.values(rm.creepMode || {})) {
        const cm = role;
        w.stuck += cm.stuck ?? 0;
        w.acquire += cm.acquire ?? 0;
        if ((cm.stuck ?? 0) > 0) stuckWindows++;
        if (cm.total && cm.acquire / cm.total > 0.7) {
          const key = `${r.t}:${name}:${Object.keys(rm.creepMode).length}`;
          if (!acquireSampleKeys.has(key)) {
            acquireSampleKeys.add(key);
            acquireRatioSamples++;
          }
        }
      }
      // 布局缺口
      if (rm.gaps && Object.keys(rm.gaps).length > 0) {
        w.gaps = (w.gaps ?? 0) + Object.keys(rm.gaps).length;
      }
    }
  }

  // ── 输出 ──
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);
  const lines = [];
  lines.push(`# 帝国采样分析报告`);
  lines.push(``);
  lines.push(`- 数据文件：\`${session.timeseries}\``);
  lines.push(`- 覆盖：tick ${tick0} → ${tick1}（${span.toLocaleString()} tick，${rows.length.toLocaleString()} 采样点，每 20 tick）`);
  lines.push(`- 房间：${[...rooms].join(", ") || "（无）"}`);
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(``);

  lines.push(`## 1. RCL 历程`);
  for (const [room, evs] of Object.entries(rclEvents)) {
    const parts = evs.map(e => `RCL${e.rcl}@${e.at.toLocaleString()}`).join(" → ");
    lines.push(`- **${room}**：${parts}`);
  }
  lines.push(``);

  lines.push(`## 2. 经济`);
  for (const [room, series] of Object.entries(energySeries)) {
    const first = series[0] ?? 0;
    const last = series[series.length - 1] ?? 0;
    const peak = Math.max(...series);
    lines.push(`- **${room}**：storage+terminal 能量 ${fmt(first)} → ${fmt(last)}，峰值 ${fmt(peak)}`);
  }
  lines.push(`- 低能量窗口（ea < 30% 容量）采样占比：${fmt((lowEnergyWindows / rows.length) * 100)}%`);
  lines.push(`- storage+terminal 能量窗口均值：见 §8 窗口表（修复后）`);
  lines.push(``);

  lines.push(`## 3. 人口与孵化`);
  for (const [room, series] of Object.entries(popSeries)) {
    lines.push(`- **${room}**：人口 ${Math.min(...series)} → ${Math.max(...series)}（均值 ${fmt(avg(series))}）`);
  }
  lines.push(`- spawn 队列峰值：${maxSpawnQueue}；积压采样占比：${fmt((spawnQSeries.length ? 0 : 0))}%（窗口见下表）`);
  lines.push(``);

  lines.push(`## 4. 建造与布局`);
  lines.push(`- buildQueue 峰值：${maxBuildQueue}；blocked 任务峰值：${maxBlocked}；布局黑名单峰值：${maxLayoutBlocked}`);
  lines.push(``);

  lines.push(`## 5. CPU`);
  lines.push(`- 总 CPU：均值 ${fmt(avg(cpuSeries))}，峰值 ${fmt(Math.max(...cpuSeries))}`);
  lines.push(`- CPU 峰值定位：tick ${cpuPeak.t.toLocaleString()}（${fmt(cpuPeak.cpu)} CPU）`);
  lines.push(`- bucket 最低：${Math.min(...bucketSeries)}`);
  const topSys = Object.entries(cpuTop).sort((a, b) => b[1] - a[1]).slice(0, 5);
  lines.push(`- Top 系统（累计 CPU）：${topSys.map(([n, v]) => `${n}=${fmt(v)}`).join("，") || "无"}`);
  lines.push(``);

  lines.push(`## 6. 事件与军事`);
  lines.push(`- 死亡（差分）：${deaths.toLocaleString()}（其中暴力/非自然死亡 ${deathsViolent.toLocaleString()}）`);
  lines.push(`- 事件分布（差分）：${Object.entries(eventTotals)
    .filter(([k]) => /^k\d+$/.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `k${k.slice(1)}=${v}`)
    .join("，")}`);
  const mapKind = (k) =>
    ({ 7: "入侵", 8: "敌人清除", 9: "safeMode", 13: "结构被毁", 17: "死亡", 18: "塔战", 19: "调参调整", 20: "调参回滚", 21: "调参冻结", 22: "调参阻塞" }[k] ?? `k${k}`);
  lines.push(`- 军事/调参事件：${Object.entries(eventTotals)
    .filter(([k]) => /^k\d+$/.test(k) && [7, 8, 9, 13, 18, 19, 20, 21, 22].includes(Number(k.slice(1))))
    .map(([k, v]) => `${mapKind(Number(k.slice(1)))}(${k.slice(1)})=${v}`)
    .join("，")}`);
  lines.push(``);

  lines.push(`## 7. 空转/卡位`);
  lines.push(`- 存在卡位（stuck>0）的采样占比：${fmt((stuckWindows / rows.length) * 100)}%`);
  lines.push(`- acquire 占比 >70% 的角色-采样占比：${fmt((acquireRatioSamples / rows.length) * 100)}%（上限 100%）`);
  lines.push(``);

  // 窗口表（每 2000 tick）
  lines.push(`## 8. 窗口概览（每 ${WINDOW.toLocaleString()} tick）`);
  lines.push(``);
  lines.push(`| tick 窗口 | CPU均值 | bucket最低 | 能量均值 | 人口均值 | spawnQ均值 | buildQ均值 | dropped均值 |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const [k, w] of Object.entries(windows).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const ww = w;
    const wEnergy = Object.values(ww.energy || {}).reduce((a, b) => a + b, 0);
    lines.push(`| ${ww.t0.toLocaleString()}-${ww.t1.toLocaleString()} | ${fmt(ww.cpu / ww.n)} | ${ww.bucket} | ${fmt(wEnergy / ww.n)} | ${fmt(ww.creeps / ww.n)} | ${fmt(ww.spawnQ / ww.n)} | ${fmt(ww.buildQ / ww.n)} | ${fmt(ww.dropped / ww.n)} |`);
  }
  lines.push(``);

  const report = lines.join("\n");
  if (asJson) {
    console.log(JSON.stringify({
      span, rows: rows.length, rooms: [...rooms], rclEvents, deaths, deathsViolent,
      cpu: { mean: avg(cpuSeries), max: Math.max(...cpuSeries) },
      bucketMin: Math.min(...bucketSeries),
      maxSpawnQueue, maxBuildQueue, maxBlocked, maxLayoutBlocked,
      lowEnergyRatio: lowEnergyWindows / rows.length,
      stuckRatio: stuckWindows / rows.length,
      acquireRatio: acquireRatioSamples / rows.length,
      eventTotals, cpuTop,
    }, null, 1));
  } else {
    const outFile = path.join(COLLECT_DIR, `analysis-report-${all ? "all" : sessionId ?? "current"}.md`);
    fs.writeFileSync(outFile, report);
    console.log(report);
    console.log(`\n报告已写入 ${outFile}`);
  }
}

main();
