/**
 * A5.4.1 Runtime Integration Tests — Tactical Runtime 集成验证。
 *
 * 验证：
 *   TAC-R01: tacticalRuntimeSystem 正确导出与结构
 *   TAC-R02: TacticalRuntimeCache 字段在 globalCache 上正确初始化
 *   TAC-R03: attacker.ts 不导入 systems 层（R3 守卫）
 *   TAC-R04: healer.ts 不导入 systems 层（R3 守卫）
 *   TAC-R05: tactical-runtime-system 不直接写 warAbortSignals
 *   TAC-R06: recovery-execution-system 消费 tacticalAbortSignals
 *   TAC-R07: logistics-planner 消费 tacticalSupplyDemands
 *   TAC-R08: attacker.ts readTacticalIntent 正确从 globalCache 读取
 *   TAC-R09: healer.ts readTacticalIntent 正确从 globalCache 读取
 *   TAC-R10: bootstrap.ts 注册了 tacticalRuntimeSystem
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const NL = String.fromCharCode(10);
const SRC = resolve(__dirname, "../../../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const ALL_FILES = walk(SRC);

function codeLines(src: string): string {
  return src.split(NL)
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join(NL);
}

function importsOf(file: string): { resolved: string }[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1]!);
  }
  return out.map(s => ({ resolved: s }));
}

function layerOf(file: string | string): string {
  const rel = relative(SRC, file);
  if (rel.startsWith("domain/")) return "domain";
  if (rel.startsWith("systems/")) return "systems";
  if (rel.startsWith("creeps/")) return "creeps";
  if (rel.startsWith("kernel/")) return "kernel";
  if (rel.startsWith("config/")) return "config";
  return "other";
}

// ─── TAC-R01: tacticalRuntimeSystem 导出与结构 ───

describe("A5.4.1 TAC-R01: tacticalRuntimeSystem 导出与结构", () => {
  it("tactical-runtime-system.ts 导出 tacticalRuntimeSystem", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("export const tacticalRuntimeSystem");
  });

  it("系统 name 为 'tactical-runtime'", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain('name: "tactical-runtime"');
  });

  it("系统有 interval 和 priority 定义", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toMatch(/interval:\s*\d+/);
    expect(src).toMatch(/priority:\s*\d+/);
  });
});

// ─── TAC-R02: TacticalRuntimeCache 字段定义 ───

describe("A5.4.1 TAC-R02: TacticalRuntimeCache 字段定义", () => {
  it("TacticalRuntimeCache 接口包含所有必要字段", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("tacticalObjectives");
    expect(src).toContain("tacticalRoleIntents");
    expect(src).toContain("tacticalDecisions");
    expect(src).toContain("tacticalAbortSignals");
    expect(src).toContain("tacticalSupplyDemands");
    expect(src).toContain("tacticalReinforcementDemands");
  });
});

// ─── TAC-R03: attacker.ts 不导入 systems 层（R3 守卫） ───

describe("A5.4.1 TAC-R03: attacker.ts 不导入 systems 层", () => {
  it("attacker.ts 无 systems 导入", () => {
    const f = resolve(SRC, "creeps/roles/attacker.ts");
    const imports = importsOf(f);
    const badImports = imports.filter(imp =>
      imp.resolved.includes("../systems/") || imp.resolved.includes("../../systems/"),
    );
    expect(badImports, `attacker.ts 导入了 systems: ${badImports.map(b => b.resolved).join(", ")}`).toHaveLength(0);
  });

  it("attacker.ts 使用 readTacticalIntent 而非 getTacticalIntent", () => {
    const f = resolve(SRC, "creeps/roles/attacker.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("readTacticalIntent");
    expect(src).not.toContain("getTacticalIntent");
  });
});

// ─── TAC-R04: healer.ts 不导入 systems 层（R3 守卫） ───

describe("A5.4.1 TAC-R04: healer.ts 不导入 systems 层", () => {
  it("healer.ts 无 systems 导入", () => {
    const f = resolve(SRC, "creeps/roles/healer.ts");
    const imports = importsOf(f);
    const badImports = imports.filter(imp =>
      imp.resolved.includes("../systems/") || imp.resolved.includes("../../systems/"),
    );
    expect(badImports, `healer.ts 导入了 systems: ${badImports.map(b => b.resolved).join(", ")}`).toHaveLength(0);
  });

  it("healer.ts 使用 readTacticalIntent 而非 getTacticalIntent", () => {
    const f = resolve(SRC, "creeps/roles/healer.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("readTacticalIntent");
    expect(src).not.toContain("getTacticalIntent");
  });
});

// ─── TAC-R05: tactical-runtime-system 不直接写 warAbortSignals ───

describe("A5.4.1 TAC-R05: 不直接写 warAbortSignals", () => {
  it("tactical-runtime-system.ts 不写 warAbortSignals（只写 tacticalAbortSignals）", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const src = readFileSync(f, "utf8");
    const code = codeLines(src);
    // 允许在注释中提到 warAbortSignals，但代码行不得写入
    const writePattern = /g\.warAbortSignals\s*=/;
    expect(writePattern.test(code), "tactical-runtime-system 直接写了 g.warAbortSignals").toBe(false);
  });
});

// ─── TAC-R06: recovery-execution-system 消费 tacticalAbortSignals ───

describe("A5.4.1 TAC-R06: recovery-execution-system 消费 tacticalAbortSignals", () => {
  it("recovery-execution-system.ts 包含 consumeTacticalAbortSignals 函数", () => {
    const f = resolve(SRC, "systems/recovery-execution-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("consumeTacticalAbortSignals");
    expect(src).toContain("tacticalAbortSignals");
  });

  it("recovery-execution-system 在 run 中调用 consumeTacticalAbortSignals", () => {
    const f = resolve(SRC, "systems/recovery-execution-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("const tacticalActions = consumeTacticalAbortSignals");
  });
});

// ─── TAC-R07: logistics-planner 消费 tacticalSupplyDemands ───

describe("A5.4.1 TAC-R07: logistics-planner 消费 tacticalSupplyDemands", () => {
  it("logistics-planner.ts 包含 tacticalSupplyDemands 消费逻辑", () => {
    const f = resolve(SRC, "systems/logistics-planner.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("tacticalSupplyDemands");
    expect(src).toContain("tacSupplies");
  });
});

// ─── TAC-R08: attacker.ts readTacticalIntent 从 globalCache 读取 ───

describe("A5.4.1 TAC-R08: attacker readTacticalIntent 从 globalCache 读取", () => {
  it("attacker.ts 的 readTacticalIntent 通过 globalCache 读取", () => {
    const f = resolve(SRC, "creeps/roles/attacker.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("globalCache");
    expect(src).toContain("tacticalRoleIntents");
    expect(src).toContain("readTacticalIntent");
  });

  it("attacker.ts 的 attackByTacticalIntent 调用 readTacticalIntent", () => {
    const f = resolve(SRC, "creeps/roles/attacker.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("readTacticalIntent(ac.creep.name)");
  });
});

// ─── TAC-R09: healer.ts readTacticalIntent 从 globalCache 读取 ───

describe("A5.4.1 TAC-R09: healer readTacticalIntent 从 globalCache 读取", () => {
  it("healer.ts 的 readTacticalIntent 通过 globalCache 读取", () => {
    const f = resolve(SRC, "creeps/roles/healer.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("globalCache");
    expect(src).toContain("tacticalRoleIntents");
    expect(src).toContain("readTacticalIntent");
  });

  it("healer.ts 的 healByTacticalIntent 调用 readTacticalIntent", () => {
    const f = resolve(SRC, "creeps/roles/healer.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("readTacticalIntent(ac.creep.name)");
  });
});

// ─── TAC-R10: bootstrap.ts 注册了 tacticalRuntimeSystem ───

describe("A5.4.1 TAC-R10: bootstrap 注册 tacticalRuntimeSystem", () => {
  it("bootstrap.ts 导入并注册了 tacticalRuntimeSystem", () => {
    const f = resolve(SRC, "bootstrap.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("tacticalRuntimeSystem");
    expect(src).toContain("registerSystem(tacticalRuntimeSystem)");
  });
});

// ─── TAC-R11: 全局 R3 守卫 — creeps 不导入 systems ───

describe("A5.4.1 TAC-R11: 全局 creeps 层不导入 systems 层", () => {
  it("零命中", () => {
    const creepFiles = ALL_FILES.filter(f => layerOf(f) === "creeps");
    const bad: string[] = [];
    for (const f of creepFiles) {
      for (const imp of importsOf(f)) {
        if (imp.resolved.includes("../systems/") || imp.resolved.includes("../../systems/")) {
          bad.push(relative(SRC, f));
        }
      }
    }
    expect(bad, `creeps 导入了 systems: ${bad.join(", ")}`).toHaveLength(0);
  });
});

// ─── TAC-R12: tactical-runtime-system 不直接调用 Game API 动作 ───

describe("A5.4.1 TAC-R12: tactical-runtime-system 不直接调用 Creep API", () => {
  it("不调用 move() / attack() / heal() / spawnCreep()", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const code = codeLines(readFileSync(f, "utf8"));
    // 允许在 Game.getObjectById 中读取（数据采集），但不得直接执行动作
    expect(code).not.toMatch(/\.move\(/);
    expect(code).not.toMatch(/\.attack\(/);
    expect(code).not.toMatch(/\.heal\(/);
    expect(code).not.toMatch(/spawnCreep\(/);
  });
});

// ─── TAC-R13: SupplyDemand 检测只在 advance 相位 ───

describe("A5.4.1 TAC-R13: SupplyDemand 检测只在 advance 相位", () => {
  it("detectSupplyDemand 函数存在且有 phase 检查", () => {
    const f = resolve(SRC, "systems/tactical-runtime-system.ts");
    const src = readFileSync(f, "utf8");
    expect(src).toContain("detectSupplyDemand");
    expect(src).toContain('plan.phase !== "advance"');
  });
});
