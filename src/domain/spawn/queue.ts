/**
 * 孵化队列操作 — 管理 SpawnRequest 列表的纯函数。
 * 队列存储在 RoomMemory.spawnQueue 中，是孵化意图的唯一来源。
 */

/** 通过稳定 key 将请求合并到队列。已有请求更新而非重复。 */
export function submitRequest(queue: SpawnRequest[], request: SpawnRequest): void {
  const existing = queue.find(r => r.key === request.key);
  if (existing) {
    // 更新字段但保留创建时间和重试次数。
    existing.role = request.role;
    existing.home = request.home;
    existing.priority = request.priority;
    existing.body = request.body;
    existing.memory = request.memory;
    existing.expiresAt = request.expiresAt;
    existing.replaceBy = request.replaceBy;
  } else {
    queue.push({ ...request });
  }
}

/** 按 key 移除请求。 */
export function removeRequest(queue: SpawnRequest[], key: string): void {
  const idx = queue.findIndex(r => r.key === key);
  if (idx >= 0) queue.splice(idx, 1);
}

/**
 * 撤销指定房间内某角色的所有待处理请求，返回移除数量。
 *
 * 请求撤销通道：队列请求的常规出队路径只有孵化成功 / TTL 过期 / 重试隔离，
 * 需求前提消失（如威胁清除后的 defender、状态翻转后的 upgrader）时，
 * 残留请求会在 TTL 窗口（最长 1000 tick）内继续被孵化 — 幽灵需求浪费能量。
 * 调用方在每 tick 需求评估前按当前世界状态主动撤销。
 */
export function removeRequestsByRole(queue: SpawnRequest[], role: string, home: string): number {
  let removed = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    const req = queue[i];
    if (req && req.role === role && req.home === home) {
      queue.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

/**
 * 撤销指定 home 的所有待处理请求，返回移除数量。
 *
 * 主要用于扩张 abort：拓荒编队请求寄宿在 sponsor 队列但 home 指向目标房，
 * 失守/超时退出行动时需要一次性清掉所有寄宿请求，避免 sponsor 队列
 * 继续孵化已失去意义的拓荒者。语义与 removeRequestsByRole 互补：
 * 前者按 home+role 精细过滤，本函数按 home 整体清空。
 *
 * 唯一调用方 expansion-manager 经此函数操作 sponsor 队列，禁止任何模块
 * 直接对 spawnQueue 调用 splice（队列属主是 spawn-manager，
 * 见 spawnQueue-splice 守卫测试）。
 */
export function cancelRequestsByHome(queue: SpawnRequest[], home: string): number {
  let removed = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    const req = queue[i];
    if (req && req.home === home) {
      queue.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

/** 按优先级升序排序（P0 在前），有 replaceBy 的替换请求优先，然后按 createdAt 升序排序。 */
export function sortQueue(queue: SpawnRequest[]): SpawnRequest[] {
  return queue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // X-17：有 replaceBy 的替换请求优先于普通请求。
    const aReplace = a.replaceBy !== undefined ? 0 : 1;
    const bReplace = b.replaceBy !== undefined ? 0 : 1;
    if (aReplace !== bReplace) return aReplace - bReplace;
    return a.createdAt - b.createdAt;
  });
}

/** 检查队列中是否已存在某 key 的请求。 */
export function hasRequest(queue: readonly SpawnRequest[], key: string): boolean {
  return queue.some(r => r.key === key);
}

/** 移除过期请求（expiresAt 已过）和达到重试上限的请求。
 *
 * SP-2：返回因重试上限被清除的 key 列表 — 调用方应将其记入黑名单冷却，
 * 否则 demand 下一 tick 以同 key 重建（retries 归零），持久性配置错误
 * （如 body 超容量）形成「5 次失败 → 删除 → 重建 → 再 5 次」的无限翻炒，
 * plan §5.4 的「隔离该请求」沦为周期性日志噪音。TTL 过期不入黑名单 —
 * 过期是正常生命周期，需求仍在时重建是设计行为。
 *
 * P2-K：可选 onPurge 回调在两路删除点（retries 烧穿 / TTL 过期）触发，
 * 让调用方把 churn 事件转译为遥测条目（如 recordSkip('spawn/churn/<role>/retries')）。
 * 回调用参数注入而非在 domain 直接调 recordSkip — cleanQueue 仍是纯函数，
 * 不传回调时行为完全等价于改动前。purgedKeys 仍只含 retries 路径的 key
 * （黑名单逻辑依赖此契约 — TTL 过期是设计行为，不该隔离）。
 */
export function cleanQueue(
  queue: SpawnRequest[],
  tick: number,
  maxRetries: number,
  onPurge?: (key: string, reason: "retries" | "expired") => void,
): string[] {
  const purgedKeys: string[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const req = queue[i];
    if (!req) continue;
    if (req.retries >= maxRetries) {
      purgedKeys.push(req.key);
      queue.splice(i, 1);
      onPurge?.(req.key, "retries");
      continue;
    }
    if (req.expiresAt && tick > req.expiresAt) {
      queue.splice(i, 1);
      onPurge?.(req.key, "expired");
    }
  }
  return purgedKeys;
}

/** 统计房间内某角色的待处理请求数（不含孵化中）。
 *
 * 可选 home 过滤：sponsor 房代孵他房 creep（扩张拓荒）时，请求寄宿在
 * sponsor 队列但 home 指向目标房 — 不过滤会污染 sponsor 自身的人口预算。
 */
export function countPending(queue: readonly SpawnRequest[], role: string, home?: string): number {
  return queue.filter(r => r.role === role && (home === undefined || r.home === home)).length;
}

/** 构建稳定去重 key：role:room:source?:index */
export function spawnKey(role: string, home: string, index: number, sourceId?: string): string {
  return sourceId
    ? `${role}:${home}:${sourceId}:${index}`
    : `${role}:${home}:${index}`;
}
