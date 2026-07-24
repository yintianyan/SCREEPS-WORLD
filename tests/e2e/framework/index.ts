/**
 * E2E 测试框架 — 基于 screeps-server-mockup 的真实 Screeps 引擎测试。
 *
 * 与 integration/framework/ 的区别：
 *   - integration/ 跑 TestWorld（自研模拟器），验证 kernel/systems 内部逻辑
 *   - e2e/ � screeps-server-mockup（真实 Screeps 引擎），验证 dist/main.js 构建产物
 *
 * 架构原则：
 *   - 不假设生产代码内部结构，只通过 bot.memory / bot.console / Game.* API 观察
 *   - 场景基于真实 Screeps 运营经验设计，不从代码覆盖率推导
 *   - 每个场景独立 server 实例，避免状态污染
 *   - 严格隔离：通过真实 Screeps API 交互，不直接 import 生产代码
 */

export { ServerHarness } from "./ServerHarness";
export { BotHarness } from "./BotHarness";
export { WorldBuilder, type RoomSetup, type ObjectSpec } from "./WorldBuilder";
export { SnapshotInspector, type BotSnapshot } from "./SnapshotInspector";
export { ScenarioRunner, type ScenarioOptions, type TickPredicate } from "./ScenarioRunner";
