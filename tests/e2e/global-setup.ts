/** E2E vitest globalSetup — 运行在主进程（非 worker）。 */
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
