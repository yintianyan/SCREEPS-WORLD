/** 迁移步骤：从版本 from 升到 to。run 必须幂等。
 * ready（可选）：迁移依赖的外部资源（如 RawMemory segment）是否就绪 —
 * 未就绪时迁移链在此中断，版本停在断点，下 tick 重试。 */
export interface MigrationStep {
  from: number;
  to: number;
  ready?: () => boolean;
  run: () => void;
}
