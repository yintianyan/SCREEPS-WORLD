/** Event Registry — 离散事件注册中心。 */

import { globalCache } from "../kernel/global-cache";
import type { TelemetryEvent } from "./schema";

// ─── Storage ──────────────────────────────────────────────

interface EventBuffer {
    events: TelemetryEvent[];
    /** 上次 flush tick（限频） */
    lastFlushTick: number;
    /** 已 flush 总数（统计用） */
    totalFlushed: number;
}

const MAX_BUFFER_SIZE = 200;
const FLUSH_INTERVAL = 10; // 每 10 tick flush 一次

function buffer(): EventBuffer {
    const g = globalCache() as Record<string, unknown>;
    if (!g.__telemetryEvents) {
        g.__telemetryEvents = {
            events: [],
            lastFlushTick: 0,
            totalFlushed: 0,
        } as EventBuffer;
    }
    return g.__telemetryEvents as EventBuffer;
}

// ─── Public API ───────────────────────────────────────────

/** 记录一个离散事件。O(1) — 数组 push。 */
export function recordEvent(
    type: string,
    data: Record<string, unknown> = {},
    room?: string,
    operation?: string,
): void {
    const buf = buffer();
    // 防止无限增长：超过上限时丢弃最老的 50%
    if (buf.events.length >= MAX_BUFFER_SIZE) {
        buf.events = buf.events.slice(-Math.floor(MAX_BUFFER_SIZE / 2));
    }
    buf.events.push({
        tick: Game.time,
        type,
        room,
        operation,
        data,
    });
}

/** 排空并返回所有缓冲事件（flush 时调用）。 */
export function drainEvents(): TelemetryEvent[] {
    const buf = buffer();
    const events = buf.events;
    buf.events = [];
    buf.lastFlushTick = Game.time;
    buf.totalFlushed += events.length;
    return events;
}

/** 是否到了 flush 时间。 */
export function shouldFlushEvents(): boolean {
    const buf = buffer();
    return Game.time - buf.lastFlushTick >= FLUSH_INTERVAL && buf.events.length > 0;
}

/** 获取缓冲区当前事件数。 */
export function eventBufferSize(): number {
    return buffer().events.length;
}

/** 获取已 flush 总数。 */
export function totalEventsFlushed(): number {
    return buffer().totalFlushed;
}

// ─── 预定义事件类型 ─────────────────────────────

export const TELEMETRY_EVENT_TYPES = {
    // Spawn
    SPAWN_REQUESTED: "spawn.requested",
    SPAWN_COMPLETED: "spawn.completed",
    SPAWN_FAILED: "spawn.failed",
    // Creep
    CREEP_SPAWNED: "creep.spawned",
    CREEP_DIED: "creep.died",
    // Room
    ROOM_RCL_UP: "room.rcl_up",
    ROOM_PHASE_CHANGE: "room.phase_change",
    // Economy
    ECONOMIC_ACTIVATION: "economic.activation",
    ECONOMIC_DEGRADATION: "economic.degradation",
    // Expansion
    EXPANSION_STARTED: "expansion.started",
    EXPANSION_COMPLETED: "expansion.completed",
    EXPANSION_FAILED: "expansion.failed",
    // Operation
    OPERATION_STARTED: "operation.started",
    OPERATION_COMPLETED: "operation.completed",
    OPERATION_FAILED: "operation.failed",
    // Task
    TASK_FAILED: "task.failed",
    // Tier
    TIER_DOWNGRADE: "tier.downgrade",
    TIER_UPGRADE: "tier.upgrade",
    // Defense
    DEFENSE_ALERT: "defense.alert",
    DEFENSE_SIEGE: "defense.siege",
    SAFEMODE_ACTIVATED: "safemode.activated",
} as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[keyof typeof TELEMETRY_EVENT_TYPES];
