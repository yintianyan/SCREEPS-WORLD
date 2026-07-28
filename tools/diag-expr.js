// 诊断表达式：把 distributor 决策链的运行时真相写进 Memory.__diag。
// 由 console-eval-file.js 读取并 POST 到游戏 console 执行。
(function () {
  const r = Game.rooms["W37S58"];
  if (!r) return "no room visibility";
  const dist = r.find(FIND_MY_CREEPS, { filter: function (c) { return c.memory.role === "distributor"; } })[0];
  const emptyExt = r.find(FIND_MY_STRUCTURES, {
    filter: function (s) { return s.structureType === "extension" && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0; },
  });
  // 快照系统的 fillTargets 无法从 console 直接读（它在 heap），
  // 但可以复现其构建逻辑，看运行时是否真有空 sink。
  const spawns = r.find(FIND_MY_SPAWNS);
  const spawnFree = spawns.reduce(function (a, s) { return a + s.store.getFreeCapacity(RESOURCE_ENERGY); }, 0);
  Memory.__diag = {
    t: Game.time,
    energyAvail: r.energyAvailable,
    energyCap: r.energyCapacityAvailable,
    emptyExtCount: emptyExt.length,
    spawnFree: spawnFree,
    distExists: !!dist,
    distStore: dist ? dist.store.getUsedCapacity(RESOURCE_ENERGY) : -1,
    distMode: dist ? dist.memory.mode : "none",
    distTier: dist ? dist.memory.distributorTier : -1,
    distPos: dist ? dist.pos.x + "," + dist.pos.y : "none",
    // 直接让 distributor 尝试填充最近空 extension，捕获返回码 —— 这是决定性证据。
    txCode: (dist && emptyExt.length) ? dist.transfer(emptyExt[0], RESOURCE_ENERGY) : "noTargetOrNoDist",
  };
  return JSON.stringify(Memory.__diag);
})();
