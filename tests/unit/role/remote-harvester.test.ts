/**
 * RemoteHarvester 角色测试 — v33-R11 站桩锚定与占位自报。
 *
 * 事故背景（线上实证 W36S58）：远矿房无 RoomSnapshot，站桩占位不预载，
 * 寻路矩阵看不见静止 creep — reserver 占住矿位后，采集者的缓存路径反复
 * 指向该格、意图逐 tick 被解算器拒绝 → 锁死空转。修复：在矿位采集时
 * 登记 anchorMiner 锚 + registerStaticBlocker 占位自报（与本地 harvester
 * 的 anchorMiner 同口径）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteHarvesterRole } from "../../../src/creeps/roles/remote-harvester";
import { getIntentLedger } from "../../../src/creeps/movement/intent";
import { CONFIG } from "../../../src/config";
import { mockContext, mockCreep, mockSnapshot, mockSource, resetGlobals } from "../../role-helpers";

const homeRoom = "W7N4";
const targetRoom = "W2N1";

/** 把 creep 放到目标房坐标，getRangeTo 按 Chebyshev 距离计算。
 *  兼容两种目标形态：RoomPosition（直接 .x/.y）与 RoomObject（.pos.x/.y，
 *  如 source 对象 — 引擎语义下 getRangeTo(source) 取 source.pos）。 */
function placeCreep(creep: any, x: number, y: number): void {
  creep.pos = {
    x, y, roomName: targetRoom,
    getRangeTo: vi.fn((t: any) => {
      const tx = t.x ?? t.pos?.x ?? 0;
      const ty = t.y ?? t.pos?.y ?? 0;
      return Math.max(Math.abs(tx - x), Math.abs(ty - y));
    }),
    getDirectionTo: vi.fn(() => 3),
  };
}

function makeRoom(creep: any, sources: any[]): any {
  return {
    name: targetRoom,
    find: vi.fn((t: number) => {
      if (t === FIND_SOURCES) return sources;
      if (t === FIND_MY_CREEPS) return [creep];
      return [];
    }),
    lookForAt: vi.fn(() => []),
    lookForAtArea: vi.fn(() => []),
  };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  // __staticBlockersCache / __moveIntents 不在 resetGlobals 清理清单 — 本文件自行隔离。
  delete (globalThis as any).__staticBlockersCache;
  delete (globalThis as any).__moveIntents;
  // 锚定登记在 traffic 关闭时为 no-op — 显式开启以断言锚。
  (CONFIG.movement as { trafficManager: boolean }).trafficManager = true;
});

