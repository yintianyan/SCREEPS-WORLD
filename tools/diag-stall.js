Memory.__diag=JSON.stringify((function(){
var m=Memory.rooms.W37S58,intel=m&&m.intel||{};
var out={};for(var rn in intel){var i=intel[rn];
if(i.kind==="normal")out[rn]={pc:i.pathCost!==undefined?Math.floor(i.pathCost):null,src:i.sources};}
var ops={};for(var k in (m.remoteOps||{})){var o=m.remoteOps[k];
ops[k]={s:o.state,hn:o.haulerNeed};}
return{t:Game.time,normalIntel:out,ops:ops,hasStorage:!!Game.rooms.W37S58.storage};
})());
