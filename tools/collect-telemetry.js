/**
 * Real-time telemetry collector — subscribes to Screeps console via WebSocket.
 *
 * Listens for @TELEMETRY prefixed lines emitted by the in-game
 * telemetry-collector system and writes them to telemetry.jsonl.
 *
 * Usage:
 *   node collect-telemetry.js
 *
 * Configuration via environment variables (see .env.example):
 *   SCREEPS_TOKEN=xxx           # Official server API token
 *   SCREEPS_HOST=127.0.0.1      # Private server host (omit for official)
 *   SCREEPS_PORT=21025          # Private server port
 *   SCREEPS_PROTOCOL=http       # http or https
 *   SCREEPS_USERNAME=user      # Private server username
 *   SCREEPS_PASSWORD=pass       # Private server password
 *   SCREEPS_SHARD=shard3       # Shard name (official server only)
 *   OUTPUT_FILE=./data/telemetry.jsonl
 */

const fs = require("fs");
const path = require("path");
const ScreepsAPI = require("screeps-api");

// ─── Configuration ────────────────────────────────────────────

const OUTPUT_FILE = process.env.OUTPUT_FILE || "./data/telemetry.jsonl";
const PREFIX = "@TELEMETRY";

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

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const config = buildConfig();

  if (!process.env.SCREEPS_HOST && !process.env.SCREEPS_TOKEN) {
    console.error("Error: Set SCREEPS_TOKEN (official) or SCREEPS_HOST (private server).");
    console.error("See .env.example for configuration options.");
    process.exit(1);
  }

  // Ensure output directory exists
  const outDir = path.dirname(OUTPUT_FILE);
  fs.mkdirSync(outDir, { recursive: true });

  // Track stats
  let received = 0;
  let errors = 0;
  const startTime = Date.now();

  console.log(`[Collector] Connecting to Screeps server...`);
  if (process.env.SCREEPS_HOST) {
    console.log(`[Collector] Private server: ${config.protocol}://${config.host}:${config.port}`);
  } else {
    console.log(`[Collector] Official server, shard=${config.shard}`);
  }
  console.log(`[Collector] Output: ${OUTPUT_FILE}`);

  const api = new ScreepsAPI(config);

  try {
    await api.connect();
    console.log(`[Collector] Connected. Subscribing to console...`);

    api.socket.subscribe("console", (event) => {
      try {
        // event.data.messages is an array of {type, message, timestamp}
        const messages = event.data?.messages || event.data?.message;
        if (!messages) return;

        const lines = Array.isArray(messages)
          ? messages.map(m => m.message || m)
          : [messages];

        for (const line of lines) {
          if (typeof line !== "string") continue;
          if (!line.startsWith(PREFIX)) continue;

          const jsonStr = line.slice(PREFIX.length).trim();
          try {
            const payload = JSON.parse(jsonStr);
            // Add collection timestamp
            payload._collected = Date.now();
            fs.appendFileSync(OUTPUT_FILE, JSON.stringify(payload) + "\n");
            received++;

            // Log notable signals
            if (payload.er > 0 || payload.crisis > 0 || payload.cpu > 15) {
              console.log(
                `[Collector] tick=${payload.t} cpu=${payload.cpu} ` +
                `bk=${payload.bk} tier=${payload.tier} ` +
                `errors=${payload.er} crisis=${payload.crisis}`
              );
            }
          } catch {
            // Malformed JSON — skip
            errors++;
          }
        }
      } catch (err) {
        // Event processing error — don't crash
        errors++;
      }
    });

    // Stats reporting every 60 seconds
    setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(
        `[Collector] Stats: ${received} samples received, ` +
        `${errors} errors, ${elapsed}s elapsed`
      );
    }, 60000);

    // Graceful shutdown
    process.on("SIGINT", () => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(
        `\n[Collector] Shutting down. ${received} samples in ${elapsed}s. ` +
        `Data saved to ${OUTPUT_FILE}`
      );
      process.exit(0);
    });

  } catch (err) {
    console.error(`[Collector] Connection failed:`, err.message);
    process.exit(1);
  }
}

main();
