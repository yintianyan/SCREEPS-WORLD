/**
 * vitest E2E 配置。
 *
 * E2E 测试特点：
 *   - 依赖 screeps-server-mockup（真实 Screeps 引擎）
 *   - 每个 test 文件独立 server 实例
 *   - 需要长 timeout（server 启动 + 多 tick）
 *   - 单进程跑（避免原生模块冲突）
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    exclude: ["tests/integration/**", "tests/*.test.ts"],
    testTimeout: 300000, // 5 分钟
    hookTimeout: 120000, // 2 分钟
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // 单进程，避免 screeps-server-mockup 原生模块冲突
      },
    },
    forceExit: true, // screeps-server-mockup 的 storage 无法优雅关闭
    setupFiles: ["tests/e2e/setup.ts"],
  },
});
