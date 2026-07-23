# Screeps Telemetry Tools

External data collection scripts for the Screeps: World telemetry system.

## Quick Start

```bash
cd tools/
npm install
cp ../.env.example .env
# Edit .env with your server credentials
```

## Official Server (MMO)

Get your API token from [screeps.com/a/#!/account/auth](https://screeps.com/a/#!/account/auth).

```bash
# .env
SCREEPS_TOKEN=your-token-here
SCREEPS_SHARD=shard3
```

## Private Server

```bash
# .env
SCREEPS_HOST=127.0.0.1
SCREEPS_PORT=21025
SCREEPS_PROTOCOL=http
SCREEPS_USERNAME=your-username
SCREEPS_PASSWORD=your-password
```

## Scripts

### `collect-telemetry.js` — Real-time collection

Subscribes to the Screeps console via WebSocket, filters `@TELEMETRY` prefixed lines, and writes them to `telemetry.jsonl`.

```bash
npm run collect
```

Output: `data/telemetry.jsonl` (one JSON object per line):

```json
{"t":12345,"cpu":8.2,"bk":8500,"tier":"healthy","sk":0,"er":0,"avg":8.1,"max":12.5,"bkm":7800,"crisis":0,"errHot":"","skipHot":"","_collected":1700000000000}
```

Notable signals (errors, crisis, high CPU) are also printed to the collector console for real-time monitoring.

### `export-segments.js` — Batch segment export

Pulls RawMemory Segment 1 (time series) and Segment 2 (event log) via HTTP REST API and saves as JSON files.

```bash
# Single export
npm run export:once

# Continuous (every 5 minutes by default)
npm run export
```

Output files in `data/export/`:

| File | Contents |
|------|----------|
| `timeseries.json` | CPU ring buffer + economy ring buffer + population snapshot |
| `events.json` | Event log ring buffer (phase transitions, tier changes, etc.) |
| `stats.json` | `Memory.kernel.stats` quick summary |
| `skip-reasons.json` | Skip reason accumulator |
| `archive/*-timestamp.json` | Timestamped copies for historical comparison |

## Data Analysis

The exported JSON files can be loaded into Python/notebooks for trend analysis:

```python
import json
import matplotlib.pyplot as plt

# Load time series
with open("data/export/timeseries.json") as f:
    data = json.load(f)

cpu_samples = data["cpu"]["d"]  # Ring buffer data array
# Filter out None entries
cpu_samples = [s for s in cpu_samples if s is not None]

ticks = [s["t"] for s in cpu_samples]
cpus = [s["cpu"] for s in cpu_samples]

plt.figure(figsize=(12, 4))
plt.plot(ticks, cpus, label="CPU")
plt.axhline(y=17.5, color="r", linestyle="--", label="soft limit")
plt.xlabel("Tick")
plt.ylabel("CPU")
plt.title("CPU Usage Over Time")
plt.legend()
plt.tight_layout()
plt.savefig("cpu-trend.png", dpi=150)
```

## Dual-Channel Architecture

```
In-game (per tick)
  ├── telemetry-collector → Segment 1/2 (persistent)
  └── console.log('@TELEMETRY {...}')
        ↓
External Collector (Node.js, persistent)
  ├── WebSocket subscribe: real-time @TELEMETRY → telemetry.jsonl
  └── HTTP poll (every 5 min): Segment 1/2 → timeseries.json + events.json
        ↓
Analysis
  └── Python/notebook: load JSON → trend charts, event timeline
```

- **Real-time channel** (`collect-telemetry.js`): tick-level latency, summary metrics, good for monitoring and alerts
- **Batch channel** (`export-segments.js`): complete time series + event log, good for post-hoc deep analysis

Both channels complement each other: real-time tells you "something happened", batch tells you "what exactly happened".
