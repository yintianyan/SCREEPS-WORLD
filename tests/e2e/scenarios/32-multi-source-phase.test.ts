/**
 * E2E-032 多 source 房的相位资格（#10 回归）—— 5 颗 source 的房必须拿得到正常相位。
 *
 * 为什么要有这个场景：#10 那条缺陷（`understaffed = harvesterCount < sourceCount` 撞上
 * `harvester.maxCount=4`）在仓库里存活了很久却从没被跑到过 —— **e2e 夹具清一色 2 source**，
 * 而真实房间普遍 4~6 个 source。判据与编制上限互斥时，这种房把 harvester 孵到顶仍算"欠员"，
 * 于是永久停在 bootstrap；bootstrap 与 crisis/recovery 同归经济生存带，生存带又封掉
 * 战争授权、扩张健康门与远矿运营 —— 一间资源更好的房反而永远拿不到正常相位。
 *
 * 实测旧行为（同一夹具，修法前）：9000 tick 里 harvesters 峰值恰为 4，phase 落在危机带
 * 8730 tick（97%），其中 forceCrisis 的驻留计数 `srcStallTicks ≥ 50` 持续 8730 tick，
 * 而 `drain>0` 仅 191 tick、`liq>0` 仅 150 tick —— 把它钉死的是「欠员」判据本身，
 * 外加 srcRatio 取「最满 source」（没被派人的那颗必然满载）把欠员伪装成采集塌方。
 *
 * 夹具刻意在本文件里现造（`developedRoom` + 3 颗额外 source），不改共享 fixture：
 * 多 source 是这条场景的前提，不是别的场景想要的世界。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ScenarioRunner } from "../framework";
import { developedRoom } from "../fixtures/rooms";
import { source } from "../framework/WorldBuilder";
import { CONFIG } from "../../../src/config";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
/** 额外 source 数（默认补到 5 颗）；设 0 跑 2-source 对照组。 */
const EXTRA_SOURCES = Number(process.env.MSRC_EXTRA ?? 3);
/** 暖机目标/上限 tick 数：跑到编制爬到 harvester 上限为止（见用例内说明）。 */
const WARMUP_MAX = 6000;
const BATCH = 250;
const SAMPLED = 2500;
/** harvester 编制上限 —— 报告用（判据区间以它为上端参照）。 */
const CAP = CONFIG.roles.harvester.maxCount;
/** 最低编制：新欠员判据的轴（`harvesterCount < clamp(minCount, 1, sourceCount)`）。 */
const FLOOR = CONFIG.roles.harvester.minCount;

/** 生存带相位 —— bootstrap/crisis/recovery 都会掐掉战争与扩张授权。 */
const SURVIVAL = new Set(["bootstrap", "crisis", "recovery"]);

interface TickSample {
  tick: number;
  phase: string;
  harvesters: number;
  sources: number;
  srcStallTicks: number;
  bandTicks: number;
  reserve: number;
}

