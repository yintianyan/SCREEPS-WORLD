/**
 * 状态指示灯 — 在 creep 头顶绘制红/黄/绿灯，可视化诊断 creep 工作状态。
 *
 * 语义映射（基于 CreepMode FSM，零侵入——不读 action 内部状态）：
 *   work    → 绿灯：正在工作（建造 / 升级 / 填充 / 维修 / 采集 / 倒能）
 *   acquire → 黄灯：取能途中（背包空，通勤去采集 / withdraw 的路上）
 *   idle    → 红灯：空闲（无匹配候选 / 门禁拦截 / 待回收）
 *   flee    → 橙灯：逃跑（检测到威胁——异常态，必须可视化）
 *
 * 为何用 RoomVisual.circle 而非 Creep.say：
 *   - circle 是纯渲染色块，更像"红绿灯"；say 是文字气泡
 *   - 不占用 say 通道（保留给未来调试输出 / 紧急广播）
 *   - RoomVisual 每 tick 自动清除，无需手动清理
 *
 * CPU 影响（[Facts] Screeps 官方 RoomVisual 为纯客户端渲染）：
 *   每次 circle 调用约 0.001-0.005 CPU。
 *   默认关闭（CONFIG.debug.statusLight = false），诊断时开启。
 *   10 房 × 30 creep ≈ 300 次/tick ≈ 0.3-1.5 CPU/tick，在 20 CPU 预算下可接受。
 *
 * 插入点：role-runner 的 run() 末端（try/finally），所有 return 后统一绘制。
 *   不侵入 ActionCandidate 架构，不改 action 签名，不改 Memory 结构。
 *
 * 已知精度边界（[Experience]）：
 *   work 模式下 creep 可能仍在移动（未到工地）。要精确区分"在干活 vs 在移动"
 *   需侵入 action.execute 让其返回状态——违背可插拔原则，当前不做。
 *   基于 mode 的三色灯已满足诊断需求，精度提升属 P2 级。
 */
import { CONFIG } from "../../config";

/** CreepMode → 颜色映射。未匹配的 mode 回退到 idle 的红色。 */
const STATUS_COLORS: Record<string, string> = {
  work: "#2ecc40", // 绿
  acquire: "#ffdc00", // 黄
  idle: "#ff4136", // 红
  flee: "#ff851b", // 橙（逃跑，异常态）
};

/**
 * 在 creep 头顶绘制状态指示灯。
 *
 * 仅当 CONFIG.debug.statusLight 开启时绘制；关闭时直接 return，零开销。
 * 在 creep 上方一格画半径 0.2 的小圆（不遮挡 creep 本体）。
 * y 坐标 clamp 到 [0, 49]，防止越界到相邻房间。
 */
export function drawStatusLight(creep: Creep): void {
  if (!CONFIG.debug.statusLight) return;

  const mode = creep.memory.mode ?? "idle";
  const color = STATUS_COLORS[mode] ?? STATUS_COLORS.idle!;

  // 在 creep 上方一格画小圆（红绿灯效果）。
  // y=0 时画在原地（已 clamp），避免越界到上一房间。
  const y = Math.max(0, creep.pos.y - 1);

  creep.room.visual.circle(creep.pos.x, y, {
    fill: color,
    radius: 0.2,
    opacity: 1,
  });
}
