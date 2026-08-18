/**
 * 官服 console 探针运行器 — 通过官方 /api/user/console 在游戏内执行表达式，
 * 完整打印返回值（result）与日志（logs）。弥补 tools/official/console-eval.js
 * 把返回截断到 200 字符的局限，专为体检/诊断场景设计。
 *
 * 与 console-eval.js 同通道、同鉴权（X-Token + https），仅输出更完整。
 * 用法：node tools/mmo/console-probe.js "<游戏内 JS 表达式>"
 */
const https = require("https");
const path = require("path");
require(path.join(__dirname, "..", "load-env"));
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";
const expr = process.argv[2];
if (!expr) { console.error("usage: console-probe.js <expression>"); process.exit(1); }
if (!token) { console.error("缺少 SCREEPS_TOKEN"); process.exit(1); }
const payload = JSON.stringify({ expression: expr, shard });
const req = https.request({
  host: "screeps.com", path: "/api/user/console", method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "X-Token": token },
}, (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => {
    try {
      const j = JSON.parse(d);
      if (j.result !== undefined) console.log(typeof j.result === "string" ? j.result : JSON.stringify(j.result));
      if (j.logs && j.logs.length) console.log("LOGS:" + JSON.stringify(j.logs));
      if (j.error) console.log("ERROR:" + JSON.stringify(j.error));
      if (j.result === undefined && !j.logs && !j.error) console.log("RAW:" + d.slice(0, 2000));
    } catch (e) { console.log("RAW:" + d.slice(0, 2000)); }
  });
});
req.on("error", (e) => console.log("err:" + e.message));
req.write(payload);
req.end();
