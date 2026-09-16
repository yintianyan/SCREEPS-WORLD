/**
 * 从 tools/.env 加载环境变量到 process.env（本地手动部署时使用）。
 * CI 中环境变量已由 GitHub Actions workflow 直接注入，此文件为 no-op。
 */
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
if (!fs.existsSync(envPath)) return;

const content = fs.readFileSync(envPath, "utf8");
for (const line of content.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  if (key && !(key in process.env)) {
    process.env[key] = val;
  }
}
