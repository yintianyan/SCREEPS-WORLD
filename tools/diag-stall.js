Memory.__diag=JSON.stringify((function(){
var r=Game.rooms.W37S58;
var list=r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType==="road";}})
.map(function(x){return Math.floor(x.hits*100/x.hitsMax)+"@"+x.pos.x+","+x.pos.y;});
return{t:Game.time,roads:list};
})());