describe("remoteHarvester — 站桩锚定与占位自报", () => {
  it("在矿位（range≤1）采集：登记 anchorMiner 锚 + 静态占位自报", () => {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };

    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1" });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    placeCreep(creep, 11, 10); // 距 source 1 格 — 在矿位
    creep.room = makeRoom(creep, [s1]);

    const snap = mockSnapshot({ roomName: homeRoom });
    remoteHarvesterRole.run(creep, mockContext(snap));

    expect(creep.harvest).toHaveBeenCalledWith(s1);
    expect(getIntentLedger().anchors.get("rh-1")).toBe(
      CONFIG.movement.trafficPriority.anchorMiner,
    );
    const cache = (globalThis as any).__staticBlockersCache;
    expect(cache[targetRoom].positions).toContain(11 * 50 + 10);
  });

  it("未到矿位（range>1）：不锚定不占位，走移动链路", () => {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };

    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1" });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    placeCreep(creep, 20, 10); // 距 source 10 格 — 未到矿位
    creep.room = makeRoom(creep, [s1]);
    // harvest mock 默认返回 OK（0）→ move-and-mine 无分支动作；断言只看锚/占位。
    const snap = mockSnapshot({ roomName: homeRoom });
    remoteHarvesterRole.run(creep, mockContext(snap));

    expect(getIntentLedger().anchors.has("rh-1")).toBe(false);
    const cache = (globalThis as any).__staticBlockersCache;
    expect(cache?.[targetRoom]).toBeUndefined();
  });

  it("满载且无 container（work 链）：stationary 让位 → dropEnergy 放能（满载停摆修复）", () => {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };

    // 满载 creep：used=capacity=50（mockCreep 的 store mock 用固定 used/capacity）。
    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1", used: 50, capacity: 50 });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mode = "work";
    placeCreep(creep, 11, 10); // 在矿位
    // 房内无 container：lookForAtArea 返回空（makeRoom 的 mock 已覆盖）。
    creep.room = makeRoom(creep, [s1]);

    const snap = mockSnapshot({ roomName: homeRoom });
    const ctx = mockContext(snap);
    remoteHarvesterRole.run(creep, ctx);
    // tick 1：buildSourceContainer 命中 request 分支，写 needContainer 申请。
    expect(creep.memory.needContainer).toBe(true);
    expect(creep.drop).not.toHaveBeenCalled();

    remoteHarvesterRole.run(creep, ctx);
    // tick 2：needContainer 已在途 → build 候选让位 → stationary 满载让位 →
    // dropEnergy 放能。修复前：stationaryMine 无条件匹配 → harvest ERR_FULL →
    // drop 永远轮不到，满载永久停摆零产出。
    expect(creep.drop).toHaveBeenCalledWith(RESOURCE_ENERGY);
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("带能且被挤离矿位（work + range>1）：move-and-mine 归位，不落入 idle 趴窝", () => {
    // 线上实证 W36S58：采集者被占位挤到 range 2 且携带 25 能量 — 原 work 链
    // 三候选（自建/站桩/drop）全部 resolve 失败 → 「无匹配 → idle + park」，
    // 既不满载又不空载 → 永久趴窝。修复：work 链补 move-and-mine。
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };

    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1", used: 25, capacity: 50 });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mode = "work";
    creep.harvest = vi.fn(() => ERR_NOT_IN_RANGE); // 距离 2 → 引擎语义
    placeCreep(creep, 10, 12); // 距 source 2 格
    creep.room = makeRoom(creep, [s1]);

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    // 修复前：全部候选失败 → mode=idle（趴窝）。修复后：move-and-mine 匹配，
    // harvest 尝试 + 移动意图登记，mode 保持 work。
    expect(creep.harvest).toHaveBeenCalledWith(s1);
    expect(creep.memory.mode).toBe("work");
  });
});

