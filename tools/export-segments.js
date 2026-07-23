/**
 * Segment exporter — batch-pull RawMemory segments via HTTP REST API.
 *
 * Pulls Segment 1 (time series) and Segment 2 (event log) from Screeps
 * server and saves them as JSON files for offline analysis.
 *
 * Usage:
 *   node export-segments.js              # Continuous mode (every 5 min)
 *   node export-segments.js --once       # Single export then exit
 *
 * Configuration via environment variables (see .env.example):
 *   SCREEPS_TOKEN=xxx           # Official server API token
 *   SCREEPS_HOST=127.0.0.1      # Private server host (omit for official)
 *   SCREEPS_PORT=21025          # Private server port
 *   SCREEPS_PROTOCOL=http       # http or https
 *   SCREEPS_USERNAME=user      # Private server username
 *   SCREEPS_PASSWORD=pass       # Private server password
 *   SCREEPS_SHARD=shard3       # Shard name (official server only)
 *   EXPORT_DIR=./data/export    # Output directory
 *   EXPORT_INTERVAL=300000      # Polling interval (ms, default 5 min)
 */

const fs = require("fs");
const path = require("path");
const ScreepsAPI = require("screeps-api");

// ─── Configuration ────────────────────────────────────────────

const EXPORT_DIR = process.env.EXPORT_DIR || "./data/export";
const EXPORT_INTERVAL = parseInt(process.env.EXPORT_INTERVAL || "300000", 10);
const SEGMENTS = [1, 2]; // Segment 1 = timeseries, Segment 2 = event log

function buildConfig() {
  const isPrivate = process.env.SCREEPS_HOST != null;

  if (isPrivate) {
    return {
      host: process.env.SCREEPS_HOST || "127.0.0.1",
      port: parseInt(process.env.SCREEPS_PORT || "21025", 10),
      protocol: process.env.SCREEPS_PROTOCOL || "http",
      username: process.env.SCREEPS_USERNAME || "",
      password: process.env.SCREEPS_PASSWORD || "",
      path: "/",
    };
  }

  return {
    token: process.env.SCREEPS_TOKEN,
    path: "/",
    shard: process.env.SCREEPS_SHARD || "shard3",
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/** Fetch a RawMemory segment by ID. Returns parsed JSON or null. */
async function fetchSegment(api, segmentId) {
  try {
    // screeps-api's raw.memory.segment() handles the REST call
    const resp = await api.raw.memory.segment(segmentId);
    const raw = resp.data || resp;
    if (!raw) return null;

    // Some versions return base64, some return raw string
    let content = raw;
    if (typeof raw === "object" && raw.data) {
      content = raw.data;
    }

    // Decode if base64-encoded
    if (typeof content === "string" && /^[A-Za-z0-9+/]+=*$/.test(content)) {
      try {
        content = Buffer.from(content, "base64").toString("utf8");
      } catch {
        // Not base64 — use as-is
      }
    }

    return JSON.parse(content);
  } catch (err) {
    console.error(`[Export] Failed to fetch segment ${segmentId}:`, err.message);
    return null;
  }
}

/** Fetch Memory at a specific path (e.g., kernel.stats). */
async function fetchMemoryPath(api, memPath) {
  try {
    const resp = await api.raw.memory.get(memPath);
    return resp.data || resp;
  } catch (err) {
    console.error(`[Export] Failed to fetch memory path ${memPath}:`, err.message);
    return null;
  }
}

/** Save data to a JSON file with timestamp suffix. */
function saveJson(data, filename) {
  const filepath = path.join(EXPORT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[Export] Saved ${filepath} (${JSON.stringify(data).length} bytes)`);
}

// ─── Main ────────────────────────────────────────────────────

async function exportOnce(api) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log(`\n[Export] ${timestamp} — Starting export...`);

  // 1. Pull segments
  for (const segId of SEGMENTS) {
    const data = await fetchSegment(api, segId);
    if (data) {
      const name = segId === 1 ? "timeseries" : "events";
      saveJson(data, `${name}.json`);
      // Also save timestamped copy for history
      saveJson(data, `archive/${name}-${timestamp}.json`);
    }
  }

  // 2. Pull Memory.kernel.stats quick summary
  const stats = await fetchMemoryPath(api, "kernel.stats");
  if (stats) {
    saveJson(stats, "stats.json");
    console.log(`[Export] stats: cpuAvg=${stats.cpuAvg10} cpuMax=${stats.cpuMax10} ` +
      `bucketMin=${stats.bucketMin10} crisis=${stats.crisisCount}`);
  }

  // 3. Pull skipReasons for skip hotspot analysis
  const skips = await fetchMemoryPath(api, "kernel.skipReasons");
  if (skips) {
    saveJson(skips, "skip-reasons.json");
  }

  console.log(`[Export] Done.`);
}

async function main() {
  const args = process.argv.slice(2);
  const isOnce = args.includes("--once");

  const config = buildConfig();

  if (!process.env.SCREEPS_HOST && !process.env.SCREEPS_TOKEN) {
    console.error("Error: Set SCREEPS_TOKEN (official) or SCREEPS_HOST (private server).");
    console.error("See .env.example for configuration options.");
    process.exit(1);
  }

  // Ensure output directories exist
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.mkdirSync(path.join(EXPORT_DIR, "archive"), { recursive: true });

  console.log(`[Export] Output dir: ${EXPORT_DIR}`);
  if (process.env.SCREEPS_HOST) {
    console.log(`[Export] Private server: ${config.protocol}://${config.host}:${config.port}`);
  } else {
    console.log(`[Export] Official server, shard=${config.shard}`);
  }

  const api = new ScreepsAPI(config);

  try {
    await api.connect();
    console.log(`[Export] Connected.`);

    await exportOnce(api);

    if (isOnce) {
      console.log(`[Export] Single export complete. Exiting.`);
      process.exit(0);
    }

    // Continuous mode
    console.log(`[Export] Continuous mode. Polling every ${EXPORT_INTERVAL / 1000}s.`);
    console.log(`[Export] Press Ctrl+C to stop.`);

    setInterval(() => {
      exportOnce(api).catch(err => {
        console.error(`[Export] Error during poll:`, err.message);
      });
    }, EXPORT_INTERVAL);

    process.on("SIGINT", () => {
      console.log(`\n[Export] Shutting down.`);
      process.exit(0);
    });

  } catch (err) {
    console.error(`[Export] Connection failed:`, err.message);
    process.exit(1);
  }
}

main();
