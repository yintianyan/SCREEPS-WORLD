/**
 * CpuProbe — 真引擎下的逐 tick CPU 画像采集通道。
 *
 * 探针在 bot 沙箱内读 `global.telemetry`（kernel 每 tick 本就采集、随即丢弃）与几个
 * heap 账本，因此不新增任何生产侧测量开销；`cpuAtProbe` 取探针内首个语句的 getUsed()，
 * console 与 main 同 tick 且 main 先跑，故该读数即整 tick 的主循环成本、不含探针自身。
 *
 * 载荷走 `key=value` 线格式而非 JSON —— console 通道会把双引号转义成 &#x22;，
 * JSON.parse 必然失败。
 */

export interface IntentTally {
  ok: number;
  /** ok + 所有非 OK 返回码次数。 */
  total: number;
  /** 非 OK 返回码 → 次数。 */
  codes: Record<number, number>;
}

export interface ActionCpuRow {
  count: number;
  totalCpu: number;
  maxCpu: number;
}

export interface ProbeSample {
  tick: number;
  /** 探针首句读到的累计 CPU；main 先于 console 执行时即整 tick 成本。 */
  cpuAtProbe: number;
  /** telemetry 所属 tick；等于 tick 表示 main 已先于 console 执行。 */
  telemetryTick: number;
  bucket: number;
  /** 本 tick 引擎给的 CPU 上限。节流判据必须看它 —— 档位只由 bucket 决定，而 mockup
   * 的 bucket 可能是常量，"bucket 没跌"不等于"没被掐"。 */
  tickLimit: number;
  creeps: number;
  rooms: number;
  memorySize: number;
  skipped: number;
  errors: number;
  systemCpu: Record<string, number>;
  roleCpu: Record<string, number>;
  actionCpu: Record<string, ActionCpuRow>;
  /** bot 自采样的引擎侧总量，作为探针通道的交叉校验。 */
  statsCpuAvg10: number;
  statsCpuMax10: number;
  /** 本 tick 各房寻路预算占用次数（PathFinder.search 次数的上界代理）。 */
  pathSearchByRoom: Record<string, number>;
  /** heap 路径缓存条目数。 */
  pathCacheEntries: number;
  /** 本 tick 登记的移动意图数（账本，非引擎签发）。 */
  moveIntents: number;
  /** 本 tick 引擎意图签发：类别 → 返回码分桶。 */
  issued: Record<string, IntentTally>;
  /** 本 tick 各角色在编 creep 数 —— 角色 CPU 必须除以它才是每 creep 成本。 */
  roleCounts: Record<string, number>;
  /** 台阶标签（`buildProbe({label})` 原样回显），用于把样本归属到某个人口台阶。 */
  step: string;
  /** 全帝国自有结构数 / 在建 site 数 / storage 能量 —— 人口台阶实验的协变量。 */
  structures: number;
  sites: number;
  storedEnergy: number;
  /** 视野内**全部**结构数（含道路/容器/墙）。用来核对 `structures` 是不是过滤器漏了什么。 */
  structuresAll: number;
  /** 所有在建 site 的累计 progress 之和 —— 判断「建了又拆」还是「几乎没推进」。 */
  siteWork: number;
  /** 结构类型直方图原始串 `type:n,…`：核对过滤器口径，不依赖任何推断。 */
  structureTypes: string;
  /** `room.energyCapacityAvailable` 最大值 —— 有没有 extension 的直接证据（无则恒 300）。 */
  spawnEnergyCap: number;
  /** `room.energyAvailable` 最大值 —— 当前可动用的能量（决定能孵多大的 body）。 */
  energyAvailable: number;
  /** 在建 site 按类型的 `只数 / progressTotal / 已累计 progress` —— 看工时实际流向哪个类型。 */
  siteTotals: Record<string, { count: number; total: number; progress: number }>;
  /** 参与台阶实验的角色，其生效 roleBounds 摘要（各房一致时为 `role:min/max,…`，否则 MIXED）。 */
  roleBounds: string;
}

/**
 * 探针选项。`sweepRoles` + `pin` 让探针在读取之前把角色编制边界写回 Memory ——
 * 这是人口台阶夹具唯一的运行时旋钮：`CONFIG.roles.*` 是编译期常量，而
 * `Memory.kernel.tuning.rooms[r].roleBounds[role]` 每次 `getRoleBounds` 都读
 * （`src/config/tuned.ts:62`），且每 tick 重写可以压过 tuning-engine 每 500 tick 的调整。
 */
