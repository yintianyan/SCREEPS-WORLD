import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";

/**
 * Pixel 生成系统 — P3 系统，在 CPU bucket 满载时生成 pixel。
 *
 * `Game.cpu.generatePixel()` 消耗 **10000 bucket**（吃光整个 bucket 上限）。
 * 遥测实证：bucket 10000 → 0，随后以 ~+15/tick 净回充爬升 — 注意成本不是 5000，
 * 旧注释的「healthy tier 门禁防跌破阈值」因此形同虚设：每次生成必然清零 bucket。
 *
 * 自愿放血协议：生成后写 Memory.kernel.pixelAt，scheduler 在宽限窗口内把
 * tier 地板抬到 conserve — bucket 清零只损失突发容量，每 tick 20 CPU 限额不变，
 * 常态负载（~2-5 CPU）下经济角色（P0-P2）应照常运行，只有 P3 发展性工作暂停。
 * 无此协议的后果（遥测实录）：每次 pixel → recovery 档 → upgrader/builder 等
 * P2 全停数百 tick → 每 ~660 tick 一轮「creep 不工作」锯齿。
 *
 * 优先级：P3 — 纯收益操作，绝不与生存/发展竞争。
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
    // 私服无 generatePixel API — 安全检查避免每 10 tick 报 TypeError。
    if (typeof Game.cpu.generatePixel !== "function") return;
    if ((Game.cpu.bucket ?? 0) >= 10000) {
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
