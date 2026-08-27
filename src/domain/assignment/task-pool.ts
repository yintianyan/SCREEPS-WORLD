/** TaskPool — 单 tick 任务池（纯数据结构），封装任务存储与索引： */

import type { AssignmentTaskEntry } from "./service";

export class TaskPool {
  private readonly roomTasks = new Map<string, AssignmentTaskEntry[]>();
  /** taskId -> 任务条目（O(1) 查找）。 */
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

  /** 存入房间任务列表并构建 ID 索引；重复调用覆盖旧任务（索引同步更新）。 */
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

  /** 将 creep 分配到任务（带去重）；任务不存在或已在列表中时返回 false。 */
  assignCreep(taskId: string, creepName: string): boolean {
    const task = this.taskIndex.get(taskId);
    if (!task) return false;
    if (task.assignedCreeps.includes(creepName)) return false;
    task.assignedCreeps.push(creepName);
    return true;
  }

  /** 从任务移除 creep；任务不存在或不在列表中时返回 false。 */
  releaseCreep(taskId: string, creepName: string): boolean {
    const task = this.taskIndex.get(taskId);
    if (!task) return false;
    const idx = task.assignedCreeps.indexOf(creepName);
    if (idx < 0) return false;
    task.assignedCreeps.splice(idx, 1);
    return true;
  }

  /** 失效房间内 priority >= minPriority 的任务：单次遍历收集 creep 名并清空 assignedCreeps。 */
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