describe("E2E-032 多 source 房相位资格 — #10 回归", () => {
  const runner = new ScenarioRunner();
  const series: TickSample[] = [];
  let errorsSeen = 0;

  beforeAll(async () => {
    const room = developedRoom(HOME, 5);
    // 补 source（坐标避开核心区 17..33 的 extension 与 25,25 的 spawn、10,10 的控制器）。
    // env 可关：MSRC_EXTRA=0 得到同一家具的 2-source 对照组，用来区分「判据缺陷」
    // 与「这间房本来就穷」。
    const extraSlots: Array<[number, number]> = [
      [10, 25],
      [25, 10],
      [40, 25],
    ];
    room.objects!.push(...extraSlots.slice(0, EXTRA_SOURCES).map(([x, y]) => source(x, y)));
    await runner.setup({
      roomName: HOME,
      rooms: [room],
      maxTicks: WARMUP_MAX + SAMPLED + BATCH,
      controllerLevel: 5,
    });
  }, 180000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(`5-source 房在 ${SAMPLED} tick 采样窗里拿得到正常相位（不再被"欠员+最满 source"钉死）`, async () => {
    // 暖机跑到「采集端至少站住最低编制」为止（上限 WARMUP_MAX 兜底）。
    // 判据不要求爬到 maxCount：这间房有贫富两态（实测同一份构建的三次跑法里
    // harvester 峰值分别是 4、4、3），把前提钉在 4 上就会在穷分支里随机拒签；
    // 而"顶格仍算欠员"只是「编制 ≥ 下限而 < source 数」这个区间的特例，
    // 用整个区间当判据既覆盖它、又不赌世界长什么样。
    let warmed = 0;
    let reachedFloor = false;
    while (warmed < WARMUP_MAX && !reachedFloor) {
      const snaps = await runner.runTicks(BATCH);
      warmed += BATCH;
      const rm = snaps.at(-1)?.rawMemory as Record<string, any> | undefined;
      reachedFloor = Number(rm?.rooms?.[HOME]?.phase?.harvesterCount ?? 0) >= FLOOR;
    }
    console.log(`[msrc-evidence] warmup=${warmed} reachedFloor=${reachedFloor}`);

    let tick = 0;
    while (tick < SAMPLED) {
      const snaps = await runner.runTicks(BATCH);
      tick += BATCH;
      errorsSeen += snaps.flatMap(s => s.consoleLogs).filter(isJsError).length;
      for (const snap of snaps) {
        const rm = snap.rawMemory as Record<string, any> | undefined;
        const ph = rm?.rooms?.[HOME]?.phase;
        if (!ph) continue;
        series.push({
          tick: snap.tick,
          phase: String(ph.phase ?? "?"),
          harvesters: Number(ph.harvesterCount ?? -1),
          sources: Number(ph.sourceCount ?? -1),
          srcStallTicks: Number(ph.srcStallTicks ?? -1),
          bandTicks: Number(ph.bandTicks ?? -1),
          reserve: Number(ph.reserve ?? -1),
        });
      }
    }

    const n = series.length;

    const maxHarvesters = Math.max(...series.map(s => s.harvesters));
    const sourcesSeen = Math.max(...series.map(s => s.sources));
    const survival = series.filter(s => SURVIVAL.has(s.phase));
    const survivalShare = survival.length / Math.max(1, n);
    /** 反事实区间：采集端已站住最低编制（新判据下"够员"），但人头数仍小于 source 数
     * （旧判据 `harvesterCount < sourceCount` 在这里一律判欠员 → bootstrap）。
     * 主判据就在这个区间上取"被判 bootstrap 的 tick 数" —— 它同时覆盖了
     * "顶格编制仍算欠员"（cap 只是区间的上端特例），又不要求这间房必须爬到某个特定编制，
     * 所以贫富两态都验得到（实测峰值 4/4/3）。 */
    const staffingWindow = series.filter(s => s.harvesters >= FLOOR && s.harvesters < s.sources);
    const oldPredicateTicks = staffingWindow.filter(s => s.phase === "bootstrap").length;
    // P0-1 通道的驻留计数：≥50 意味着"采集塌方"被当真事发（旧行为里它常驻 8730 tick）。
    const stallHits = series.filter(s => s.srcStallTicks >= 50).length;
    const phaseHist: Record<string, number> = {};
    for (const s of series) phaseHist[s.phase] = (phaseHist[s.phase] ?? 0) + 1;

    console.log(
      `[msrc-evidence] extra=${EXTRA_SOURCES} samples=${n} sources=${sourcesSeen} ` +
        `maxHarvesters=${maxHarvesters}/${CAP} floor=${FLOOR} windowTicks=${staffingWindow.length} ` +
        `oldPredicateTicks=${oldPredicateTicks} stall≥50=${stallHits} ` +
        `survivalShare=${(survivalShare * 100).toFixed(1)}% ` +
        `reserve=${series.at(-1)?.reserve} hist=${JSON.stringify(phaseHist)}`,
    );
    mkdirSync("tmp", { recursive: true });
    writeFileSync(
      resolve("tmp", "msrc32-series.json"),
      JSON.stringify({ samples: series }, null, 0),
    );

    // ── 前提钉（三条，缺一条这条绿就没有意义）：
    //    ① 夹具真有 5 颗 source；② 采集端至少站住最低编制；③ 反事实区间真被走到过。
    expect(
      sourcesSeen,
      `夹具只给出 ${sourcesSeen} 颗 source（期望 ${2 + EXTRA_SOURCES}）—— 前提没成立，本场景在测空房`,
    ).toBe(2 + EXTRA_SOURCES);
    expect(
      maxHarvesters,
      `harvesters 峰值 ${maxHarvesters} < 最低编制 ${FLOOR}：暖机跑满 ${WARMUP_MAX} tick 采集端还没站住人，` +
        `"欠员判据是否脱钩 source 数"这条路径未被走到（结论不可用）`,
    ).toBeGreaterThanOrEqual(FLOOR);
    expect(
      staffingWindow.length,
      `反事实区间（编制 ≥${FLOOR} 且 < source 数）一个 tick 都没出现 —— 判据没被考到，绿无意义` +
        `（maxHarvesters=${maxHarvesters} sources=${sourcesSeen}）`,
    ).toBeGreaterThan(0);

    // ── #10-a：欠员判据不得拿人头数跟 source 数比（旧行为 8730/9000 tick 永久 bootstrap）
    expect(
      oldPredicateTicks,
      `编制已 ≥ 最低编制 ${FLOOR} 却因"人数 < source 数(${sourcesSeen})"被判 bootstrap ` +
        `${oldPredicateTicks} tick（反事实区间共 ${staffingWindow.length} tick）` +
        `—— 判据又跟 source 数挂钩了。\n` +
        `样本=${staffingWindow
          .filter(s => s.phase === "bootstrap")
          .slice(0, 5)
          .map(s => `t${s.tick}:harv=${s.harvesters}`)
          .join(",")}`,
    ).toBe(0);

    // 反常激励的守卫就是上面那条 oldPredicateTicks —— 它已经表达了
    // "bootstrap 只允许出现在真的低于最低编制时"。这里只报告占比，不再当判据：
    // 曾经写的 `bootstrapShare ≤ 5%` 判的是错的东西 —— 一间真缺人的房（实测某次跑法
    // 有 128/2500 tick 只有 0~1 只 harvester，reserve 360）判 bootstrap 是**正确**的，
    // 拿占比设卡等于要求房永不低于编制，那既不是 #10 的主张，也必然随世界贫富随机红。
    // crisis/recovery 占比同理不判（#11 的领地，实测同一构建两次跑法 71.6%↔0%）。
    console.log(
      `[msrc-evidence] bootstrapShare=${(((phaseHist["bootstrap"] ?? 0) / Math.max(1, n)) * 100).toFixed(1)}%`,
    );

    // ── #10-b：srcRatio 平均口径后，"没被派人的那颗 source 满载"不再算塌方
    expect(
      stallHits,
      `srcStallTicks≥50 共 ${stallHits} tick —— 采集塌方通道又被"最满 source"点着了` +
        `（旧行为 8730/9000）。reserve=${series.at(-1)?.reserve}`,
    ).toBe(0);

    expect(errorsSeen, `采样窗内出现 ${errorsSeen} 个 JS 错误`).toBe(0);
  }, 900000);
});
