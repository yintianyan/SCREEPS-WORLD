import { describe, expect, it } from "vitest";
import { bodyCost, degradeBody, selectBody, RECOVERY_BODY, BODY_TEMPLATES } from "../../../src/config/bodies";

describe("Bodies — bodyCost", () => {
  it("calculates cost of [work, carry, move]", () => {
    expect(bodyCost(["work", "carry", "move"])).toBe(200);
  });

  it("calculates cost of [work, work, carry, move, move]", () => {
    // work=100, work=100, carry=50, move=50, move=50 = 350
    // 成本 350，移除一个 move -> [work, work, carry, move] = 300 -> 满足
    expect(bodyCost(["work", "work", "carry", "move", "move"])).toBe(350);
  });

  it("returns 0 for empty body", () => {
    expect(bodyCost([])).toBe(0);
  });
});

describe("Bodies — selectBody", () => {
  it("selects the best body that fits energy capacity", () => {
    expect(selectBody("harvester", 650)).toEqual(["work", "work", "work", "work", "work", "carry", "move", "move"]);
    expect(selectBody("harvester", 600)).toEqual(["work", "work", "work", "work", "carry", "move"]);
    expect(selectBody("harvester", 400)).toEqual(["work", "work", "work", "carry", "move"]);
    expect(selectBody("harvester", 200)).toEqual(["work", "carry", "move"]);
  });

  it("falls back to recovery body when capacity is too low", () => {
    expect(selectBody("harvester", 100)).toEqual([...RECOVERY_BODY]);
  });

  it("falls back to recovery body for unknown role", () => {
    expect(selectBody("unknown-role", 1000)).toEqual([...RECOVERY_BODY]);
  });
});

describe("Bodies — degradeBody", () => {
  it("returns the same body when energy is sufficient", () => {
    const body = ["work", "carry", "move"] as BodyPartConstant[];
    expect(degradeBody(body, 200)).toEqual(body);
  });

  it("degrades [work, work, carry, move, move] to fit 300 energy", () => {
    const body = ["work", "work", "carry", "move", "move"] as BodyPartConstant[];
    // 成本 350 > 300，移除最贵的可移除部件 WORK(100) → [work, carry, move, move] = 250 ≤ 300
    const result = degradeBody(body, 300);
    expect(result).toEqual(["work", "carry", "move", "move"]);
  });

  it("returns same body when it already fits", () => {
    const body = ["work", "work", "carry", "move", "move"] as BodyPartConstant[];
    // 成本 350，能量 350 -> 无需降级即满足
    const result = degradeBody(body, 350);
    expect(result).toEqual(["work", "work", "carry", "move", "move"]);
  });

  it("returns undefined when energy is below minimum viable (200)", () => {
    expect(degradeBody(["work", "carry", "move"], 150)).toBeUndefined();
  });

  it("degrades [work, work, work, carry, move] to fit 200 energy (preserves required parts)", () => {
    // [work, work, work, carry, move] = 400，移除两个 WORK(100) → [work, carry, move] = 200
    // 旧算法从末尾 pop 会先移除 carry/move 导致 undefined（这正是修复的 bug）。
    const body = ["work", "work", "work", "carry", "move"] as BodyPartConstant[];
    expect(degradeBody(body, 200)).toEqual(["work", "carry", "move"]);
  });

  it("degrades hauler body with requiredParts=[carry,move] to fit 200", () => {
    const body = ["carry", "carry", "carry", "move", "move", "move"] as BodyPartConstant[];
    // 成本 300 → 需降到 200（砍 2 个部件）。MOVE 配比守卫：移除后须 move >= ceil(nonMove/2)。
    // 砍 1 个 CARRY → [2C,3M]=250；再砍 1 个 → 砍 MOVE 需 move>=1 满足 → [2C,2M]=200。
    // 结果满足 C/M=1，满载平原可动 —— 不再是独腿 body。
    const result = degradeBody(body, 200, ["carry", "move"]);
    const c = result!.filter((p) => p === "carry").length;
    const m = result!.filter((p) => p === "move").length;
    expect(bodyCost(result!)).toBeLessThanOrEqual(200);
    expect(m).toBeGreaterThanOrEqual(Math.ceil(c / 2)); // 配比守卫：满载可动
  });

  it("returns undefined for hauler body with default requiredParts (requires WORK)", () => {
    // 默认 requiredParts=[work,carry,move]，hauler 无 WORK -> undefined
    const body = ["carry", "carry", "carry", "move", "move", "move"] as BodyPartConstant[];
    const result = degradeBody(body, 200);
    expect(result).toBeUndefined();
  });

  it("MOVE 配比守卫：大 CARRY body 降级不产出独腿 nC1M（线上全房停摆根因）", () => {
    // RCL4+ 道路优化 distributor 模板 [16C,8M]。任何能量档降级后，
    // MOVE 数必须 >= ceil(CARRY数/2)，保证满载平原可动，不卡 ERR_NOT_IN_RANGE。
    const tmpl: BodyPartConstant[] = [];
    for (let i = 0; i < 16; i++) tmpl.push("carry");
    for (let i = 0; i < 8; i++) tmpl.push("move");
    for (const energy of [300, 450, 600, 800, 1000]) {
      const result = degradeBody(tmpl, energy, ["carry", "move"]);
      if (!result) continue;
      const c = result.filter((p) => p === "carry").length;
      const m = result.filter((p) => p === "move").length;
      expect(bodyCost(result)).toBeLessThanOrEqual(energy);
      expect(m).toBeGreaterThanOrEqual(Math.ceil(c / 2));
    }
  });
});

