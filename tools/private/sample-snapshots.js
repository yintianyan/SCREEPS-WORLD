/**
 * 从 snapshots 文件精确抽取指定 tick 范围的快照。
 * 文件 1.5GB，必须流式扫描，不能一次性载入。
 *
 * 用法：node tools/private/sample-snapshots.js <tickStart> [<tickEnd>]
 *   单 tick：抽取最接近该 tick 的一行
 *   区间：抽取 [start, end] 内所有行
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const COLLECT_DIR = path.join(__dirname, "data", "collect");
const session = JSON.parse(fs.readFileSync(path.join(COLLECT_DIR, "session.json"), "utf8"));
const SN_FILE = path.join(COLLECT_DIR, session.snapshots);

const targetTick = parseInt(process.argv[2] ?? "0", 10);
const endTick = parseInt(process.argv[3] ?? "0", 10);
const rangeMode = endTick > 0 && endTick > targetTick;

if (!targetTick) {
  console.error("用法：node sample-snapshots.js <tickStart> [<tickEnd>]");
  process.exit(1);
}

console.log(`[Scan] ${SN_FILE}`);
console.log(`[Target] ${rangeMode ? `range [${targetTick}, ${endTick}]` : `nearest to ${targetTick}`}`);

const out = [];
let scanned = 0;
let nearest = null;
let nearestDelta = Infinity;

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(SN_FILE, { highWaterMark: 1024 * 1024 * 4 }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    scanned++;
    // 快速提取 tick：每行格式为 {"t":<num>,...
    const m = line.match(/^{"t":("?(\d+)"?)/);
    if (!m) continue;
    const tick = parseInt(m[2], 10);
    if (rangeMode) {
      if (tick >= targetTick && tick <= endTick) {
        try { out.push(JSON.parse(line)); } catch (e) {}
      }
    } else {
      const d = Math.abs(tick - targetTick);
      if (d < nearestDelta) {
        nearestDelta = d;
        nearest = line;
      }
    }
    if (scanned % 1000 === 0) process.stderr.write(`  scanned ${scanned}\r`);
  }
  process.stderr.write("\n");
  console.log(`[Scanned] ${scanned} 行`);
  if (rangeMode) {
    console.log(`[Matched] ${out.length} 条`);
    // 输出每条的 tick 与摘要
    out.forEach(s => {
      console.log(`  tick=${s.t} objects=${s.objects?.length || 0} rooms=${s.rooms?.length || 0}`);
    });
    // 写出文件供进一步分析
    const outFile = path.join(COLLECT_DIR, `snapshot-sampled-${targetTick}-${endTick}.json`);
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`[Output] ${outFile}`);
  } else {
    if (!nearest) { console.error("未找到任何行"); process.exit(1); }
    const obj = JSON.parse(nearest);
    console.log(`[Nearest] tick=${obj.t} delta=${nearestDelta} objects=${obj.objects?.length || 0}`);
    const outFile = path.join(COLLECT_DIR, `snapshot-sampled-${obj.t}.json`);
    fs.writeFileSync(outFile, JSON.stringify(obj, null, 2));
    console.log(`[Output] ${outFile}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
