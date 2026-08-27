#!/usr/bin/env node
/**
 * 私服重置脚本 — 清空世界数据 + 生成新地图 + 部署 AI 代码。
 *
 * 前置：cd docker && docker compose up -d 且服务已健康。
 *
 * 执行序列：
 *   1. pauseSimulation()
 *   2. system.resetAllData()     — 清空所有世界数据
 *   3. map.generateMap()         — 用 screepsmod-map-tool 生成标准地图
 *   4. resumeSimulation()
 *   5. 部署 AI 代码（可选）
 *
 * 用法：
 *   node scripts/reset-private-server.js              # 重置 + 生成地图 + 部署
 *   node scripts/reset-private-server.js --no-deploy  # 只重置，不部署代码
 *   node scripts/reset-private-server.js --rooms      # 生成后列出房间
 *
 * 环境变量（docker/.env 或 shell）：
 *   SCREEPS_CONTAINER  私服容器名（默认 screeps-server）
 *   SCREEPS_CLI_PORT   容器内 CLI 端口（默认 21026）
 */
"use strict";

const { execFileSync } = require("child_process");
const { existsSync } = require("fs");
const { resolve } = require("path");

const CONTAINER = process.env.SCREEPS_CONTAINER || "screeps-server";
const CLI_PORT = process.env.SCREEPS_CLI_PORT || "21026";
const NO_DEPLOY = process.argv.includes("--no-deploy");
const SHOW_ROOMS = process.argv.includes("--rooms");

/**
 * 通过 docker exec → 容器内 curl 调用 CLI sandbox。
 */
function runCli(expression, timeoutMs = 30000) {
  const args = [
    "exec", "-i", CONTAINER,
    "curl", "-s", "-m", String(Math.ceil(timeoutMs / 1000)),
    "-XPOST", `http://localhost:${CLI_PORT}/cli`,
    "-H", "Content-Type: text/plain",
    "--data-binary", "@-",
  ];
  try {
    const out = execFileSync("docker", args, {
      input: expression,
      encoding: "utf8",
      timeout: timeoutMs + 5000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
    if (/^Error:/.test(out)) {
      throw new Error(`CLI eval error: ${out.slice(0, 400)}`);
    }
    return out;
  } catch (err) {
    if (err.stderr) {
      throw new Error(`CLI exec failed: ${err.message} | ${err.stderr.slice(0, 200)}`);
    }
    throw err;
  }
}

function checkDocker() {
  try {
    execFileSync("docker", ["info"], { encoding: "utf8", stdio: "pipe" });
  } catch {
    console.error("[reset] Docker daemon is not running. Start Docker Desktop or dockerd.");
    process.exit(1);
  }
}

function checkContainer() {
  try {
    const out = execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", CONTAINER], {
      encoding: "utf8",
    }).trim();
    if (out !== "true") {
      console.error(`[reset] Container ${CONTAINER} is not running. Start with: cd docker && docker compose up -d`);
      process.exit(1);
    }
  } catch {
    console.error(`[reset] Container ${CONTAINER} not found. Start with: cd docker && docker compose up -d`);
    process.exit(1);
  }
}

async function main() {
  console.log("[reset] Checking prerequisites...");
  checkDocker();
  checkContainer();

  // Step 1: 暂停模拟
  console.log("[reset] Step 1: Pausing simulation...");
  try {
    runCli("system.pauseSimulation()");
    console.log("  → OK");
  } catch (err) {
    console.warn(`  ⚠ ${err.message} (may already be paused)`);
  }

  // Step 2: 清空世界数据
  console.log("[reset] Step 2: Resetting all data...");
  try {
    runCli("system.resetAllData()", 60000);
    console.log("  → OK");
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    process.exit(1);
  }

  // Step 3: 等待服务重新稳定
  console.log("[reset] Step 3: Waiting for server to stabilize...");
  await new Promise((r) => setTimeout(r, 5000));

  // Step 4: 生成地图（screepsmod-map-tool 的 map.generateMap()）
  // 生成默认地图：7×7 sector + source keeper 中心 + border
  console.log("[reset] Step 4: Generating map via screepsmod-map-tool...");
  try {
    const out = runCli("map.generateMap()", 120000);
    console.log(`  → ${out || "OK"}`);
  } catch (err) {
    console.warn(`  ⚠ map.generateMap() failed: ${err.message}`);
    console.warn("  → Trying manual room generation (fallback)...");
    // Fallback: 逐个生成 WN 象限 9×9 房间
    let count = 0;
    for (let x = 1; x <= 9; x++) {
      for (let y = 1; y <= 9; y++) {
        try {
          runCli(`map.generateRoom('W${x}N${y}')`, 10000);
          count++;
        } catch {
          // 房间可能已存在或生成失败
        }
      }
    }
    console.log(`  → Generated ${count} rooms (fallback)`);
  }

  // Step 5: 恢复模拟
  console.log("[reset] Step 5: Resuming simulation...");
  try {
    runCli("system.resumeSimulation()");
    console.log("  → OK");
  } catch (err) {
    console.warn(`  ⚠ ${err.message} (may auto-resume after reset)`);
  }

  // Step 6: 设置 tick 速率
  console.log("[reset] Step 6: Setting tick rate to 100ms...");
  try {
    runCli("system.setTickDuration(100)");
    console.log("  → OK");
  } catch (err) {
    console.warn(`  ⚠ ${err.message}`);
  }

  // Step 7: 部署 AI 代码（可选）
  if (!NO_DEPLOY) {
    const deployScript = resolve(__dirname, "..", "tools", "private", "deploy-cli.js");
    if (existsSync(deployScript)) {
      console.log("[reset] Step 7: Deploying AI code...");
      try {
        const out = execFileSync("node", [deployScript], {
          encoding: "utf8",
          timeout: 30000,
        }).trim();
        console.log(`  → ${out}`);
      } catch (err) {
        console.warn(`  ⚠ Deploy failed: ${err.message}`);
        console.warn("  → Run manually: node tools/private/deploy-cli.js");
      }
    } else {
      console.log("[reset] Step 7: Skipping deploy (deploy-cli.js not found)");
    }
  }

  // Step 8: 验证
  console.log("\n[reset] Step 8: Verification...");
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const tickOut = runCli(
      "JSON.stringify({tick: storage.env.get(storage.env.keys.GAMETIME), rooms: storage.db.rooms.countDocuments()})",
    );
    console.log(`  → ${tickOut}`);
  } catch (err) {
    console.warn(`  ⚠ Verification query failed: ${err.message}`);
  }

  // 可选：列出所有房间
  if (SHOW_ROOMS) {
    try {
      const roomsOut = runCli(
        "JSON.stringify(storage.db.rooms.find({}).then(rs=>rs.map(r=>r._id)))",
      );
      console.log(`  → Rooms: ${roomsOut}`);
    } catch (err) {
      console.warn(`  ⚠ Room listing failed: ${err.message}`);
    }
  }

  console.log("\n[reset] Done!");
  console.log("  → Map Tool UI: http://localhost:21025/maptool/");
  console.log("  → Browser:      http://localhost:8080/(http://screeps:21025)/");
  console.log("  → Deploy code:  node tools/private/deploy-cli.js");
  console.log("  → Collector:    node tools/private/empire-collector.js --once");
}

main().catch((err) => {
  console.error("[reset] Fatal:", err);
  process.exit(1);
});
