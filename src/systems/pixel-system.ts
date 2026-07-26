import type { Priority, System, TickContext } from "../kernel/contracts";

/**
 * Pixel 生成系统 — P3 系统，在 CPU bucket 满载时生成 pixel。
 *
 * `Game.cpu.generatePixel()` 消耗 5000 bucket 生成 1 个 pixel。
 * Pixel 可在市场出售换取 credits 或用于装饰。
 * 仅当 bucket 达到 10000（满载）时执行，确保不会与生存竞争 CPU。
 *
 * **Tier 门禁**：只在 healthy tier 下执行。generatePixel 消耗 5000 bucket，
 * 在 guarded tier 下运行可能导致 bucket 跌破 conserve/recovery 阈值，
 * 触发降级死亡螺旋——construction-manager 等 P2 系统被 budget gate 拦截，
 * 关键基建（storage/tower）永远建不成。
 *
 * 优先级：P3 — 纯收益操作，绝不与生存/发展竞争。
 */
export const pixelSystem: System = {
  name: "pixel-generator",
  priority: 3 as Priority,
  interval: 10,
  run(ctx: TickContext): void {
    // 只在 healthy tier 下生成 pixel — generatePixel 消耗 5000 bucket，
    // 在非 healthy tier 下运行可能导致 bucket 跌破阈值触发降级死亡螺旋。
    if (ctx.budget.tier !== "healthy") return;
    // 私服无 generatePixel API — 安全检查避免每 10 tick 报 TypeError。
    if (typeof Game.cpu.generatePixel !== "function") return;
    if ((Game.cpu.bucket ?? 0) >= 10000) {
      Game.cpu.generatePixel();
    }
  },
};
