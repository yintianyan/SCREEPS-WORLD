/** Economy Metrics — 经济指标-11）。 */

import { registerMetricGauge } from "../Telemetry";
import { setGauge } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import type { RoomSnapshot } from "../../kernel/contracts";

let registered = false;

export function registerEconomyMetrics(): void {
    if (registered) return;
    registered = true;

    // 核心指标
    registerMetricGauge("economy", "energy_income", "Energy income per tick", ["room"]);
    registerMetricGauge("economy", "energy_expense", "Energy expense per tick", ["room"]);
    registerMetricGauge("economy", "energy_net", "Net energy per tick", ["room"]);
    registerMetricGauge("economy", "energy_stored", "Total stored energy", ["room"]);

    // 拆分
    registerMetricGauge("economy", "energy_harvest", "Energy harvested per tick", ["room"]);
    registerMetricGauge("economy", "energy_transport", "Energy transported per tick", ["room"]);
    registerMetricGauge("economy", "energy_spawn", "Energy spent on spawn per tick", ["room"]);
    registerMetricGauge("economy", "energy_build", "Energy spent on build per tick", ["room"]);
    registerMetricGauge("economy", "energy_repair", "Energy spent on repair per tick", ["room"]);
    registerMetricGauge("economy", "energy_upgrade", "Energy spent on upgrade per tick", ["room"]);

    // 健康度
    registerMetricGauge("economy", "health_ratio", "Economic health ratio", []);
    registerMetricGauge("economy", "energy_sufficiency_ratio", "Energy sufficiency = income / expense", []);
    registerMetricGauge("economy", "logistics_efficiency_ratio", "Logistics efficiency ratio", []);
    registerMetricGauge("economy", "spawn_efficiency_ratio", "Spawn efficiency ratio", []);
}

/** 采集 Economy Metrics。每 10 tick 调用。 */
export function collectEconomyMetrics(snapshots: Iterable<RoomSnapshot>): void {
    if (!shouldCollect("economy")) return;
    markCollected("economy");

    try {
        let totalIncome = 0;
        let totalExpense = 0;
        let totalStored = 0;

        for (const snap of snapshots) {
            const labels = { room: snap.roomName };

            // Stored energy
            const storageEnergy = snap.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
            const containerEnergy = snap.containers.reduce(
                (sum, c) => sum + c.store.getUsedCapacity(RESOURCE_ENERGY), 0,
            );
            const stored = storageEnergy + containerEnergy + snap.energyAvailable;
            setGauge("screeps_economy_energy_stored", stored, labels);
            totalStored += stored;

            // Income/Expense — 从 Memory 读取 economy accounting
            const roomMem = Memory.rooms[snap.roomName];
            const econPhase = roomMem?.phase;
            if (econPhase) {
                const income = (econPhase as any).energyIncome ?? 0;
                const expense = (econPhase as any).energyExpense ?? 0;
                const net = income - expense;

                setGauge("screeps_economy_energy_income", Math.round(income * 100) / 100, labels);
                setGauge("screeps_economy_energy_expense", Math.round(expense * 100) / 100, labels);
                setGauge("screeps_economy_energy_net", Math.round(net * 100) / 100, labels);

                totalIncome += income;
                totalExpense += expense;
            }
        }

        // 帝国级健康度
        if (totalExpense > 0) {
            const sufficiency = totalIncome / totalExpense;
            setGauge("screeps_economy_energy_sufficiency_ratio", Math.round(sufficiency * 1000) / 1000);
            setGauge("screeps_economy_health_ratio", Math.round(sufficiency * 1000) / 1000);
        } else if (totalIncome > 0) {
            setGauge("screeps_economy_energy_sufficiency_ratio", 1.0);
            setGauge("screeps_economy_health_ratio", 1.0);
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
