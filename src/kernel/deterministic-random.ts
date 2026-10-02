/**
 * 调优探索的**可复现**随机源（#62）。
 *
 * 为什么放在 kernel 而不是 domain/tuning 旁边：架构守卫 R1（`tests/unit/architecture/compliance.test.ts`）
 * 禁止 `domain/**` 引用 `Game./Memory./console.` —— 第一版我把这个文件写在 domain/tuning 里，
 * 被守卫当场拦下（不是我改守卫的理由）。读 Memory 的接缝留在允许读它的层，由 tuning-engine 注入进纯函数评估层。
 *
 * 为什么必须在 src 侧开口而不是在测试里替换 `Math.random`：
 *   bot 代码由 `@screeps/driver` 在 **isolated-vm isolate** 里执行
 *   （`screeps-server-mockup/src/screepsServer.js` 设 `DRIVER_MODULE=@screeps/driver`，
 *   `driver/lib/runtime/make.js`、`user-vm.js` 用 `isolated-vm`），isolate 有自己的一套内建对象
 *   ⇒ 测试进程里对 `Math.random` 的替换**到不了被测物**。10-01 实测：给定同一
 *   `E2E_RANDOM_SEED` 连跑两遍场景 22，世界仍分叉（firstWar 5002 vs 5003）。
 *   isolate 读得到的通道是 `Memory` ⇒ 种子走 Memory。
 *
 * 生产语义不变：**没有 `Memory.kernel.testRandomSeed` 就返回真 `Math.random()`**，
 * 一个字节的行为差别都没有；落种子才切确定性流。
 */

/** mulberry32 的最终混淆步 —— 只要一个"由整数算出的 [0,1) 数"，不需要跨调用连续状态。 */
function mixToUnit(mixed: number): number {
  let t = mixed >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * 与 `Math.random()` 同签名同值域（[0,1)）。
 * 每次调用消耗一个确定性的"调用序号"，同 (seed, 序号) ⇒ 同输出，
 * 于是测试夹具只要把 seed 写进 Memory，两遍跑就能拿到**同一条探索序列**。
 */
export function tuningRandom(): number {
  if (typeof Memory === "undefined") return Math.random();
  const seed = Memory.kernel?.testRandomSeed;
  if (seed === undefined) return Math.random();
  const calls = Memory.kernel!.testRandomCalls ?? 0;
  Memory.kernel!.testRandomCalls = calls + 1;
  // 把 seed 与序号混成 32 位整数；黄金比例常数保证序号相邻也不相关。
  return mixToUnit((seed >>> 0) + Math.imul(calls + 1, 0x9e3779b9));
}
