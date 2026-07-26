/**
 * Industry 模块类型定义。
 *
 * 设计原则：
 *   - 纯数据描述，不含 Game API 调用。
 *   - 反应链和 boost 决策均为纯函数，可独立测试。
 *   - 预留多房间扩展接口（TerminalPolicy）。
 */

// ─── Screeps 化合物常量 ─────────────────────────────────────

/** 基础矿物（房间矿脉产出）。 */
export type BaseMineral = "H" | "O" | "U" | "L" | "K" | "Z" | "X";

/** 所有化合物类型（含基础矿物）。 */
export type Compound =
  | BaseMineral
  // Tier 1
  | "UH" | "UO" | "ZH" | "ZO" | "LH" | "LO" | "KH" | "KO" | "GH" | "GO"
  // Tier 2
  | "UH2O" | "UHO2" | "ZH2O" | "ZHO2" | "LH2O" | "LHO2" | "KH2O" | "KHO2" | "GH2O" | "GHO2"
  // Tier 3 (X-compounds)
  | "XUH2O" | "XUHO2" | "XZH2O" | "XZHO2" | "XLH2O" | "XLHO2" | "XKH2O" | "XKHO2" | "XGH2O" | "XGHO2"
  // 中间产物
  | "OH" | "ZK" | "UL" | "G";

/** Boost 效果类别。 */
export type BoostEffect = "harvest" | "upgrade" | "attack" | "rangedAttack" | "heal" | "repair" | "dismantle" | "carry" | "move" | "tough";

// ─── 反应规划 ───────────────────────────────────────────────

/** 单个反应步骤：两种输入 → 一种输出。 */
export interface ReactionStep {
  readonly input1: Compound;
  readonly input2: Compound;
  readonly output: Compound;
  /** 本批次需要生产的数量。 */
  readonly amount: number;
}

/** 反应链规划结果。 */
export interface ReactionPlan {
  /** 有序反应步骤（从基础到高级）。 */
  readonly steps: readonly ReactionStep[];
  /** 最终目标产物。 */
  readonly target: Compound;
  /** 目标数量。 */
  readonly targetAmount: number;
}

// ─── Lab 分配 ───────────────────────────────────────────────

/** Lab 在当前 tick 的角色。 */
export type LabRole = "input1" | "input2" | "output" | "boost" | "idle";

/** Lab 分配方案（单 tick）。 */
export interface LabAssignment {
  readonly labId: string;
  readonly role: LabRole;
  /** boost 模式下需要服务的 creep 名。 */
  readonly boostTarget?: string;
  /** boost 模式下使用的化合物。 */
  readonly boostCompound?: Compound;
}

/** 完整的 lab 分配方案（单 tick）。 */
export interface LabPlan {
  readonly assignments: readonly LabAssignment[];
  /** 本 tick 应执行的反应（如果有）。 */
  readonly reaction?: ReactionStep;
}

// ─── Boost 决策 ─────────────────────────────────────────────

/** Boost 请求：某个 creep 需要某种 boost。 */
export interface BoostRequest {
  readonly creepName: string;
  readonly compound: Compound;
  /** 需要 boost 的 body part 数量。 */
  readonly bodyParts: number;
  /** 优先级（越高越先执行）。 */
  readonly priority: number;
}

/** Boost 策略配置。 */
export interface BoostPolicy {
  /** 角色 → 期望 boost 化合物映射。 */
  readonly roleBoosts: Readonly<Record<string, Compound>>;
  /** 最低 RCL 才启用 boost。 */
  readonly minRcl: number;
  /** storage 中化合物低于此量时停止 boost（保留反应原料）。 */
  readonly reserveAmount: number;
}

// ─── Terminal 策略（预留多房间扩展） ─────────────────────────

/** Terminal 传输请求。 */
export interface TerminalTransfer {
  readonly resourceType: string;
  readonly amount: number;
  readonly targetRoom: string;
  readonly priority: number;
}

/** Terminal 策略接口 — 未来多房间资源调度的扩展点。 */
export interface TerminalPolicy {
  /** 计算本 tick 的传输计划。 */
  planTransfers(roomName: string, available: Readonly<Record<string, number>>): readonly TerminalTransfer[];
}

// ─── 反应配方表 ─────────────────────────────────────────────

/** 所有反应的配方映射：output → [input1, input2]。 */
export const REACTIONS: Readonly<Record<string, readonly [Compound, Compound]>> = {
  // Tier 1
  UH: ["U", "H"],
  UO: ["U", "O"],
  ZH: ["Z", "H"],
  ZO: ["Z", "O"],
  LH: ["L", "H"],
  LO: ["L", "O"],
  KH: ["K", "H"],
  KO: ["K", "O"],
  GH: ["G", "H"],
  GO: ["G", "O"],
  // 中间产物
  OH: ["O", "H"],
  ZK: ["Z", "K"],
  UL: ["U", "L"],
  G: ["ZK", "UL"],
  // Tier 2
  UH2O: ["UH", "OH"],
  UHO2: ["UO", "OH"],
  ZH2O: ["ZH", "OH"],
  ZHO2: ["ZO", "OH"],
  LH2O: ["LH", "OH"],
  LHO2: ["LO", "OH"],
  KH2O: ["KH", "OH"],
  KHO2: ["KO", "OH"],
  GH2O: ["GH", "OH"],
  GHO2: ["GO", "OH"],
  // Tier 3
  XUH2O: ["X", "UH2O"],
  XUHO2: ["X", "UHO2"],
  XZH2O: ["X", "ZH2O"],
  XZHO2: ["X", "ZHO2"],
  XLH2O: ["X", "LH2O"],
  XLHO2: ["X", "LHO2"],
  XKH2O: ["X", "KH2O"],
  XKHO2: ["X", "KHO2"],
  XGH2O: ["X", "GH2O"],
  XGHO2: ["X", "GHO2"],
};

/** Boost 化合物 → 效果类别映射（用于决策）。
 *
 * 与引擎 BOOSTS 常量逐行对齐 — 化合物线路与效果的对应关系容易记错
 *（例如 UH 线是 attack 而非 harvest，harvest 是 UO 线），
 * 映射错误会让整条 lab 反应链产出无用化合物。
 */
export const BOOST_EFFECTS: Readonly<Record<string, BoostEffect>> = {
  // U 线：UH = attack，UO = harvest。
  UH: "attack", UH2O: "attack", XUH2O: "attack",
  UO: "harvest", UHO2: "harvest", XUHO2: "harvest",
  // G 线：GH = upgrade，GO = tough（承伤减免）。
  GH: "upgrade", GH2O: "upgrade", XGH2O: "upgrade",
  GO: "tough", GHO2: "tough", XGHO2: "tough",
  // L 线：LH = build/repair，LO = heal。
  LH: "repair", LH2O: "repair", XLH2O: "repair",
  LO: "heal", LHO2: "heal", XLHO2: "heal",
  // Z 线：ZH = dismantle，ZO = move（疲劳减免）。
  ZH: "dismantle", ZH2O: "dismantle", XZH2O: "dismantle",
  ZO: "move", ZHO2: "move", XZHO2: "move",
  // K 线：KH = carry，KO = rangedAttack。
  KH: "carry", KH2O: "carry", XKH2O: "carry",
  KO: "rangedAttack", KHO2: "rangedAttack", XKHO2: "rangedAttack",
};
