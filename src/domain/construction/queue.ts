/**
 * 建造队列域模块。
 *
 * 历史说明：早期版本的建造任务生成逻辑（generateBuildTasks、spiralPositions 等）
 * 已迁移至 src/domain/layout/ 下的 layout-planner 与 task-factory 模块。
 * 此文件保留为占位，便于未来存放与 BuildQueue 相关的纯函数工具。
 *
 * 当前 BuildTask 类型定义在 src/types/global.d.ts，
 * 队列存储在 RoomMemory.buildQueue，由 construction-manager 和 layout-planner 共同维护。
 */

export {};
