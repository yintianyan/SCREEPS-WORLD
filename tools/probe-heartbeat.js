// 游戏心跳探针：对比 gameTime 与 kernel.stats.lastSample，判断主循环是否存活。
require("./load-env");
const https = require("https");
const zlib = require("zlib");
const token = process.env.SCREEPS_TOKEN;
const shard = process.env.SCREEPS_SHARD || "shard3";

function get(path) {
  return new Promise((resolve) => {
    https.get({ host: "screeps.com", path, headers: { "X-Token": token } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    }).on("error", () => resolve(""));
  });
}

(async () => {
  const timeResp = JSON.parse(await get(`/api/game/time?shard=${shard}`));
  console.log("gameTime:", timeResp.time);

  const memResp = JSON.parse(await get(`/api/user/memory?shard=${shard}&path=kernel`));
  let content = memResp.data;
  if (typeof content === "string" && content.startsWith("gz:")) {
    content = zlib.gunzipSync(Buffer.from(content.slice(3), "base64")).toString("utf8");
  }
  const kernel = typeof content === "object" ? content : JSON.parse(content);
  console.log("kernel.tier:", kernel.tier, "recoveryTicks:", kernel.recoveryTicks, "pixelAt:", kernel.pixelAt);
  console.log("stats:", JSON.stringify(kernel.stats));
  console.log("心跳差 (gameTime - lastSample):", timeResp.time - (kernel.stats?.lastSample ?? 0), "tick");
  console.log("skipReasons:", JSON.stringify(kernel.skipReasons).slice(0, 400));
})();
