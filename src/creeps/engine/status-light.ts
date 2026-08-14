/**
 * 状态指示灯 — creep 头顶红/黄/绿灯，可视化诊断工作状态（零侵入，不读 action 内部）。
 *   work → 绿（工作）/ acquire → 黄（取能途中）/ idle → 红（空闲）/ flee → 橙（逃跑，异常态）
 * 用 RoomVisual.circle 而非 say：不占 say 通道，且每 tick 自动清除无需清理。
 * CPU（[Facts] 官方 RoomVisual 纯客户端渲染）：每次约 0.001-0.005，默认关闭
 * （CONFIG.debug.statusLight = false），10 房 × 30 creep ≈ 0.3-1.5 CPU/tick 可接受。
 * 插入点：role-runner 的 run() 末端（try/finally），所有 return 后统一绘制。
 * 精度边界（[Experience]）：work 下 creep 可能仍在移动——精确区分需侵入 execute 返回状态，
 * 违背可插拔原则，当前不做（P2 级）。
 */
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
