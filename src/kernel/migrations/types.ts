/** 旧备份 Memory 变换：name 供诊断；ready（可选）未就绪时中断变换，版本不盖章，下 tick 重试。 */
export interface LegacyTransform {
  name: string;
  ready?: () => boolean;
  run: () => void;
}
