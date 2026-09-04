/** 孵化请求的 body 模板和生成约束。 */

export type BodyTier = "recovery" | "basic" | "standard" | "extended";

interface BodyTemplate {
  /** 有序 body 部件（Screeps 按数组顺序生成）。 */
  parts: BodyPartConstant[];
  /** 完整 body 所需的最小 energyCapacityAvailable。 */
  minCapacity: number;
}

/**
 * 按角色 → 档位索引的 body 目录，从高到低取第一个容量满足者。
 * "recovery" 档始终 ≤200 能量，供 P0 紧急孵化。
 * 用字符串字面量而非 Screeps 全局常量 — 无运行时也可测试。
 */
export const BODY_TEMPLATES: Readonly<Record<string, readonly BodyTemplate[]>> = {
  attacker: [
    // 纯战斗（无 CARRY）：TOUGH 吸收塔伤、ATTACK 拆建筑/杀敌、1:1 MOVE 无疲劳移动。
    // RCL8 攻城档 [10T,20A,20M] @4200（50 部件 = MAX_CREEP_SIZE）：20 ATTACK = 600 dmg/tick，
    // 10 TOUGH 吸 1000 塔伤保住 ATTACK 输出窗口；1:1 MOVE 平原满速突进。
    // 用于 war-planner 编队攻坚（塔 ≥2 座的重防目标），平时不孵（仅 war 姿态）。
    { parts: ["tough","tough","tough","tough","tough","tough","tough","tough","tough","tough","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move"], minCapacity: 4200 },
    // RCL7 塔下攻坚档 [5T,10A,10M] @2100：10 ATTACK = 300 dmg/tick，5 TOUGH 吸 500 塔伤。
    // 2-3 塔目标可打（配合 healer 编队），无塔目标碾压。
    { parts: ["tough","tough","tough","tough","tough","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","move","move","move","move","move","move","move","move","move","move"], minCapacity: 2100 },
    // 满编 [3T,4A,4M] @800：抗一轮塔伤并砸穿 rampart 血线（war-planner 按编队孵化）。
    { parts: ["tough", "tough", "tough", "attack", "attack", "attack", "attack", "move", "move", "move", "move"], minCapacity: 800 },
    // 绝境档 [1T,1A,1M]：随时可战优先于等满配（bodies.test 要求最低档 minCapacity=200）。
    { parts: ["tough", "attack", "move"], minCapacity: 200 },
  ],
  // 远程攻击者（kiting 战术）：RANGED_ATTACK 10 dmg/part/tick，射程 3，
  // 无 counter-attack 风险（vs ATTACK 的 30 dmg 但被反击）。
  // kiting = 边退边打，近战敌人永远够不到 — 对 NPC 入侵者/无 ranged 敌人无损。
  // TOUGH 前置吸塔伤，RANGED_ATTACK 比 ATTACK 贵 70/部件（150 vs 80）。
  // 用于：防御 NPC 入侵者、PvP kiting、highway 巡逻。
  rangedAttacker: [
    // RCL8 满编 [5T,10R,15M] @2750：10 RANGED_ATTACK = 100 dmg/tick，
    // 5 TOUGH 吸 500 塔伤保住 RANGED_ATTACK 输出窗口。
    // MOVE:非MOVE = 15:15 = 1:1 平原满速；kiting 需要高机动性。
    { parts: ["tough","tough","tough","tough","tough","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move"], minCapacity: 2750 },
    // RCL7 [3T,6R,9M] @1650：6 RANGED_ATTACK = 60 dmg/tick。
    { parts: ["tough","tough","tough","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","ranged_attack","move","move","move","move","move","move","move","move","move"], minCapacity: 1650 },
    // RCL5 [1T,3R,4M] @650：3 RANGED_ATTACK = 30 dmg/tick。
    { parts: ["tough","ranged_attack","ranged_attack","ranged_attack","move","move","move","move"], minCapacity: 650 },
    // 最小档 [1R,1M] @200：10 dmg/tick，kiting 入侵者。
    { parts: ["ranged_attack", "move"], minCapacity: 200 },
  ],
  // 拆迁者：WORK dismantle 50 dmg/part/tick（vs ATTACK 30 dmg），不触发 counter-attack。
  // 用于拆 rampart/wall/high HP 结构 — dismantle 不产能量但伤害最高。
  // TOUGH 前置吸塔伤，WORK 拆建筑，MOVE 保证机动。
  dismantler: [
    // RCL8 满编 [5T,10W,15M] @2150：10 WORK = 500 dmg/tick dismantle。
    // 5 TOUGH 吸 500 塔伤保住 WORK 输出窗口。
    { parts: ["tough","tough","tough","tough","tough","work","work","work","work","work","work","work","work","work","work","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move"], minCapacity: 2150 },
    // RCL6 [3T,6W,9M] @1290：6 WORK = 300 dmg/tick。
    { parts: ["tough","tough","tough","work","work","work","work","work","work","move","move","move","move","move","move","move","move","move"], minCapacity: 1290 },
    // RCL4 [1T,3W,4M] @650：3 WORK = 150 dmg/tick。
    { parts: ["tough","work","work","work","move","move","move","move"], minCapacity: 650 },
    // 最小档 [1W,1M] @200：50 dmg/tick dismantle。
    { parts: ["work", "move"], minCapacity: 200 },
  ],
  // 奶车（heal-tank 编队的治疗端）：1:1 HEAL:MOVE 平原无疲劳；贴身 heal 12/part/tick,
  // range 3 退化为 rangedHeal 4/part/tick。满档 10 HEAL = 120 hits/tick，
  // 双奶叠加可覆盖 2-3 塔集火的平均伤害（塔单发 600 衰减至 75）。
  // TOUGH 前置变体（RCL7+）：塔伤按 body 顺序命中，TOUGH 先死保住后面的 HEAL
  // 部件不备摧毁（社区标准实践 — Screeps Wiki Combat: TOUGH boosted 减伤）。
  healer: [
    // RCL8 TOUGH 前置档 [4T,8H,12M] @2540：8 HEAL = 96 hits/tick 贴身治疗，
    // 4 TOUGH 吸 400 塔伤保住 HEAL 部件 — 塔下生存率显著提升。
    { parts: ["tough","tough","tough","tough","heal","heal","heal","heal","heal","heal","heal","heal","move","move","move","move","move","move","move","move","move","move","move","move"], minCapacity: 2540 },
    // 无 TOUGH 满档 [10H,10M] @3000：纯治疗最大化，无塔威胁时最优。
    { parts: ["heal", "heal", "heal", "heal", "heal", "heal", "heal", "heal", "heal", "heal", "move", "move", "move", "move", "move", "move", "move", "move", "move", "move"], minCapacity: 3000 },
    // RCL7 TOUGH 前置档 [2T,5H,7M] @1590：5 HEAL = 60 hits/tick。
    { parts: ["tough","tough","heal","heal","heal","heal","heal","move","move","move","move","move","move","move"], minCapacity: 1590 },
    // 无 TOUGH 中档 [6H,6M] @1800。
    { parts: ["heal", "heal", "heal", "heal", "heal", "heal", "move", "move", "move", "move", "move", "move"], minCapacity: 1800 },
    { parts: ["heal", "heal", "move", "move"], minCapacity: 600 },
  ],
  // 侦察兵（R6b）：[MOVE] 即足 — 无疲劳全速穿行、50 能量可抛弃；
  // 使命是「到达目标房提供一 tick 视野」，不是战斗（敌意房由 flee 保全）。
  scout: [
    { parts: ["move"], minCapacity: 50 },
  ],
  // PB 捡运者（审计缺口 2）：纯 CARRY+MOVE 一次性 — PB 击破后进场捡掉落
  // power（2k-6k）送回 home。无战斗件（PB 反击会秒杀，只在 collect 阶段进场）。
  pbCollector: [
    // RCL7+ 大运力档 [10C,10M] @1000 成本：运 5000 power 一趟清（大 PB 掉落 6k 一趟搞定）。
    // minCapacity=1300：与 [5C,5M] 同在 RCL4(1300) 解锁，但排在更高档位。
    // 低于 1300 容量退回 [5C,5M]（5C5M 成本 750，1250 门槛确保 RCL3(800) 不用此档）。
    { parts: ["carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move","move","move"], minCapacity: 1300 },
    // 5C5M：运 2500 power 一趟清（典型掉落 2k-6k，1-3 趟由 maxCount=1 串行）。
    { parts: ["carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move"], minCapacity: 1250 },
    { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 750 },
    { parts: ["carry", "carry", "move", "move"], minCapacity: 500 },
  ],
  // 次级 Invader Core 清核者（P1）：拆 level-0 reserve-only 核心（无守卫、不反击）。
  // 核心是纯能量/战利品来源 —— 无 HEAL/boost/combat 编队，body 加 CARRY 顺手把废墟
  // 战利品运回 home 存 storage 后回收。满档 8A2C10M：240 dmg/tick → 100k core ≈ 417 tick
  // 拆完；降级档 4A1C5M 仍 ≥120 dmg/tick（≈833 tick），能量紧张亦能拆。
  coreClearer: [
    { parts: ["attack", "attack", "attack", "attack", "attack", "attack", "attack", "attack", "carry", "carry", "move", "move", "move", "move", "move", "move", "move", "move", "move", "move"], minCapacity: 1240 },
    { parts: ["attack", "attack", "attack", "attack", "carry", "move", "move", "move", "move", "move"], minCapacity: 620 },
  ],
  worker: [
    // 开局优化：RCL1 起始 300 能量直接用满，2 WORK 采集翻倍，大幅缩短 bootstrap。
    { parts: ["work", "work", "carry", "move"], minCapacity: 300 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  harvester: [
    // 站桩矿工：5 WORK 恰好匹配 source 再生速率（3000/300=10/tick）；按容量平滑降级，
    // 避免低容量卡在 1 WORK（2/tick）拖垮经济。
    // 2 MOVE：站桩后不需移动，但首次通勤到 container 时 1 MOVE 在沼泽上需 30 tick/步，
    // 2 MOVE 降至 15 tick/步，平原 3 tick/步 vs 1 MOVE 的 6 tick/步。
    { parts: ["work", "work", "work", "work", "work", "carry", "move", "move"], minCapacity: 650 },
    { parts: ["work", "work", "work", "work", "carry", "move"], minCapacity: 500 },
    { parts: ["work", "work", "work", "carry", "move"], minCapacity: 400 },
    { parts: ["work", "work", "carry", "move"], minCapacity: 300 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  hauler: [
    // RCL7+ 无路大运力档 [10C,10M] @1000：1:1 CARRY:MOVE 平原满速，运力 500/趟。
    // 无道路覆盖的房间或远矿路径上用此档，比 6C6M 运力 +67%。
    {
      parts: ["carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move","move","move"],
      minCapacity: 1000,
    },
    // RCL3+ 大运力档：同样吞吐用更少 creep，省 CPU/寻路/spawn 孵化窗。
    {
      parts: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move"],
      minCapacity: 600,
    },
    // 300–599 补档：RCL2（容量 550）流动性陷阱高发期，卡 3C 档只有 150 运力 —
    // 断档会放大 colonyState 振荡。
    { parts: ["carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move"], minCapacity: 500 },
    { parts: ["carry", "carry", "carry", "carry", "move", "move", "move", "move"], minCapacity: 400 },
    { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
    { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
  ],
  distributor: [
    // 与 hauler 同型（纯 CARRY+MOVE 物流，storage→spawn/extension/tower 分发）。
    // RCL7+ 无路大运力档 [10C,10M] @1000。
    {
      parts: ["carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move","move","move"],
      minCapacity: 1000,
    },
    {
      parts: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move"],
      minCapacity: 600,
    },
    { parts: ["carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move"], minCapacity: 500 },
    { parts: ["carry", "carry", "carry", "carry", "move", "move", "move", "move"], minCapacity: 400 },
    { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
    { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
  ],
  upgrader: [
    // 站桩升级：1 CARRY 承接 withdraw、2 MOVE 通勤，其余全 WORK。
    // RCL<8 无引擎升级上限，大 body 直接提升升速（每 WORK = 1 energy/tick）。
    // [40W,1C,2M] @4200：RCL7(5300) 冲刺档 — 40/tick 升速，比 15W 快 2.7x。
    {
      parts: [
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work", "work",
        "carry", "move", "move",
      ],
      minCapacity: 4200,
    },
    // [25W,1C,2M] @2700：RCL6(3000) 冲刺档 — 25/tick 升速。
    {
      parts: [
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work",
        "carry", "move", "move",
      ],
      minCapacity: 2700,
    },
    // [15W,1C,2M] @1650：RCL5(1800) 起可孵；RCL8 单 creep 恰好顶满官方 15 energy/tick 上限。
    {
      parts: [
        "work", "work", "work", "work", "work", "work", "work", "work",
        "work", "work", "work", "work", "work", "work", "work",
        "carry", "move", "move",
      ],
      minCapacity: 1650,
    },
    // [8W,1C,2M] @950：RCL4(1300) 主力档。
    {
      parts: ["work", "work", "work", "work", "work", "work", "work", "work", "carry", "move", "move"],
      minCapacity: 950,
    },
    // [4W] @500：RCL2-3(550/800) 过渡档。
    { parts: ["work", "work", "work", "work", "carry", "move"], minCapacity: 500 },
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  builder: [
    // RCL8 大工地档 [16W,8C,12M] @2600：16 WORK = 16/tick 建造速度，
    // 8 CARRY = 400 运力减少往返，12 MOVE ≥ 24非MOVE/2 道路满速。
    // RCL8 大量 rampart/wall 工地时显著缩短建造周期。
    {
      parts: [
        "work","work","work","work","work","work","work","work",
        "work","work","work","work","work","work","work","work",
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "move","move","move","move","move","move","move","move","move","move","move","move",
      ],
      minCapacity: 2600,
    },
    // RCL7 大工地档 [12W,6C,9M] @1950：12 WORK = 12/tick，比 8W 快 50%。
    {
      parts: [
        "work","work","work","work","work","work","work","work",
        "work","work","work","work",
        "carry","carry","carry","carry","carry","carry",
        "move","move","move","move","move","move","move","move","move",
      ],
      minCapacity: 1950,
    },
    // [8W,4C,6M] RCL4 主力档：MOVE ≥ 非MOVE/2 道路上满速；大工地几下拍完减少往返取能。
    {
      parts: [
        "work", "work", "work", "work", "work", "work", "work", "work",
        "carry", "carry", "carry", "carry",
        "move", "move", "move", "move", "move", "move",
      ],
      minCapacity: 1300,
    },
    // [4W,2C,3M] @650：RCL3(800) 过渡档。
    {
      parts: ["work", "work", "work", "work", "carry", "carry", "move", "move", "move"],
      minCapacity: 650,
    },
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move", "move"], minCapacity: 250 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  remoteHarvester: [
    // 与本地 harvester 同款 5W 站桩 + 额外 MOVE 保证跨房无道路通勤。
    { parts: ["work", "work", "work", "work", "work", "carry", "move", "move", "move"], minCapacity: 750 },
    // [3W,1C,2M] 中容量档。
    { parts: ["work", "work", "work", "carry", "move", "move"], minCapacity: 450 },
    // [2W,1C,2M] 低容量回退。
    { parts: ["work", "work", "carry", "move", "move"], minCapacity: 350 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  remoteHauler: [
    // RCL8 跨房大运力档 [24C,12M] @1800：1:1 配比平原满速，运力 1200/趟。
    // 远矿距离远、往返耗时长，大运力减少趟数 = 减少 CPU 消耗 + 更少 creep 编制。
    { parts: ["carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move","move","move","move","move"], minCapacity: 1800 },
    // RCL7 跨房大运力档 [16C,8M] @1200：运力 800/趟，比 8C8M 翻倍。
    { parts: ["carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move"], minCapacity: 1200 },
    // hauler 同款 CARRY+MOVE，额外 MOVE 保证跨房无道路可行进。
    { parts: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move", "move", "move"], minCapacity: 800 },
    { parts: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move", "move", "move"], minCapacity: 600 },
    { parts: ["carry", "carry", "carry", "move", "move", "move"], minCapacity: 300 },
    { parts: ["carry", "carry", "move", "move"], minCapacity: 200 },
  ],
  // A3.0 跨房调拨搬运工：CARRY+MOVE 1:1 平原满速跨房。
  // 模板与 remoteHauler 同构——远距离大运力减少趟数。
  carrier: [
    // RCL8 大运力档 [24C,12M] @1800：运力 1200/趟。
    { parts: ["carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move","move","move","move","move"], minCapacity: 1800 },
    // RCL7 中运力档 [16C,8M] @1200：运力 800/趟。
    { parts: ["carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move"], minCapacity: 1200 },
    // RCL5 标准档 [8C,8M] @800：运力 400/趟。
    { parts: ["carry","carry","carry","carry","carry","carry","carry","carry","move","move","move","move","move","move","move","move"], minCapacity: 800 },
    // RCL4 基础档 [4C,4M] @400：运力 200/趟。
    { parts: ["carry","carry","carry","carry","move","move","move","move"], minCapacity: 400 },
    // 最小档 [2C,2M] @200：运力 100/趟。
    { parts: ["carry","carry","move","move"], minCapacity: 200 },
  ],
  reserver: [
    // [CLAIM,MOVE] 最小占领：1 CLAIM=600 能量；reserveController 每 tick 续期 1 tick，
    // 单 CLAIM 即满足需求。
    { parts: ["claim", "move"], minCapacity: 650 },
  ],
  claimer: [
    // 多 1 MOVE 加速跨房长途通勤 — CLAIM creep 仅 600 tick 寿命，路上省 1 tick 都是占领窗口。
    { parts: ["claim", "move", "move"], minCapacity: 700 },
    { parts: ["claim", "move"], minCapacity: 650 },
  ],
  mineralMiner: [
    // 站桩矿工：extractor 5-tick 冷却，1 WORK=1/tick、上限 10/tick 需 10 WORK；
    // 必须含 CARRY（harvestMineral 检查剩余容量>0，空 CARRY 永不触发）。按容量平滑降级。
    { parts: ["work", "work", "work", "work", "work", "work", "work", "work", "work", "work", "carry", "move"], minCapacity: 1250 },
    { parts: ["work", "work", "work", "work", "work", "carry", "move"], minCapacity: 650 },
    { parts: ["work", "work", "work", "carry", "move"], minCapacity: 450 },
    { parts: ["work", "carry", "move"], minCapacity: 200 },
  ],
  remoteDefender: [
    // [2A,2M] 20 damage/tick，10 tick 击杀 NPC reserver（200 hits；其无攻击能力，
    // defender 不会受伤）。
    { parts: ["attack", "attack", "move", "move"], minCapacity: 520 },
    // [A,M] 最小配置：10 damage/tick，20 tick 击杀 NPC reserver。
    { parts: ["attack", "move"], minCapacity: 130 },
  ],
  defender: [
    // 本房防御者：与塔协同贴脸输出，1:1 ATTACK:MOVE 无路面也能追击。
    // RCL8 重防档 [8T,16A,16M] @2160：16 ATTACK = 480 dmg/tick，8 TOUGH 吸 800 塔伤
    // 保住 ATTACK 输出窗口。TOUGH 前置是关键 — 塔伤按部件顺序命中，TOUGH 先死
    // 保护后面的 ATTACK 不被摧毁（部件摧毁后输出骤降）。
    {
      parts: ["tough","tough","tough","tough","tough","tough","tough","tough","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move","move"],
      minCapacity: 2160,
    },
    // RCL7+ 重防档 [4T,10A,10M] @1340：TOUGH 前置吸塔伤，10 ATTACK = 300 dmg/tick。
    // 仅比无 TOUGH 版多 40 能量（4×10），但塔下存活率显著提升。
    {
      parts: ["tough","tough","tough","tough","attack","attack","attack","attack","attack","attack","attack","attack","attack","attack","move","move","move","move","move","move","move","move","move","move"],
      minCapacity: 1340,
    },
    // [10A,10M] RCL5+ 主力档，300 damage/tick（无 TOUGH — 和平期足够）。
    {
      parts: [
        "attack", "attack", "attack", "attack", "attack",
        "attack", "attack", "attack", "attack", "attack",
        "move", "move", "move", "move", "move",
        "move", "move", "move", "move", "move",
      ],
      minCapacity: 1300,
    },
    // [6A,6M] RCL3-4 档。
    { parts: ["attack", "attack", "attack", "attack", "attack", "attack", "move", "move", "move", "move", "move", "move"], minCapacity: 780 },
    // [4A,4M] RCL2-3 档。
    { parts: ["attack", "attack", "attack", "attack", "move", "move", "move", "move"], minCapacity: 520 },
    // [2A,2M] 早期最小可用防御。
    { parts: ["attack", "attack", "move", "move"], minCapacity: 260 },
    // [A,M] 绝境档 — 有防御总比没有强。
    { parts: ["attack", "move"], minCapacity: 130 },
  ],
};

/**
 * 道路优化 body 变体（约束 HA-10）：RCL4+ 核心物流路已铺设时使用 —
 * 1 MOVE 可在道路上带动 2 CARRY（fatigue-free）；道路未覆盖时退回默认模板。
 */
const ROAD_OPTIMIZED_BODIES: Readonly<Record<string, readonly BodyTemplate[]>> = {
  hauler: [
    // RCL8 道路顶档 [32C,16M] @2400：道路 2:1 配比满速，运力 1600/趟。
    // RCL8(12300) 容量远超此档 — 但 32C 已是单趟饱和点（storage→spawn 一趟填满），
    // 更多 CARRY 只增加孵化时间与成本而吞吐无增益（spawn 窗口是瓶颈）。
    {
      parts: [
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "move","move","move","move","move","move","move","move",
        "move","move","move","move","move","move","move","move",
      ],
      minCapacity: 2400,
    },
    // [16C,8M] @1200：RCL4(1300) 顶档。
    {
      parts: [
        "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
        "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
        "move", "move", "move", "move", "move", "move", "move", "move",
      ],
      minCapacity: 1200,
    },
    // [8C,4M] @600：RCL3(800) 档。
    {
      parts: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move"],
      minCapacity: 600,
    },
    { parts: ["carry", "carry", "carry", "carry", "move", "move"], minCapacity: 300 },
  ],
  distributor: [
    // RCL8 道路顶档 [32C,16M] @2400：与 hauler 同型。
    {
      parts: [
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "carry","carry","carry","carry","carry","carry","carry","carry",
        "move","move","move","move","move","move","move","move",
        "move","move","move","move","move","move","move","move",
      ],
      minCapacity: 2400,
    },
    // 与 hauler 相同的道路优化 body。
    {
      parts: [
        "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
        "carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry",
        "move", "move", "move", "move", "move", "move", "move", "move",
      ],
      minCapacity: 1200,
    },
    {
      parts: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move"],
      minCapacity: 600,
    },
    { parts: ["carry", "carry", "carry", "carry", "move", "move"], minCapacity: 300 },
  ],
};

/** P0 恢复用的最小可用 body — 始终为 [WORK, CARRY, MOVE]，成本 200 能量。 */
export const RECOVERY_BODY: BodyPartConstant[] = ["work", "carry", "move"];

/** 各 body 部件的成本。使用与 BodyPartConstant 值匹配的字符串键。 */
const PART_COST: Readonly<Record<string, number>> = {
  move: 50,
  work: 100,
  carry: 50,
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  claim: 600,
  tough: 10,
};

export function bodyCost(body: readonly BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + (PART_COST[part] ?? 0), 0);
}

/**
 * 选择适合 spawn 能量容量的最佳 body；无档位匹配时回退 RECOVERY_BODY，
 * 确保 P0 孵化不因 body 选择阻塞。options.rcl ≥ 4 时 hauler 走道路优化变体（HA-10）。
 */
export function selectBody(
  role: string,
  energyCapacityAvailable: number,
  options?: { rcl?: number },
): BodyPartConstant[] {
  if (options?.rcl !== undefined && options.rcl >= 4) {
    const roadTiers = ROAD_OPTIMIZED_BODIES[role];
    if (roadTiers) {
      for (const t of roadTiers) {
        if (energyCapacityAvailable >= t.minCapacity) return [...t.parts];
      }
    }
  }

  const templates = BODY_TEMPLATES[role];
  if (templates) {
    for (const t of templates) {
      if (energyCapacityAvailable >= t.minCapacity) return [...t.parts];
    }
  }
  return [...RECOVERY_BODY];
}

/**
 * 角色最低档模板 body（无视能量约束）— RECOVERY_BODY 兜底对必需部件非
 * [W,C,M] 的角色是陷阱：缺能量时 defender 会拿到无 ATTACK 的 [W,C,M]、
 * hauler 平白多买用不上的 WORK。调用方在回退产物缺必需部件时改用它：
 * 请求带最低档 body 排队，能量一到位即孵出真正可用的单位。
 */
export function minimalBodyFor(role: string): BodyPartConstant[] {
  const templates = BODY_TEMPLATES[role];
  const last = templates?.[templates.length - 1];
  return last ? [...last.parts] : [...RECOVERY_BODY];
}

/**
 * 将 body 降级以适应当前可用能量。
 * 每次移除最贵的可移除部件（优先砍 WORK=100，保留 CARRY/MOVE），
 * 直到成本满足或无可移除部件。至少保留 requiredParts 中每种各一个。
 * 默认要求 [WORK, CARRY, MOVE]；hauler 等纯 CARRY+MOVE 角色可传入 ["carry", "move"]。
 * 如果连最小 body 也无法满足，返回 undefined（调用方应推迟请求）。
 *
 * MOVE 配比守卫（关键）：CARRY 与 MOVE 同价（各 50），朴素「砍最贵」会把
 * MOVE 一路砍到只剩 1 个 —— 产出 nC1M 独腿 body，满载后 fatigue 恢复趋零，
 * 无路时寸步难移，transfer 永远 ERR_NOT_IN_RANGE 卡死（线上实测全房停摆根因）。
 * 因此移除时对 MOVE 施加地板：保证 MOVE 数 ≥ 其余部件数的一半（向上取整）。
 * 引擎疲劳机制：非 MOVE 部件平原产 2 fatigue/格、道路 1、沼泽 10，每 MOVE 消 2/tick —
 * 2 非MOVE : 1 MOVE 是道路 fatigue-free 的临界配比，平原为半速（隔 tick 一格），
 * 仍保有可用机动性，不会退化为独腿卡死。
 */
export function degradeBody(
  body: readonly BodyPartConstant[],
  energyAvailable: number,
  requiredParts: readonly BodyPartConstant[] = ["work", "carry", "move"],
): BodyPartConstant[] | undefined {
  const parts = [...body];

  while (bodyCost(parts) > energyAvailable) {
    const counts = new Map<string, number>();
    for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1);

    const moveCount = counts.get("move") ?? 0;
    const nonMoveCount = parts.length - moveCount;

    // 找最贵的可移除部件（满足 requiredParts 与 MOVE 配比约束）。
    let worstIdx = -1;
    let worstCost = -1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const cost = PART_COST[p] ?? 0;
      if (cost < worstCost) continue;
      // 每种 requiredParts 至少保留 1 个。
      const isRequired = requiredParts.includes(p);
      const currentCount = counts.get(p) ?? 0;
      if (isRequired && currentCount <= 1) continue;
      // MOVE 配比守卫：移除后仍须 move ≥ ceil(nonMove/2)，否则跳过该 MOVE。
      if (p === "move") {
        const moveAfter = moveCount - 1;
        const needed = Math.ceil(nonMoveCount / 2);
        if (moveAfter < needed) continue;
      }
      worstIdx = i;
      worstCost = cost;
    }

    if (worstIdx === -1) break; // 无可移除部件（保配比后卡住）
    parts.splice(worstIdx, 1);
  }

  for (const part of requiredParts) {
    if (!parts.includes(part)) return undefined;
  }
  if (bodyCost(parts) > energyAvailable) return undefined;
  return parts;
}
