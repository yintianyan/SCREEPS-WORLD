/**
 * E2E-021 诱饵对抗（Scenario F）— 诱饵不触发授权（R18/W2，Phase 9 验收）。
 *
 * 场景：主房 RCL6+storage+塔（军事可行）；邻房 W1N1 为诱饵——早期情报显示
 * 「敌方无塔空城」（fact），此后不再刷新（威胁短窗 200t 内必然降级 stale）。
 * 同时对主房持续注入 NPC invader（threatWindow 3000t 内保持 threatRecent）
 * → fortify 驻留 5000t → 自然升 war 姿态。
 *
 * 断言（两条契约，刻意分开判）：
 *  ①**授权起点**必须有观测（fact 硬门槛的等价表述：无观测不得立项；有观测时授权是正确行为）。
 *  ②**承诺不得长期越过证据**：立项之后，授权窗口里不得出现成片的零视野样本 ——
 *     实测这条红：warPlan 存续期内完全不复核情报新鲜度，而 `planTimeout`(6000) ≫
 *     `targetFreshness`(1500)，于是"最后一眼"之后还能继续烧 4500 tick 的兵。
 *     修法属军事领域决策（存续期复核节律？planTimeout 上限？），未擅自改 src。
 * 采样口径：授权窗口与视野配对一律逐 tick / 50t 批（授权窗口实测可短至 30~50 tick，
 * 500t 网格会把整段采漏然后绿得毫无意义）；未覆盖窗口显式报 `uncovered=`。
 *
 * 为什么不是原来那句「诱饵永远不得被授权」：那条把"侦察会自然停"当成前提
 * （种子 scout TTL 1500 死掉 → 视野消失 → 情报 stale）。经济一旦健康，AI 会**补孵
 * scout 续住视野**，诱饵就成了货真价实的 fact 目标 —— 此时"绝不授权"是错的断言，
 * 会把正确行为判成缺陷。fact 门槛的语义本来就是"信不信由观测决定"，不是"永远别打那间"。
 * 证据绑定：commit / schemaVersion / 姿态与授权时间线在输出登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CONFIG } from "../../../src/config";
import { ROOM_THREAT_TTL } from "../../../src/domain/intel";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";
import { injectEnemyRoom, injectFriendlyCreep, injectHostile } from "../fixtures/inject";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
const DECOY = "W1N1";

describe("E2E-021 诱饵对抗 — 诱饵不触发授权（Scenario F）", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;
  let warSeen = false;
  let decoyAuthorized = false;
  /** fact 门槛被绕过的次数：对诱饵授权时该楼层零视野 —— 这才是真违规。 */
  let staleAuthorizations = 0;
  let samplesSeen = 0;
  const timeline: string[] = [];

  beforeAll(async () => {
    // 诱饵房：normal 邻房，controller 预置归敌对用户「Enemy」（war 目标形态）。
    const decoyRoom: RoomSetup = {
      name: DECOY,
      terrain: emptyTerrain(),
      objects: [controller(10, 10, 1), source(10, 40), source(40, 10), mineral(40, 40)],
    };
    // 主房军事化：塔（有能量）击杀 invader 保经济不受损——无塔时 invader 杀
    // harvester 触发经济可持续性门（avgPressure/anyRecovery）拦住 war（行为方差
    // 根因）；storage 60k 解除 war 预算门。
    const home = standardRoom(HOME, 300, 6);
    home.objects!.push(
      { type: "tower", x: 20, y: 20, props: { energy: 1000, energyCapacity: 1000 } },
      { type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } },
    );
    await runner.setup({
      roomName: HOME,
      rooms: [home, decoyRoom],
      maxTicks: 9200,
      controllerLevel: 6,
    });
    await injectEnemyRoom(runner, DECOY, "Enemy", 1);
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it("war 姿态下 stale 诱饵情报不触发 warPlan；全程存活", async () => {
    // 经济鲁棒性（回归根因修复）：standardRoom 零 creep 冷启动会经历 bootstrap
    // （understaffed：harvester < 2 source）→ anyRecovery 拦截 fortify→war 门，
    // 且 war 达成后注入间隙的 anyRecovery 闪烁触发 war→fortify 立即降级
    // （posture.ts:163）→ since 重置重走 5000t 驻留。种子满编劳动力（生产角色，
    // 由 bot assignment 接管）跳过冷启动，war 门在场景开始即只依赖真实经济信号。
    // TTL 1500 自然死亡 → 替换走生产 spawn 路径（pendingHarvesters 防替换期假 bootstrap）。
    await injectFriendlyCreep(
      runner,
      HOME,
      11,
      40,
      ["work", "work", "work", "work", "move", "move"],
      "seed-harv-1",
      { role: "harvester", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      40,
      11,
      ["work", "work", "work", "work", "move", "move"],
      "seed-harv-2",
      { role: "harvester", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      26,
      25,
      ["work", "work", "work", "work", "move", "move"],
      "seed-harv-3",
      { role: "harvester", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      25,
      26,
      ["carry", "carry", "carry", "carry", "move", "move", "move", "move"],
      "seed-hauler-1",
      { role: "hauler", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      23,
      30,
      ["carry", "carry", "carry", "move", "move"],
      "seed-dist-1",
      { role: "distributor", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      11,
      11,
      ["work", "work", "work", "carry", "move", "move"],
      "seed-upgr-1",
      { role: "upgrader", home: HOME },
    );

    // 诱饵情报播种（生产路径）：t≈100 放一只 bot scout 进诱饵房 → 房间可见
    // → refreshNeighborIntel 带视野采集（owner=Enemy, towers=0, towers 字段
    // 触发威胁短窗 TTL 200t）。scout TTL 1500 自然死亡 → 视野消失 → 情报
    // 停在最后一次观测 → 决策时点（war 达成后）必然 stale（非 fact）。
    await injectFriendlyCreep(runner, DECOY, 25, 25, ["move"], "scout-decoy", {
      role: "scout",
      home: HOME,
      remoteTarget: DECOY,
    });

    // 采样密度：授权窗口实测可短至 30~50 tick（#22/#23 的逐 tick 序列量出来的），而本场景
    // 原先按 500t 网格采样 —— 一整段"对诱饵授权"可以被完整采漏，然后绿得毫无意义。
    // t<4500 仍用 500t（那会儿还没到 war 时点，省往返），之后收到 50t：任何 ≥50t 的授权
    // 窗口至少撞上一次同 tick 视野配对；更短的窗口由逐 tick 序列登记为未覆盖并打 WARN。
    let tick = 0;
    let invaderSeq = 0;
    let lastInject = -1000;
    /** 逐 tick 的 warPlan 目标（rawMemory 自带，零额外往返）—— 用来量授权窗口的真实宽度。
     * lostAge = 门自己判定的情报断供年龄（-1 = 该 tick 有据）。 */
    const targetTicks: Array<{ tick: number; tgt?: string; lostAge: number }> = [];
    const probeTicks: number[] = [];
    /** 与 target=DECOY 配对的同 tick 视野读数（授权合法性 = 该 tick 有没有人看着）。 */
    const probeVision: Array<{ tick: number; vis: number }> = [];
    while (tick < 9000) {
      const batch = tick < 4500 ? 500 : 50;
      // 高频再注入：塔击杀保经济，目击刷新 lastHostileAt 维持 threatRecent——
      // 「反复试探性攻击维持战争姿态」是生产语义。加密采样后仍按 ~500t 节奏注入，
      // 否则等于把入侵强度调高 10 倍，场景就不是原来那个场景了。
      if (tick >= 200 && tick <= 6000 && tick - lastInject >= 500) {
        lastInject = tick;
        await injectHostile(
          runner,
          HOME,
          35,
          35,
          ["attack", "move"],
          `invader-${invaderSeq++}`,
          "invader",
        );
      }

      // war 门三条件探针：colonyState（anyRecovery）/ economyPressure（压力门）/
      // since（驻留基准）/ phase.phase（闪烁溯源：bootstrap vs crisis 带）。
      // economyPressure 在 RoomMemory 顶层（room-state.ts 每 tick 写入，
      // phase 子对象无此字段——上一版探针读错路径导致 p=undefined 假象）。
      // 同一 tick 同时取「诱饵房内我方 creep 数」与 warPlan 目标 —— 授权合法性必须在
      // 同一份快照里配对判定，分开取会因相位差误判（见头注释）。
      await runner.bot.sendConsole(
        `var v=0; for (var cn in Game.creeps) { if (Game.creeps[cn].room && Game.creeps[cn].room.name === "${
          DECOY
        }") v++; }` +
          `console.log("DECOYAUTH t=" + Game.time + " vis=" + v + " target=" + (Memory.kernel.warPlan ? Memory.kernel.warPlan.targetRoom : "-"));`,
      );
      await runner.bot.sendConsole(
        'console.log("PROBE t=" + Game.time + " cs=" + Memory.rooms["W0N1"].colonyState + ' +
          '" ph=" + Memory.rooms["W0N1"].phase?.phase + ' +
          '" p=" + Memory.rooms["W0N1"].economyPressure + ' +
          '" since=" + Memory.kernel.strategy?.since + " post=" + Memory.kernel.strategy?.posture)',
      );
      const snaps = await runner.runTicks(batch);
      tick += batch;
      const last = snaps.at(-1)!;
      errorsSeen += snaps.flatMap(s => s.consoleLogs).filter(isJsError).length;
      for (const l of snaps.flatMap(s => s.consoleLogs)) {
        if (l.includes("PROBE t=")) timeline.push(l.replace(/^.*PROBE /, "PROBE "));
      }
      // 同 tick 配对：DECOYAUTH 行与它所在快照的 rawMemory 是同一份状态。
      for (const snap of snaps) {
        const rm = snap.rawMemory as Record<string, any> | undefined;
        // `warIntelLost` 是 war-planner 自己盖的章：只有当授权谓词（fact + targetFreshness）
        // 判 false 那一轮才写。用它的年龄当"盲区"口径，量的是**门的裁决**；
        // 而 vis=0 量的是"探针采样的那一 tick 有没有人站在房里" —— 两者不等价：
        // 情报按 room-observer 的 50t 扫描 tick 前移 lastSeen，探针网格与它相位不同，
        // 完全可能"我看见没人、门却判定有据"。契约②必须按前者判，否则红的是探针口径。
        const tgt = rm?.kernel?.warPlan?.targetRoom as string | undefined;
        const lost = rm?.kernel?.warIntelLost as { room: string; since: number } | undefined;
        targetTicks.push({
          tick: snap.tick,
          tgt,
          lostAge: lost && lost.room === tgt ? snap.tick - Number(lost.since) : -1,
        });
        if (rm?.kernel?.strategy?.posture === "war") warSeen = true;
        const line = snap.consoleLogs
          .map(x => (x.includes("&#x22;") ? x.replace(/&#x22;/g, '"') : x))
          .find(x => x.includes("DECOYAUTH t="));
        if (!line) continue;
        const mVis = line.match(/vis=(\d+)/);
        const mTgt = line.match(/target=(\S+)/);
        if (!mVis || !mTgt) continue;
        const vis = Number(mVis[1]);
        const target = mTgt[1];
        samplesSeen++;
        if (target === DECOY) {
          decoyAuthorized = true;
          probeTicks.push(snap.tick);
          probeVision.push({ tick: snap.tick, vis });
          if (vis === 0) {
            staleAuthorizations++;
            timeline.push(`VIOLATION@${snap.tick}: 对 ${DECOY} 授权但该楼层零视野`);
          } else {
            timeline.push(`OBSERVED@${snap.tick}: ${DECOY} 授权时有 ${vis} 只我方 creep 在场`);
          }
        }
      }
      const mem = await runner.bot.getMemory();
      const posture = mem?.kernel?.strategy?.posture;
      const warPlan = mem?.kernel?.warPlan;
      if (posture === "war") warSeen = true;
      if (warPlan && warPlan.targetRoom === DECOY) decoyAuthorized = true;
      timeline.push(
        `t${last.tick}:${posture ?? "?"}${warPlan ? `(plan→${warPlan.targetRoom})` : ""}`,
      );
    }

    // 授权窗口 = 逐 tick 序列里 targetRoom===DECOY 的连续段；covered = 段内是否撞上一次
    // 同 tick 视野配对。未覆盖段必须显式登记：绿不等于验过，采样网格漏掉的窗口里
    // 完全可能藏着一段零视野授权。
    const decoyWindows: Array<{ from: number; to: number; covered: boolean }> = [];
    for (let i = 0; i < targetTicks.length; i++) {
      if (targetTicks[i]!.tgt !== DECOY) continue;
      let j = i;
      while (j + 1 < targetTicks.length && targetTicks[j + 1]!.tgt === DECOY) j++;
      decoyWindows.push({
        from: targetTicks[i]!.tick,
        to: targetTicks[j]!.tick,
        covered: probeTicks.some(p => p >= targetTicks[i]!.tick && p <= targetTicks[j]!.tick),
      });
      i = j;
    }
    const uncovered = decoyWindows.filter(w => !w.covered);
    // 两条不同的契约，必须分开判（原先一条断言把它们混成一句话，红起来指错地方）：
    //  ①**授权门槛**（本场景的标题）：一个授权窗口的**起点**必须有观测 —— fact 硬门槛。
    //  ②**承诺不得越过证据**（原 task #12 缺陷，已修）：窗口存续期间可以因为通勤而瞬时
    //     零视野，但长期零视野还在打 = 计划在自己证据过期之后继续烧命。修前实测窗口起点
    //     t3901 授权合法，而 t6302 起连续 54 个同 tick 样本零视野仍在授权
    //     （`CONFIG.war.planTimeout`=6000 ≫ `targetFreshness`=1500，且计划存续期内
    //     完全不复核情报新鲜度 → 中间 4500 tick 是"没人看见却继续打"）。
    //     修后判据从"零视野样本数=0"换成**可证伪的长度上界**：单个授权窗口内最长的
    //     连续零视野段不得超过 planIntelBlackoutTicks（停补员是即时的，撤军给一个新鲜度
    //     周期的容忍），再加两段观测盲区补偿 —— 采样网格（相邻样本的 tick 差）与
    //     ROOM_THREAT_TTL（授权谓词本身允许 200 tick 前的目击仍算 fact）。
    //     注意"零视野"是本探针的口径（该 tick 房内无我方 creep），比 intel 的"无视野"严：
    //     盲刷不前移 lastSeen（domain/intel.ts 的无视野分支），所以两者不会互相掩盖。
    const staleStarts: number[] = [];
    let unobservedSamples = 0;
    let maxBlindRun = 0;
    let blindRunWhere = "-";
    let gridMax = 0;
    for (const w of decoyWindows) {
      const inside = probeVision
        .filter(s => s.tick >= w.from - 50 && s.tick <= (w.covered ? w.to : w.from + 50))
        .sort((a, b) => a.tick - b.tick);
      if (!inside.length) continue; // 未覆盖窗口不猜测，另列 uncovered
      if (inside[0]!.vis === 0) staleStarts.push(inside[0]!.tick);
      unobservedSamples += inside.filter(s => s.vis === 0).length;

      // 最长连续零视野段（tick 口径）：零样本段从前一个样本起、到下一个有视野样本止，
      // 窗口在段内结束就用窗口终点。
      let runStart: number | undefined;
      let runEnd = w.from;
      let prev = w.from;
      for (const s of inside) {
        if (inside.length > 1) gridMax = Math.max(gridMax, s.tick - prev);
        if (s.vis === 0) {
          if (runStart === undefined) runStart = prev;
          runEnd = s.tick;
        } else if (runStart !== undefined) {
          if (runEnd - runStart > maxBlindRun) {
            maxBlindRun = runEnd - runStart;
            blindRunWhere = `t${runStart}..${runEnd}`;
          }
          runStart = undefined;
        }
        prev = s.tick;
      }
      if (runStart !== undefined && Math.min(w.to, prev) - runStart > maxBlindRun) {
        maxBlindRun = Math.min(w.to, prev) - runStart;
        blindRunWhere = `t${runStart}..${Math.min(w.to, prev)}(窗口末)`;
      }
    }
    const blindRunCap = CONFIG.war.planIntelBlackoutTicks + gridMax + ROOM_THREAT_TTL;

    // ── 契约②的**主判据**：门自己裁决的连续断供长度（逐 tick 的 warIntelLost 年龄）。
    // 上面那套 vis=0 口径只能当旁证：情报的 lastSeen 按 room-observer 的 50t 扫描 tick
    // 前移，与本探针的 50t 网格相位不同，于是"探针看见没人"与"门判定有据"可以同时成立 ——
    // 那种时候该修的是判据口径，不是门。
    // 上界 = 容忍窗口 + 规划器间隔（war-planner 每 CONFIG.war.interval tick 跑一轮，
    // 判定与撤军都发生在轮次边界上）。
    let maxLostRun = 0;
    let lostRunWhere = "-";
    {
      let runStart: number | undefined;
      let runEnd = 0;
      for (const s of targetTicks) {
        if (s.tgt === DECOY && s.lostAge >= 0) {
          if (runStart === undefined) runStart = s.tick;
          runEnd = s.tick;
        } else if (runStart !== undefined) {
          if (runEnd - runStart > maxLostRun) {
            maxLostRun = runEnd - runStart;
            lostRunWhere = `t${runStart}..${runEnd}`;
          }
          runStart = undefined;
        }
      }
      if (runStart !== undefined && runEnd - runStart > maxLostRun) {
        maxLostRun = runEnd - runStart;
        lostRunWhere = `t${runStart}..${runEnd}(窗末)`;
      }
    }
    const lostRunCap = CONFIG.war.planIntelBlackoutTicks + 2 * CONFIG.war.interval;

    // ── 证据登记 ──
    console.log(`[soak-evidence] decoy probes: ${timeline.slice(-6).join(" | ")}`);
    console.log(
      `[soak-evidence] decoy: warSeen=${warSeen} decoyAuthorized=${decoyAuthorized} jsErrors=${errorsSeen}`,
    );
    console.log(
      `[soak-evidence] decoy binding: schemaVersion=${CONFIG.memory.schemaVersion} gcl=1 collectedAt=${new Date().toISOString()}`,
    );

    // ── 断言 ──
    // war 姿态自然达成（fortify 驻留 5000t + 威胁未消 → war）。
    expect(
      warSeen,
      `8000 tick 内未达成 war 姿态（fortify 驻留 + 威胁维持应升 war）：\n${timeline.join(", ")}`,
    ).toBe(true);
    // 契约①（本场景的标题）：**授权起点**必须是观测支持的。这才是 fact 硬门槛的原意 ——
    // 判据取窗口起点的第一次同 tick 配对，不取窗口全程（全程判据把②混进来，红起来指错原因）。
    expect(
      staleStarts,
      `诱饵授权窗口的起点就零视野 ${staleStarts.join(",")} —— fact 硬门槛被绕过！\n${timeline.slice(-8).join(", ")}`,
    ).toEqual([]);
    // 契约②（task #12 已修）：承诺不得长期越过证据。**按门自己的裁决判** ——
    // warIntelLost 只在授权谓词（fact + targetFreshness）判 false 的那些轮次盖章，
    // 所以它的连续年龄越过 blackout 容忍还不撤军，才是"复核门失效"。
    // 探针的 vis=0 口径退为旁证（见上面的注释：两种口径可以合法地不一致）。
    expect(
      maxLostRun,
      `门判定断供后连续 ${maxLostRun} tick 仍在授权（${lostRunWhere}），越过上界 ${lostRunCap} ` +
        `= planIntelBlackoutTicks(${CONFIG.war.planIntelBlackoutTicks}) + 2×war.interval —— ` +
        `复核门失效或被调宽。\n授权窗口=${decoyWindows.map(w => `t${w.from}..${w.to}`).join(",")}` +
        `\n（窗口起点都有观测 → 不是 fact 门槛被绕过，是"承诺存续期内不复核情报"）`,
    ).toBeLessThanOrEqual(lostRunCap);
    if (maxBlindRun > lostRunCap) {
      // 探针口径的盲区长于门的上界 —— 不一定违规（情报按 50t 扫描 tick 前移，本探针
      // 网格相位不同），但必须打在证据里，因为它意味着"房内无人"的时长已值得再看一眼。
      console.log(
        `[soak-evidence] WARN decoy vision-only blind run ${maxBlindRun}@${blindRunWhere} ` +
          `> ${lostRunCap}（门裁决的断供长度=${maxLostRun}@${lostRunWhere}）`,
      );
    }
    console.log(
      `[soak-evidence] decoy blind-run audit: maxLostRun=${maxLostRun}@${lostRunWhere} ` +
        `cap=${lostRunCap} maxBlindRun=${maxBlindRun}@${blindRunWhere} visCap=${blindRunCap} ` +
        `unobservedSamples=${unobservedSamples} windows=${decoyWindows.length}`,
    );
    // 契约②是上界判据（≤cap）⇒ maxLostRun=0 时它**没有输入**，绿不代表分支被覆盖。
    // 实测对照：同一提交下 CPU 天花板不同，这个读数就在 0 与 849 之间整段搬家 ——
    // 借用开启后 room-observer 不再每 tick 被拒，intel 根本不断供。所以这里必须
    // 把"本轮不可证伪"打在证据里，否则会把"没触发"读成"通过"（同类坑第四次）。
    if (maxLostRun === 0) {
      console.log(
        `[soak-evidence] WARN 契约②本轮不可证伪：门判定的断供长度 maxLostRun=0` +
          `（探针盲样=${unobservedSamples}）—— intel 全程未断供，"断供后按期撤军"分支` +
          `未被 e2e 覆盖，守卫只剩 war-planner 单测 R5。`,
      );
    }
    console.log(
      `[soak-evidence] decoy audit: samples=${samplesSeen} targetedDecoy=${decoyAuthorized} ` +
        `staleAuthorizations=${staleAuthorizations} staleStarts=${staleStarts.length} ` +
        `unobservedSamples=${unobservedSamples} decoyWindows=${decoyWindows.length} ` +
        `uncovered=${uncovered.length}${
          uncovered.length
            ? ` (${uncovered.map(w => `t${w.from}..${w.to}`).join(",")} 无同 tick 视野配对)`
            : ""
        }`,
    );
    // 全程无 JS 错误。
    expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);
  }, 1200000);
});
