/**
 * E2E-026 site quota 极限注入 — CANARY：创建闸门 + 记账一致性。
 * 双房 buildQueue 各预置 20 个 queued 任务（远超配额）→ construction-manager 消费 → 量测：
 *   1. normal 道止步于每房配额（闸门真的生效）；
 *   2. 引擎真实 site 总数不超过设计承诺的上界；
 *   3. `buildQueue` 的 "site" 记账与引擎真实 site 数在**同一次求值**里对得上。
 *
 * 此处原本的断言是「总 site 数 ≤ maxNormalLaneSites」，实测越限 9~10。查清后判定**该断言本身错**：
 * `maxNormalLaneSites` 是 normal / development-lane 两道的**创建闸门**
 * （`evaluateDevelopmentGate` / `evaluateDevelopmentLane` 的 `global-site-cap` 原因码），
 * 不是总量不变量。critical(tower/spawn)、storage、source container 各走**独立每房配额**
 * （`tryCreateSite` 分道计额），配置注释把 critical 明写作每房"**额外**允许的关键 site 数"，
 * emergency 道更完全不查全局帽（`construction-manager.ts:115`）。
 * 所以上界是 `maxNormalLaneSites + 房数 × 额外道数`，越出它才是真缺陷。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CONFIG } from "../../../src/config";
import { ScenarioRunner } from "../framework";
import { t0Base } from "../fixtures/base";
import { isJsError } from "../../support/errors";
import { parsePipe } from "../framework/CpuProbe";

/** 与 CONFIG.construction 同值（测试侧重复常量是为了失败信息直接可读，不引入 src 依赖）。 */
const MAX_GLOBAL_SITES = 7;
const MAX_NORMAL_SITES_PER_ROOM = 3;
/** 每房可叠在 normal 配额之外的独立道：critical(tower/spawn) + storage + source container。 */
const EXTRA_LANES_PER_ROOM = 3;
const ROOMS = ["W0N1", "W0N2"];

/** `type:n,type:n` → 计数表。 */
function parseTypes(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const idx = pair.lastIndexOf(":");
    if (idx <= 0) continue;
    const n = Number(pair.slice(idx + 1));
    if (Number.isFinite(n)) out[pair.slice(0, idx)] = n;
  }
  return out;
}