export interface ProbeOptions {
  label?: string;
  /** 参与台阶实验的角色名列表。给了就会在每 tick 被钉住或解除。 */
  sweepRoles?: string[];
  /** 角色 → 钉住的边界；缺该角色 = 删除覆盖，回落 CONFIG 默认。 */
  pin?: Record<string, { minCount: number; maxCount: number }>;
}

/** 构造逐 tick 探针脚本。 */
export function buildProbe(opts: ProbeOptions = {}): string {
  const sweepRoles = opts.sweepRoles ?? [];
  return `(function(){
  var g = global;
  var t = g.telemetry || {};
  var st = (Memory.kernel && Memory.kernel.stats) || {};
  var SWEEP = ${JSON.stringify(sweepRoles)};
  var PIN = ${JSON.stringify(opts.pin ?? {})};
  function ownedRooms(){ var a = [], n; for (n in Game.rooms) { if (Game.rooms[n].controller && Game.rooms[n].controller.my) a.push(n); } return a; }
  // 台阶旋钮：每 tick 把 sweepRoles 的 roleBounds 钉成 PIN 给的形状（PIN 里没有 = 删除覆盖）。
  var dig = '';
  if (SWEEP.length) {
    var or = ownedRooms(), ri, rn, rb, si, role, cur;
    for (ri = 0; ri < or.length; ri++) {
      rn = or[ri];
      if (!Memory.kernel) Memory.kernel = {};
      if (!Memory.kernel.tuning) Memory.kernel.tuning = { lastTuned: 0, rooms: {} };
      if (!Memory.kernel.tuning.rooms) Memory.kernel.tuning.rooms = {};
      if (!Memory.kernel.tuning.rooms[rn]) Memory.kernel.tuning.rooms[rn] = { roleBounds: {}, lastAdjusted: {} };
      rb = Memory.kernel.tuning.rooms[rn].roleBounds || (Memory.kernel.tuning.rooms[rn].roleBounds = {});
      for (si = 0; si < SWEEP.length; si++) {
        role = SWEEP[si];
        if (PIN[role]) {
          cur = rb[role] || (rb[role] = {});
          cur.minCount = PIN[role].minCount;
          cur.maxCount = PIN[role].maxCount;
        } else if (rb[role]) {
          delete rb[role];
        }
      }
    }
    // 回读生效值，各房一致则出一条摘要，否则标 MIXED（证明旋钮没钉住，读数不可用）。
    var mixed = 0;
    for (ri = 0; ri < or.length; ri++) {
      rb = (Memory.kernel.tuning.rooms[or[ri]] || {}).roleBounds || {};
      var s = '';
      for (si = 0; si < SWEEP.length; si++) {
        role = SWEEP[si];
        cur = rb[role];
        s += (s ? ',' : '') + role + ':' + (cur ? cur.minCount + '/' + cur.maxCount : '-');
      }
      if (!dig) dig = s;
      else if (dig !== s) mixed = 1;
    }
    if (mixed) dig = 'MIXED!' + dig;
  }
  var cov = [0, 0, 0, 0, 0], or2 = ownedRooms(), oi, rm, found, q;
  for (oi = 0; oi < or2.length; oi++) {
    rm = Game.rooms[or2[oi]];
    found = rm.find(FIND_MY_STRUCTURES);
    cov[0] += found ? found.length : 0;
    cov[4] += (rm.find(FIND_STRUCTURES) || []).length;
    found = rm.find(FIND_CONSTRUCTION_SITES) || [];
    cov[1] += found.length;
    for (q = 0; q < found.length; q++) cov[3] += found[q].progress || 0;
    if (rm.storage) cov[2] += rm.storage.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
  }
  function flat(o){ var a = [], k; for (k in o) a.push(k + ':' + o[k]); return a.join(','); }
  // 结构类型直方图 + spawn 可用能量容量：structures 与真实世界不符时这里立刻现形
  // （有没有 extension 由 ecap 直接暴露，不依赖任何过滤器口径）。
  var styp = {}, ecap = 0, eavail = 0, ei, e2;
  for (ei = 0; ei < or2.length; ei++) {
    e2 = Game.rooms[or2[ei]].find(FIND_STRUCTURES) || [];
    for (var q2 = 0; q2 < e2.length; q2++) {
      styp[e2[q2].structureType] = (styp[e2[q2].structureType] || 0) + 1;
    }
    // 能量容量走 room.energyCapacityAvailable（与 spawn-manager.ts:466 同一口径）——
    // 它是「有没有 extension」的直接证据：无 extension 时恒等于 spawn 基础值 300。
    var rw = Game.rooms[or2[ei]];
    ecap = Math.max(ecap, rw.energyCapacityAvailable || 0);
    eavail = Math.max(eavail, rw.energyAvailable || 0);
  }
  var swork = {};
  for (ei = 0; ei < or2.length; ei++) {
    var sw = Game.rooms[or2[ei]].find(FIND_CONSTRUCTION_SITES) || [];
    for (var q4 = 0; q4 < sw.length; q4++) {
      var kk = sw[q4].structureType || "?";
      var cur = swork[kk] || [0, 0, 0];
      cur[0] += 1;
      cur[1] += sw[q4].progress || 0;
      cur[2] += sw[q4].progressTotal || 0;
      swork[kk] = cur;
    }
  }
  var sws = '';
  for (var wk in swork) sws += (sws ? ',' : '') + wk + ':' + swork[wk][0] + '/' + swork[wk][2] + '/' + swork[wk][1];
  function cnt(o){ if (!o) return -1; if (typeof o.size === 'number') return o.size; return Object.keys(o).length; }
  var sys = {}; var k;
  for (k in (t.systemCpu || {})) sys[k] = t.systemCpu[k];
  var rol = {};
  for (k in (t.roleCpu || {})) rol[k] = t.roleCpu[k];
  var act = '';
  if (g.actionCpu) {
    var arr = [];
    g.actionCpu.forEach(function(v, key){ arr.push(key + ':' + v.count + ':' + v.totalCpu + ':' + v.maxCpu); });
    act = arr.join(',');
  }
  var mem = 0;
  try { mem = RawMemory.get().length; } catch (e) {}
  var pbg = g.__pathSearchBudget, pb = '';
  if (pbg && pbg.tick === Game.time) { for (var rk in pbg.byRoom) pb += rk + ':' + pbg.byRoom[rk] + ';'; }
  var iss = '';
  for (var ik in (t.intents || {})) {
    var b = t.intents[ik], cs = '', tot = b.ok, c;
    for (c in b.codes) { tot += b.codes[c]; cs += (cs ? ',' : '') + c + '*' + b.codes[c]; }
    iss += (iss ? ';' : '') + ik + ':' + b.ok + ':' + tot + ':' + cs;
  }
  var cpu = Game.cpu.getUsed();
  var nByRole = {};
  for (var ck in Game.creeps) {
    var cm = Game.creeps[ck].memory;
    var r = cm && cm.role;
    if (r) nByRole[r] = (nByRole[r] || 0) + 1;
  }
  console.log('CPUB|tick=' + Game.time +
    '|cpu=' + cpu +
    '|telTick=' + (t.tick || -1) +
    '|bucket=' + (Game.cpu.bucket || 0) +
    '|tickLimit=' + (Game.cpu.tickLimit || 0) +
    '|creeps=' + Object.keys(Game.creeps).length +
    '|rooms=' + Object.keys(Game.rooms).length +
    '|mem=' + mem +
    '|skip=' + (t.skipped || 0) +
    '|err=' + (t.errors || 0) +
    '|avg10=' + (st.cpuAvg10 || 0) +
    '|max10=' + (st.cpuMax10 || 0) +
    '|pathSearch=' + pb +
    '|pathCache=' + cnt(g.__creepPathCache) +
    '|intentsReg=' + (g.__moveIntents ? cnt(g.__moveIntents.intents) : -1) +
    '|issued=' + iss +
    '|sys=' + flat(t.systemCpu || {}) +
    '|role=' + flat(t.roleCpu || {}) +
    '|roleN=' + flat(nByRole) +
    '|step=${(opts.label ?? "none").replace(/[^A-Za-z0-9_-]/g, "")}' +
    '|structs=' + cov[0] +
    '|sites=' + cov[1] +
    '|sfull=' + cov[4] +
    '|stypes=' + flat(styp) +
    '|ecap=' + ecap +
    '|eavail=' + eavail +
    '|siteTot=' + sws +
    '|siteWork=' + cov[3] +
    '|storeE=' + cov[2] +
    '|bounds=' + dig +
    '|act=' + act);
})();`;
}

