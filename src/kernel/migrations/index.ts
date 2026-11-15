/** Memory schema 迁移 —— 迁移链归并后的唯一入口：旧备份一次性原子变换。 */

import type { LegacyTransform } from "./types";
import { LEGACY_TRANSFORMS } from "./legacy";

export type { LegacyTransform } from "./types";

export const MIGRATIONS: ReadonlyArray<LegacyTransform> = LEGACY_TRANSFORMS;
