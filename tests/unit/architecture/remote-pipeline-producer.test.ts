/**
 * 远矿机会管线的"无人接线"契约（B2-10 裁决的落点）。
 *
 * 背景：specialization-planner 的 opportunity → execution-gate → operation 这条链
 * 在 src 内没有生产者 —— `createOpportunity` 零调用，`__remoteOpportunities` 唯一的
 * 写者是把刚读到的列表原样存回去。于是 `checkExecutionGate` 一次也不执行，
 * 而它的输入里 threatClear / empireDemand / budgetSufficient 三项写死为 true。
 *
 * 这是一对必须同时成立或同时不成立的事实，所以用一条互斥断言钉住：
 *   有人接线 ⟺ 三扇纸面门还在
 * 谁先单独动另一半，这里就红：
 *   - 只写生产者、留着 true 输入 → 闸门数字说谎（"10 项检查"里 3 项恒过）；
 *   - 只删 true 输入、仍然没有生产者 → 该删的是整条管线（B7 的六步复验），不是留个
 *     永远不执行的空壳。
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

/** 去掉整行注释，避免注释里提到标识符被当成引用。 */
function codeLines(src: string): string {
  return src
    .split(NL)
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join(NL);
}

const PLANNER = join(SRC, "systems/empire/specialization-planner.ts");

/** createOpportunity 的调用点（定义文件自身除外）。 */
function producerSites(): string[] {
  const bad: string[] = [];
  for (const f of ALL_FILES) {
    const rel = relative(SRC, f);
    if (rel === "domain/remote/remote-opportunity.ts") continue; // 定义所在文件
    const code = codeLines(readFileSync(f, "utf8"));
    for (const line of code.split(NL)) {
      if (/createOpportunity\s*\(/.test(line)) bad.push(`${rel}: ${line.trim()}`);
    }
  }
  return bad;
}

/** 除"读回来原样存回去"之外，是否有别处往机会池里放东西。 */
function opportunityStoreWriters(): string[] {
  const bad: string[] = [];
  for (const f of ALL_FILES) {
    const rel = relative(SRC, f);
    if (rel === "systems/empire/specialization-planner.ts") continue; // 唯一的读回-存回方
    const code = codeLines(readFileSync(f, "utf8"));
    if (code.includes("__remoteOpportunities")) bad.push(rel);
  }
  return bad;
}

/** 三扇纸面门是否仍以字面量 true 存在。 */
function paperGatesStillLiteral(): boolean {
  const code = readFileSync(PLANNER, "utf8");
  return /threatClear:\s*true/.test(code) && /empireDemand:\s*true/.test(code);
}

describe("远矿机会管线：接线状态与纸面门必须同步", () => {
  it("当前无生产者 —— createOpportunity 在 src 内零调用", () => {
    const sites = producerSites();
    expect(
      sites,
      `远矿机会管线出现生产者（${sites.join(" | ")}）。` +
        "接线前必须先把 specialization-planner.buildGateInput 的 threatClear/" +
        "empireDemand/budgetSufficient 三项换成真值采集，并同步更新 execution-gate 的" +
        "「10 项检查」文档与本闸。",
    ).toHaveLength(0);
  });

  it("机会池没有被旁路写入（唯一写者是读回-存回）", () => {
    const writers = opportunityStoreWriters();
    expect(
      writers,
      `__remoteOpportunities 被别处写入（${writers.join(", ")}）—— ` +
        "等同于给管线接了生产者，见上一条用例的接线前置条件。",
    ).toHaveLength(0);
  });

  it("「有人接线」与「纸面门还写着 true」必须一真一假（不得各自漂移）", () => {
    const wired = producerSites().length > 0 || opportunityStoreWriters().length > 0;
    const paper = paperGatesStillLiteral();
    expect(
      wired,
      wired
        ? "管线已接线但三扇门仍写死 true：checkExecutionGate 的通过数在说谎。"
        : "纸面门被删了却仍无生产者：该整体处置这条管线（B7 六步复验），不是留个永不执行的空壳。",
    ).not.toBe(paper);
  });
});
