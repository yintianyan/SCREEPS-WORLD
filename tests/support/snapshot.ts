/**
 * 三层公共快照形状（FREEZE R20①）。
 *
 * 各层把自家世界状态适配成本形状后，即可消费 support/assertions 的跨层断言原语：
 *  - unit：不使用（纯函数直接断言）
 *  - integration：TestWorld.snapshot() / GameInspector 适配
 *  - e2e：SnapshotInspector 适配（structureCensus 走 world.roomObjects 统计）
 */
export interface StructureCensus {
  spawn: number;
  extension: number;
  container: number;
  tower: number;
  storage: number;
  link: number;
  terminal: number;
  road: number;
  rampart: number;
  constructedWall: number;
  /** 允许引擎/场景扩展结构类型（如 invaderCore），键为 structureType 字符串。 */
  [structureType: string]: number;
}

export interface TestSnapshot {
  tick: number;
  /** controller 等级；无 controller 视野时 undefined。 */
  rcl?: number;
  totalCreeps: number;
  creepCountByRole: Record<string, number>;
  structureCensus: StructureCensus;
  /** 序列化 Memory 字节数（soak 有界断言用）；无 Memory 视野时省略。 */
  memoryBytes?: number;
  consoleLogs: string[];
}
