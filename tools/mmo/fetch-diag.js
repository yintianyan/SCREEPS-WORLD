/**
 * 读取 Memory 中指定键（默认 __diag）的内容 — 配合 console-eval.js 注入的
 * 诊断表达式使用（官服 /api/user/console 不回传结果，需写 Memory 再读回）。
 * 用法：node tools/mmo/fetch-diag.js [key]
 */
const fs = require("fs"), path = require("path"), zlib = require("zlib"), https = require("https");
require(path.join(__dirname, "..", "load-env"));
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";
const key = process.argv[2] || "__diag";
https.get({
  host: "screeps.com",
  path: `/api/user/memory?shard=${shard}&path=`,
  headers: { "X-Token": token },
}, (r) => {
  let d = "";
  r.on("data", (c) => (d += c));
  r.on("end", () => {
    try {
      const j = JSON.parse(d);
      const data = j.data && j.data.startsWith("gz:") ? zlib.gunzipSync(Buffer.from(j.data.slice(3), "base64")).toString() : j.data;
      const mem = JSON.parse(data);
      const v = mem[key];
      console.log(typeof v === "string" ? v : JSON.stringify(v));
    } catch (e) { console.error("fetch-diag err:", e.message); process.exit(1); }
  });
}).on("error", (e) => { console.error("err:", e.message); process.exit(1); });
