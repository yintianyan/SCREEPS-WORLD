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
    // 借用互斥闸：bucket 余量做不了判据（上限=成本，数学上不存在"成本之上的富余"），
    // 能判的只有"借来的那 6 点有没有在养常态负载"。
    // cpuMax10 = 最近 ~100 tick 的 CPU 峰值（telemetry-collector 时序环；该采样系统
    // budgetExempt、不受调度闸 ⇒ 峰值不是被同一道闸筛过的幸存者读数）。峰值达到每 tick
    // 限额 ⇒ 本 tick 额度已被用满，放血会把突发额度连根清掉。
    // 线上实测这样做的代价：一次放血让 bucket 10000→32，此后 1,618 tick 才爬回借用下界
    // 7200；同一条时序环上放血前 139 个采样 cpu 均 19.4 / 拒 7.3 每 tick，放血后 161 个
    // 采样 cpu 15.0 / 拒 25.9 —— 被拒的是建设、规划、情报、战术管线这类有产出的活。
    // 读数缺失或为 0（冷启动、global reset 后环未回填）按不放血处理：满 bucket + 无负载
    // 历史恰恰是放血最贵的时刻。
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
