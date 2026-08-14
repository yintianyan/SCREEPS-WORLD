// 探针 B：每房经济与能量（state/pressure/rcl/storage/terminal/受袭记忆）
(function () {
  var rooms = [];
  for (var rn in Memory.rooms) {
    var m = Memory.rooms[rn];
    var g = Game.rooms[rn];
    rooms.push([
      rn,
      m.colonyState || null,
      m.economyPressure != null ? Math.round(m.economyPressure * 100) / 100 : null,
      g && g.controller ? g.controller.level : null,
      g && g.storage ? g.storage.store.getUsedCapacity(RESOURCE_ENERGY) : null,
      g && g.terminal ? g.terminal.store.getUsedCapacity(RESOURCE_ENERGY) : null,
      m.lastHostileAt != null ? Game.time - m.lastHostileAt : null,
    ]);
  }
  Memory.__diag = JSON.stringify({ rooms: rooms });
})();