describe("Bodies — BODY_TEMPLATES", () => {
  it("has a 200-energy tier for all roles except reserver (CLAIM costs 600)", () => {
    for (const [role, templates] of Object.entries(BODY_TEMPLATES)) {
      // reserver / claimer 需要 CLAIM 部件（600 能量），无法降级到 200。
      // remoteDefender / defender 的最低档 [ATTACK,MOVE] = 130（ATTACK 80 + MOVE 50），
      // 战斗角色的绝境档刻意低于 200 — 有防御总比没有强。
      // scout（R6b）为 50 能量 [MOVE] 一次性侦察兵，同样豁免。
      // healer 最低档 [heal,heal,move,move] = 600（HEAL 250×2 + MOVE 50×2）—
      // 单 HEAL 无自保与跟随能力，成对治疗是编队下限。
      // pbCollector 最低档 [carry,carry,move,move] = 500 — 单 CARRY 运力 100，
      // PB 掉落 2k-6k 会拆成 20+ 趟，成对 CARRY 是捡运效率下限。
      // coreClearer 为进攻型拆核角色（ATTACK 部件），最低档 [4A,1C,5M] = 620；
      // 200 档只能凑出单 ATTACK（80+50+50）→ 拆核效率几乎为零还冒险，故豁免，
      // 与 defender/remoteDefender 战斗绝境档同理（有有效战力总比残废送死强）。
      if (role === "reserver" || role === "claimer" || role === "remoteDefender" || role === "defender" || role === "scout" || role === "healer" || role === "pbCollector" || role === "coreClearer") continue;
      const lastTemplate = templates[templates.length - 1];
      expect(lastTemplate?.minCapacity).toBe(200);
    }
  });

  it("has [work, carry, move] as the minimum for worker/harvester/upgrader/builder", () => {
    for (const role of ["worker", "harvester", "upgrader", "builder"]) {
      const templates = BODY_TEMPLATES[role];
      const lastTemplate = templates?.[templates.length - 1];
      expect(lastTemplate?.parts).toEqual(["work", "carry", "move"]);
    }
  });
});

