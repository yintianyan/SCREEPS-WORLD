/** Room Metrics — 房间级指标。 */

import { registerMetricGauge } from "../Telemetry";
import { setGauge } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import type { RoomSnapshot } from "../../kernel/contracts";

let registered = false;

export function registerRoomMetrics(): void {
    if (registered) return;
    registered = true;

    registerMetricGauge("room", "rcl", "Room controller level", ["room"]);
    registerMetricGauge("room", "energy_available", "Room energy available", ["room"]);
    registerMetricGauge("room", "energy_capacity", "Room energy capacity available", ["room"]);
    registerMetricGauge("room", "storage_energy", "Storage energy amount", ["room"]);
    registerMetricGauge("room", "terminal_energy", "Terminal energy amount", ["room"]);
    registerMetricGauge("room", "creeps", "Room creep count", ["room"]);
    registerMetricGauge("room", "workers", "Room worker count", ["room"]);
    registerMetricGauge("room", "harvesters", "Room harvester count", ["room"]);
    registerMetricGauge("room", "haulers", "Room hauler count", ["room"]);
    registerMetricGauge("room", "upgraders", "Room upgrader count", ["room"]);
}

/**
 * 采集 Room Metrics。每 5 tick 调用。
 * @param snapshots 当前 tick 的 RoomSnapshot 迭代器
 */
export function collectRoomMetrics(snapshots: Iterable<RoomSnapshot>): void {
    if (!shouldCollect("room_energy")) return;
    markCollected("room_energy");

    try {
        // 角色计数
        const roomRoles: Record<string, Record<string, number>> = {};
        for (const creep of Object.values(Game.creeps)) {
            const home = creep.memory.home ?? creep.room?.name ?? "unknown";
            const role = creep.memory.role ?? "unknown";
            if (!roomRoles[home]) roomRoles[home] = {};
            roomRoles[home][role] = (roomRoles[home][role] ?? 0) + 1;
        }

        for (const snap of snapshots) {
            const room = snap.roomName;
            const labels = { room };

            setGauge("screeps_room_rcl", snap.rcl, labels);
            setGauge("screeps_room_energy_available", snap.energyAvailable, labels);
            setGauge("screeps_room_energy_capacity", snap.energyCapacityAvailable, labels);

            const storageEnergy = snap.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
            setGauge("screeps_room_storage_energy", storageEnergy, labels);

            const terminalEnergy = snap.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
            setGauge("screeps_room_terminal_energy", terminalEnergy, labels);

            // Creep 计数
            const roles = roomRoles[room] ?? {};
            const totalCreeps = Object.values(roles).reduce((a, b) => a + b, 0);
            setGauge("screeps_room_creeps", totalCreeps, labels);
            setGauge("screeps_room_workers", roles["worker"] ?? 0, labels);
            setGauge("screeps_room_harvesters", roles["harvester"] ?? 0, labels);
            setGauge("screeps_room_haulers", roles["hauler"] ?? 0, labels);
            setGauge("screeps_room_upgraders", roles["upgrader"] ?? 0, labels);
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
