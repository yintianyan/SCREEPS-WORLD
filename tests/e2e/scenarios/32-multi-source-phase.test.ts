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
/** 暖机：让编制爬到 harvester 上限（否则测的是一间还没人的房）。 */
const WARMUP = 1500;
const BATCH = 250;
const SAMPLED = 2500;

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
      maxTicks: WARMUP + SAMPLED + BATCH,
      controllerLevel: 5,
    });
  }, 180000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(`5-source 房在 ${SAMPLED} tick 采样窗里拿得到正常相位（不再被"欠员+最满 source"钉死）`, async () => {
    await runner.runTicks(WARMUP);

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
    const cap = CONFIG.roles.harvester.maxCount;
    const maxHarvesters = Math.max(...series.map(s => s.harvesters));
    const sourcesSeen = Math.max(...series.map(s => s.sources));
    const survival = series.filter(s => SURVIVAL.has(s.phase));
    const survivalShare = survival.length / Math.max(1, n);
    /** 本场景的主判据：编制已顶到上限却仍被判「欠员 → bootstrap」的 tick 数。
     * 这是 #10-a 那条判据唯一能单独产生的症状 —— 房穷不穷（crisis/recovery）归 #11，
     * 不该混进来，否则这条断言会被真实经济吸走、变成测不出任何东西的比例游戏。 */
    const cappedBootstrap = series.filter(
      s => s.harvesters >= cap && s.phase === "bootstrap",
    ).length;
    // P0-1 通道的驻留计数：≥50 意味着"采集塌方"被当真事发（旧行为里它常驻 8730 tick）。
    const stallHits = series.filter(s => s.srcStallTicks >= 50).length;
    const phaseHist: Record<string, number> = {};
    for (const s of series) phaseHist[s.phase] = (phaseHist[s.phase] ?? 0) + 1;

    console.log(
      `[msrc-evidence] extra=${EXTRA_SOURCES} samples=${n} sources=${sourcesSeen} ` +
        `maxHarvesters=${maxHarvesters}/${cap} cappedBootstrap=${cappedBootstrap} ` +
        `stall≥50=${stallHits} survivalShare=${(survivalShare * 100).toFixed(1)}% ` +
        `reserve=${series.at(-1)?.reserve} hist=${JSON.stringify(phaseHist)}`,
    );
    mkdirSync("tmp", { recursive: true });
    writeFileSync(
      resolve("tmp", "msrc32-series.json"),
      JSON.stringify({ samples: series }, null, 0),
    );

    // ── 前提：夹具与暖机都得先把"这确实是一间 5-source 且编制孵到顶的房"钉住，
    //    否则后面的绿可能只是"还没长成人，所以没人欠员"。
    expect(
      sourcesSeen,
      `夹具只给出 ${sourcesSeen} 颗 source（期望 ${2 + EXTRA_SOURCES}）—— 前提没成立，本场景在测空房`,
    ).toBe(2 + EXTRA_SOURCES);
    expect(
      maxHarvesters,
      `harvesters 峰值 ${maxHarvesters} < 编制上限 ${cap}：暖机 ${WARMUP} tick 没让编制爬到顶，` +
        `"顶格仍算欠员"这条路径未被走到（结论不可用）`,
    ).toBeGreaterThanOrEqual(cap);

    // ── #10-a：欠员判据不得因 source 数 > 编制上限而永久成立（旧行为 8730/9000 tick）
    expect(
      cappedBootstrap,
      `编制顶到 ${maxHarvesters}/${cap} 却仍被判 bootstrap 共 ${cappedBootstrap} tick ` +
        `—— 判据又拿人头数跟 source 数比了（source=${sourcesSeen} > cap=${cap} 时该判据永久成立）。\n` +
        `样本=${series
          .filter(s => s.harvesters >= cap && s.phase === "bootstrap")
          .slice(0, 5)
          .map(s => `t${s.tick}`)
          .join(",")}`,
    ).toBe(0);

    // ── 反常激励守卫：source 更多的房不得比 source 更少的房更难拿到正常相位。
    // 修法前实测：2-source 房 growth 2500/2500，同一夹具补到 5-source 后
    // bootstrap 2489/2500（99.6%）；只按编制上限截断也修不掉（bootstrap 2489 依旧）。
    // 现在按最低编制判，实测 bootstrap 31/2500（1.2%）。
    // 注意判据只看 bootstrap —— crisis/recovery 是这间房的真实经济（#11 的领地），
    // 把它一起算进来就会让这条断言被经济噪声吸走、再也测不到判据本身。
    // **实测佐证（同一份 dist 连跑两次，extra=3）**：一次 hist=
    // {growth:690, crisis:885, recovery:894, bootstrap:31}（survivalShare 72.4%，reserve 2100），
    // 一次 {growth:2500}（0%，reserve 6947）—— 危机/恢复占比本身在刀背上跳，
    // 所以绝不要把这条断言改成 survivalShare 口径（那只会让它随机红，且测不到 #10）。
    const bootstrapShare = (phaseHist["bootstrap"] ?? 0) / Math.max(1, n);
    expect(
      bootstrapShare,
      `5-source 房有 ${(bootstrapShare * 100).toFixed(1)}% 的 tick 停在 bootstrap` +
        `（hist=${JSON.stringify(phaseHist)}）—— 反常激励回来了：同一夹具 2-source 时是 0%`,
    ).toBeLessThanOrEqual(0.05);

    // ── #10-b：srcRatio 平均口径后，"没被派人的那颗 source 满载"不再算塌方
    expect(
      stallHits,
      `srcStallTicks≥50 共 ${stallHits} tick —— 采集塌方通道又被"最满 source"点着了` +
        `（旧行为 8730/9000）。reserve=${series.at(-1)?.reserve}`,
    ).toBe(0);

    expect(errorsSeen, `采样窗内出现 ${errorsSeen} 个 JS 错误`).toBe(0);
  }, 900000);
});
