import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";

/**
 * Pixel 生成系统 — P3 系统，CPU bucket 满载时生成 pixel。
 *
 * **保留缓冲策略**：`Game.cpu.generatePixel()` 消耗 10000 bucket。旧策略满 10000
 * 即清零，bucket 在 0-10000 间锯齿振荡，生成后 tier 跌至 recovery、P3 系统冻结
 * ~700 tick。现改为：bucket 须攒到 `10000 + bucketReserve` 才生成，生成后剩余
 * `bucketReserve` 缓冲（默认 3000）——tier 不跌到 recovery，P3 冻结窗口缩短
 * 到 ~300 tick，帝国始终保留应急 bucket。
 *
 * 自愿放血协议：生成后写 Memory.kernel.pixelAt，scheduler 在宽限窗口内把 tier
 * 地板抬到 conserve——防止看门狗把自愿献血误判为失血性休克。
 */
export const pixelSystem: System = {
  name: "pixel-generator",
  priority: 3 as Priority,
  interval: 10,
  run(ctx: TickContext): void {
    // 总开关：默认关闭 — 放血清零 bucket 与 global reset 撞车会触发
    // reload death loop（详见 CONFIG.pixel.enabled 注释），收益抵不上风险。
    if (!CONFIG.pixel.enabled) return;
    // 只在 healthy tier 下生成 — 保证放血起点是满 bucket + 低负载。
    if (ctx.budget.tier !== "healthy") return;
    // war 姿态不放血 — bucket 突发容量留给战时计算（塔防/编队/物流全速），
    // 且放血后的 P3 降档窗口会禁掉遥测与调参等战时支撑系统。
    if (Memory.kernel?.strategy?.posture === "war") return;
    // 私服无 generatePixel API — 安全检查避免每 10 tick 报 TypeError。
    if (typeof Game.cpu.generatePixel !== "function") return;
    // 保留缓冲策略：门槛 = 10000（生成消耗）+ bucketReserve（生成后保留的缓冲）。
    // bucketReserve=0 时退化为旧行为（满 10000 即清零）。
    const reserve = CONFIG.pixel.bucketReserve ?? 0;
    const threshold = 10000 + reserve;
    if ((Game.cpu.bucket ?? 0) >= threshold) {
      const result = Game.cpu.generatePixel();
      if (result === OK) {
        // 记录放血时刻 — scheduler 据此启用宽限（tier 地板 conserve），
        // 防止看门狗把自愿献血误判为失血性休克。
        if (!Memory.kernel) Memory.kernel = {};
        Memory.kernel.pixelAt = ctx.tick;
      }
    }
  },
};
