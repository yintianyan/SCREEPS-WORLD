/**
 * Integration Test Framework — 统一导出。
 * 仅保留外部实际引用的绑定（R20⑤ 孤儿清理：13 个死 re-export 移除；
 * 被移除的成员仍可经深路径 import —— 内部消费不受影响）。
 */
export { TestWorld, flatTerrain } from "./TestWorld";
export { TickRunner } from "./TickRunner";
export type { RunResult } from "./TickRunner";
export { ScenarioBuilder, rcl3Economy } from "./ScenarioBuilder";
export { GameInspector } from "./GameInspector";
export { Assertions } from "./Assertions";