/** console 通道会转义引号/尖括号，解析前还原。 */
export function unescapeLog(s: string): string {
  return s
    .replace(/&#x22;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** 把 `a=1|b=2` 形式的载荷拆成键值表。 */
export function parsePipe(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of payload.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/** `k:v,k:v` → Record<string, number>。 */
export function parseNumMap(raw: string | undefined, sep = ","): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const pair of raw.split(sep)) {
    const idx = pair.lastIndexOf(":");
    if (idx <= 0) continue;
    const val = Number(pair.slice(idx + 1));
    if (Number.isFinite(val)) out[pair.slice(0, idx)] = val;
  }
  return out;
}

/** `k:count:total:max,...` → action 表（action 名本身含 `/`，逐项从右切）。 */
export function parseActionMap(raw: string | undefined): Record<string, ActionCpuRow> {
  const out: Record<string, ActionCpuRow> = {};
  if (!raw) return out;
  for (const entry of raw.split(",")) {
    const parts = entry.split(":");
    if (parts.length < 4) continue;
    const maxCpu = Number(parts.pop());
    const totalCpu = Number(parts.pop());
    const count = Number(parts.pop());
    if (!Number.isFinite(maxCpu) || !Number.isFinite(totalCpu) || !Number.isFinite(count)) continue;
    out[parts.join(":")] = { count, totalCpu, maxCpu };
  }
  return out;
}

/** `type:n/total,...` → 在建 site 的类型汇总。 */
export function parseSiteTotals(
  raw: string | undefined,
): Record<string, { count: number; total: number; progress: number }> {
  const out: Record<string, { count: number; total: number; progress: number }> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const idx = pair.lastIndexOf(":");
    if (idx <= 0) continue;
    const [n, total, prog] = pair.slice(idx + 1).split("/");
    const count = Number(n);
    const tot = Number(total);
    const done = Number(prog);
    if (Number.isFinite(count) && Number.isFinite(tot))
      out[pair.slice(0, idx)] = { count, total: tot, progress: Number.isFinite(done) ? done : 0 };
  }
  return out;
}

