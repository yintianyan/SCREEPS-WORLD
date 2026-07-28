// 通过 Screeps console API 在游戏内执行诊断表达式（运行时真相，无需部署）。
require("./load-env");
const https = require("https");
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";
const expr = process.argv[2] || "1+1";

const payload = JSON.stringify({ expression: expr, shard });
const req = https.request({
  host: "screeps.com",
  path: "/api/user/console",
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "X-Token": token },
}, (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => console.log("console POST resp:", d.slice(0, 200)));
});
req.on("error", (e) => console.log("err:", e.message));
req.write(payload);
req.end();