describe("E2E-026 site quota 极限注入", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [t0Base("W0N1"), t0Base("W0N2")],
      maxTicks: 3200,
      controllerLevel: 5,
      ownedRooms: [{ name: "W0N2", level: 4 }],
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it("over-quota 注入 → normal 道止步、总数不越设计上界、队列记账与引擎同 tick 一致", async () => {
    const mkQueue = (room: string) =>
      JSON.stringify(
        Array.from({ length: 20 }, (_, i) => ({
          key: `ext.q${i}.${room}`,
          pos: { x: 20 + (i % 5) * 2, y: 20 + Math.floor(i / 5) * 2, roomName: room },
          structureType: "extension",
          priority: 2,
          state: "queued",
          attempts: 0,
          retryAt: 0,
          queuedAt: 0,
        })),
      );
    for (const room of ROOMS) {
      await runner.bot.sendConsole(
        `Memory.rooms["${room}"].buildQueue = ${mkQueue(room)}; console.log("QSEEDED ${room}=" + Memory.rooms["${room}"].buildQueue.length)`,
      );
    }

    // 引擎真实 site（按类型）与队列 "site" 记账必须在同一次求值里取：分两处取会带上
    // 批首/批末的相位差，那时 10 vs 8 的背离判不出是记账漂移还是采样时刻不同（实测踩过）。
    const probe = `(function(){
      var byType = {}, e = 0, queued = 0, keys = [];
      for (var rn in Game.rooms) {
        var rs = Game.rooms[rn];
        if (!rs.controller || !rs.controller.my) continue;
        var found = rs.find(FIND_CONSTRUCTION_SITES) || [];
        for (var i = 0; i < found.length; i++) {
          e++;
          var ty = found[i].structureType || "?";
          byType[ty] = (byType[ty] || 0) + 1;
        }
        var q = (Memory.rooms[rn] && Memory.rooms[rn].buildQueue) || [];
        for (var j = 0; j < q.length; j++) {
          if (q[j] && q[j].state === "site") {
            queued++;
            keys.push(rn + ':' + q[j].key + ':' + q[j].structureType + ':' + q[j].pos.x + '.' + q[j].pos.y);
          }
        }
      }
      var t = ''; for (var k in byType) t += (t ? ',' : '') + k + ':' + byType[k];
      console.log('SITEQ|engine=' + e + '|queued=' + queued + '|types=' + t + '|qkeys=' + keys.join(';'));
      // 探针同时给出「site 任务占据的位置」集合：两条任务指向同一格时引擎只有 1 个 site，
      // 按任务条数比就会把重复任务误判成"状态没迁移"（实测 ext.q17 与 planner 自己的
      // constraint.extension.24.26 撞在同一格）。位置口径才是记账一致性的真判据。
      var pos = {};
      for (var rn2 in Game.rooms) {
        var rs2 = Game.rooms[rn2];
        if (!rs2.controller || !rs2.controller.my) continue;
        var found2 = rs2.find(FIND_CONSTRUCTION_SITES) || [];
        for (var m = 0; m < found2.length; m++) pos[rn2 + ':' + found2[m].pos.x + '.' + found2[m].pos.y] = 1;
      }
      var ps = ''; for (var pk in pos) ps += (ps ? ',' : '') + pk;
      console.log('SITEP|pos=' + ps);
    })();`;

    let maxEngine = 0;
    let maxQueued = 0;
    let maxGap = 0;
    let maxExtension = 0;
    let worstDump = "";
    let maxPosGap = 0;
    let dupSites = 0;
    for (let i = 0; i < 6; i++) {
      await runner.bot.sendConsole(probe);
      const snaps = await runner.runTicks(500);
      errorsSeen += snaps.flatMap(s => s.consoleLogs).filter(isJsError).length;
      // 探针在 runTicks 前下发 → 输出落在本批第一个快照，所以扫全批。
      for (const snap of snaps) {
        // 探针输出 SITEQ / SITEP 两行、同一次求值同 tick，按出现顺序配对。
        let lastKeys: string[] = [];
        for (const line of snap.consoleLogs) {
          const text = line.includes("&#x22;") ? line.replace(/&#x22;/g, '"') : line;
          const pidx = text.indexOf("SITEP|");
          if (pidx >= 0) {
            const recP = parsePipe(text.slice(pidx + "SITEP|".length));
            const enginePos = new Set((recP.pos ?? "").split(",").filter(Boolean));
            const taskPos = lastKeys.map(k => {
              const parts = k.split(":");
              return `${parts[0]}:${parts[3]}`;
            });
            const unique = new Set(taskPos);
            maxPosGap = Math.max(maxPosGap, Math.abs(enginePos.size - unique.size));
            dupSites = Math.max(dupSites, taskPos.length - unique.size);
            continue;
          }
          const idx = text.indexOf("SITEQ|");
          if (idx < 0) continue;
          const rec = parsePipe(text.slice(idx + "SITEQ|".length));
          const engine = Number(rec.engine ?? 0) || 0;
          const keys = (rec.qkeys ?? "").split(";").filter(Boolean);
          lastKeys = keys;
          const queued = Number(rec.queued ?? 0) || 0;
          maxGap = Math.max(maxGap, Math.abs(engine - queued));
          maxQueued = Math.max(maxQueued, queued);
          maxExtension = Math.max(maxExtension, parseTypes(rec.types).extension ?? 0);
          if (engine > maxEngine) {
            maxEngine = engine;
            worstDump = `types=${rec.types ?? ""} qkeys=${rec.qkeys ?? ""}`;
          }
        }
      }
    }

    const bound = MAX_GLOBAL_SITES + ROOMS.length * EXTRA_LANES_PER_ROOM;
    console.log(
      `[soak-evidence] site-quota: maxEngineSites=${maxEngine} maxQueueSiteEntries=${maxQueued} ` +
        `sameTickGap=${maxGap} posGap=${maxPosGap} dupPositionTasks=${dupSites} extensionSites=${maxExtension} cap=${MAX_GLOBAL_SITES} bound=${bound} ` +
        `jsErrors=${errorsSeen} collectedAt=${new Date().toISOString()}`,
    );
    console.log(
      `[soak-evidence] site-quota binding: schemaVersion=${CONFIG.memory.schemaVersion} rooms=${ROOMS.join("+")}`,
    );
    console.log(`[soak-evidence] site-quota worst engine view: ${worstDump}`);

    expect(maxEngine, `引擎 site 总数越出设计上限 ${bound}`).toBeLessThanOrEqual(bound);
    // 注入的 20×2 全是 extension（normal 道）——它们必须被每房配额挡住。
    expect(
      maxExtension,
      `extension site 越过每房 normal 配额 ${MAX_NORMAL_SITES_PER_ROOM}×${ROOMS.length} —— 创建闸门失效`,
    ).toBeLessThanOrEqual(MAX_NORMAL_SITES_PER_ROOM * ROOMS.length);
    // 位置口径：引擎 site 数 == 队列 "site" 任务占据的**不同**格子数。
    expect(maxPosGap, `队列 site 记账与引擎真实 site 位置数背离（gap=${maxPosGap}）`).toBe(0);
    // 任务条数口径只观测不判：同格重复任务会让它天然偏大（见 SITEP 注释）。
    if (dupSites > 0) {
      console.log(
        `[soak-evidence] site-quota WARN: ${dupSites} 条 site 任务与他人重复占同一格 —— ` +
          "不丢 site 但会虚高记账，去重缺口另立议题",
      );
    }
    expect(errorsSeen).toBe(0);
  }, 900000);
});
