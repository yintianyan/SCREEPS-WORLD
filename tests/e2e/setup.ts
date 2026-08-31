/** E2E 测试全局 setup。 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll } from "vitest";

/**
 * 检测 @screeps/driver 的 runtime.snapshot.bin 是否与当前 Node 版本兼容。
 * 委托 scripts/rebuild-driver-snapshot.js（postinstall 同源逻辑），避免双实现。
 */
function ensureDriverSnapshot(): void {
  const rebuildScript = resolve(
    process.cwd(),
    "scripts/rebuild-driver-snapshot.js",
  );
  if (!existsSync(rebuildScript)) {
    console.warn(
      "[e2e setup] scripts/rebuild-driver-snapshot.js not found. " +
        "If e2e tests crash with 'Version mismatch between V8 binary and snapshot', " +
        "run: node scripts/rebuild-driver-snapshot.js --force",
    );
    return;
  }
  try {
    execSync(`node "${rebuildScript}"`, {
      encoding: "utf8",
      stdio: "pipe",
      cwd: process.cwd(),
    });
  } catch {
    // rebuild 失败不阻塞 — 测试会在不兼容时自然报错
  }
}

/**
 * 检测 isolated-vm 原生模块 ABI 兼容性。
 * 当 Node 大版本升级后，旧的 .node 二进制的 ABI 版本不匹配，
 * 需要重新编译。
 */
function ensureIsolatedVmAbi(): void {
  try {
    const ivmPath = require.resolve(
      "@screeps/driver/node_modules/isolated-vm",
    );
    const ivm = require(ivmPath);
    const isolate = new ivm.Isolate();
    isolate.dispose();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("ERR_DLOPEN_FAILED") ||
      msg.includes("NODE_MODULE_VERSION") ||
      msg.includes("was compiled against a different Node.js version")
    ) {
      const env = { ...process.env };
      try {
        const sdkPath = execSync("xcrun --show-sdk-path", {
          encoding: "utf8",
        }).trim();
        if (sdkPath) {
          env.SDKROOT = sdkPath;
          env.CPLUS_INCLUDE_PATH = `${sdkPath}/usr/include/c++/v1`;
        }
      } catch {
        // 非 macOS
      }
      execSync("npm rebuild @screeps/driver", {
        encoding: "utf8",
        stdio: "pipe",
        env,
      });
    } else {
      throw err;
    }
  }
}

beforeAll(() => {
  // 确保 dist/main.js 存在
  if (!existsSync("dist/main.js")) {
    throw new Error(
      "dist/main.js 不存在。E2E 测试需要先运行 `npm run build` 构建产物。",
    );
  }

  // macOS SDK 路径（用于 isolated-vm 原生模块编译）
  try {
    const sdkPath = execSync("xcrun --show-sdk-path", { encoding: "utf8" }).trim();
    process.env.SDKROOT = sdkPath;
    process.env.CPLUS_INCLUDE_PATH = `${sdkPath}/usr/include/c++/v1`;
  } catch {
    // 非 macOS 环境
  }

  // 检测并修复 ABI 兼容性（Node 大版本升级后需要）
  ensureIsolatedVmAbi();

  // 检测并修复 V8 snapshot 兼容性（Node 大版本升级后需要）
  ensureDriverSnapshot();
});

afterAll(() => {
  // screeps-server-mockup 的 storage 挂起问题由两层机制处理：
  // 1. ServerHarness.dispose()：SIGKILL 子进程 + disconnect IPC；
  // 2. global-setup.ts teardown（主进程）：unref'd 强退兑底。
  // 本文件不再做进程退出操作。
});

// 防孤儿 worker：主进程退出后（IPC channel 断开）worker 自杀。
// storage 重连 timer 会 hold 住 worker 事件循环，主进程死后 worker
// 变孤儿进程永远跑重连循环。reallyExit 是 Node 底层退出，不被
// vitest 的 process.exit patch 拦截。
process.on("disconnect", () => {
  (process as any).reallyExit(0);
});
