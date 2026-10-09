/**
 * Screeps 代码上传器 — 零依赖，直接 POST 编译产物进游戏。
 *
 * 取代「push 到 screeps 分支 + Screeps 端手动/绑定 pull」的半自动链路：
 * CI build 完直接调用官方 code API，代码即时进游戏，无需任何手动同步。
 *
 * 用 Node 内置 https/http，不引入 screeps-api 依赖 —— 与 deploy job 的
 * `npm ci --ignore-scripts` 配合，整条部署链完全避开 isolated-vm 原生编译。
 *
 * 配置（环境变量，CI 中来自 GitHub Secrets）：
 *   SCREEPS_TOKEN     官服 API token（screeps.com/a/#!/account/auth）
 *   SCREEPS_BRANCH    目标代码分支，默认 "default"
 *   SCREEPS_DEPLOY_HOST/PORT/PROTOCOL   私服可选（默认官服 screeps.com:443 https）
 *   DIST_FILE         产物路径，默认 dist/main.js
 *
 * 退出码：token 缺失 → 1（API 是唯一部署路径，缺凭据即无法部署，必须响亮失败
 *         而非静默绿灯）；上传失败 → 1；成功 → 0。
 */
const fs = require("fs");
const path = require("path");
require("../load-env"); // 本地手动部署时从 tools/.env 读取 token；CI 中 env 已由 workflow 注入
// 部署闸门（R274 加，成因＝本仓一次把"只读核对线上 sha"敲成 `node tools/official/deploy-screeps.js --check-code`，
// 而本脚本历史上零 argv 分支 ⇒ 任何一次调用都是真实上传，等价于未经批复的部署）。
// 规矩：本脚本唯一的职责是上传。只读核对一律走 tools/official/check-code.mjs。
//   · 任何未知参数 ⇒ 拒绝（不猜意图，绝不把"看起来像 dry-run 的参数"当 dry-run）
//   · 非 CI 环境 ⇒ 必须显式 SCREEPS_DEPLOY_CONFIRM=1 或参数 --confirm-deploy
//   · CI（GITHUB_ACTIONS=true，workflow 里无参数调用）⇒ 行为逐字不变
{
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--confirm-deploy");
  if (unknown.length > 0) {
    console.error(
      "[Deploy] ✗ 拒绝执行：本脚本无只读模式，未知参数 " + JSON.stringify(unknown) +
      " 会被当作上传指令。只读核对请用 tools/official/check-code.mjs；" +
      "确要部署请显式加 --confirm-deploy 或设 SCREEPS_DEPLOY_CONFIRM=1。"
    );
    process.exit(1);
  }
  const confirmed = process.env.GITHUB_ACTIONS === "true" ||
    process.env.SCREEPS_DEPLOY_CONFIRM === "1" ||
    args.indexOf("--confirm-deploy") >= 0;
  if (!confirmed) {
    console.error(
      "[Deploy] ✗ 拒绝执行：未经确认的部署调用（安全内核第 3 条：未经批复不部署）。\n" +
      "  确认部署：SCREEPS_DEPLOY_CONFIRM=1 node tools/official/deploy-screeps.js\n" +
      "  只想看线上跑的是哪一版：node tools/official/check-code.mjs"
    );
    process.exit(1);
  }
  console.error("[Deploy] ! 部署闸门：确认通过（GITHUB_ACTIONS=" + (process.env.GITHUB_ACTIONS || "-") +
    ", SCREEPS_DEPLOY_CONFIRM=" + (process.env.SCREEPS_DEPLOY_CONFIRM || "-") +
    ", argv=" + JSON.stringify(args) + "）— 即将真实上传。");
}

const token = process.env.SCREEPS_TOKEN;
const branch = process.env.SCREEPS_BRANCH || "default";
const distFile = process.env.DIST_FILE || path.join(__dirname, "../../", "dist", "main.js");

if (!token) {
  console.error(
    "[Deploy] ✗ SCREEPS_TOKEN 未设置 — 无可用部署路径。\n" +
    "  CI：在仓库 Settings → Secrets and variables → Actions 添加 SCREEPS_TOKEN。\n" +
    "  本地：填入 tools/.env 的 SCREEPS_TOKEN。",
  );
  process.exit(1);
}

if (!fs.existsSync(distFile)) {
  console.error(`[Deploy] 产物不存在: ${distFile} — 请先运行 npm run build。`);
  process.exit(1);
}

// 组装 modules：main + 可选 sourcemap。
const modules = { main: fs.readFileSync(distFile, "utf8") };
const mapFile = `${distFile}.map`;
if (fs.existsSync(mapFile)) {
  // Screeps 约定：sourcemap 作为独立模块 "main.js.map"，游戏内错误堆栈可映射回 TS。
  modules["main.js.map"] = fs.readFileSync(mapFile, "utf8");
}

const payload = JSON.stringify({ branch, modules });

// 官服默认；私服通过 SCREEPS_DEPLOY_HOST 覆盖。
const host = process.env.SCREEPS_DEPLOY_HOST || "screeps.com";
const protocol = process.env.SCREEPS_DEPLOY_PROTOCOL || (process.env.SCREEPS_DEPLOY_HOST ? "http" : "https");
const port = parseInt(process.env.SCREEPS_DEPLOY_PORT || (protocol === "https" ? "443" : "21025"), 10);
const client = protocol === "https" ? require("https") : require("http");

const req = client.request(
  {
    host,
    port,
    path: "/api/user/code",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "X-Token": token,
    },
  },
  (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      if (res.statusCode === 200 && parsed && parsed.ok === 1) {
        const kb = (Buffer.byteLength(payload) / 1024).toFixed(1);
        console.log(`[Deploy] ✓ 已上传到 ${host} 分支 "${branch}"（${kb} KB，${Object.keys(modules).length} 模块）。`);
        process.exit(0);
      }
      console.error(`[Deploy] ✗ 上传失败 HTTP ${res.statusCode}: ${body.slice(0, 300)}`);
      process.exit(1);
    });
  },
);

req.on("error", (err) => {
  console.error(`[Deploy] ✗ 请求错误: ${err.message}`);
  process.exit(1);
});

req.write(payload);
req.end();
