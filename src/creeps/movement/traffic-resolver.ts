/** 交通解算器 — 纯函数，零 Game 依赖，Vitest 直测。输入：单房本 tick 全部移动意图、 */

/** 单条移动意图。from/to 为 packed 坐标。 */
export interface MoveIntent {
  name: string;
  from: number;
  to: number;
  priority: number;
}

/** 解算输入。 */
export interface ResolveInput {
  /** 本房全部移动意图（登记序）。 */
  intents: readonly MoveIntent[];
  /** 锚定声明：creep 名 → 锚定优先级。仅对「无移动意图」的 creep 生效。 */
  anchors: ReadonlyMap<string, number>;
  /** 全量占位：packed 格 → creep 名（含有意图者、静止者、敌方 creep）。 */
  occupancy: ReadonlyMap<number, string>;
  /** 不可动名单（疲劳中的己方 creep + 全部敌方 creep）：不可移动、不可被推挤。 */
  immovable: ReadonlySet<string>;
  /**
   * 推挤落格候选：给定 packed 格，返回按优先序排列的可站邻格
   * （地形可走、无阻挡结构；调用方负责排序——非关键格/非 road 在前）。
   * 返回中可以包含被静止 creep 占据的格（供链式推挤），
   * 但不得包含被「有意图 creep」占据的格。
   */
  shoveCandidates: (tile: number) => readonly number[];
}

/** 推挤被拒的原因（读数用 — 线上「顶格优先级的 creep 被静止者挡死」必须能分诊）。 */
export type ShoveFailReason =
  /** 占用者在不可动名单（疲劳的己方 creep / 敌方 creep）。 */
  | "immovable"
  /** 占用者的锚定优先级 >= 移动方优先级（站桩角色按设计不被推）。 */
  | "anchor"
  /** 8 邻域找不到合法落格（含链式推挤到 MAX_SHOVE_DEPTH 仍无解）⇒ 口袋死锁。 */
  | "no-landing";

/** 解算输出：creep 名 → 目标 packed 格（含被批准的意图与推挤指令）。 */
export interface ResolveOutput {
  moves: Map<string, number>;
  /** 本 tick 推挤被拒的次数，按原因分档（只计顶层尝试）。 */
  shoveFails: Partial<Record<ShoveFailReason, number>>;
}

/** 推挤链最大深度：A 推 B、B 推 C 即到上限，再深的连环推放弃。 */
const MAX_SHOVE_DEPTH = 2;

/**
 * 解算一个房间的全部移动意图。

 * 复杂度 O(n·log n + n·k)（n = 意图数，k = 邻格数），
 * 对单房数十 creep 规模远低于一次 PathFinder.search。
 */
