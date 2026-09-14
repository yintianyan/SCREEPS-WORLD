/**
 * 生产 bundle parity 检查 — 确保 bootstrap 注册的系统/角色名称
 * 全部出现在构建产物 dist/main.js 中。
 *
 * 防止"源码存在、测试存在、生产 bundle 不包含"的半激活状态：
 * 如果一个系统在 bootstrap.ts 注册但被 tree-shake 移除，
 * 或一个角色注册但 rollup 未包含，此测试会响亮失败。
 *
 * 依赖 dist/main.js 存在——由 test:e2e 脚本的 `npm run build` 前置保证
 * （原位于 integration/framework，因 test:integration 无 build 前置导致
 * 单独运行必红，迁入 e2e 流程使依赖关系成立）。
 */
import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GAME_GLOBAL_CONSTANTS } from "../../support/constants";

const BUNDLE_PATH = resolve(__dirname, "../../../dist/main.js");

// e2e 进程不装 Screeps 全局常量（场景只跑 dist bundle），而源码模块链的
// 模块级求值（如 movement/DIR_DELTA）依赖这些常量——动态 import 前先注入，
// 常量值与 unit/integration 共用同一 SSOT（tests/support/constants.ts）。
let registry: (typeof import("../../../src/bootstrap"))["registry"];
beforeAll(async () => {
  Object.assign(globalThis as Record<string, unknown>, GAME_GLOBAL_CONSTANTS);
  ({ registry } = await import("../../../src/bootstrap"));
});

describe("生产 bundle parity — bootstrap 注册集合 vs dist/main.js", () => {
  it("dist/main.js 存在", () => {
    expect(existsSync(BUNDLE_PATH)).toBe(true);
  });

  it("所有注册的系统名称出现在 bundle 中", () => {
    if (!existsSync(BUNDLE_PATH)) return;
    const bundle = readFileSync(BUNDLE_PATH, "utf8");
    const systems = registry.getSystems();
    const missing: string[] = [];
    for (const sys of systems) {
      // 系统名称作为字符串字面量出现在 bundle 中
      // rollup 不会 tree-shake 掉已使用的字符串属性值
      if (!bundle.includes(`"${sys.name}"`)) {
        missing.push(sys.name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("所有注册的角色名称出现在 bundle 中", () => {
    if (!existsSync(BUNDLE_PATH)) return;
    const bundle = readFileSync(BUNDLE_PATH, "utf8");
    const roles = registry.getRoles();
    const missing: string[] = [];
    for (const role of roles) {
      if (!bundle.includes(`"${role.name}"`)) {
        missing.push(role.name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("bootstrap 导出的 registry 和 kernel 出现在 bundle 中", () => {
    if (!existsSync(BUNDLE_PATH)) return;
    const bundle = readFileSync(BUNDLE_PATH, "utf8");
    // registry 和 kernel 是 bootstrap 的导出，应出现在 bundle 中
    expect(bundle).toContain("registry");
    expect(bundle).toContain("kernel");
  });

  it("bundle 不包含已裁决删除的模块（R12③ 自 compliance.test.ts 迁移，R20③）", () => {
    if (!existsSync(BUNDLE_PATH)) return;
    const bundle = readFileSync(BUNDLE_PATH, "utf8");
    const forbidden = [
      "intelligence-pipeline",
      "decision-trace",
      "evaluation-system",
      "EvaluationRegistry",
    ];
    const found = forbidden.filter(keyword => bundle.includes(keyword));
    expect(found, `dist/main.js 包含已删除模块: ${found.join(", ")}`).toHaveLength(0);
  });
});
