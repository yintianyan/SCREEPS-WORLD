/**
 * screeps-exporter — HTTP bridge: Screeps RawMemory segment → Prometheus /metrics
 *
 * 架构：
 *   1. 每 SCRAPE_INTERVAL 秒调用 Screeps REST API GET /api/user/memory-segment?segment=4
 *   2. 读取 segment 内容（Prometheus text format 纯文本）
 *   3. 缓存在内存中，通过 HTTP /metrics 端点暴露给 Prometheus scrape
 *
 * 环境变量：
 *   SCREEPS_HOST       — Screeps 服务器地址（默认 http://screeps:21025）
 *   SCREEPS_TOKEN      — API auth token（从 .env 注入）
 *   SCREEPS_USERNAME   — 用户名（token 模式可省略）
 *   SCREEPS_PASSWORD   — 密码（无 token 时用 email/password 登录）
 *   SCREEPS_SHARD      — shard 名（默认 shard3）
 *   EXPORTER_PORT      — HTTP 监听端口（默认 9115）
 *   SCRAPE_INTERVAL    — Screeps API 拉取间隔秒（默认 15）
 *   METRICS_SEGMENT    — segment ID（默认 4）
 */

const http = require('http');
const https = require('https');

// ─── Configuration ────────────────────────────────────

const SCREEPS_HOST = process.env.SCREEPS_HOST || 'http://screeps:21025';
const SCREEPS_TOKEN = process.env.SCREEPS_TOKEN || '';
const SCREEPS_USERNAME = process.env.SCREEPS_USERNAME || '';
const SCREEPS_PASSWORD = process.env.SCREEPS_PASSWORD || '';
const SCREEPS_SHARD = process.env.SCREEPS_SHARD || 'shard3';
const EXPORTER_PORT = parseInt(process.env.EXPORTER_PORT || '9115', 10);
const SCRAPE_INTERVAL = parseInt(process.env.SCRAPE_INTERVAL || '15', 10);
const METRICS_SEGMENT = parseInt(process.env.METRICS_SEGMENT || '4', 10);

// ─── State ────────────────────────────────────────────

let cachedMetrics = '';
let lastScrapeTime = 0;
let scrapeError = null;
let totalScrapes = 0;
let failedScrapes = 0;

// ─── HTTP helper ──────────────────────────────────────

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data, headers: res.headers });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: 10000,
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Screeps API ───────────────────────────────────────

let authToken = SCREEPS_TOKEN;

async function ensureAuth() {
  if (authToken) return;

  // Email/password login
  const loginUrl = `${SCREEPS_HOST}/api/auth/signin`;
  const body = JSON.stringify({
    email: SCREEPS_USERNAME,
    password: SCREEPS_PASSWORD,
  });
  const res = await httpPost(loginUrl, body, {});
  if (res.statusCode !== 200) {
    throw new Error(`Login failed: ${res.statusCode} ${res.body.slice(0, 200)}`);
  }
  const json = JSON.parse(res.body);
  authToken = json.token;
  if (!authToken) throw new Error('No token in login response');
  console.log(`[screeps-exporter] Logged in as ${SCREEPS_USERNAME}`);
}

async function fetchSegment() {
  await ensureAuth();

  const url = `${SCREEPS_HOST}/api/user/memory-segment?segment=${METRICS_SEGMENT}&shard=${SCREEPS_SHARD}`;
  const res = await httpGet(url, {
    'X-Token': authToken,
    'Authorization': `Bearer ${authToken}`,
  });

  // Token expired → re-auth and retry once
  if (res.statusCode === 401) {
    console.log('[screeps-exporter] Token expired, re-authenticating...');
    authToken = '';
    await ensureAuth();
    const retryRes = await httpGet(url, {
      'X-Token': authToken,
      'Authorization': `Bearer ${authToken}`,
    });
    if (retryRes.statusCode !== 200) {
      throw new Error(`Segment fetch (retry) failed: ${retryRes.statusCode}`);
    }
    return parseSegmentResponse(retryRes.body);
  }

  if (res.statusCode !== 200) {
    throw new Error(`Segment fetch failed: ${res.statusCode}`);
  }

  return parseSegmentResponse(res.body);
}

function parseSegmentResponse(body) {
  const json = JSON.parse(body);
  // API 返回 { data: "segment content string", ok: 1 }
  // data 可能是 null（segment 未写入或未激活）
  if (json.ok === 1) {
    return json.data || '';
  }
  throw new Error(`API error: ${JSON.stringify(json).slice(0, 200)}`);
}

// ─── Scraper Loop ──────────────────────────────────────

async function scrape() {
  try {
    const text = await fetchSegment();
    cachedMetrics = text;
    lastScrapeTime = Date.now();
    scrapeError = null;
    totalScrapes++;
  } catch (err) {
    scrapeError = err.message;
    failedScrapes++;
    console.error(`[screeps-exporter] Scrape error: ${err.message}`);
  }
}

// Start scraper loop
setInterval(scrape, SCRAPE_INTERVAL * 1000);

// Initial scrape after 2s (let screeps server be ready)
setTimeout(scrape, 2000);

// ─── HTTP Server ───────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(cachedMetrics);
  } else if (req.url === '/health') {
    const age = lastScrapeTime > 0 ? Math.floor((Date.now() - lastScrapeTime) / 1000) : -1;
    const healthy = scrapeError === null && age >= 0 && age < 120;
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      healthy,
      lastScrapeAge: age,
      totalScrapes,
      failedScrapes,
      error: scrapeError,
    }));
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('screeps-exporter — /metrics for Prometheus, /health for status');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(EXPORTER_PORT, '0.0.0.0', () => {
  console.log(`[screeps-exporter] Listening on :${EXPORTER_PORT}`);
  console.log(`[screeps-exporter] Screeps API: ${SCREEPS_HOST} (shard=${SCREEPS_SHARD}, segment=${METRICS_SEGMENT})`);
  console.log(`[screeps-exporter] Scrape interval: ${SCRAPE_INTERVAL}s`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[screeps-exporter] SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[screeps-exporter] SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
