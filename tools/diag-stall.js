// remoteDefender 回收误杀验证：远矿威胁窗口 + remote 角色存活与 recycle 标记。
Memory.__diag=JSON.stringify((function(){
var ops={};var m=Memory.rooms.W37S58;
Object.entries(m.remoteOps||{}).forEach(function(e){
ops[e[1]&&e[0]]={s:e[1].state,thr:e[1].threatUntil?e[1].threatUntil-Game.time:null};});
var rc=[];for(var n in Game.creeps){var c=Game.creeps[n];
if(c.memory.role&&c.memory.role.indexOf("remote")===0||c.memory.role==="reserver"){
rc.push([n.slice(0,14),c.memory.role,c.memory.recycle?1:0,c.ticksToLive]);}}
return{t:Game.time,ops:ops,remotes:rc};
})());