/** `kind:ok:total:code*n,code*n;...` → 签发分桶表。 */
export function parseIntentMap(raw: string | undefined): Record<string, IntentTally> {
  const out: Record<string, IntentTally> = {};
  if (!raw) return out;
  for (const entry of raw.split(";")) {
    const [kind, ok, total, codesStr] = entry.split(":");
    if (!kind) continue;
    const tally: IntentTally = { ok: Number(ok), total: Number(total), codes: {} };
    if (!Number.isFinite(tally.ok) || !Number.isFinite(tally.total)) continue;
    for (const pair of (codesStr ?? "").split(",")) {
      const [code, n] = pair.split("*");
      const c = Number(code);
      const count = Number(n);
      if (pair && Number.isFinite(c) && Number.isFinite(count)) tally.codes[c] = count;
    }
    out[kind] = tally;
  }
  return out;
}

export function toProbeSample(rec: Record<string, string>): ProbeSample | null {
  const num = (k: string): number => Number(rec[k] ?? 0) || 0;
  if (!rec.tick) return null;
  return {
    tick: num("tick"),
    cpuAtProbe: num("cpu"),
    telemetryTick: num("telTick"),
    bucket: num("bucket"),
    tickLimit: num("tickLimit"),
    creeps: num("creeps"),
    rooms: num("rooms"),
    memorySize: num("mem"),
    skipped: num("skip"),
    errors: num("err"),
    systemCpu: parseNumMap(rec.sys),
    roleCpu: parseNumMap(rec.role),
    actionCpu: parseActionMap(rec.act),
    statsCpuAvg10: num("avg10"),
    statsCpuMax10: num("max10"),
    pathSearchByRoom: parseNumMap((rec.pathSearch ?? "").replace(/;/g, ",")),
    pathCacheEntries: num("pathCache"),
    moveIntents: num("intentsReg"),
    issued: parseIntentMap(rec.issued),
    roleCounts: parseNumMap(rec.roleN),
    step: rec.step ?? "none",
    structures: num("structs"),
    sites: num("sites"),
    structuresAll: num("sfull"),
    siteWork: num("siteWork"),
    structureTypes: rec.stypes ?? "",
    spawnEnergyCap: num("ecap"),
    energyAvailable: num("eavail"),
    siteTotals: parseSiteTotals(rec.siteTot),
    storedEnergy: num("storeE"),
    roleBounds: rec.bounds ?? "",
  };
}

/** 从 console 日志流解析指定前缀的探针载荷。 */
export function collectProbes<T>(
  lines: string[],
  prefix: string,
  map: (rec: Record<string, string>) => T | null,
): T[] {
  const out: T[] = [];
  for (const line of lines) {
    const text = unescapeLog(line);
    const idx = text.indexOf(prefix);
    if (idx < 0) continue;
    const parsed = map(parsePipe(text.slice(idx + prefix.length)));
    if (parsed) out.push(parsed);
  }
  return out;
}

export const sumNumbers = (table: Record<string, number>): number =>
  Object.values(table).reduce((a, b) => a + b, 0);

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

