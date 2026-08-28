/** Architecture Compliance Tests —— FREEZE 红线的自动化守卫。 */

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

function importsOf(file: string): { resolved: string; isType: boolean }[] {
  const src = readFileSync(file, "utf8");
  const out: { resolved: string; isType: boolean }[] = [];
  const re = /import\s+(type\s+)?[\s\S]*?from\s+["'][^"']+["']/g;
  const specRe = /["']([^"']+)["']/;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const stmt = m[0];
    const specMatch = stmt.match(specRe);
    if (!specMatch) continue;
    const spec = specMatch[1]!;
    if (!spec.startsWith(".")) continue;
    const base = resolve(file, "..", spec);
    const candidates = [base, base + ".ts", join(base, "index.ts")];
    const resolved = candidates.find((c) => { try { return statSync(c).isFile(); } catch { return false; } }) ?? base;
    out.push({ resolved, isType: Boolean(m[1]) });
  }
  return out;
}

function layerOf(file: string): string {
  const rel = relative(SRC, file);
  if (rel.startsWith("domain")) return "domain";
  if (rel.startsWith("systems")) return "systems";
  if (rel.startsWith("creeps")) return "creeps";
  if (rel.startsWith("kernel")) return "kernel";
  if (rel.startsWith("config")) return "config";
  return "root";
}

