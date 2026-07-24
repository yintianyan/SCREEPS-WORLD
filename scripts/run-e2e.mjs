/**
 * E2E 测试环境设置脚本。
 *
 * macOS 27 + Node 22 上 isolated-vm 编译需要显式指定 SDK 路径。
 * 这个脚本设置正确的环境变量后运行 vitest。
 *
 * 用法：node scripts/run-e2e.mjs [vitest args]
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// macOS SDK 路径（用于 isolated-vm 原生模块编译）
const sdkPath = execSync("xcrun --show-sdk-path", { encoding: "utf8" }).trim();
const cxxPath = `${sdkPath}/usr/include/c++/v1`;

// 设置环境变量
process.env.SDKROOT = sdkPath;
process.env.CPLUS_INCLUDE_PATH = cxxPath;
process.env.CPPPATH = cxxPath;
process.env.C_INCLUDE_PATH = `${sdkPath}/usr/include`;

// 确保 dist/main.js 存在
if (!existsSync("dist/main.js")) {
  console.error("dist/main.js 不存在，先运行 npm run build");
  process.exit(1);
}

// 运行 vitest
const args = process.argv.slice(2).join(" ");
const cmd = `npx vitest run tests/e2e --testTimeout=300000 --forceExit --pool=forks --poolOptions.forks.singleFork=true ${args}`;
console.log(`运行: ${cmd}`);
console.log(`SDKROOT=${sdkPath}`);

try {
  execSync(cmd, { stdio: "inherit", env: process.env });
} catch {
  process.exit(1);
}
