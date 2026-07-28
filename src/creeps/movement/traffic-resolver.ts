/**
 * 交通解算器 — 纯函数，零 Game 依赖，Vitest 直测。
 *
 * 输入是一个房间内本 tick 的全部移动意图、锚定声明与 creep 占位表，
 * 输出是最终应签发的移动指令（含推挤指令）。解算规则按序：
 *   1. 同格仲裁：多意图争同一格 → 最高 priority 胜（平局按登记序），
 *      败者本 tick 原地（不发指令，下 tick 重算路径时自然改道/重试）。
 *   2. 跟车放行：目标格占用者本轮已被批准移走 → 放行（车队循迹前进）。
 *   3. 对向换位：A→B 格且 B→A 格 → 双双放行（引擎同 tick 互穿；
 *      若引擎实测不支持，双方原地一 tick 后走推挤路径，自动降级）。
 *   4. 推挤链：目标格被「无意图静止者」占据且移动方优先级严格更高 →
 *      为静止者选推挤落格（调用方按停车口径排好序的可站邻格），
 *      落格全被占时可再推下一层静止者，链深上限 2，超限放弃本意图。
 *   5. 疲劳/锚定豁免：fatigue > 0 或锚定优先级 ≥ 移动方的 creep
 *      不可移动也不可被推挤，视为本 tick 硬墙。
 *
 * 坐标统一用 packed 格式（x * 50 + y），与 movement 层其余模块一致。
 */

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

/** 解算输出：creep 名 → 目标 packed 格（含被批准的意图与推挤指令）。 */
export interface ResolveOutput {
  moves: Map<string, number>;
}

/** 推挤链最大深度：A 推 B、B 推 C 即到上限，再深的连环推放弃。 */
const MAX_SHOVE_DEPTH = 2;

/**
 * 解算一个房间的全部移动意图。
 *
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
   * 尝试把静止 creep（blockerName，位于 tile）推挤出去。
   * 成功时写入 moves/reservedTiles 并返回 true。
   */
  const tryShove = (blockerName: string, tile: number, moverPriority: number, depth: number): boolean => {
    if (depth > MAX_SHOVE_DEPTH) return false;
    if (immovable.has(blockerName)) return false;
    if (intentByName.has(blockerName)) return false; // 有意图者不推挤 — 由仲裁/跟车处理。
    if (staticPriority(blockerName) >= moverPriority) return false; // 锚定豁免。

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
    return false;
  };

  // 迭代放行：跟车链（A 等 B 走、B 等 C 走）需要多轮传播。
  // 每轮至少批准一条才继续，轮数受意图数约束，不会死循环。
  let pending = arbitrated;
  let progressed = true;
  while (progressed && pending.length > 0) {
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
      if (occupantIntent) {
        next.push(it);
        continue;
      }
      // 占用者是静止者 — 走推挤。
      if (tryShove(occupant, it.to, it.priority, 1)) {
        moves.set(it.name, it.to);
        reservedTiles.add(it.to);
        progressed = true;
        continue;
      }
      // 推不动（锚定/疲劳/无落格）— 本 tick 放弃，creep 原地。
    }
    pending = next;
  }

  return { moves };
}
