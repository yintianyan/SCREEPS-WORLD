// RM-1 探针：远矿运营现况 + drop-mining 损耗信号（结果写 Memory.__diag）
Memory.__diag = JSON.stringify(Object.entries(Memory.rooms).flatMap(function(e){
  var h = e[0], m = e[1];
  return Object.entries(m.remoteOps || {}).map(function(re){
    var r = re[0], o = re[1];
    var room = Game.rooms[r];
    return {
      h: h, r: r, s: o.state, seen: Game.time - o.lastSeen,
      vis: !!room,
      drop: room ? room.find(FIND_DROPPED_RESOURCES).reduce(function(a,d){ return a + d.amount; }, 0) : null,
      cont: room ? room.find(FIND_STRUCTURES, { filter: function(s){ return s.structureType === "container"; } }).length : null,
      threatUntil: o.threatUntil, blockedUntil: o.blockedUntil,
    };
  });
}));
