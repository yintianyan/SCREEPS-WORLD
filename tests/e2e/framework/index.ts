/** E2E 测试框架 — 基于 screeps-server-mockup 的真实 Screeps 引擎测试。 */

export { ServerHarness } from "./ServerHarness";
export { BotHarness } from "./BotHarness";
export { WorldBuilder, type RoomSetup, type ObjectSpec } from "./WorldBuilder";
export { SnapshotInspector, type BotSnapshot } from "./SnapshotInspector";
export { ScenarioRunner, type ScenarioOptions, type TickPredicate } from "./ScenarioRunner";
