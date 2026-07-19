export const CONFIG = {
  memory: { schemaVersion: 1 },
  kernel: {
    /** Stop non-critical work near the tick CPU limit. */
    cpuReserve: 3,
    logErrors: true,
  },
  economy: {
    harvestWorkingParts: 5,
    defaultHarvesterCarryParts: 1,
  },
} as const;