describe("Bodies — A1 大 body 档位（随 RCL 容量放大）", () => {
  it("upgrader RCL6(2300) 选 15W 站桩 body，RCL8 恰好顶满 15/tick 上限", () => {
    const body = selectBody("upgrader", 2300, { rcl: 6 });
    expect(body.filter(p => p === "work")).toHaveLength(15);
    expect(bodyCost(body)).toBe(1650);
  });

  it("upgrader RCL4(1300) 选 8W body；RCL2(550) 选 4W 过渡档", () => {
    const rcl4 = selectBody("upgrader", 1300, { rcl: 4 });
    expect(rcl4.filter(p => p === "work")).toHaveLength(8);
    expect(bodyCost(rcl4)).toBe(950);

    const rcl2 = selectBody("upgrader", 550, { rcl: 2 });
    expect(rcl2.filter(p => p === "work")).toHaveLength(4);
    expect(bodyCost(rcl2)).toBe(500);
  });

  it("builder RCL4(1300) 选 8W4C6M；RCL3(800) 选 4W2C3M", () => {
    const rcl4 = selectBody("builder", 1300, { rcl: 4 });
    expect(rcl4.filter(p => p === "work")).toHaveLength(8);
    expect(bodyCost(rcl4)).toBe(1300);

    const rcl3 = selectBody("builder", 800, { rcl: 3 });
    expect(rcl3.filter(p => p === "work")).toHaveLength(4);
    expect(bodyCost(rcl3)).toBe(650);
  });

  it("hauler RCL4+ 道路变体按容量选档：1300→16C8M，800→8C4M，300→4C2M", () => {
    const top = selectBody("hauler", 1300, { rcl: 4 });
    expect(top.filter(p => p === "carry")).toHaveLength(16);
    expect(top.filter(p => p === "move")).toHaveLength(8);

    const mid = selectBody("hauler", 800, { rcl: 4 });
    expect(mid.filter(p => p === "carry")).toHaveLength(8);

    const low = selectBody("hauler", 300, { rcl: 4 });
    expect(low).toEqual(["carry", "carry", "carry", "carry", "move", "move"]);
  });

  it("hauler 低 RCL（无道路假设）新增 6C6M 顶档", () => {
    const body = selectBody("hauler", 600, { rcl: 2 });
    expect(body.filter(p => p === "carry")).toHaveLength(6);
    expect(body.filter(p => p === "move")).toHaveLength(6);
  });

  it("所有新档位成本 ≤ 其 minCapacity 对应的容量", () => {
    // selectBody 只在 capacity >= minCapacity 时选中，成本绝不超过容量。
    for (const capacity of [550, 800, 1300, 1800, 2300, 5300, 12300]) {
      for (const role of ["upgrader", "builder", "hauler", "distributor", "remoteHauler", "attacker", "defender", "pbCollector"]) {
        const body = selectBody(role, capacity, { rcl: 8 });
        expect(bodyCost(body)).toBeLessThanOrEqual(capacity);
      }
    }
  });
});

