// 列出 Screeps 账户的代码分支及当前活跃分支。
require("./load-env");
const https = require("https");
const token = process.env.SCREEPS_TOKEN;
if (!token) { console.error("no token"); process.exit(1); }
https.get({
  host: "screeps.com",
  path: "/api/user/branches",
  headers: { "X-Token": token, "Content-Type": "application/json" },
}, (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => {
    try {
      const j = JSON.parse(d);
      console.log("branches:", JSON.stringify(j.list?.map((b) => ({ branch: b.branch, activeWorld: b.activeWorld, activeSim: b.activeSim })), null, 1));
    } catch { console.log("resp:", d.slice(0, 300)); }
  });
}).on("error", (e) => console.log("err:", e.message));
