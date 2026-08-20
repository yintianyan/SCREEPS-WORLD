(function(){
  var g = globalThis;
  var byHome = g.cpuByHome;
  // 同时采集 per-role CPU：从 telemetry.roleCpu 读取
  var tel = g.telemetry;
  var roleCpu = tel ? tel.roleCpu : null;
  var o = {
    t: Game.time,
    bk: Game.cpu.bucket,
    tier: Memory.kernel && Memory.kernel.tier,
    byHome: byHome ? Object.fromEntries(byHome) : null,
    roleCpu: roleCpu,
    // 统计每房每角色 creep 数
    roomRoleCounts: {},
    creepCount: Object.keys(Game.creeps).length
  };
  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    var m = c.memory || {};
    var home = m.home || "unknown";
    var role = m.role || "unknown";
    var key = home + "/" + role;
    o.roomRoleCounts[key] = (o.roomRoleCounts[key] || 0) + 1;
  }
  Memory.__diag = JSON.stringify(o);
})();
