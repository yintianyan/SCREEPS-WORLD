/** E2E 测试框架 — 基于 screeps-server-mockup 的真实 Screeps 引擎测试。 */
// barrel 仅保留外部实际经 barrel 引用的绑定（R20⑤：9 个死 re-export 移除；
// harness 内部消费走深路径不受影响）。
export { ScenarioRunner } from "./ScenarioRunner";
export type { BotSnapshot } from "./SnapshotInspector";
