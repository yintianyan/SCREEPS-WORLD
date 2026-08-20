// 发送 console 命令并读取结果（console eval + message read）
require("../load-env");
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
  res.on("end", () => {
    const resp = JSON.parse(d);
    if (resp.ok) {
      // 等 3 秒让游戏执行并写入消息日志
      setTimeout(() => {
        const req2 = https.request({
          host: "screeps.com",
          path: "/api/user/messages?limit=5",
          method: "GET",
          headers: { "X-Token": token },
        }, (res2) => {
          let d2 = "";
          res2.on("data", (c) => (d2 += c));
          res2.on("end", () => {
            try {
              const data = JSON.parse(d2);
              if (data.messages && Array.isArray(data.messages)) {
                for (const m of data.messages) {
                  console.log(m.message);
                }
              } else {
                console.log("No messages. Raw:", d2.slice(0, 500));
              }
            } catch (e) {
              console.log("Parse error. Raw:", d2.slice(0, 500));
            }
          });
        });
        req2.end();
      }, 3000);
    } else {
      console.log("POST failed:", d);
    }
  });
});
req.on("error", (e) => console.log("err:", e.message));
req.write(payload);
req.end();
