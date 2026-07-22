/** 布局阶段 — 对应 RCL 等级区间。 */
export type LayoutPhase = "bootstrap" | "rcl2" | "rcl3" | "rcl4" | "late" | "rcl6" | "rcl7" | "rcl8";

/** 建造优先级 — 0 最高（关键），3 最低。 */
export type BuildPriority = 0 | 1 | 2 | 3;

/** 结构标签 — 用于分类和过滤。 */
export type StructureTag = "core" | "logistics" | "defense" | "road" | "industry";

/**
 * 蓝图单元 — 模板中一个格子的声明。
 * 通过相对锚点的偏移定位，不包含绝对坐标。
 */
export interface BlueprintCell {
  /** 稳定 key，例：core.extension.01 */
  readonly key: string;
  /** 相对锚点的 x 偏移。 */
  readonly dx: number;
  /** 相对锚点的 y 偏移。 */
  readonly dy: number;
  readonly structureType: BuildableStructureConstant;
  /** 建造此结构所需的最低 RCL。 */
  readonly minRcl: number;
  readonly phase: LayoutPhase;
  readonly priority: BuildPriority;
  /** 依赖其他 blueprint key — 前置必须 done 才能建造。 */
  readonly requires?: readonly string[];
  readonly tags: readonly StructureTag[];
}

/**
 * 蓝图 — 一组相对锚点的静态结构声明。
 * 模板保存在代码中，不每房复制到 Memory。
 */
export interface Blueprint {
  readonly id: string;
  readonly anchorKind: "primary-spawn" | "planned-spawn";
  readonly cells: readonly BlueprintCell[];
}

/** validateBuildCell 的返回类型。 */
export type ValidationResult =
  | "ok"
  | "rcl"
  | "terrain"
  | "occupied"
  | "site-limit"
  | "dependency"
  /** 密封守卫：建成后自身无相邻可站格，或会把相邻已有障碍结构封死（建筑孤岛）。 */
  | "seal";

/** 将坐标编码为单个数字：x * 50 + y，范围 0-2499。 */
export function packPos(x: number, y: number): number {
  return x * 50 + y;
}

/** 解码 packed 位置。 */
export function unpackPos(packed: number): { x: number; y: number } {
  return { x: Math.floor(packed / 50), y: packed % 50 };
}

/** 将绝对坐标转为 pos 对象（不含 RoomPosition 方法）。 */
export function absPos(
  anchorX: number,
  anchorY: number,
  cell: BlueprintCell,
  roomName: string,
): { x: number; y: number; roomName: string } {
  return {
    x: anchorX + cell.dx,
    y: anchorY + cell.dy,
    roomName,
  };
}

/** 判断坐标是否在房间边界内（1-48，留出边缘）。 */
export function inBounds(x: number, y: number): boolean {
  return x >= 1 && x <= 48 && y >= 1 && y <= 48;
}
