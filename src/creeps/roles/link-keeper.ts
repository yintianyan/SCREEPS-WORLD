/** Link Keeper — storage/spawn Link 的固定双向转运岗位。 */
import type { Priority, RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import {
  findLinkKeeperStand,
  findSpawnLinkAnchor,
  findStorageLink,
} from "../../domain/economy/links";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { ACTION_RANGE_NEAR, countedIntent, runAction } from "../engine/actions/helpers";

type KeeperTarget =
  | { kind: "move"; stand: RoomPosition }
  | { kind: "withdraw-link"; link: StructureLink; amount: number }
  | { kind: "withdraw-storage"; storage: StructureStorage; amount: number }
  | { kind: "transfer-link"; link: StructureLink }
  | { kind: "transfer-storage"; storage: StructureStorage }
  | { kind: "transfer-core"; target: StructureSpawn | StructureExtension };

function coreTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): StructureSpawn | StructureExtension | undefined {
  const candidates = snapshot.fillTargets.filter(
    (target): target is StructureSpawn | StructureExtension =>
      (target.structureType === STRUCTURE_SPAWN || target.structureType === STRUCTURE_EXTENSION) &&
      target.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  );
  return creep.pos.findClosestByRange(candidates) ?? undefined;
}

function keeperStep(): ActionCandidate<KeeperTarget> {
  return {
    name: "link-keeper:balance",
    resolve: ac => {
      const post = ac.creep.memory.linkKeeperPost;
      if (post !== "storage" && post !== "spawn") return undefined;
      const spawnLink = post === "spawn" ? findSpawnLinkAnchor(ac.snapshot) : undefined;
      const link = post === "storage" ? findStorageLink(ac.snapshot) : spawnLink?.link;
      const anchor = post === "storage" ? ac.snapshot.storage : spawnLink?.anchor;
      if (!link || !anchor || link.pos.getRangeTo(anchor.pos) > 2) return undefined;
      const terrain = ac.creep.room.getTerrain();
      const standPoint = findLinkKeeperStand(
        ac.snapshot,
        link,
        anchor,
        (x, y) => terrain.get(x, y),
        ac.creep.pos,
      );
      if (!standPoint) return undefined;
      const stand = new RoomPosition(standPoint.x, standPoint.y, ac.creep.room.name);
      if (!ac.creep.pos.isEqualTo(stand)) return { kind: "move", stand };

      const carried = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
      const linkEnergy = link.store.getUsedCapacity(RESOURCE_ENERGY);
      const linkFree = link.store.getFreeCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);

      if (carried > 0) {
        if (post === "spawn") {
          const target = coreTarget(ac.creep, ac.snapshot);
          return target ? { kind: "transfer-core", target } : undefined;
        }
        const storage = ac.snapshot.storage;
        if (!storage) return undefined;
        if (ac.creep.memory.keeperCargo === "link" && linkFree > 0) {
          return { kind: "transfer-link", link };
        }
        if (storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          return { kind: "transfer-storage", storage };
        }
        return linkFree > 0 ? { kind: "transfer-link", link } : undefined;
      }

      if (post === "spawn") {
        return linkEnergy > 0
          ? { kind: "withdraw-link", link, amount: Math.min(linkEnergy, carryFree) }
          : undefined;
      }

      const storage = ac.snapshot.storage;
      if (!storage) return undefined;
      const storageEnergy = storage.store.getUsedCapacity(RESOURCE_ENERGY);
      const storageFree = storage.store.getFreeCapacity(RESOURCE_ENERGY);
      if (linkEnergy > CONFIG.economy.link.keeperHighWater && storageFree > 0) {
        return {
          kind: "withdraw-link",
          link,
          amount: Math.min(linkEnergy - CONFIG.economy.link.keeperHighWater, carryFree),
        };
      }
      if (
        linkEnergy < CONFIG.economy.link.keeperLowWater &&
        storageEnergy > CONFIG.economy.link.keeperStorageFloor &&
        linkFree > 0
      ) {
        return {
          kind: "withdraw-storage",
          storage,
          amount: Math.min(
            CONFIG.economy.link.keeperLowWater - linkEnergy,
            storageEnergy - CONFIG.economy.link.keeperStorageFloor,
            carryFree,
          ),
        };
      }
      return undefined;
    },
    execute: (ac, target) => {
      if (target.kind === "move") {
        moveToTarget(ac.creep, target.stand, 0);
        return;
      }
      if (target.kind === "withdraw-link") {
        const result = countedIntent("withdraw", () =>
          ac.creep.withdraw(target.link, RESOURCE_ENERGY, target.amount),
        );
        if (result === OK) ac.creep.memory.keeperCargo = "storage";
        return;
      }
      if (target.kind === "withdraw-storage") {
        const result = countedIntent("withdraw", () =>
          ac.creep.withdraw(target.storage, RESOURCE_ENERGY, target.amount),
        );
        if (result === OK) ac.creep.memory.keeperCargo = "link";
        return;
      }
      if (target.kind === "transfer-link") {
        const result = countedIntent("transfer", () =>
          ac.creep.transfer(target.link, RESOURCE_ENERGY),
        );
        if (result === OK) delete ac.creep.memory.keeperCargo;
        return;
      }
      if (target.kind === "transfer-storage") {
        const result = countedIntent("transfer", () =>
          ac.creep.transfer(target.storage, RESOURCE_ENERGY),
        );
        if (result === OK) delete ac.creep.memory.keeperCargo;
        return;
      }
      const result = runAction(ac.creep, target.target, ACTION_RANGE_NEAR, () =>
        ac.creep.transfer(target.target, RESOURCE_ENERGY),
      );
      if (result === OK) delete ac.creep.memory.keeperCargo;
    },
  };
}

const policy: RolePolicy = {
  noIdleCadence: true,
  recoveryEligible: true,
  isLifeLine: true,
  executionOrder: 2,
  acquire: [keeperStep()],
  work: [keeperStep()],
};

export const linkKeeperRole = defineRole("linkKeeper", 1 as Priority, policy);
