import { defineConfig } from "vitest/config";

/**
 * 默认 vitest 配置 — 跑 unit + integration，排除 e2e。
 *
 * 分层：
 *   - `npm test`：跑 unit + integration（快，不需要 build）
 *   - `npm run test:unit`：只跑 unit
 *   - `npm run test:integration`：只跑 integration
 *   - `npm run test:e2e`：跑 e2e（需要先 build + screeps-server-mockup）
 *
 * e2e 由 vitest.e2e.config.ts 单独配置，用 singleFork 避免原生模块冲突。
 */
export default defineConfig({
  test: {
    setupFiles: ["tests/setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
