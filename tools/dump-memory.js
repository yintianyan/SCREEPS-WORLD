// 拉取 Screeps 全量 Memory（creep 分配 + 房间状态）用于故障诊断。
require("./load-env");
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";
if (!token) { console.error("no token"); process.exit(1); }

https.get({
  host: "screeps.com",
  path: `/api/user/memory?shard=${shard}`,
  headers: { "X-Token": token, "Content-Type": "application/json" },
}, (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => {
    try {
      const j = JSON.parse(d);
      let content = j.data;
      if (typeof content === "string" && content.startsWith("gz:")) {
        content = zlib.gunzipSync(Buffer.from(content.slice(3), "base64")).toString("utf8");
      }
      const mem = JSON.parse(content);
      fs.writeFileSync(path.join(__dirname, "data/export/memory-full.json"), JSON.stringify(mem, null, 1));
      console.log("saved memory-full.json, keys:", Object.keys(mem).join(","));
    } catch (e) { console.log("resp head:", d.slice(0, 200)); }
  });
}).on("error", (e) => console.log("err:", e.message));
