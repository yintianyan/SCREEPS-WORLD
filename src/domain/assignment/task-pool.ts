/**
 * TaskPool — 单 tick 任务池数据结构，封装任务存储与索引。
 *
 * 架构价值：
 *   - **封装**：任务存储细节不泄漏到系统/适配层。数据结构变更只需改此文件。
 *   - **O(1) 任务查找**：通过 taskIndex 替代 tasks.find() 的 O(N) 线性扫描。
 *   - **单次扫描失效**：invalidate 合并「收集 creep 名」和「清空 assignedCreeps」为一次遍历。
 *
 * 生命周期：
 *   1. 每 tick 开头 assignment-service 调用 init(tick) 创建空池
 *   2. 为每房调用 setRoomTasks() 存入任务列表（同时构建索引）
 *   3. 角色通过 findTask()/getRoomTasks() 查找任务
 *   4. 角色通过 assignCreep()/releaseCreep() 修改分配状态
 *   5. tick 结束后池随 global reset 自然消亡
 *
 * 不访问 Game/Memory/globalCache — 纯数据结构，由调用方管理生命周期。
 */

import type { AssignmentTaskEntry } from "./service";

export class TaskPool {
  private readonly roomTasks = new Map<string, AssignmentTaskEntry[]>();
  /** taskId -> 任务条目，O(1) 查找替代 tasks.find()。 */
  private readonly taskIndex = new Map<string, AssignmentTaskEntry>();
  private _tick = 0;

  /** 初始化空池（每 tick 开头调用）。 */
  init(tick: number): void {
    this.roomTasks.clear();
    this.taskIndex.clear();
    this._tick = tick;
  }

  get tick(): number {
    return this._tick;
  }

  /**
   * 存入房间的任务列表并构建 ID 索引。
   * 同一房间重复调用会覆盖旧任务（索引同步更新）。
   */
  setRoomTasks(roomName: string, tasks: AssignmentTaskEntry[]): void {
    this.roomTasks.set(roomName, tasks);
    for (const task of tasks) {
      this.taskIndex.set(task.id, task);
    }
  }

  /** 获取房间的任务列表（只读视图）。 */
  getRoomTasks(roomName: string): readonly AssignmentTaskEntry[] | undefined {
    return this.roomTasks.get(roomName);
  }

  /** O(1) 按 ID 查找任务（替代 tasks.find）。 */
  findTask(taskId: string): AssignmentTaskEntry | undefined {
    return this.taskIndex.get(taskId);
  }

  /**
   * 将 creep 分配到任务（带去重）。
   * @returns true 如果分配成功（任务存在且 creep 未已在列表中）。
   */
  assignCreep(taskId: string, creepName: string): boolean {
    const task = this.taskIndex.get(taskId);
    if (!task) return false;
    if (task.assignedCreeps.includes(creepName)) return false;
    task.assignedCreeps.push(creepName);
    return true;
  }

  /**
   * 从任务的 assignedCreeps 中移除 creep。
   * @returns true 如果移除成功。
   */
  releaseCreep(taskId: string, creepName: string): boolean {
    const task = this.taskIndex.get(taskId);
    if (!task) return false;
    const idx = task.assignedCreeps.indexOf(creepName);
    if (idx < 0) return false;
    task.assignedCreeps.splice(idx, 1);
    return true;
  }

  /**
   * 失效指定房间内 priority >= minPriority 的所有任务。
   * 单次遍历同时：收集 creep 名 + 清空 assignedCreeps。
   * @returns 需要清除 assignment 的 creep 名列表。
   */
  invalidate(roomName: string, minPriority: number): string[] {
    const tasks = this.roomTasks.get(roomName);
    if (!tasks) return [];
    const names: string[] = [];
    for (const task of tasks) {
      if (task.priority >= minPriority) {
        names.push(...task.assignedCreeps);
        task.assignedCreeps = [];
      }
    }
    return names;
  }
}
