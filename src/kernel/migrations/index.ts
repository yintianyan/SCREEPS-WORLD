/** Memory schema 迁移链 — 按版本段拆分的数据表（early v0-15 / mid v16-30 / late v31-46）。
 * 段间必须保持 from→to 单调衔接；执行器在 kernel/memory.ts。 */

import type { MigrationStep } from "./types";
import { EARLY_MIGRATIONS } from "./early";
import { MID_MIGRATIONS } from "./mid";
import { LATE_MIGRATIONS } from "./late";

export type { MigrationStep } from "./types";

export const MIGRATIONS: ReadonlyArray<MigrationStep> = [
  ...EARLY_MIGRATIONS,
  ...MID_MIGRATIONS,
  ...LATE_MIGRATIONS,
];
