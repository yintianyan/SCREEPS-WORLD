// distributor 填充链约束探针：档位/storage/tower 弹药/controller link 与 container 水位。
Memory.__diag=JSON.stringify((function(){
var r=Game.rooms.W37S58;
var d;for(var n in Game.creeps){if(Game.creeps[n].memory.role==="distributor")d=Game.creeps[n];}
var tw=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="tower";}});
var ct=r.controller;
var links=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}});
var ctlLink=links.some(function(l){return l.pos.getRangeTo(ct)<=2;});
var cc=ct.pos.findInRange(FIND_STRUCTURES,1,{filter:function(s){return s.structureType==="container";}})[0];
return{t:Game.time,stE:r.storage?r.storage.store.energy:null,
tier:d?d.memory.distributorTier:null,
towers:tw.map(function(s){return s.store.energy+"/"+s.store.getCapacity(RESOURCE_ENERGY);}),
ctlLink:ctlLink,links:links.length,
cc:cc?cc.store.energy+"/2000":null,
eA:r.energyAvailable};
})());
