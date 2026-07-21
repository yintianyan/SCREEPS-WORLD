#!/usr/bin/env node
/**
 * 将 dist/main.js 直接注入私服 mongo 的 users.code 集合。
 *
 * 使用场景：私服用户 yty 通过 Steam 登录无密码，无法走标准 API 上传。
 * 绕过 API 直接写 mongo 是最简方案 — screeps 引擎每 tick 都从该集合读 code。
 *
 * 用法：node scripts/inject-to-private-server.mjs
 * 前置：dist/main.js 已构建；docker exec screeps-mongo 可访问。
 *
 * 实现要点：
 *   - base64 编码代码内容，避免 shell 引号/换行转义问题
 *   - 通过 docker exec -i + stdin 传 mongosh eval，规避命令行长度与字符编码问题
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MONGO_CONTAINER = "screeps-mongo";
const DB_NAME = "screeps";
const USERNAME = "yty";
const BRANCH = "default";
// 工作目录名含空格（SCREEPS WORLD），URL 路径会被编码成 %20 导致 readFileSync 失败。
// 改用 fileURLToPath + path.join 规避编码问题。
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CODE_PATH = join(SCRIPT_DIR, "..", "dist", "main.js");

const code = readFileSync(CODE_PATH, "utf8");
const b64 = Buffer.from(code).toString("base64");

// 1. 查 user._id（mongosh 输出仅一行 uid 字符串）。
const uidResult = spawnSync("docker", [
  "exec", MONGO_CONTAINER, "mongosh", DB_NAME, "--quiet",
  "--eval", `db.users.findOne({username:"${USERNAME}"})._id.toString()`,
], { encoding: "utf8" });
if (uidResult.status !== 0) {
  console.error("[inject] 查询用户失败:", uidResult.stderr || uidResult.stdout);
  process.exit(1);
}
const uid = uidResult.stdout.trim();
if (!uid || uid === "null") {
  console.error(`[inject] user "${USERNAME}" not found`);
  process.exit(1);
}
console.log(`[inject] user=${USERNAME} _id=${uid}`);

// 2. upsert code 文档。
// 通过 stdin 传 eval 脚本，避免命令行参数中 base64 的 + 被解析。
// mongosh 从 stdin 读 JavaScript：docker exec -i ... mongosh ... -
const evalScript = [
  `const uid = ${JSON.stringify(uid)};`,
  `const b64 = ${JSON.stringify(b64)};`,
  `const code = atob(b64);`,
  `const ts = Date.now();`,
  `db.users.code.updateOne(`,
  `  { user: uid, branch: ${JSON.stringify(BRANCH)} },`,
  `  { $set: { modules: { main: code }, timestamp: ts, activeWorld: true, activeSim: true } },`,
  `  { upsert: true }`,
  `);`,
  `print("upserted branch=${BRANCH} len=" + code.length);`,
].join("\n");

const upsertResult = spawnSync("docker", [
  "exec", "-i", MONGO_CONTAINER, "mongosh", DB_NAME, "--quiet", "--file", "/dev/stdin",
], { input: evalScript, encoding: "utf8" });
if (upsertResult.status !== 0) {
  console.error("[inject] upsert 失败:", upsertResult.stderr || upsertResult.stdout);
  process.exit(1);
}
process.stdout.write(upsertResult.stdout);
if (upsertResult.stderr) process.stderr.write(upsertResult.stderr);
console.log("[inject] done — 下一 tick 引擎将加载新代码");
