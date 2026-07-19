export {};

declare global {
  interface CreepMemory {
    /** Registered role name. Never infer role from creep name. */
    role: string;
    /** Home room used for ownership and routing decisions. */
    home?: string;
    /** Stable work target id; clear it when the target no longer exists. */
    targetId?: Id<_HasId>;
    working?: boolean;
  }

  interface Memory {
    schemaVersion?: number;
    creeps: Record<string, CreepMemory>;
    rooms?: Record<string, RoomMemory>;
  }
}