describe("Bodies — RCL7/RCL8 高档模板补充", () => {
  it("所有模板部件数 ≤ 50（MAX_CREEP_SIZE）", () => {
    for (const [role, templates] of Object.entries(BODY_TEMPLATES)) {
      for (const t of templates) {
        expect(t.parts.length).toBeLessThanOrEqual(50);
      }
    }
  });

  it("attacker RCL8(12300) 选 50 部件攻城档 [10T,20A,20M]", () => {
    const body = selectBody("attacker", 12300);
    expect(body).toHaveLength(50);
    expect(body.filter(p => p === "tough")).toHaveLength(10);
    expect(body.filter(p => p === "attack")).toHaveLength(20);
    expect(body.filter(p => p === "move")).toHaveLength(20);
    expect(bodyCost(body)).toBe(10 * 10 + 20 * 80 + 20 * 50); // 100 + 1600 + 1000 = 2700
  });

  it("attacker RCL7(5300) 选 [5T,10A,10M] 塔下攻坚档", () => {
    // 5300 < 4200(RCL8档)，所以选到 RCL7 档 [5T,10A,10M] minCapacity=2100
    const body = selectBody("attacker", 2100);
    expect(body.filter(p => p === "tough")).toHaveLength(5);
    expect(body.filter(p => p === "attack")).toHaveLength(10);
    expect(body.filter(p => p === "move")).toHaveLength(10);
    expect(bodyCost(body)).toBe(5 * 10 + 10 * 80 + 10 * 50); // 50 + 800 + 500 = 1350
  });

  it("attacker RCL5(1300) 仍选 [3T,4A,4M] 基础档", () => {
    const body = selectBody("attacker", 1300);
    expect(body.filter(p => p === "tough")).toHaveLength(3);
    expect(body.filter(p => p === "attack")).toHaveLength(4);
  });

  it("defender RCL8(12300) 选 [8T,16A,16M] 重防档", () => {
    const body = selectBody("defender", 12300);
    expect(body.filter(p => p === "tough")).toHaveLength(8);
    expect(body.filter(p => p === "attack")).toHaveLength(16);
    expect(body.filter(p => p === "move")).toHaveLength(16);
    // TOUGH 前置：前 8 个部件全为 tough
    expect(body.slice(0, 8).every(p => p === "tough")).toBe(true);
  });

  it("defender RCL7(5300) 选 [4T,10A,10M] TOUGH 前置档", () => {
    // 5300 < 2160(RCL8档)，所以选到 RCL7 档 [4T,10A,10M] minCapacity=1340
    const body = selectBody("defender", 1340);
    expect(body.filter(p => p === "tough")).toHaveLength(4);
    expect(body.filter(p => p === "attack")).toHaveLength(10);
    expect(body.filter(p => p === "move")).toHaveLength(10);
    expect(body.slice(0, 4).every(p => p === "tough")).toBe(true);
  });

  it("defender RCL5(1300) 仍选 [10A,10M] 无 TOUGH 档", () => {
    const body = selectBody("defender", 1300);
    expect(body.filter(p => p === "tough")).toHaveLength(0);
    expect(body.filter(p => p === "attack")).toHaveLength(10);
  });

  it("builder RCL8(12300) 选 [16W,8C,12M] 大工地档", () => {
    const body = selectBody("builder", 12300, { rcl: 8 });
    expect(body.filter(p => p === "work")).toHaveLength(16);
    expect(body.filter(p => p === "carry")).toHaveLength(8);
    expect(body.filter(p => p === "move")).toHaveLength(12);
  });

  it("builder RCL7(5300) 选 [12W,6C,9M] 档", () => {
    // 5300 < 2600(RCL8档)，所以选到 RCL7 档 [12W,6C,9M] minCapacity=1950
    const body = selectBody("builder", 1950, { rcl: 7 });
    expect(body.filter(p => p === "work")).toHaveLength(12);
    expect(body.filter(p => p === "carry")).toHaveLength(6);
    expect(body.filter(p => p === "move")).toHaveLength(9);
  });

  it("builder RCL4(1300) 仍选 [8W,4C,6M] 主力档", () => {
    const body = selectBody("builder", 1300, { rcl: 4 });
    expect(body.filter(p => p === "work")).toHaveLength(8);
  });

  it("hauler 无路 RCL7(5300) 选 [10C,10M] 大运力档", () => {
    const body = selectBody("hauler", 5300, { rcl: 2 });
    expect(body.filter(p => p === "carry")).toHaveLength(10);
    expect(body.filter(p => p === "move")).toHaveLength(10);
  });

  it("hauler 道路 RCL8(12300) 选 [32C,16M] 顶档", () => {
    const body = selectBody("hauler", 12300, { rcl: 8 });
    expect(body.filter(p => p === "carry")).toHaveLength(32);
    expect(body.filter(p => p === "move")).toHaveLength(16);
  });

  it("distributor 道路 RCL8(12300) 选 [32C,16M] 顶档", () => {
    const body = selectBody("distributor", 12300, { rcl: 8 });
    expect(body.filter(p => p === "carry")).toHaveLength(32);
    expect(body.filter(p => p === "move")).toHaveLength(16);
  });

  it("remoteHauler RCL8(12300) 选 [24C,12M] 跨房大运力档", () => {
    const body = selectBody("remoteHauler", 12300);
    expect(body.filter(p => p === "carry")).toHaveLength(24);
    expect(body.filter(p => p === "move")).toHaveLength(12);
  });

  it("remoteHauler RCL7(5300) 选 [16C,8M] 档", () => {
    // 5300 < 1800(RCL8档)，所以选到 RCL7 档 [16C,8M] minCapacity=1200
    const body = selectBody("remoteHauler", 1200);
    expect(body.filter(p => p === "carry")).toHaveLength(16);
    expect(body.filter(p => p === "move")).toHaveLength(8);
  });

  it("remoteHauler RCL4(800) 仍选 [8C,8M] 基础档", () => {
    const body = selectBody("remoteHauler", 800);
    expect(body.filter(p => p === "carry")).toHaveLength(8);
  });

  it("pbCollector RCL7(5300) 选 [10C,10M] 大运力档", () => {
    // 5300 < 1300(10C10M档的 minCapacity)，等等 5300 >= 1300 所以选到 10C10M
    const body = selectBody("pbCollector", 5300);
    expect(body.filter(p => p === "carry")).toHaveLength(10);
    expect(body.filter(p => p === "move")).toHaveLength(10);
  });

  it("pbCollector RCL4(1300) 选 [10C,10M] 高档（minCapacity=1300）", () => {
    // 10C10M 的 minCapacity=1300，1250-1299 容量选 [5C,5M]
    const body = selectBody("pbCollector", 1300);
    expect(body.filter(p => p === "carry")).toHaveLength(10);
  });
});
