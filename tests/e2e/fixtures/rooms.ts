/** E2E 场景夹具 — 基于 Screeps 真实常量构建标准房间。 */
import {
  type RoomSetup,
  source,
  controller,
  mineral,
  spawn,
  emptyTerrain,
} from "../framework/WorldBuilder";
import { STANDARD_ROOM_LAYOUT } from "../../support/room-blueprints";
import { COMPACT_CORE_V2 } from "../../../src/domain/layout/templates/compact-core-v2";
import { absPos } from "../../../src/domain/layout/types";
import type { ObjectSpec } from "../framework/WorldBuilder";

/**
 * 标准单房间：spawn + 2 source + 1 controller + 1 mineral。
 * 地形全平原，spawn 在中心 (25,25)。
 * 坐标取自共享蓝图 STANDARD_ROOM_LAYOUT（与 integration 层同源）。

 * @param roomName 房间名
 * @param spawnEnergy spawn 初始能量（默认 300，灾后恢复用）
 * @param rcl controller 初始等级（默认 1）
 */
export function standardRoom(roomName: string, spawnEnergy = 300, rcl = 1): RoomSetup {
  const L = STANDARD_ROOM_LAYOUT;
  return {
    name: roomName,
    terrain: emptyTerrain(),
    objects: [
      controller(L.controller.x, L.controller.y, rcl),
      source(L.sources[0]!.x, L.sources[0]!.y),
      source(L.sources[1]!.x, L.sources[1]!.y),
      mineral(L.mineral.x, L.mineral.y),
      spawn(L.spawn.x, L.spawn.y, L.spawn.name, spawnEnergy),
    ],
  };
}

/**
 * RCL4 房间：已有 storage 建造需求，验证 storage 优先级。
 * controller level 4，spawn 满，5 个 extension。
 */
export function rcl4Room(roomName: string): RoomSetup {
  const room = standardRoom(roomName, 300, 4);
  // extension 位置（5 个，RCL2 解锁）
  room.objects!.push(
    { type: "extension", x: 22, y: 22, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 28, y: 22, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 22, y: 28, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 28, y: 28, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 25, y: 20, props: { energy: 50, energyCapacity: 50 } },
  );
  return room;
}

/**
 * RCL3 房间：有 tower，验证防御逻辑。
 * controller level 3，1 个 tower（空能量）。
 */
export function rcl3RoomWithTower(roomName: string): RoomSetup {
  const room = standardRoom(roomName, 300, 3);
  room.objects!.push({ type: "tower", x: 20, y: 20, props: { energy: 0, energyCapacity: 1000 } });
  return room;
}

/**
 * 双房间布局：用于 remote mining 场景。
 * 主房 W0N1（有 spawn），remote 房 W0N0（只有 source，无 spawn）。
 */
export function remoteMiningRooms(): RoomSetup[] {
  return [
    standardRoom("W0N1", 300, 3),
    {
      name: "W0N0",
      terrain: emptyTerrain(),
      objects: [
        controller(10, 10, 0), // 未占领
        source(10, 40),
        source(40, 10),
        mineral(40, 40),
      ],
    },
  ];
}

/**
 * 按 COMPACT_CORE_V2 派生「该 RCL 合法批次」的 extension 规格。
 *
 * 存在的理由（实测挖出的坑）：规模场景直接白送高 RCL，而 AI 的起步路径是
 * 「RCL2-5 逐批铺 extension」——跳过它会让世界卡在 `energyCapacityAvailable=300`：
 * 最小 body → builder 每只 ~1 progress/tick → 14 万工程账单清不完 → extension 永远建不出来。
 * 于是人口/编制类读数量的都是萎缩世界。预置 extension 就是把这个死循环拆开。
 *
 * 位置**必须**由蓝图算出：手填坐标会被 layout 的 orphanSweep 判为非布局结构拆掉
 * （见 `tests/support/room-blueprints.ts` 的「禁止重新发明绝对坐标」约束）。
 */
export function coreExtensions(roomName: string, rcl: number): ObjectSpec[] {
  const L = STANDARD_ROOM_LAYOUT;
  return COMPACT_CORE_V2.cells
    .filter(c => c.structureType === STRUCTURE_EXTENSION && c.minRcl <= rcl)
    .map(c => {
      const p = absPos(L.spawn.x, L.spawn.y, c, roomName);
      return {
        type: "extension",
        x: p.x,
        y: p.y,
        // 现代引擎读 store；与 addHostileTower 同形状，另补 extension 的真实 hitsMax=1000。
        props: {
          energy: 50,
          energyCapacity: 50,
          hits: 1000,
          hitsMax: 1000,
          store: { energy: 50 },
          storeCapacityResource: { energy: 50 },
        },
      };
    });
}

