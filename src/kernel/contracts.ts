export interface System {
  readonly name: string;
  /** Critical systems run even when the CPU budget is exhausted. */
  readonly critical?: boolean;
  run(): void;
}

export interface CreepRole {
  readonly name: string;
  run(creep: Creep): void;
}
