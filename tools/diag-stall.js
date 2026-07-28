Memory.__diag=JSON.stringify((function(){
var r=Game.rooms.W38S58,out=[];
for(var n in Game.creeps){var c=Game.creeps[n];
if(c.memory.home==="W38S58"){
var onCont=r.lookForAt(LOOK_STRUCTURES,c.pos.x,c.pos.y).some(function(s){return s.structureType==="container";});
out.push([c.memory.role[0]+n.slice(-3),c.pos.x+","+c.pos.y,c.memory.mode,c.store.energy,onCont?1:0]);}}
var conts=r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType==="container";}})
.map(function(s){return s.store.energy+"@"+s.pos.x+","+s.pos.y;});
return{t:Game.time,crew:out,conts:conts};
})());
