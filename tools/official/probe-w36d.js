// 探针 W4：W36S58 source 区地形网格 + 全房结构（含 owner）
(function(){var o={};var w=Game.rooms.W36S58;if(w){o.ter=[];for(var y=12;y<=19;y++){var row=[];for(var x=20;x<=26;x++){row.push(w.lookForAt(LOOK_TERRAIN,x,y)==="wall"?1:0);}o.ter.push(row.join(""));}o.st=w.find(FIND_STRUCTURES).map(function(s){return[s.structureType,s.pos.x,s.pos.y,s.owner?s.owner.username:null]});}Memory.__diag=JSON.stringify(o);})();
