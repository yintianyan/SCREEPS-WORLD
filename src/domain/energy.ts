/** True when a creep should switch between collecting and spending energy. */
export function updateWorkingState(creep: Creep): boolean {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) creep.memory.working = false;
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) creep.memory.working = true;
  return creep.memory.working ?? false;
}
