// 探针 V：schema 版本 + 最近事件 + 孵化队列
(function(){var o={v:Memory.schemaVersion,t:Game.time};var e=[];try{var s=JSON.parse(RawMemory.segments[2]||"null");if(s&&s.events)e=s.events.slice(-6).map(function(x){return[x.t,x.k,x.d]});}catch(_){}o.ev=e;var m=Memory.rooms.W37S58;o.sq=(m.spawnQueue||[]).map(function(r){return[r.role,r.priority]});Memory.__diag=JSON.stringify(o);})();
