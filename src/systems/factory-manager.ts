/**
 * Factory Manager — P3 系统，RCL7-8 终局结构的最小运营层。
 * Factory：storage 满仓时把过剩能量压缩为 battery（600 energy → 50 battery，
 * 冷却 10 tick）——满仓即能量在源头被 harvester drop 浪费，压缩把「必然损失」
 * 转为可存储/可交易的资产（battery 解压回收率 5/6）。
 * PowerSpawn：processPower（1 power + 50 energy/次）积累 GPL — 调度门禁见
 * domain/economy/power-processing（能量地板 + war 姿态，投资让位生存）。
 * 原料能量由 distributor 的 stockFactoryEnergy 在满仓信号下搬运（actions/industry.ts）。
 */
import { CONFIG } from "../config";
import { shouldProcessPower } from "../domain/economy/power-processing";
import type { Priority, System, TickContext } from "../kernel/contracts";

export const factoryManagerSystem: System = {
  name: "factory-manager",
  priority: 3 as Priority,
  interval: CONFIG.factory.interval,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const powerSpawn = snapshot.powerSpawn;
      if (powerSpawn && typeof powerSpawn.processPower === "function") {
        if (
          shouldProcessPower({
            powerStored: powerSpawn.store.getUsedCapacity(RESOURCE_POWER),
            energyStored: powerSpawn.store.getUsedCapacity(RESOURCE_ENERGY),
            storageEnergy: snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY),
            energyFloor: CONFIG.factory.processEnergyFloor,
            warActive: Memory.kernel?.strategy?.posture === "war",
          })
        ) {
          powerSpawn.processPower();
        }
      }

      const factory = snapshot.factory;
      if (!factory) continue;
      // 测试/私服环境的 factory mock 可能无 produce — 安全跳过。
      if (typeof factory.produce !== "function") continue;
      if (factory.cooldown > 0) continue;
      // 仅在 storage 满仓（能量正在源头被浪费）时压缩 — 正常水位下
      // 能量应流向 upgrade/build，压缩的 1/6 折损划不来。
      if (Memory.rooms[snapshot.roomName]?.storageNearFull !== true) continue;
      if (factory.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.factory.batchEnergy) continue;
      factory.produce(RESOURCE_BATTERY);
    }
  },
};
