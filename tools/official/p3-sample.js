// P3 官方服采样器：console-eval 写 Memory.p3probe → REST 读 → gunzip → JSONL 追加。
require("../load-env");
const https=require("https"),zlib=require("zlib"),fs=require("fs");
const token=process.env.SCREEPS_TOKEN;
const expr=process.env.P3_EXPR||"Memory.p3probe={t:Game.time,rooms:Object.keys(Game.rooms).filter(r=>Game.rooms[r].controller&&Game.rooms[r].controller.my).map(r=>{const rm=Game.rooms[r];return{r,rcl:rm.controller.level,ea:rm.energyAvailable,st:rm.storage?rm.storage.store[RESOURCE_ENERGY]:0,cr:Object.keys(Game.creeps).filter(c=>Game.creeps[c].room.name===r&&Game.creeps[c].my).length}})}";
function evalExpr(){return new Promise(res=>{
  const payload=JSON.stringify({expression:expr,shard:process.env.SCREEPS_SHARD||"shard3"});
  const req=https.request({host:"screeps.com",path:"/api/user/console",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(payload),"X-Token":token}},r=>{r.resume();r.on("end",res);});
  req.on("error",()=>res());req.write(payload);req.end();});}
function readMem(){return new Promise(res=>{
  https.get({host:"screeps.com",path:"/api/user/memory?path=p3probe&shard="+process.env.SCREEPS_SHARD||"shard3",headers:{"X-Token":token}},r=>{
    let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{const j=JSON.parse(d);res(JSON.parse(zlib.gunzipSync(Buffer.from(String(j.data).replace(/^gz:/,""),"base64")).toString()));}catch(e){res(null);}});
  }).on("error",()=>res(null));});}
async function main(){await evalExpr();await new Promise(r=>setTimeout(r,8000));const s=await readMem();
  if(s){fs.appendFileSync(process.env.P3_SAMPLES||"docs/phase3/data/live-samples.jsonl",JSON.stringify(s)+"\n");console.log("sampled t="+s.t+" rooms="+s.rooms.length);}else console.log("sample failed");}
main();