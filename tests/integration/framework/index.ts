/**
 * Integration Test Framework — 统一导出。
 */
export { TestWorld, flatTerrain, terrainWithWalls, terrainWithSwamps } from "./TestWorld";
export type { WorldConfig, WorldPos, WorldStats } from "./TestWorld";
export { TickRunner, tickRunner } from "./TickRunner";
export type { TickRecord, RunResult, TickRunnerOptions } from "./TickRunner";
export { ScenarioBuilder, rcl1Bootstrap, rcl2Steady, rcl3Economy } from "./ScenarioBuilder";
export { GameInspector } from "./GameInspector";
export type { EmpireStatus, EconomyReport } from "./GameInspector";
export { Assertions, createAssertions } from "./Assertions";
