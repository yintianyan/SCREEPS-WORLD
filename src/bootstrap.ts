import { harvesterRole } from "./creeps/harvester";
import { Kernel } from "./kernel/kernel";
import { Registry } from "./kernel/registry";
import { roomObserverSystem } from "./systems/room-observer";

const registry = new Registry()
  .registerSystem(roomObserverSystem)
  .registerRole(harvesterRole);

export const kernel = new Kernel(registry);
