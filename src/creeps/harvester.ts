import type { CreepRole } from "../kernel/contracts";
import { updateWorkingState } from "../domain/energy";

export const harvesterRole: CreepRole = {
  name: "harvester",
  run(creep): void {
    if (updateWorkingState(creep)) {
      const target = creep.room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
          (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      })[0];
      if (target && creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(target);
      return;
    }

    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source);
  },
};
