// 读取表达式文件，POST 到 Screeps console 执行，随后拉回 Memory.__diag。
require("../load-env");
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";
const exprFile = process.argv[2] || path.join(__dirname, "diag-expr.js");
const expr = fs.readFileSync(exprFile, "utf8");

function post(body) {
  const payload = JSON.stringify({ expression: body, shard });
  return new Promise((resolve) => {
    const req = https.request({
      host: "screeps.com", path: "/api/user/console", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "X-Token": token },
    }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(d)); });
    req.on("error", () => resolve(""));
    req.write(payload); req.end();
  });
}
function get(p) {
  return new Promise((resolve) => {
    https.get({ host: "screeps.com", path: p, headers: { "X-Token": token } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(d));
    });
  });
}

(async () => {
  const r = JSON.parse(await post(expr));
  console.log("console 执行:", r.ok === 1 ? "✅ ok" : JSON.stringify(r).slice(0, 150));
  // console 命令在下一 tick 执行，等几秒再拉 __diag。
  await new Promise((res) => setTimeout(res, 6000));
  const mr = JSON.parse(await get(`/api/user/memory?shard=${shard}&path=__diag`));
  let c = mr.data;
  if (typeof c === "string" && c.startsWith("gz:")) c = zlib.gunzipSync(Buffer.from(c.slice(3), "base64")).toString("utf8");
  console.log("__diag:", typeof c === "object" ? JSON.stringify(c) : c);
})();