/** 把逐 tick 样本聚合成按均值降序的占比表。 */
export function aggregate(
  samples: ProbeSample[],
  pick: (s: ProbeSample) => Record<string, number>,
): Array<{ name: string; meanCpu: number; sharePct: number; ticksPresent: number }> {
  const totals = new Map<string, { sum: number; n: number }>();
  let grand = 0;
  for (const s of samples) {
    for (const [name, cpu] of Object.entries(pick(s))) {
      const cur = totals.get(name) ?? { sum: 0, n: 0 };
      cur.sum += cpu;
      cur.n += 1;
      totals.set(name, cur);
      grand += cpu;
    }
  }
  return [...totals.entries()]
    .map(([name, v]) => ({
      name,
      meanCpu: v.sum / Math.max(samples.length, 1),
      sharePct: grand > 0 ? (v.sum / grand) * 100 : 0,
      ticksPresent: v.n,
    }))
    .sort((a, b) => b.meanCpu - a.meanCpu);
}

/** 最小二乘直线拟合 y = intercept + slope·x，附带 R² 以判断拟合是否可信。 */
export function linreg(pairs: Array<[number, number]>): {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
} {
  const n = pairs.length;
  if (n < 2) return { intercept: 0, slope: 0, r2: 0, n };
  const sx = pairs.reduce((a, [x]) => a + x, 0);
  const sy = pairs.reduce((a, [, y]) => a + y, 0);
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return { intercept: my, slope: 0, r2: 0, n };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  for (const [x, y] of pairs) ssRes += (y - (intercept + slope * x)) ** 2;
  const r2 = syy === 0 ? 0 : 1 - ssRes / syy;
  return { intercept, slope, r2, n };
}

/**
 * 最小二乘拟合平面 `y = a + b·x1 + c·x2`（正规方程 + 3×3 高斯消元）。
 * 返回残差平方和与 RMS，供调用方判"模型是否还缺项"。**两种情况下返回 null 而不是给数**：
 * 样本 <4（自由度不够）、两个自变量近共线 |r|>0.9（参数不可分离）。
 */
export function fitPlane(
  points: Array<{ y: number; x1: number; x2: number }>,
): { a: number; b: number; c: number; rms: number; dof: number } | null {
  const n = points.length;
  if (n < 4) return null; // 3 参数 + 至少 1 自由度才算一次检验
  // 两个自变量近共线时 p 与 c 不可分离 —— 拟合照样能给出漂亮的残差，但参数是假的
  // （实测：台阶人口里 签发 与 creeps 的 r=0.95，把 0.21 的单价拆成 0.109 + 0.047/creep）。
  // 与 E2E-030「R²<0.5 就返回 NaN」同一条纪律：分不开就不给数。
  const mx = points.reduce((a, x) => a + x.x1, 0) / n;
  const mn = points.reduce((a, x) => a + x.x2, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const x of points) {
    sxy += (x.x1 - mx) * (x.x2 - mn);
    sxx += (x.x1 - mx) ** 2;
    syy += (x.x2 - mn) ** 2;
  }
  if (sxx > 0 && syy > 0 && Math.abs(sxy) / Math.sqrt(sxx * syy) > 0.9) return null;
  const S = (
    f: (x: (typeof points)[number]) => number,
    g?: (x: (typeof points)[number]) => number,
  ) => points.reduce((acc, x) => acc + f(x) * (g ? g(x) : 1), 0);
  const s1 = S(x => x.x1),
    s2 = S(x => x.x2),
    sy = S(x => x.y);
  const s11 = S(
      x => x.x1,
      x => x.x1,
    ),
    s22 = S(
      x => x.x2,
      x => x.x2,
    );
  const s12 = S(
    x => x.x1,
    x => x.x2,
  );
  const s1y = S(
      x => x.x1,
      x => x.y,
    ),
    s2y = S(
      x => x.x2,
      x => x.y,
    );
  const m = [
    [n, s1, s2, sy],
    [s1, s11, s12, s1y],
    [s2, s12, s22, s2y],
  ];
  for (let i = 0; i < 3; i++) {
    const piv = m[i]![i]!;
    if (Math.abs(piv) < 1e-12) return null; // 自变量共线（台阶没拉开）
    for (let j = 0; j < 4; j++) m[i]![j]! /= piv;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = m[k]![i]!;
      for (let j = 0; j < 4; j++) m[k]![j]! -= f * m[i]![j]!;
    }
  }
  const [a, b, c] = [m[0]![3]!, m[1]![3]!, m[2]![3]!];
  const sse = points.reduce((acc, x) => acc + (x.y - (a + b * x.x1 + c * x.x2)) ** 2, 0);
  return { a, b, c, rms: Math.sqrt(sse / n), dof: n - 3 };
}