export function resolveTraffic(input: ResolveInput): ResolveOutput {
  const { anchors, occupancy, immovable, shoveCandidates } = input;

  // 稳定排序：priority 降序，平局保持登记序。
  const sorted = input.intents
    .map((intent, order) => ({ intent, order }))
    .sort((a, b) =>
      b.intent.priority !== a.intent.priority
        ? b.intent.priority - a.intent.priority
        : a.order - b.order,
    )
    .map(e => e.intent);

  const intentByName = new Map<string, MoveIntent>();
  for (const it of sorted) {
    // 同名多意图取最先（排序后即最高优）— 正常管线每 creep 每 tick 至多一条。
    if (!intentByName.has(it.name)) intentByName.set(it.name, it);
  }

  // 同格仲裁：每个目标格只留最高优意图。
  const targetWinner = new Map<number, MoveIntent>();
  const arbitrated: MoveIntent[] = [];
  for (const it of intentByName.values()) {
    if (it.to === it.from) continue; // 原地意图无意义，丢弃。
    if (targetWinner.has(it.to)) continue; // 已有更高优者赢得该格。
    targetWinner.set(it.to, it);
    arbitrated.push(it);
  }

  const moves = new Map<string, number>();
  /** 本轮已被批准指令占用的目标格（意图 + 推挤落格），防重复落格。 */
  const reservedTiles = new Set<number>();

  /** creep 的有效静止优先级：锚定值（无锚 = 0）。有意图者不适用本函数。 */
  const staticPriority = (name: string): number => anchors.get(name) ?? 0;

  /**
   * 推挤被拒计数（只记顶层尝试）：嵌套链的失败会在同一格上重复计数，
   * 而「一次被挡」才是移动方真正承受的事件 —— 深一层的读数没有决策价值。
   */
  const fails: Partial<Record<ShoveFailReason, number>> = {};

  /** 破环轮标记：只有"整轮零批准且仍有 pending"（环的形状）才会开启，见主循环。 */
  let cyclePass = false;

  /**
   * 尝试把静止 creep（blockerName，位于 tile）推挤出去。
   * 成功时写入 moves/reservedTiles 并返回 true。
   */
  const tryShove = (
    blockerName: string,
    tile: number,
    moverPriority: number,
    depth: number,
  ): boolean => {
    const note = (reason: ShoveFailReason): void => {
      if (depth === 1) fails[reason] = (fails[reason] ?? 0) + 1;
    };
    if (depth > MAX_SHOVE_DEPTH) return false;
    if (immovable.has(blockerName)) {
      note("immovable");
      return false;
    }
    if (moves.has(blockerName)) return false; // 本轮已被批准移动 ⇒ 它自己会让位，不必推
    // 正常轮里「有意图的占用者」交给跟车处理；只有**破环轮**才把它当静止者推开。
    // 健康跟车链第一轮必有批准，走不到破环轮 ⇒ 多轮传播不被误伤。
    if (intentByName.has(blockerName) && !cyclePass) return false;
    if (staticPriority(blockerName) >= moverPriority) {
      note("anchor");
      return false; // 锚定豁免。
    }

    const candidates = shoveCandidates(tile);
    // 先找直接空格（跳过已预定格与仲裁胜者的目标格 — 后者即将有人落入）。
    for (const c of candidates) {
      if (reservedTiles.has(c) || targetWinner.has(c)) continue;
      if (!occupancy.has(c)) {
        moves.set(blockerName, c);
        reservedTiles.add(c);
        return true;
      }
    }
    // 无空格 — 尝试链式推挤下一层静止者。
    for (const c of candidates) {
      if (reservedTiles.has(c) || targetWinner.has(c)) continue;
      const nextBlocker = occupancy.get(c);
      if (nextBlocker === undefined) continue;
      if (moves.has(nextBlocker)) continue; // 已有指令（含已被推挤）— 该格即将空出但不可再叠推。
      if (tryShove(nextBlocker, c, moverPriority, depth + 1)) {
        moves.set(blockerName, c);
        reservedTiles.add(c);
        return true;
      }
    }
    note("no-landing");
    return false;
  };

  // 迭代放行：跟车链（A 等 B 走、B 等 C 走）需要多轮传播。
  // 每轮至少批准一条才继续；**整轮零批准**时只再开一轮「破环轮」，之后收摊 ⇒ 不会死循环。
  let pending = arbitrated;
  let progressed = true;
  let cyclePassUsed = false;
  while (pending.length > 0) {
    progressed = false;
    const next: MoveIntent[] = [];
    for (const it of pending) {
      const occupant = occupancy.get(it.to);
      // 目标格无人，或占用者本轮已被批准移走（跟车/落格已让位）。
      if (occupant === undefined || moves.has(occupant)) {
        if (reservedTiles.has(it.to)) continue; // 已被换位/落格预定 — 放弃。
        moves.set(it.name, it.to);
        reservedTiles.add(it.to);
        progressed = true;
        continue;
      }
      // 对向换位：占用者的意图恰好指向本 creep 的出发格。
      // 守卫：占用者必须同时是其目标格的仲裁胜者 — 否则可能与
      // 争夺同一出发格的更高优意图产生双 creep 落同格冲突。
      const occupantIntent = intentByName.get(occupant);
      if (
        occupantIntent &&
        occupantIntent.to === it.from &&
        targetWinner.get(occupantIntent.to) === occupantIntent &&
        !reservedTiles.has(occupantIntent.to)
      ) {
        moves.set(it.name, it.to);
        moves.set(occupant, occupantIntent.to);
        reservedTiles.add(it.to);
        reservedTiles.add(occupantIntent.to);
        progressed = true;
        continue;
      }
      // 占用者有意图但去别处 — 等下一轮看它是否被批准（跟车）。
      // ⚠️ 但「等」对**环**是永不止息的等待：A 踩 B 的格、B 踩 C 的格、C 踩 A 的格时，
      // 每一轮三条意图都被挂到 next 而零批准 ⇒ while 循环因 progressed=false 直接收摊，
      // 三方每拍重演同一幕（线上实测：W37S58 两只 remoteHauler + 一只 reserver 互相钉死
      // stuck 380+ 拍、ttl 一路耗干 ⇒ 远矿收入直接停工）。
      // 破环规则保持最小：占用者**本轮没被批准移动**就当它是静止者，走同一套推挤
      // （仍受不可动名单 / 锚定豁免 / 必须有合法落格三道闸约束，推不动就照旧等待）。
      if (occupantIntent && (moves.has(occupant) || !cyclePass)) {
        next.push(it);
        continue;
      }
      // 占用者是静止者，或有意图但本轮未获批（环）— 走推挤。
      if (tryShove(occupant, it.to, it.priority, 1)) {
        moves.set(it.name, it.to);
        reservedTiles.add(it.to);
        progressed = true;
        continue;
      }
      // 推不动（锚定/疲劳/无落格）— 本 tick 放弃，creep 原地。
    }
    if (progressed || next.length === 0) {
      pending = next;
      if (!progressed) break;
      continue;
    }
    // 走到这里 = 本轮零批准且仍有未决意图：占用者全都在"等同伴让位"，只剩**环**这一种形状。
    // 再开一轮，且只开一轮：这一轮允许把"有意图但未获批"的占用者按静止者推开
    // （落格/锚定/不可动三道闸一条不松；推不动就照旧原地，不制造新风险）。
    if (cyclePassUsed) break;
    cyclePassUsed = true;
    cyclePass = true;
    pending = next;
  }

  return { moves, shoveFails: fails };
}
