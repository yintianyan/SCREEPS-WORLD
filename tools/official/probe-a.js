// 探针 A：帝国状态（schema/tick/bucket/gcl/姿态/战争/内核 tier）
(function () {
  var owned = [];
  for (var rn in Game.rooms) { var r = Game.rooms[rn]; if (r && r.controller && r.controller.my) owned.push(rn); }
  Memory.__diag = JSON.stringify({
    v: Memory.schemaVersion != null ? Memory.schemaVersion : null,
    t: Game.time,
    bucket: Game.cpu.bucket,
    gcl: Game.gcl ? Game.gcl.level : null,
    owned: owned,
    posture: Memory.kernel && Memory.kernel.strategy ? Memory.kernel.strategy.posture : null,
    wpTicks: Memory.kernel && Memory.kernel.strategy ? Memory.kernel.strategy.warPressureTicks : null,
    warPlan: Memory.kernel && Memory.kernel.warPlan
      ? { target: Memory.kernel.warPlan.targetRoom, phase: Memory.kernel.warPlan.phase, spawned: Memory.kernel.warPlan.spawned }
      : null,
    warBl: Memory.kernel && Memory.kernel.warBlacklist ? Object.keys(Memory.kernel.warBlacklist) : [],
    tier: Memory.kernel ? Memory.kernel.tier : null,
  });
})();
