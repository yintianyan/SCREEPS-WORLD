/** E2E 测试全局 setup。 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { GAME_GLOBAL_CONSTANTS } from "../support/constants";

/**
 * 官方常量注入必须发生在**测试模块被装载之前**：`src/domain/layout` 的蓝图模块
 * 在模块作用域读 STRUCTURE_* 常量，测试文件只要 import 它就会在缺失时拿到 undefined。
 * setupFiles 正是这个时机（单个场景里再 Object.assign 已太晚，且会重复）。
 */
Object.assign(globalThis as Record<string, unknown>, GAME_GLOBAL_CONSTANTS);

/**
 * `E2E_RANDOM_SEED=<整数>` 时把 Math.random 换成可复现序列（mulberry32）；未给则保持真随机。
 *
 * 动机（10-01 实测）：`src/domain/tuning/evaluator.ts:903-905` 的随机探索分支每次抽**一个随机参数
 * + 一个随机方向**去改 roleBounds，`src/systems/room/spawn-manager.ts:505` 的 creep 名后缀也抽随机。
 * 前者是**生产行为** ⇒ 9000 拍的 soak 世界每次都不同（同一份 dist 两次单跑 bandTicks 3 vs 0、
 * finalSpawned 17 vs 20），于是任何"某个计数必须为 0"式断言都骑在随机相位上 —— E2E-022 那次红就是这么来的，
 * 与被测改动无关。留开关不开默认，是因为服务器端口分配（ServerHarness.ts:25,30）需要真实变化。
 *
 * ⚠️生效前提：bot 与本进程同一个 JS realm。若 @screeps/driver 把 bot 放进 isolated-vm 沙箱，
 * 这里改不到它 —— 判据：给定同一 seed 连跑两次场景，世界读数必须逐字相同；不一致就说明要改到 src 侧注入。
 */
function installDeterministicRandom(): void {
  const raw = process.env.E2E_RANDOM_SEED;
  if (raw === undefined || raw === "") return;
  let state = Number(raw) >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  console.log(`[e2e setup] deterministic Math.random installed (seed=${raw})`);
}
installDeterministicRandom();

/**
 * 检测 @screeps/driver 的 runtime.snapshot.bin 是否与当前 Node **大版本**兼容。
 *
 * 历史形状（本次改掉）：这里曾委托 `scripts/rebuild-driver-snapshot.js`，而那个脚本已在
 * `58a65562`（"remove obsolete tools/scripts"）里被删；本函数却仍打印"请去运行它"——
 * 一条指向不存在文件的指令，且那句"postinstall 同源逻辑"也不成立（package.json 无 postinstall）。
 * driver 自带 `make-runtime-snapshot.js`，并把构建时的大版本写进 `build/.snapshot-node-version`
 * （现读内容＝"24"）⇒ 改成**自己比对 marker、只在真不匹配时**跑 driver 自带的重建。
 */
function ensureDriverSnapshot(): void {
  const driverRoot = resolve(process.cwd(), "node_modules/@screeps/driver");
  const marker = resolve(driverRoot, "build/.snapshot-node-version");
  const makeScript = resolve(driverRoot, "make-runtime-snapshot.js");
  // 装法不含快照（源码安装／新版改了布局）⇒ 不干预，也不报警。
  if (!existsSync(marker) || !existsSync(makeScript)) return;
  let built: string | null = null;
  try {
    built = readFileSync(marker, "utf8").trim();
  } catch {
    built = null;
  }
  const running = process.versions.node.split(".")[0];
  if (built === running) return; // 兼容 ⇒ 静默（旧版无论相容与否都先吼一声）
  console.warn(
    `[e2e setup] driver 快照由 Node ${built ?? "?"} 构建、当前 ${running} ⇒ 重建 runtime.snapshot.bin`,
  );
  try {
    // execFileSync ＋ argv 数组：不过 shell（无元字符拼接面），且用**当前跑测试的这个 node**
    // （process.execPath）重建——快照必须与它同版本，用 PATH 上碰巧的 node 反而会再错一次。
    execFileSync(process.execPath, [makeScript], {
      encoding: "utf8",
      stdio: "pipe",
      cwd: process.cwd(),
    });
  } catch {
    // 重建失败不阻塞 — 真不兼容时测试自己会崩，那时错误信息才是权威的
  }
}

/**
 * 检测 isolated-vm 原生模块 ABI 兼容性。
 * 当 Node 大版本升级后，旧的 .node 二进制的 ABI 版本不匹配，
 * 需要重新编译。
 */
function ensureIsolatedVmAbi(): void {
  try {
    const ivmPath = require.resolve("@screeps/driver/node_modules/isolated-vm");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
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
    throw new Error("dist/main.js 不存在。E2E 测试需要先运行 `npm run build` 构建产物。");
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
