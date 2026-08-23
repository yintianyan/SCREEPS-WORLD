// RCL1→RCL4 爬升采样器（文件式，无嵌套引号）
const { execFileSync } = require("child_process");
const fs = require("fs");
const OUT = "docs/phase3/data/rcl-climb.jsonl";
const INNER = "/tmp/p3-inner.js";
fs.writeFileSync(INNER, [
  'var s=db["rooms.objects"].findOne({type:"spawn"});',
  'var c=db.creeps.countDocuments();',
  'var r=db.rooms.findOne({_id:"W1S1"});',
  'var st=(db["rooms.objects"].findOne({type:"storage"})||{store:{energy:0}}).store.energy;',
  'var sites=db["rooms.objects"].countDocuments({type:"construction-site"});',
  'var t=(db.env.findOne({_id:"gameTime"})||{v:0}).v;',
  'print("DATA:"+JSON.stringify({t,rcl:(r&&r.controller)?r.controller.level:0,ea:s?s.store.energy:0,cr:c,sites,st}));'
].join("\n"));
execFileSync("docker", ["cp", INNER, "screeps-mongo:/tmp/p3-inner.js"], {stdio:"pipe"});
const out = execFileSync("docker", ["exec","screeps-mongo","mongosh","--quiet","screeps","--file","/tmp/p3-inner.js"], {encoding:"utf8"});
const line = out.split("\n").find(l=>l.indexOf("DATA:")===0);
if(line){ fs.appendFileSync(OUT, line.slice(6)+"\n"); console.log(line.slice(6)); }
else console.log("NO-DATA:"+out.slice(0,150));