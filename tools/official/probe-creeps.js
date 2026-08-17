// 探针 C2：每 creep 紧凑行 [role,mode,stuckTicks,assignment,ttl,roomName]（写 Memory.__diag）
(function(){var o={t:Game.time,c:[]};for(var i in Game.creeps){var c=Game.creeps[i],m=c.memory||{};o.c.push([m.role||"?",m.mode||"?",m.stuckTicks||0,m.assignment?m.assignment.kind:"-",c.ticksToLive,c.pos.roomName]);}Memory.__diag=JSON.stringify(o);})();
