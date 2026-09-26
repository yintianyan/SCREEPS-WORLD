/**
 * B6-㉔ Squad 级战术状态的归属（systems/military/squad-state）。
 *
 * 修前：三个 stage runtime 各有一份 `deriveTacticalStateFromPhase(plan.phase)`，
 * 每 tick 从 warPlan 的**波次相位**现推战术状态 —— 而转换表里 FORMING 只允许
 * →MOVING/ABORTED/COMPLETED，于是 STALE 情报的 REGROUPING 闸、敌方能力暴涨的
 * RETREATING 闸、healer 全灭与低血量的 DISENGAGING 闸**四道安全闸恒判非法**，
 * 决策产出的 newState 也从来没被存下来（代码注释声称存了）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  commitSquadState,
  pruneSquadStates,
  readSquadState,
  squadStateCount,
  squadStateKey,
} from "../../../src/systems/military/squad-state";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

const TICK = 10000;
const G = () => globalThis as any;
const OWNER = { sponsor: "W7N4", targetRoom: "W6N4", since: 9000 };
const KEY = squadStateKey(OWNER);

beforeEach(() => {
  resetGlobals();
  G().Memory.kernel = {};
});

describe("状态归属：读、写、合法性裁判", () => {
  it("没有记录 → FORMING（新行动从集结开始，不继承别处推出来的值）", () => {
    expect(readSquadState(KEY)).toBe("FORMING");
  });

  it("合法转换被接受并读得回来；非法转换被拒且状态留在原地", () => {
    // 转换表是唯一裁判：FORMING 不能直跳 ENGAGING（缺 MOVING/POSITIONING 两步）。
    expect(commitSquadState(KEY, "FORMING", "ENGAGING", TICK)).toBe(false);
    expect(readSquadState(KEY)).toBe("FORMING");

    expect(commitSquadState(KEY, "FORMING", "MOVING", TICK)).toBe(true);
    expect(readSquadState(KEY)).toBe("MOVING");
  });

  it("维持现状（自持）合法，且不重置进入该状态的时刻", () => {
    commitSquadState(KEY, "FORMING", "MOVING", TICK);
    const since = G().Memory.kernel.tacticalSquadStates[KEY].since;

    expect(commitSquadState(KEY, "MOVING", "MOVING", TICK + 300)).toBe(true);
    const entry = G().Memory.kernel.tacticalSquadStates[KEY];
    expect(entry.state).toBe("MOVING");
    expect(entry.since).toBe(since);
    expect(entry.updatedAt).toBe(TICK + 300); // 只挪"最近被摸到"的时点，供淘汰用
  });

  it("撤退中的编队不会被下游阶段改写成进攻态（第二写者已注销）", () => {
    commitSquadState(KEY, "FORMING", "MOVING", TICK);
    commitSquadState(KEY, "MOVING", "RETREATING", TICK + 10);
    expect(readSquadState(KEY)).toBe("RETREATING");
    // 修前这里读到的是从 warPlan.phase 推出来的 FORMING/MOVING —— RETREATING
    // 会被 engagement 阶段的"只认 ENGAGING/POSITIONING，其余现推"顺手抹掉。
    expect(readSquadState(KEY)).not.toBe("MOVING");
  });

  it("换一轮行动（since 变了）= 新键 = 从头开始，上一仗的状态不继承", () => {
    commitSquadState(KEY, "FORMING", "MOVING", TICK);
    commitSquadState(KEY, "MOVING", "RETREATING", TICK + 10);

    const nextRound = squadStateKey({ ...OWNER, since: OWNER.since + 1 });
    expect(readSquadState(nextRound)).toBe("FORMING");
  });

  it("存着不认识的状态词（代码回滚）→ 回落到 FORMING，不把未知值喂给消费方", () => {
    G().Memory.kernel.tacticalSquadStates = {
      [KEY]: { state: "SOMETHING_ELSE", since: TICK, updatedAt: TICK },
    };
    expect(readSquadState(KEY)).toBe("FORMING");
  });
});

describe("有界性：不再被读取的行动条目要清掉", () => {
  it("超过 planTimeout 没被摸过的键被淘汰，活跃键留下", () => {
    commitSquadState(KEY, "FORMING", "MOVING", TICK);
    const oldRound = squadStateKey({ ...OWNER, since: 100 });
    commitSquadState(oldRound, "FORMING", "MOVING", 100);

    pruneSquadStates(TICK);

    expect(readSquadState(KEY)).toBe("MOVING");
    expect(squadStateCount()).toBe(1);
  });

  it("自持更新会续命（正在打的仗不会被误删）", () => {
    commitSquadState(KEY, "FORMING", "ENGAGING", TICK); // 非法，不写
    commitSquadState(KEY, "FORMING", "MOVING", TICK);
    commitSquadState(KEY, "MOVING", "MOVING", TICK + CONFIG.war.planTimeout);

    pruneSquadStates(TICK + CONFIG.war.planTimeout + 1);

    expect(squadStateCount()).toBe(1);
  });
});

describe("守卫：战术状态只有一个来源", () => {
  it("src 内不再有从 warPlan.phase 推战术状态的副本", () => {
    const SRC = resolve(__dirname, "../../../src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) {
          const code = readFileSync(p, "utf8");
          if (/function deriveTacticalState/.test(code)) offenders.push(relative(SRC, p));
        }
      }
    };
    walk(SRC);
    expect(
      offenders,
      `又出现了从别处语义现推战术状态的副本（${offenders.join(", ")}）—— ` +
        "战术状态归 systems/military/squad-state，读写都走它",
    ).toHaveLength(0);
  });
});
