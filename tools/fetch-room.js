// 拉取房间对象快照（结构/creep/store）— 诊断物流断链的地面真相。
require("./load-env");
const https = require("https");
const fs = require("fs");
const path = require("path");
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";
const room = process.argv[2] || "W37S58";

https.get({
  host: "screeps.com",
  path: `/api/game/room-objects?room=${room}&shard=${shard}`,
  headers: { "X-Token": token },
}, (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => {
    try {
      const j = JSON.parse(d);
      const objs = j.objects || [];
      fs.writeFileSync(path.join(__dirname, `data/export/room-${room}.json`), JSON.stringify(objs, null, 1));
      // 结构摘要
      const byType = {};
      for (const o of objs) byType[o.type] = (byType[o.type] || 0) + 1;
      console.log("types:", JSON.stringify(byType));
      // 能量关键点
      for (const o of objs) {
        if (["spawn", "extension", "storage", "container", "link", "tower"].includes(o.type)) {
          const e = o.store?.energy ?? o.energy ?? 0;
          const cap = o.storeCapacityResource?.energy ?? o.storeCapacity ?? o.energyCapacity ?? "?";
          console.log(o.type.padEnd(10), String(o._id).slice(-6), `(${o.x},${o.y})`, "energy:", e + "/" + cap, o.type === "spawn" && o.spawning ? "SPAWNING:" + JSON.stringify(o.spawning).slice(0, 60) : "");
        }
        if (o.type === "source") {
          console.log("source    ", String(o._id).slice(-6), `(${o.x},${o.y})`, "energy:", o.energy + "/" + o.energyCapacity);
        }
        if (o.type === "creep" && j.users && o.user) {
          console.log("creep     ", (o.name || "").slice(0, 34).padEnd(36), `(${o.x},${o.y})`, "store:", JSON.stringify(o.store || {}).slice(0, 50), "ttl:", o.ageTime ? o.ageTime - (j.gameTime || 0) : "?");
        }
        if (o.type === "constructionSite") {
          console.log("site      ", o.structureType, `(${o.x},${o.y})`, "progress:", o.progress + "/" + o.progressTotal);
        }
      }
      console.log("gameTime:", j.gameTime ?? "(未返回)");
    } catch (e) { console.log("resp head:", d.slice(0, 300)); }
  });
}).on("error", (e) => console.log("err:", e.message));
