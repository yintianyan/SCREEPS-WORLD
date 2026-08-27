/** 状态指示灯 — creep 头顶红/黄/绿灯，可视化诊断工作状态（零侵入，不读 action 内部）。 */
import { CONFIG } from "../../config";

/** CreepMode → 颜色映射。未匹配的 mode 回退到 idle 的红色。 */
const STATUS_COLORS: Record<string, string> = {
  work: "#2ecc40",
  acquire: "#ffdc00",
  idle: "#ff4136",
  flee: "#ff851b", // 橙（逃跑，异常态）
};

/** 在 creep 头顶绘制状态指示灯。仅 CONFIG.debug.statusLight 开启时绘制，关闭时零开销。
 * 在 creep 上方一格画半径 0.2 小圆，y clamp 到 [0, 49] 防止越界到相邻房间。 */
export function drawStatusLight(creep: Creep): void {
  if (!CONFIG.debug.statusLight) return;

  const mode = creep.memory.mode ?? "idle";
  const color = STATUS_COLORS[mode] ?? STATUS_COLORS.idle!;

  const y = Math.max(0, creep.pos.y - 1);

  creep.room.visual.circle(creep.pos.x, y, {
    fill: color,
    radius: 0.2,
    opacity: 1,
  });
}
