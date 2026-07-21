import type { Priority, System, TickContext } from "../kernel/contracts";

/**
 * Pixel 生成系统 — P3 系统，在 CPU bucket 满载时生成 pixel。
 *
 * `Game.cpu.generatePixel()` 消耗 5000 bucket 生成 1 个 pixel。
 * Pixel 可在市场出售换取 credits 或用于装饰。
 * 仅当 bucket 达到 10000（满载）时执行，确保不会与生存竞争 CPU。
 *
 * 优先级：P3 — 纯收益操作，绝不与生存/发展竞争。
 */
export const pixelSystem: System = {
  name: "pixel-generator",
  priority: 3 as Priority,
  interval: 10,
  run(): void {
    if ((Game.cpu.bucket ?? 0) >= 10000) {
      Game.cpu.generatePixel();
    }
  },
};
