// hauler 取货链诊断：地面堆 vs container vs assignment 钉死。
Memory.__diag=JSON.stringify((function(){
var r=Game.rooms.W37S58;
var drops=r.find(FIND_DROPPED_RESOURCES).map(function(d){return d.resourceType.slice(0,2)+d.amount+"@"+d.pos.x+","+d.pos.y;});
var conts=r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType==="container";}}).map(function(c){return c.store.energy+"@"+c.pos.x+","+c.pos.y;});
var hs=[];for(var n in Game.creeps){var c=Game.creeps[n];
if(c.memory.role==="hauler"&&c.memory.home==="W37S58"){
hs.push({n:n.slice(-4),pos:c.pos.x+","+c.pos.y,e:c.store.energy,mode:c.memory.mode,
asg:c.memory.assignment?{k:c.memory.assignment.kind,src:String(c.memory.assignment.sourceId||"").slice(-4)}:null});}}
return{t:Game.time,drops:drops,conts:conts,haulers:hs};
})());