function codeLines(src: string): string {
  return src.split(NL)
    .filter((l) => { const t = l.trim(); return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*"); })
    .join(NL);
}

describe("R1 domain 纯度", () => {
  const domainFiles = ALL_FILES.filter((f) => layerOf(f) === "domain");

  it("不 import systems/* 或 creeps/*", () => {
    const bad: string[] = [];
    for (const f of domainFiles) {
      for (const imp of importsOf(f)) {
        const l = layerOf(imp.resolved);
        if (l === "systems" || l === "creeps") bad.push(relative(SRC, f) + " -> " + relative(SRC, imp.resolved));
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });

  it("kernel 导入仅允许 global-cache（值）或任意 kernel 模块的 type-only", () => {
    const bad: string[] = [];
    for (const f of domainFiles) {
      for (const imp of importsOf(f)) {
        if (layerOf(imp.resolved) !== "kernel") continue;
        if (imp.isType) continue;
        if (imp.resolved.includes("global-cache")) continue;
        bad.push(relative(SRC, f) + " -> " + relative(SRC, imp.resolved));
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });

  it("代码行不得引用 Game./Memory./console.", () => {
    const bad: string[] = [];
    for (const f of domainFiles) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Game\./.test(code) || /Memory\./.test(code) || /console\./.test(code)) bad.push(relative(SRC, f));
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R3 creeps 不 import systems", () => {
  const creepFiles = ALL_FILES.filter((f) => layerOf(f) === "creeps");
  it("零命中", () => {
    const bad: string[] = [];
    for (const f of creepFiles) {
      for (const imp of importsOf(f)) {
        if (layerOf(imp.resolved) === "systems") bad.push(relative(SRC, f));
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R4 systems→creeps 仅限 movement/support", () => {
  const systemFiles = ALL_FILES.filter((f) => layerOf(f) === "systems");
  it("禁 roles/engine", () => {
    const bad: string[] = [];
    for (const f of systemFiles) {
      for (const imp of importsOf(f)) {
        if (layerOf(imp.resolved) !== "creeps") continue;
        const rel = relative(SRC, imp.resolved);
        if (!rel.includes("creeps/movement/") && !rel.includes("creeps/support")) bad.push(relative(SRC, f) + " -> " + rel);
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R5 strategy 状态唯一写者", () => {
  it("赋值写只在 empire-strategy.ts", () => {
    const bad: string[] = [];
    for (const f of ALL_FILES) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/Memory\.kernel\.strategy\s*(?:\.[a-zA-Z_$][\w$]*)?\s*=[^=]/.test(code)) {
        const rel = relative(SRC, f);
        if (!rel.endsWith("empire-strategy.ts")) bad.push(rel);
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R6 roles 动作红线", () => {
  const roleFiles = ALL_FILES.filter((f) => relative(SRC, f).startsWith("creeps/roles"));
  it("禁 spawnCreep/createConstructionSite/PathFinder.search/Game.market", () => {
    const bad: string[] = [];
    for (const f of roleFiles) {
      const code = codeLines(readFileSync(f, "utf8"));
      if (/spawnCreep\s*\(/.test(code)) bad.push(relative(SRC, f) + ": spawnCreep");
      if (/createConstructionSite\s*\(/.test(code)) bad.push(relative(SRC, f) + ": createConstructionSite");
      if (/PathFinder\.search\s*\(/.test(code)) bad.push(relative(SRC, f) + ": PathFinder.search");
      if (/Game\.market/.test(code)) bad.push(relative(SRC, f) + ": Game.market");
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R8 roles 禁止 Room.find 和全局扫描", () => {
  const roleFiles = ALL_FILES.filter((f) => relative(SRC, f).startsWith("creeps/roles"));
  // R8 已修复：所有角色文件的 room.find / Game.getObjectById / Object.values(Game.creeps)
  // 已收敛到 creeps/support/room-scans.ts 和 obj-cache.ts 的 per-tick per-room 共享缓存。
  // 豁免列表已清空。
  const R8_EXEMPTIONS = new Set<string>([]);
  it("禁 room.find / Object.values(Game.creeps) / Game.getObjectById", () => {
    const bad: string[] = [];
    for (const f of roleFiles) {
      const rel = relative(SRC, f);
      const code = codeLines(readFileSync(f, "utf8"));
      if (/(?:^|[^.])\broom\.find\s*\(|creep\.room\.find\s*\(/.test(code) && !R8_EXEMPTIONS.has(rel + ":room.find")) {
        bad.push(rel + ": room.find");
      }
      if (/Object\.values\(Game\.creeps\)/.test(code) && !R8_EXEMPTIONS.has(rel + ":Object.values(Game.creeps)")) {
        bad.push(rel + ": Object.values(Game.creeps)");
      }
      if (/Game\.getObjectById/.test(code) && !R8_EXEMPTIONS.has(rel + ":Game.getObjectById")) {
        bad.push(rel + ": Game.getObjectById");
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R9 Kernel 禁止 import 业务模块", () => {
  const kernelFiles = ALL_FILES.filter((f) => layerOf(f) === "kernel");
  // 已登记白名单例外（ENGINEERING_BLUEPRINT §3.1 Dependencies 行）：
  // - pruneDeadCreepCache from creeps/movement/pathfinding（R9 例外，KERNEL §8）
  // - type-only 导入豁免（全局类型共享，无运行时副作用）
  // - global-cache.ts 的 TaskPool type import 豁免
  // - outcome-channel.ts 的 uoem-types type import 豁免
  // - layout-metrics.ts 的 StructureGaps type import 豁免
  // R9 已修复：buildRoomSnapshot 通过 Registry.registerWorldModelBuilder 注入，
  // classifyThreats 内联为 CONFIG.defense.threatParts 判定，
  // MINCUT_ALGO_VERSION 改为参数注入。豁免列表已清空。
  const R9_VALUE_EXEMPTIONS = new Set<string>([]);
  it("值导入业务模块仅在白名单中", () => {
    const bad: string[] = [];
    for (const f of kernelFiles) {
      const rel = relative(SRC, f);
      for (const imp of importsOf(f)) {
        if (imp.isType) continue; // type-only 豁免
        const targetLayer = layerOf(imp.resolved);
        if (targetLayer !== "systems" && targetLayer !== "creeps" && targetLayer !== "domain") continue;
        // 已登记白名单：pruneDeadCreepCache
        if (rel === "kernel/kernel.ts" && imp.resolved.includes("creeps/movement/pathfinding")) continue;
        const targetRel = relative(SRC, imp.resolved);
        const exemptKey = rel + ":" + targetRel;
        if (R9_VALUE_EXEMPTIONS.has(exemptKey)) continue;
        bad.push(rel + " -> " + targetRel);
      }
    }
    expect(bad, bad.join(NL)).toHaveLength(0);
  });
});

describe("R7 无循环依赖", () => {
  it("src 相对导入图无环（忽略 type-only）", () => {
    const graph = new Map<string, Set<string>>();
    for (const f of ALL_FILES) {
      graph.set(f, new Set());
      for (const imp of importsOf(f)) {
        if (imp.isType) continue;
        if (imp.resolved.startsWith(SRC)) graph.get(f)!.add(imp.resolved);
      }
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    let cyclic: string | undefined;
    const visit = (n: string): void => {
      color.set(n, GRAY);
      for (const next of graph.get(n) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) { cyclic = n + " -> " + next; return; }
        if (c === WHITE) visit(next);
        if (cyclic) return;
      }
      color.set(n, BLACK);
    };
    for (const n of graph.keys()) {
      if ((color.get(n) ?? WHITE) === WHITE) { visit(n); if (cyclic) break; }
    }
    expect(cyclic, "circular dependency at " + cyclic).toBeUndefined();
  });
});

describe("R10 bootstrap 注册集合一致性", () => {
  const bootstrapPath = resolve(SRC, "bootstrap.ts");
  const bootstrapSrc = readFileSync(bootstrapPath, "utf8");

  // 提取 registerSystem(...) 调用中的参数标识符
  const systemCalls = [...bootstrapSrc.matchAll(/\.registerSystem\(\s*(\w+)\s*\)/g)].map(m => m[1]!);
  // 提取 registerRole(...) 调用中的参数标识符
  const roleCalls = [...bootstrapSrc.matchAll(/\.registerRole\(\s*(\w+)\s*\)/g)].map(m => m[1]!);

  it("每个 registerSystem 参数都有对应 import 声明", () => {
    const missing: string[] = [];
    for (const ident of systemCalls) {
      // 检查 bootstrap.ts 中是否有 import { ident } from "..." 声明
      const re = new RegExp(`import\\s+[^{]*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s+from\\s+["']`, "");
      if (!re.test(bootstrapSrc)) {
        missing.push(ident);
      }
    }
    expect(missing, "registerSystem 参数无 import: " + missing.join(", ")).toHaveLength(0);
  });

  it("每个 registerRole 参数都有对应 import 声明", () => {
    const missing: string[] = [];
    for (const ident of roleCalls) {
      const re = new RegExp(`import\\s+[^{]*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s+from\\s+["']`, "");
      if (!re.test(bootstrapSrc)) {
        missing.push(ident);
      }
    }
    expect(missing, "registerRole 参数无 import: " + missing.join(", ")).toHaveLength(0);
  });

  it("每个 import 的模块文件实际存在", () => {
    const missing: string[] = [];
    const importRe = /import\s+(?:type\s+)?[^{]*\{[^}]*\}\s+from\s+["'](\.\.\/[^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(bootstrapSrc)) !== null) {
      const spec = m[1]!;
      const resolved = resolve(SRC, spec.replace(/^\.\.\//, "./"));
      const tsFile = resolved + ".ts";
      try {
        readFileSync(tsFile, "utf8");
      } catch {
        missing.push(spec + " → " + relative(SRC, tsFile));
      }
    }
    expect(missing, "import 目标文件不存在: " + missing.join(", ")).toHaveLength(0);
  });

  it("系统数量在合理范围内（30-40）", () => {
    expect(systemCalls.length).toBeGreaterThanOrEqual(30);
    expect(systemCalls.length).toBeLessThanOrEqual(40);
  });

  it("角色数量在合理范围内（15-25）", () => {
    expect(roleCalls.length).toBeGreaterThanOrEqual(15);
    expect(roleCalls.length).toBeLessThanOrEqual(25);
  });
});