describe("remoteHarvester — RM-2 source container 维修", () => {
  /**
   * 构造带 container 的远矿房：source(10,10)、container(10,11)（source 旁
   * range 1）、creep(11,10)（矿位）。lookForAtArea 返回 container 结构 —
   * findSourceContainer 首扫命中后写 sourceContainerId 缓存。
   */
  function makeWorld(opts: { hits?: number; hitsMax?: number } = {}) {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };

    const container: any = {
      id: "cont-1",
      structureType: "container",
      pos: { x: 10, y: 11, roomName: targetRoom },
      hits: opts.hits ?? 150000,
      hitsMax: opts.hitsMax ?? 250000,
      store: { getFreeCapacity: vi.fn(() => 0), getUsedCapacity: vi.fn(() => 2000) },
    };

    const creep = mockCreep({
      name: "rh-1", role: "remoteHarvester", sourceId: "s1",
      used: 50, capacity: 50, // 满载（work 链的常态）
    });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mode = "work";
    placeCreep(creep, 11, 10);

    const room = makeRoom(creep, [s1]);
    room.lookForAtArea = vi.fn(() => [{ structure: container }]);
    creep.room = room;

    return { creep, container, source: s1 };
  }

  it("满载 + container 血量 < 80% → repair（把空转 tick 变维修 tick）", () => {
    const { creep, container } = makeWorld({ hits: 150000 }); // 0.6 < 0.8

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).toHaveBeenCalledWith(container);
    // 维修候选截停 work 链 — 本 tick 不采集（背包能量流向维修）。
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("container 满血 → 不修，stationaryMine 接管（正常采集倒能）", () => {
    const { creep } = makeWorld({ hits: 250000 }); // 1.0 ≥ 0.8

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalled();
  });

  it("血量恰在 80% 阈值 → 不修（边界含等号，防贴线抖动）", () => {
    const { creep } = makeWorld({ hits: 200000 }); // 0.8 = 0.8

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).not.toHaveBeenCalled();
  });

  it("背包空 → 让位采集链（维修无料，采集优先回补）", () => {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };
    const container: any = {
      id: "cont-1", structureType: "container",
      pos: { x: 10, y: 11, roomName: targetRoom },
      hits: 100000, hitsMax: 250000,
      store: { getFreeCapacity: vi.fn(() => 0) },
    };
    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1", used: 0, capacity: 50 });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mode = "work";
    placeCreep(creep, 11, 10);
    const room = makeRoom(creep, [s1]);
    room.lookForAtArea = vi.fn(() => [{ structure: container }]);
    creep.room = room;

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalled();
  });

  it("无 container（衰减殆尽/未建）→ 不修，走建链或采集链", () => {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };
    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1", used: 25, capacity: 50 });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mode = "work";
    placeCreep(creep, 11, 10);
    // lookForAtArea 返回空（makeRoom 默认）— 无 container。
    creep.room = makeRoom(creep, [s1]);

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).not.toHaveBeenCalled();
  });

  it("距 container 超维修射程（>3）→ 让位归位链，不远程追修", () => {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };
    const container: any = {
      id: "cont-1", structureType: "container",
      pos: { x: 10, y: 11, roomName: targetRoom },
      hits: 100000, hitsMax: 250000,
      store: { getFreeCapacity: vi.fn(() => 0) },
    };
    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1", used: 25, capacity: 50 });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    creep.memory.mode = "work";
    placeCreep(creep, 16, 10); // 距 container(10,11)：max(6,1)=6 > 3
    const room = makeRoom(creep, [s1]);
    room.lookForAtArea = vi.fn(() => [{ structure: container }]);
    creep.room = room;

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).not.toHaveBeenCalled();
  });

  it("acquire 稳态（半载）+ 血量 < 80% → repair 触发（FSM 稳态可达性）", () => {
    // 采集者稳态是「采 N 倒 N」背包近空，FSM 长期 acquire — 维修只在
    // work 链则永远轮不到（集成场景 600 tick 实证：container 单调衰减）。
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };
    const container: any = {
      id: "cont-1", structureType: "container",
      pos: { x: 10, y: 11, roomName: targetRoom },
      hits: 150000, hitsMax: 250000, // 0.6 < 0.8
      store: { getFreeCapacity: vi.fn(() => 0) },
    };
    // 半载（acquire 链常态）— mode 未设置时由 FSM 判空载/半载为 acquire。
    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1", used: 10, capacity: 50 });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    placeCreep(creep, 11, 10); // 矿位：距 source 1、距 container 1
    const room = makeRoom(creep, [s1]);
    room.lookForAtArea = vi.fn(() => [{ structure: container }]);
    creep.room = room;

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).toHaveBeenCalledWith(container);
    // 维修截停采集 — 本 tick 能量流向维修而非 harvest。
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("acquire 稳态空载 → 维修让位采集链（回补优先）", () => {
    const s1 = mockSource("s1");
    s1.pos = { x: 10, y: 10, roomName: targetRoom };
    const container: any = {
      id: "cont-1", structureType: "container",
      pos: { x: 10, y: 11, roomName: targetRoom },
      hits: 100000, hitsMax: 250000,
      store: { getFreeCapacity: vi.fn(() => 0) },
    };
    const creep = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "s1", used: 0, capacity: 50 });
    creep.memory.home = homeRoom;
    creep.memory.remoteTarget = targetRoom;
    placeCreep(creep, 11, 10);
    const room = makeRoom(creep, [s1]);
    room.lookForAtArea = vi.fn(() => [{ structure: container }]);
    creep.room = room;

    remoteHarvesterRole.run(creep, mockContext(mockSnapshot({ roomName: homeRoom })));

    expect(creep.repair).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalled();
  });
});
