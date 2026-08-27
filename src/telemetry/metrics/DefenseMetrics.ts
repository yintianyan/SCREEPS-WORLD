/** Defense Metrics — 防御指标。 */

import { registerMetricGauge, registerMetricCounter } from "../Telemetry";
import { setGauge, incrementCounter } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import type { RoomSnapshot } from "../../kernel/contracts";

let registered = false;

export function registerDefenseMetrics(): void {
    if (registered) return;
    registered = true;

    registerMetricGauge("defense", "threat_rooms", "Rooms with active threats", []);
    registerMetricGauge("defense", "hostile_creeps", "Total hostile creeps visible", []);
    registerMetricCounter("defense", "invasions", "Total invasion events", [], "total");
    registerMetricCounter("defense", "safemode_activated", "Safe mode activations", ["room"], "total");
    registerMetricGauge("defense", "tower_energy", "Tower energy level", ["room"]);
    registerMetricGauge("defense", "rampart_avg", "Average rampart hits", ["room"]);
}

/** 采集 Defense Metrics。每 5 tick 调用。 */
export function collectDefenseMetrics(snapshots: Iterable<RoomSnapshot>): void {
    if (!shouldCollect("spawn")) return; // 与 spawn 同频（5 tick）
    markCollected("spawn");

    try {
        let threatRooms = 0;
        let totalHostiles = 0;

        for (const snap of snapshots) {
            if (snap.threatCreeps.length > 0) {
                threatRooms++;
                totalHostiles += snap.threatCreeps.length;
            }

            // Tower energy
            for (const tower of snap.towers) {
                const energy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
                setGauge("screeps_defense_tower_energy", energy, { room: snap.roomName });
            }

            // Rampart average
            if (snap.ramparts.length > 0) {
                const avgHits = snap.ramparts.reduce((sum, r) => sum + r.hits, 0) / snap.ramparts.length;
                setGauge("screeps_defense_rampart_avg", Math.round(avgHits), { room: snap.roomName });
            }
        }

        setGauge("screeps_defense_threat_rooms", threatRooms);
        setGauge("screeps_defense_hostile_creeps", totalHostiles);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
