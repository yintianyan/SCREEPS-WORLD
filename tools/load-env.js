/**
 * 零依赖 .env 加载器 — 供采集脚本共用。
 *
 * 背景：README 指引用户把凭据填进 tools/.env，但脚本只读 process.env
 * 且未引入 dotenv — 填了也不生效，采集静默失败（Error: Set SCREEPS_TOKEN...）。
 * 本模块按 KEY=VALUE 逐行解析，不覆盖已存在的环境变量
 * （shell 内联传入的值优先，保持原有用法兼容）。
 *
 * 查找顺序：tools/.env → 仓库根 .env（先命中先用，两者都存在时合并，前者优先）。
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    // 去掉行尾注释与首尾引号。
    let value = trimmed.slice(eq + 1).trim();
    const hashIdx = value.indexOf(" #");
    if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 不覆盖已有环境变量 — shell 内联值优先。
    if (process.env[key] === undefined && value !== "") {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

module.exports = { loadEnvFile };
