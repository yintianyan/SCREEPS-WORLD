/**
 * E2E 测试全局 setup。
 *
 * 职责：
 *   - 确保 dist/main.js 存在
 *   - 设置环境变量（macOS SDK 路径）
 *   - 全局清理钩子
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { afterAll, beforeAll } from "vitest";

beforeAll(() => {
  // 确保 dist/main.js 存在
  if (!existsSync("dist/main.js")) {
    throw new Error(
      "dist/main.js 不存在。E2E 测试需要先运行 `npm run build` 构建产物。",
    );
  }

  // macOS SDK 路径（用于 isolated-vm 原生模块）
  try {
    const sdkPath = execSync("xcrun --show-sdk-path", { encoding: "utf8" }).trim();
    process.env.SDKROOT = sdkPath;
    process.env.CPLUS_INCLUDE_PATH = `${sdkPath}/usr/include/c++/v1`;
  } catch {
    // 非 macOS 环境，忽略
  }
});

afterAll(() => {
  // 全局清理留空——screeps-server-mockup 的清理在每个 ScenarioRunner.teardown() 中处理
});
