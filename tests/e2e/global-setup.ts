/**
 * E2E vitest globalSetup — 运行在主进程（非 worker）。
 *
 * 为什么需要这个文件（挂起根因链）：
 * 1. screeps-server-mockup 的 storage 子进程无法优雅关闭；
 * 2. @screeps/common storage.js 的 socket error/end handler 会
 *    setTimeout(_connect, 1000) 无限重连，worker 事件循环永不空闲；
 * 3. vitest v2.1.9 正常结束路径是 ctx.close()（非 ctx.exit()），
 *    pool.close() 等待 worker 自然退出 → 永久挂起（teardownTimeout
 *    兜底只挂在 ctx.exit() 的 Ctrl+C 路径上，正常路径无兜底）。
 *
 * 解法：globalSetup 的 teardown 在 pool.close() 之前运行（主进程，
 * process.exit 不被 vitest patch）。设置 unref'd 强退定时器：
 * - 若 pool.close() 自然完成：事件循环只剩本 unref'd timer → 进程
 *   自然退出，timer 不触发；
 * - 若挂起：5s 后 process.exit(process.exitCode ?? 0)，退出码与
 *   vitest 已设置的值一致（runTests 完成即设 exitCode=1 on failure）。
 */
export default function globalSetup(): Promise<void> | (() => Promise<void>) {
  return async function teardown(): Promise<void> {
    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn(
        "[e2e-global-setup] pool close 挂起（storage 重连 timer hold 住 worker），强制退出主进程。",
      );
      process.exit(process.exitCode ?? 0);
    }, 5000);
    // unref：不阻止进程自然退出；仅在其他 handle 全部释放后才允许触发。
    timer.unref?.();
  };
}
