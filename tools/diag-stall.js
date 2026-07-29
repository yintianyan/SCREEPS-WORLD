Memory.__diag=JSON.stringify((function(){
var c=Game.creeps["worker-W37S58-1-81857288-2m6k"];if(!c)return{gone:1};
var r=c.room;
var srcs=r.find(FIND_SOURCES).map(function(s){
var occ=s.pos.findInRange(FIND_MY_CREEPS,1).length;
return s.id.slice(-4)+" e"+s.energy+" d"+c.pos.getRangeTo(s)+" occ"+occ;});
var sites=r.find(FIND_MY_CONSTRUCTION_SITES).length;
return{t:Game.time,pos:c.pos.x+","+c.pos.y,mode:c.memory.mode,e:c.store.energy,
sid:c.memory.sourceId?String(c.memory.sourceId).slice(-4):null,
srcs:srcs,sites:sites,stuck:c.memory.stuckTicks||0};
})());
