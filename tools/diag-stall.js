Memory.__diag=JSON.stringify((function(){
var o={};for(var rn in Memory.rooms){var m=Memory.rooms[rn];
if(m.lastHostileAt!==undefined)o[rn]=Game.time-m.lastHostileAt;}
return{t:Game.time,sinceHostile:o};
})());
