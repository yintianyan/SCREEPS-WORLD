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

/** 移除过期请求（createdAt + TTL < now）和隔离请求（retries > max）。 */
export function cleanQueue(queue: SpawnRequest[], tick: number, maxRetries: number): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const req = queue[i];
    if (!req) continue;
    if (req.retries >= maxRetries) {
      queue.splice(i, 1);
      continue;
    }
    if (req.expiresAt && tick > req.expiresAt) {
      queue.splice(i, 1);
    }
  }
}

/** 统计房间内某角色的待处理请求数（不含孵化中）。 */
export function countPending(queue: readonly SpawnRequest[], role: string): number {
  return queue.filter(r => r.role === role).length;
}

/** 构建稳定去重 key：role:room:source?:index */
export function spawnKey(role: string, home: string, index: number, sourceId?: string): string {
  return sourceId
    ? `${role}:${home}:${sourceId}:${index}`
    : `${role}:${home}:${index}`;
}
