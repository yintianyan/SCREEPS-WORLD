#!/usr/bin/env node
/**
 * 重新生成 @screeps/driver 的 runtime.snapshot.bin。
 *
 * 根因：@screeps/driver@5.3.0 预编译的 snapshot 是用特定 Node 大版本的 V8
 * 生成的。当 Node 大版本升级（如 22→24）时，V8 版本不匹配（V8 binary
 * version vs snapshot version），导致 engine 子进程在创建 Isolate 时
 * fatal crash：
 *   "Version mismatch between V8 binary and snapshot"
 *
 * 本脚本用当前 Node 版本的 V8 重新生成 snapshot，确保 ABI 兼容。
 * 应在 npm install 后自动执行（postinstall），也可手动运行。
 *
 * 触发条件：
 *   1. runtime.snapshot.bin 不存在
 *   2. 当前 Node 大版本与 snapshot 生成时的大版本不一致
 *
 * 使用方式：
 *   node scripts/rebuild-driver-snapshot.js          # 自动检测
 *   node scripts/rebuild-driver-snapshot.js --force  # 强制重新生成
 */
"use strict";

const path = require("path");
const fs = require("fs");

const driverPkgJsonPath = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "@screeps",
  "driver",
  "package.json",
);
const snapshotPath = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "@screeps",
  "driver",
  "build",
  "runtime.snapshot.bin",
);
const markerPath = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "@screeps",
  "driver",
  "build",
  ".snapshot-node-version",
);

const currentNodeMajor = parseInt(process.versions.node.split(".")[0], 10);

function getSnapshotNodeMajor() {
  try {
    const marker = fs.readFileSync(markerPath, "utf8").trim();
    return parseInt(marker, 10);
  } catch {
    return null; // 不存在 marker，说明是预编译的旧 snapshot
  }
}

function needsRebuild(force = false) {
  if (force) return true;
  if (!fs.existsSync(snapshotPath)) return true;
  const snapshotMajor = getSnapshotNodeMajor();
  if (snapshotMajor === null) {
    // 没有 marker，可能是预编译的旧 snapshot，需要检查是否兼容
    // 如果当前 Node >= 23 且没有 marker，保守起见重新生成
    return currentNodeMajor >= 23;
  }
  return snapshotMajor !== currentNodeMajor;
}

function rebuild() {
  const driverDir = path.dirname(path.dirname(snapshotPath));
  const makeSnapshotScript = path.join(driverDir, "make-runtime-snapshot.js");

  if (!fs.existsSync(makeSnapshotScript)) {
    console.warn(
      "[rebuild-driver-snapshot] make-runtime-snapshot.js not found, skipping",
    );
    return;
  }

  // 确保 SDK 路径（macOS）
  try {
    const { execSync } = require("child_process");
    const sdkPath = execSync("xcrun --show-sdk-path", { encoding: "utf8" }).trim();
    if (sdkPath) {
      process.env.SDKROOT = sdkPath;
      process.env.CPLUS_INCLUDE_PATH = `${sdkPath}/usr/include/c++/v1`;
    }
  } catch {
    // 非 macOS
  }

  console.log(
    `[rebuild-driver-snapshot] Regenerating runtime.snapshot.bin for Node ${process.versions.node}...`,
  );

  try {
    const { execSync } = require("child_process");
    execSync(`node --no-node-snapshot "${makeSnapshotScript}"`, {
      encoding: "utf8",
      stdio: "inherit",
      cwd: driverDir,
      env: process.env,
    });

    // 写入 marker 文件
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, String(currentNodeMajor), "utf8");
    console.log("[rebuild-driver-snapshot] Done.");
  } catch (err) {
    console.error("[rebuild-driver-snapshot] Failed:", err.message);
    // 不 exit(1)，因为 npm install 不应因 snapshot 生成失败而中断
    // 用户可以在需要时手动运行
  }
}

// CLI
const force = process.argv.includes("--force");
if (needsRebuild(force)) {
  rebuild();
} else {
  // 静默跳过
}
