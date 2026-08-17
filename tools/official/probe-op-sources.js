// 探针 OS：各 op 的 sources 快照 vs 实测 source 数
(function(){var o={};var m=Memory.rooms.W37S58;if(m&&m.remoteOps){for(var k in m.remoteOps){var op=m.remoteOps[k];var w=Game.rooms[k];o[k]={s:op.state,sources:op.sources,actual:w?w.find(FIND_SOURCES).length:null};}}Memory.__diag=JSON.stringify(o);})();
