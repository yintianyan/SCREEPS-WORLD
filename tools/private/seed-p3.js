// P3 私服种子（全新世界版）：从零建 yty 用户 → 选房 → controller L1 → spawn(300E)。
db.users.insertOne({username:"yty", email:"", cpu:100, cpuAvailable:100, gcl:0, gclLevel:1, lastUsedTime:Date.now(), steam:"p3-yty"});
const uid = db.users.findOne({username:"yty"})._id;
print("UID:" + uid);

const cand = db.rooms.find().limit(100).toArray();
print("ROOMS:" + cand.length);
if (cand.length === 0) { print("NO-ROOM"); quit(1); }
const room = cand[0];
const rid = room._id;

if (!room.controller) db.rooms.updateOne({_id:rid}, {$set:{controller:{}}});
db.rooms.updateOne({_id:rid}, {$set:{controller:{user:uid, level:1, progress:0, downgradeTime:null, safetyMode:null}}});

db["rooms.objects"].insertMany([
  {_id:"spawn-"+rid+"-1", type:"spawn", room:rid, x:25, y:25, user:uid, store:{energy:300}, hits:5000, hitsMax:5000, notifyWhenAttacked:false},
  {_id:"src-"+rid+"-1", type:"source", room:rid, x:10, y:10, energy:3000, energyCapacity:3000, ticksToRegeneration:1},
  {_id:"src-"+rid+"-2", type:"source", room:rid, x:40, y:40, energy:3000, energyCapacity:3000, ticksToRegeneration:1},
]);
print("SEEDED:" + JSON.stringify({uid, rid}));