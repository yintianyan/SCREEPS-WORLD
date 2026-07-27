// 查询 GitHub Actions 最近 run 状态（公开仓库无需凭据）。
const https = require("https");
https.get({
  hostname: "api.github.com",
  path: "/repos/yintianyan/SCREEPS-WORLD/actions/runs?per_page=5",
  headers: { "User-Agent": "screeps-ci-check" },
}, (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => {
    try {
      const j = JSON.parse(d);
      if (j.workflow_runs === undefined) { console.log("API resp:", d.slice(0, 300)); return; }
      for (const r of j.workflow_runs) {
        console.log(r.run_number, r.head_branch, r.status, r.conclusion ?? "-", "|", r.display_title.slice(0, 60), "|", r.updated_at);
      }
    } catch (e) { console.log("parse fail:", d.slice(0, 200)); }
  });
}).on("error", (e) => console.log("request error:", e.message));
