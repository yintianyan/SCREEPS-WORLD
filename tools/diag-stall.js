Memory.__diag=JSON.stringify((function(){
var out=[];for(var n in Game.creeps){var c=Game.creeps[n];
if(c.memory.role==="upgrader"){var ct=c.room.controller;
out.push({n:n.slice(-4),pos:c.pos.x+","+c.pos.y,mode:c.memory.mode,
e:c.store.energy,rng:ct?c.pos.getRangeTo(ct):null});}}
return{t:Game.time,ups:out};
})());
