// distributor 保底诊断（精简）。
Memory.__diag=JSON.stringify((function(){
var r=Game.rooms.W37S58,m=Memory.rooms.W37S58;
var b={};Object.values(Game.creeps).forEach(function(c){if(c.memory.home==="W37S58")b[c.memory.role]=(b[c.memory.role]||0)+1;});
var tu=Memory.kernel&&Memory.kernel.tuning&&Memory.kernel.tuning.rooms&&Memory.kernel.tuning.rooms.W37S58;
return{t:Game.time,eA:r.energyAvailable,eC:r.energyCapacityAvailable,
stE:r.storage?r.storage.store.energy:null,roles:b,
tuned:tu?tu.roleBounds:null,colony:m.colonyState,p:m.economyPressure,
extEmpty:r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="extension"&&s.store.getFreeCapacity(RESOURCE_ENERGY)>0;}}).length,
q:(m.spawnQueue||[]).map(function(x){return x.role+":"+x.priority;})};
})());
