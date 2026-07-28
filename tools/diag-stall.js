// 探针A：拥堵带 (23-28, 20-26) 占位图 + storage/spawn 位置。
Memory.__diag = JSON.stringify((function(){
var r=Game.rooms.W37S58,b=[];
for(var x=23;x<=28;x++)for(var y=20;y<=26;y++){
var h=r.lookAt(x,y).map(function(o){
return o.type==="structure"?o.structure.structureType.slice(0,4)
:o.type==="constructionSite"?"s:"+o.constructionSite.structureType.slice(0,4)
:o.type==="creep"?"C"
:(o.type==="terrain"&&o.terrain==="wall")?"W":"";
}).filter(Boolean);
if(h.length)b.push(x+","+y+"="+h.join("+"));}
return{t:Game.time,st:r.storage?r.storage.pos.x+","+r.storage.pos.y:null,
sp:r.find(FIND_MY_SPAWNS).map(function(s){return s.pos.x+","+s.pos.y;}),b:b};
})());
