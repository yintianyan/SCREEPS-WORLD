/**
 * 私服代码部署 — 把构建产物 dist/main.js 写入 yty 的 users.code 文档。
 *
 * 官服走 HTTP API（POST /api/user/code + X-Token）；私服 HTTP auth 不通。
 * CLI 后门（21026）有 ~200KB body 限制且 sandbox 无 require/fs，无法传 1.4MB
 * 构建产物。改走 mongo 容器 + mongosh：docker cp 代码进 mongo 容器 → mongosh
 * （底层 node，支持 fs）readFileSync 后 updateOne upsert users.code。
 *
 * screeps 代码文档结构：{ user, branch, modules: { main }, timestamp, activeWorld }
 * 引擎每 tick 检测 timestamp 变化后热重载 activeWorld 分支。
 *
 * 用法：node tools/deploy-cli.js [branch]   // 默认分支 default
 */
require("../load-env");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const USERNAME = process.env.SCREEPS_USERNAME || "yty";
const MONGO_CONTAINER = process.env.SCREEPS_MONGO_CONTAINER || "screeps-mongo";
const BRANCH = process.argv[2] || "default";
const DIST = path.join(__dirname, "..", "dist", "main.js");
const CONTAINER_TMP = "/tmp/screeps-deploy-main.js";

function main() {
  if (!fs.existsSync(DIST)) {
    console.error(`构建产物不存在：${DIST}（先跑 npm run build）`);
    process.exit(1);
  }
  const sizeKb = (fs.statSync(DIST).size / 1024).toFixed(1);

  // 1. 代码送入 mongo 容器临时文件。
  try {
    execFileSync("docker", ["cp", DIST, `${MONGO_CONTAINER}:${CONTAINER_TMP}`], { stdio: "pipe" });
  } catch (e) {
    console.error("[Deploy CLI] docker cp 失败:", e.message);
    process.exit(1);
  }

  // 2. mongosh 读文件 upsert users.code（mongosh 支持 require fs）。
  //    脚本经 stdin 传入，避免 --eval 的 shell 转义问题。
  const script = `
const fs = require("fs");
const code = fs.readFileSync(${JSON.stringify(CONTAINER_TMP)}, "utf8");
const branch = ${JSON.stringify(BRANCH)};
// 优先按用户名定位；Steam 登录用户名可能为空（authmod 未装时），回退到 steam 用户。
var u = db.users.findOne({ username: ${JSON.stringify(USERNAME)} });
if (!u) { u = db.users.findOne({ steam: { $exists: true } }); }
if (!u) { print("ERR: 未找到目标用户（用户名 ${USERNAME} 或任何 steam 用户）"); quit(1); }
// 引擎约定 users.code.user 是「字符串」（driver data.js 以 string userId 查询）。
// u._id 可能是 ObjectId（Steam 注册用户）— 直接用对象写入会创建 runner 永远
// 查不到的孤儿文档，热重载假死。统一转 hex 字符串。
const uid = String(u._id);
// 清理历史孤儿文档（user 为 ObjectId 类型的错误写入）。
db.getCollection("users.code").deleteMany({ user: { $type: "objectId" } });
db.getCollection("users.code").updateOne(
  { user: uid, branch: branch },
  { $set: { user: uid, branch: branch, modules: { main: code }, timestamp: Date.now(), activeWorld: true, activeSim: false } },
  { upsert: true }
);
db.getCollection("users.code").updateMany(
  { user: uid, branch: { $ne: branch } },
  { $set: { activeWorld: false } }
);
print("DEPLOYED user=" + uid + " branch=" + branch + " bytes=" + code.length);
`;

  try {
    const out = execFileSync(
      "docker",
      ["exec", "-i", MONGO_CONTAINER, "mongosh", "screeps", "--quiet"],
      { input: script, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ).trim();
    console.log(`[Deploy CLI] ${out}（${sizeKb} KB → 分支 "${BRANCH}"）`);
  } catch (e) {
    console.error("[Deploy CLI] mongosh 写入失败:", e.message);
    process.exit(1);
  }
}

main();
