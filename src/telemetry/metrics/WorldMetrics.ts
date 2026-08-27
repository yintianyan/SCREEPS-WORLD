/** World Metrics — 世界层指标。 */

import { registerMetricGauge } from "../Telemetry";
import { setGauge } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";

let registered = false;

export function registerWorldMetrics(): void {
    if (registered) return;
    registered = false;

    // 房间计数
    registerMetricGauge("world", "rooms", "Total visible rooms");
    registerMetricGauge("world", "owned_rooms", "Owned rooms count");
    registerMetricGauge("world", "visible_rooms", "Visible rooms count");
    registerMetricGauge("world", "hostile_rooms", "Hostile rooms count");
    registerMetricGauge("world", "neutral_rooms", "Neutral rooms count");

    // 资源
    registerMetricGauge("world", "energy", "Total empire energy");
    registerMetricGauge("world", "mineral", "Total empire mineral count");
    registerMetricGauge("world", "power", "Total power count");

    registered = true;
}

/** 采集 World Metrics。每 tick 调用（频率 = 1）。 */
export function collectWorldMetrics(): void {
    if (!shouldCollect("cpu")) return; // 世界层与 runtime 同频
    markCollected("cpu");

    try {
        const myRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
        const ownedRooms = myRooms.length;
        const visibleRooms = Object.keys(Game.rooms).length;

        setGauge("screeps_world_rooms", visibleRooms);
        setGauge("screeps_world_owned_rooms", ownedRooms);
        setGauge("screeps_world_visible_rooms", visibleRooms);

        // 帝国总能量
        let totalEnergy = 0;
        for (const room of myRooms) {
            totalEnergy += room.energyAvailable ?? 0;
            const storage = room.storage;
            if (storage) totalEnergy += storage.store.getUsedCapacity(RESOURCE_ENERGY);
        }
        setGauge("screeps_world_energy", totalEnergy);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
