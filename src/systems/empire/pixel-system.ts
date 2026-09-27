import { CONFIG } from "../../config";
import type { Priority, System, TickContext } from "../../kernel/contracts";

/**
 * Pixel 生成系统 — P3 系统，CPU bucket 满载时生成 pixel。

 * **门槛就是生成成本本身**：`Game.cpu.generatePixel()` 消耗 PIXEL_CPU_COST(=10000)
 * bucket，而 bucket 上限与之相等 —— 攒不出"成本之上的富余"，所以旧策略里
 * `10000 + bucketReserve` 那道门槛永远迈不过去（pixel 从未生成过一次）。

 * 自愿放血协议：生成后写 Memory.kernel.pixelAt，scheduler 在 CONFIG.cpu.pixelGraceTicks
 * 窗口内把 tier 地板抬到 conserve —— 防止看门狗把自愿献血误判为失血性休克。
 * 放血只损失突发容量，每 tick 限额不变，因此 P2 经济角色不应被 recovery 冻结。

 * **与 bucket 借用互斥**（见 run() 里的 cpuMax10 闸）：bucket 在 CONFIG.cpu.borrow 里被
 * 当成"突发额度"用了，而放血的代价恰好等于 bucket 上限 —— 两者不能同时成立。
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
    // 【必要但不充分 — 已被线上否定，2026-09-27】借用互斥闸：峰值达到每 tick 限额即不放血。
    // 当初的算盘是"bucket 余量做不了判据（上限=成本），只能看借来的 6 点在不在养负载"。
    // 实测打脸：放血前那段是 bucket=10000 + tier=healthy + cpu 12.7~15.4 —— 峰值够不到 limit，
    // 这道闸判"没在借用"而放行；同一段却有 18~19 项/tick 被拒。真正的代价也不在借用那 6 点，
    // 而在 **bucket 是档位时钟**：清一次 bucket 要 1,500+ tick 才爬回 healthy，期间 P3 系统
    // 几乎每 tick 被拒（实测 500 tick 窗口 layout-planner/room-observer 各 478 次）。
    // 结论：本帝国不存在"产能用不满"的自洽状态，所以放血的否决权在 `CONFIG.pixel.enabled=false`
    // （见该处注释的完整理由）。这道闸留着只作纵深防御 —— 谁将来重新开启 pixel，它至少挡掉
    // "CPU 已经贴着限额还在放血"这一类最坏的时机，但它单独不构成保障。
    const peak = Memory.kernel?.stats?.cpuMax10 ?? 0;
    if (peak <= 0 || peak >= (Game.cpu.limit ?? 20)) return;
    // 门槛 = 生成成本（bucket 攒满即可，攒不出成本之上的富余）。
    const threshold = CONFIG.pixel.cpuCost;
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
