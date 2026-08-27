/** Empire Metrics — 帝国级指标。 */

import { registerMetricGauge } from "../Telemetry";
import { setGauge } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import { globalCache } from "../../kernel/global-cache";

let registered = false;

export function registerEmpireMetrics(): void {
    if (registered) return;
    registered = true;

    registerMetricGauge("empire", "rooms", "Owned rooms count", []);
    registerMetricGauge("empire", "rcl_avg", "Average RCL across owned rooms", []);
    registerMetricGauge("empire", "energy", "Total empire energy", []);
    registerMetricGauge("empire", "creeps", "Total empire creeps", []);
    registerMetricGauge("empire", "health", "Empire health score (0-1)", []);
    registerMetricGauge("empire", "gcl", "Global control level", []);
    registerMetricGauge("empire", "gpl", "Global power level", []);
}

/** 采集 Empire Metrics。每 25 tick 调用。 */
export function collectEmpireMetrics(): void {
    if (!shouldCollect("empire")) return;
    markCollected("empire");

    try {
        const myRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
        let totalRcl = 0;
        let totalEnergy = 0;

        for (const room of myRooms) {
            totalRcl += room.controller?.level ?? 0;
            totalEnergy += room.energyAvailable ?? 0;
            if (room.storage) {
                totalEnergy += room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
            }
        }

        setGauge("screeps_empire_rooms", myRooms.length);
        setGauge("screeps_empire_rcl_avg", myRooms.length > 0 ? totalRcl / myRooms.length : 0);
        setGauge("screeps_empire_energy", totalEnergy);
        setGauge("screeps_empire_creeps", Object.keys(Game.creeps).length);
        setGauge("screeps_empire_gcl", Game.gcl?.level ?? 0);
        setGauge("screeps_empire_gpl", Game.gpl?.level ?? 0);

        // 从 globalCache 读取帝国健康度
        const g = globalCache();
        const empireHealth = g.empireHealth;
        if (empireHealth) {
            setGauge("screeps_empire_health", (empireHealth as any).score ?? 0);
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