/**
 * 已开发的自有房：双 source + controller + mineral + 该 RCL 合法批次的 extension 群。
 * 规模类场景（CPU 定标/外推/台阶人口）用它，否则量到的是萎缩世界
 * （实测：无 extension 时 energyCapacityAvailable 恒 300 → 最小 body → 建设吞吐 ~1/tick
 * → 14 万工程账单清不完 → 永远停在零基建）。
 *
 * 语义是「假设有一间发展到位的房」，不是「AI 自己长成了这样」——高 RCL 白送的起步态
 * AI 反而走不出来，那条稳健性缺口（灾后/接收预建房同样中招）值得单独立场景验，
 * 不该由规模定标场景代答。
 */
export function developedRoom(roomName: string, rcl: number): RoomSetup {
  const L = STANDARD_ROOM_LAYOUT;
  return {
    name: roomName,
    terrain: emptyTerrain(),
    objects: [
      controller(L.controller.x, L.controller.y, rcl),
      source(L.sources[0]!.x, L.sources[0]!.y),
      source(L.sources[1]!.x, L.sources[1]!.y),
      mineral(L.mineral.x, L.mineral.y),
      // 不预置 spawn：ScenarioRunner 会为自有房补「store 制式」spawn（addBot 同源），
      // 夹具再放一个 legacy 制式的就成了双 spawn —— 计费口径分裂，孵化容量恒 0（实测踩过）。
      // extension 位置仍以蓝图的主 spawn (25,25) 为锚点，与 runner 补的 spawn 同位。
      ...coreExtensions(roomName, rcl),
    ],
  };
}

/**
 * 战争场景的主房：RCL6 核心区（extension 群）+ 有主塔 + 大额 storage。
 *
 * 为什么必须有 extension（实测根因，不是调参）：无 extension 的 RCL6 房
 * `energyCapacityAvailable` 恒 300，一次孵化就把口袋抽干 → `spendableRatio` 长期贴着
 * 物流陷阱阈值 0.15 之下；而双 source 房的 source container 本就常满（`frozenRatio>0.8`）
 * → 陷阱两条件同时成立几乎是常态 → liquidityScore 每几百 tick 打满一次，把 phase 推进
 * 危机带；posture 的「危机撤资」在 defense 掩码撤开的第 1 tick 就把 war 降回 fortify
 * （实测 war 存活 36~222 tick，编队孵化到 6/8 就收摊）。
 * 换句话说：那间房本来就**打不起战争**，让场景去判战争平衡没有意义。
 *
 * 同样必须修的是**支付能力**，而且要按**实测烧钱速率**标定，不是凑数：
 * `standardRoom` 只放 2 个 source（再生 10 E/tick → 收入天花板 20 E/tick），而这类房在
 * RCL6 + 现钱状态下 war 期净流实测 **−27.79 E/tick**（t1000..6500 窗口，含升级/工程/编队
 * 支出）。于是"能撑多久"是算得出来的：`200k ÷ 27.8 ≈ 7200 tick` —— 与三次实测撤资时刻
 * （6559 / 7189 / 7480）对得上。场景窗口 9000 tick，所以默认给 **400k ≈ 14400 tick**
 * （1.6 倍余量），让"打得起"成为夹具事实而不是侥幸；相位机的两道绝对刻度都在其下：
 * 可支付豁免线 50k（`upgrade.sprintStorage`）、破产兜底线 10k（`upgrade.sustainedStorage`）。
 *
 * 本该从**收入侧**补（真实房间 4~6 个 source），实测踩过一次后判定为暂不可行，账记在
 * task #10：给到 5 个 source 时 `CONFIG.roles.harvester.maxCount=4` 与相位机的
 * `understaffed = harvesterCount < sourceCount` **互斥** —— 顶格编制仍算欠员，房间永久
 * 停在生存带（9000 tick 里 8730 tick 在带内），war 场景因此不可判定；那条通道
 * （srcRatio 取"最满 source"）还会把欠员伪装成采集塌方，把真相盖掉。
 * 编制上限修好之前，这里只能用绝对储备把支付能力买回来。
 *
 * 坐标一律取布局蓝图槽位（extension 走 {@link coreExtensions}，塔/storage 用同一模版的
 * `core.tower.01`/`core.storage.01`）：手填坐标会被 layout 的 orphanSweep 判成非布局结构拆掉。
 *
 * @param storageEnergy 预置储备 —— 默认 400k（引擎 STORAGE_CAPACITY=1,000,000，合法）。
 */
export function warRoom(roomName: string, rcl = 6, storageEnergy = 400000): RoomSetup {
  const L = STANDARD_ROOM_LAYOUT;
  const slot = (key: string): { x: number; y: number } => {
    const c = COMPACT_CORE_V2.cells.find(cc => cc.key === key);
    if (!c) throw new Error(`warRoom: 蓝图缺少槽位 ${key}`);
    return absPos(L.spawn.x, L.spawn.y, c, roomName);
  };
  const tower = slot("core.tower.01");
  const storage = slot("core.storage.01");
  const room = standardRoom(roomName, 300, rcl);
  room.objects!.push(
    ...coreExtensions(roomName, rcl),
    { type: "tower", x: tower.x, y: tower.y, props: { energy: 1000, energyCapacity: 1000 } },
    { type: "storage", x: storage.x, y: storage.y, props: { store: { energy: storageEnergy } } },
  );
  return room;
}
