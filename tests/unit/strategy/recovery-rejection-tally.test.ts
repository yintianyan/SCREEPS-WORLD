/**
 * #105 — 恢复动作被拒的持久留痕。
 *
 * 立案依据（读码，非事故）：`recoveryActionTable` 与 `attempts/maxAttempts` 都住 heap
 * ⇒ 每次部署归零，所以"某类动作一直被判拒"这种结构性失效在本仓读数里从不显形。
 * 这一族里最值得看的那条**是故意的**：`GLOBAL_ROOM` 的动作被显式跳过（文件头注释：
 * "不能默认买/建/孵"），而物流/网络/健康维度这三类失败节点都不带房名 ⇒ 它们的动作
 * 按构造全部走跳过分支。设计越合理，没有读数就越查不到 —— 本表就是为了能读到它。
 *
 * ⚠️覆盖边界（写清楚，不假装）：本文件测的是 `recordRecoveryRejection` 这条**写入路径本身**。
 * 调用点在 `recovery-execution-system.run()` 的拒绝分支里，而该文件没有系统级夹具
 * （同 `recovery-record-room-source.test.ts` 的坦白）⇒ **接线只能靠线上读数复核**：
 * 上线后 `Memory.kernel.stats.recoveryRejections` 里若出现 `*:non_retryable` 且
 * `lastReason` 含 "global"，就同时证明了接线与那条按构造的跳过分支在真实运行里被走到。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { recordRecoveryRejection } from "../../../src/systems/room/recovery-execution-system";
import type { RecoveryAction } from "../../../src/domain/strategy/recovery-priority";
import { resetGlobals } from "../../support/factories";

const TICK = 8_340_200;
const G = () => globalThis as any;

/** 真实的动作类型之一；用断言而非 string，保证键的形状与生产一致。 */
const TYPE = "ENERGY_REDIRECT" as RecoveryAction["type"];

function tally(): Record<string, { count: number; lastAt: number; lastReason: string }> {
  return G().Memory.kernel.stats.recoveryRejections;
}

beforeEach(() => {
  resetGlobals();
  G().Memory.kernel = { stats: {} };
});

describe("#105 写入路径", () => {
  it("首次被拒建表并计 1，带上 tick 与 reason", () => {
    recordRecoveryRejection(TYPE, "non_retryable", "room memory not found: global", TICK);

    expect(tally()["ENERGY_REDIRECT:non_retryable"]).toEqual({
      count: 1,
      lastAt: TICK,
      lastReason: "room memory not found: global",
    });
  });

  it("同型同分类累加、异型或异分类分键（key = type:classification）", () => {
    recordRecoveryRejection(TYPE, "non_retryable", "room memory not found: global", TICK);
    recordRecoveryRejection(TYPE, "non_retryable", "room memory not found: global", TICK + 1);
    recordRecoveryRejection(TYPE, "blocked", "cpu tier conserve", TICK + 2);
    recordRecoveryRejection(
      "TERMINAL_TRADE" as RecoveryAction["type"],
      "non_retryable",
      "x",
      TICK + 3,
    );

    const keys = Object.keys(tally()).sort();
    expect(keys).toEqual([
      "ENERGY_REDIRECT:blocked",
      "ENERGY_REDIRECT:non_retryable",
      "TERMINAL_TRADE:non_retryable",
    ]);
    expect(tally()).toMatchObject({ "ENERGY_REDIRECT:non_retryable": { count: 2 } });
    // lastAt/lastReason 记最近一次（这是"还在发生吗"的判别量，不是首次发生）
    expect(tally()["ENERGY_REDIRECT:blocked"]).toEqual({
      count: 1,
      lastAt: TICK + 2,
      lastReason: "cpu tier conserve",
    });
  });

  it("长 reason 截到 120 字符（防自由文本把 Memory 撑肥）", () => {
    const long = "n".repeat(400);
    recordRecoveryRejection(TYPE, "retryable", long, TICK);

    expect(tally()).toMatchObject({
      "ENERGY_REDIRECT:retryable": { lastReason: "n".repeat(120) },
    });
  });
});

describe("#105 已有形状与缺失守卫（键迁移那一族的两个坑）", () => {
  it("表已存在时不吞旧条目：异键并存、同键 +1", () => {
    G().Memory.kernel.stats.recoveryRejections = {
      "SPAWN_RECOVERY:non_retryable": { count: 7, lastAt: 1, lastReason: "历史拒因" },
    };

    recordRecoveryRejection(TYPE, "non_retryable", "room memory not found: global", TICK);
    recordRecoveryRejection(
      "SPAWN_RECOVERY" as RecoveryAction["type"],
      "non_retryable",
      "y",
      TICK + 1,
    );

    // 老条目既没被 ??= 重建覆盖，也没被同键写入以外的操作改动
    expect(tally()["SPAWN_RECOVERY:non_retryable"]).toEqual({
      count: 8,
      lastAt: TICK + 1,
      lastReason: "y",
    });
    expect(tally()).toMatchObject({ "ENERGY_REDIRECT:non_retryable": { count: 1 } });
  });

  it("`kernel` 或 `stats` 缺席时静默不抛、也不替 kernel 建壳", () => {
    G().Memory.kernel = {};
    expect(() => recordRecoveryRejection(TYPE, "blocked", "x", TICK)).not.toThrow();
    expect(G().Memory.kernel.stats).toBeUndefined();
    expect(G().Memory.kernel.recoveryRejections).toBeUndefined();

    delete G().Memory.kernel;
    expect(() => recordRecoveryRejection(TYPE, "blocked", "x", TICK)).not.toThrow();
    expect(G().Memory.kernel).toBeUndefined();
  });
});

/**
 * 接线锁（架构守卫，仿 `tests/unit/tactical/a5-*-architecture*.test.ts` 的读源码写法）。
 *
 * 为什么需要这一条：上面五例测的是写入函数本身，**摘掉调用点它们仍会全绿** ⇒ 那是
 * "绿色但什么也没断言"的形状。本仓的系统文件没有系统级夹具（同 `recovery-record-room-source`
 * 的坦白），所以对"调用点在拒绝分支里"这件事，源码形状是能拿到的最强证据；
 * 语义层面的最终复核留给线上读数（见文件头的覆盖边界）。
 */
describe("#105 接线（源码形状）", () => {
  const source = readFileSync("src/systems/room/recovery-execution-system.ts", "utf8");

  it("拒绝分支里调用记录器，且整个文件除定义外只有这一个调用点", () => {
    const calls = source.split("recordRecoveryRejection(").length - 1;
    // 1 次调用 + 1 次函数定义（定义行不带左括号的写法会被上面的 split 抓到，所以是 2）
    expect(calls).toBe(2);
    const rejectBranch = source.slice(
      source.indexOf("} else {\n        // 提交失败"),
      source.indexOf(
        "(g.recoveryActionTable as RecoveryActionTable).set(recoveryIdempotencyKey(action), record);\n        // #105",
      ),
    );
    expect(rejectBranch).toContain("classifyFailure");
    expect(source).toContain(
      "recordRecoveryRejection(action.type, classification, execResult.reason, tick);",
    );
  });

  it("提交成功分支不写拒因（否则计数会把成功也算进去）", () => {
    const successBranch = source.slice(
      source.indexOf("if (execResult.submitted) {"),
      source.indexOf("} else {\n        // 提交失败"),
    );
    expect(successBranch).toContain("submittedThisTick++");
    expect(successBranch).not.toContain("recordRecoveryRejection");
  });
});
