/**
 * 标准房蓝图 — integration(TestWorld) 与 e2e(mockup) 共享的唯一布局定义源。
 *
 * 坐标语义（t0 canonical 新 spawn 房，与 e2e/fixtures/base.ts 的 t0Base 一致）：
 *   - spawn 居中 (25,25)
 *   - controller 西北 (10,10)
 *   - 双 source 对角 (10,40)/(40,10)
 *   - mineral 东南 (40,40)
 *
 * 场景变体（附加 container/tower/extensions 等）应基于本蓝图坐标派生，
 * 保持"结构紧贴其服务对象"的相对语义，禁止重新发明一套绝对坐标。
 *
 * 修改布局常量必须同时验证两层：
 *   npm run test:integration && npm run test:e2e:smoke
 */

/** 蓝图内 source 的标识（TestWorld 按 id 建引用，e2e 由引擎自动分配 id）。 */
export interface BlueprintSource {
  id: string;
  x: number;
  y: number;
}

export interface StandardRoomLayout {
  spawn: { name: string; x: number; y: number };
  controller: { x: number; y: number };
  sources: [BlueprintSource, BlueprintSource];
  mineral: { x: number; y: number };
}

export const STANDARD_ROOM_LAYOUT: StandardRoomLayout = {
  spawn: { name: "Spawn1", x: 25, y: 25 },
  controller: { x: 10, y: 10 },
  sources: [
    { id: "s1", x: 10, y: 40 },
    { id: "s2", x: 40, y: 10 },
  ],
  mineral: { x: 40, y: 40 },
};
