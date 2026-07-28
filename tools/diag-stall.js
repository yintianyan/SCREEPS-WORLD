// 精简探针：5kjz 路径缓存 + 现算 PathFinder 首步 + 目标格占位。
Memory.__diag=JSON.stringify((function(){
var d;for(var n in Game.creeps){if(n.indexOf("5kjz")>=0)d=Game.creeps[n];}
if(!d)return{no:1};
var c=(global.__creepPathCache||{})[d.name];
var r=Game.rooms.W37S58;
var pf=PathFinder.search(d.pos,{pos:r.storage.pos,range:1},{maxRooms:1});
return{t:Game.time,pos:d.pos.x+","+d.pos.y,mode:d.memory.mode,stuck:d.memory.stuckTicks,
cp:c?c.path.slice(0,3).map(function(p){return p.x+","+p.y;}):null,
tk:c?c.targetKey:null,
pf:pf.path.slice(0,3).map(function(p){return p.x+","+p.y;}),inc:pf.incomplete,
at:r.lookAt(25,24).map(function(o){return o.type==="structure"?o.structure.structureType:o.type;}).join("+")};
})());
