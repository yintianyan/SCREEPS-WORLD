/**
 * Screeps 私服 CLI 适配层 — 通过 launcher CLI（容器内 21026）执行服务端命令。
 *
 * 背景：本地私服（screepers/screeps-launcher Docker）的 HTTP API 认证依赖
 * screepsmod-auth 的 signin 端点，但该 router 未挂载（Cannot POST /api/auth/
 * signin）。CLI 后门（POST 21026/cli，body 为服务端 sandbox 内执行的 JS）是
 * 不依赖 HTTP auth、不依赖 mod 的可靠通道，拥有对 storage.db 的完整读写权限。
 *
 * CLI 端口 21026 仅容器内监听（未映射宿主机），故通过 docker exec 转发。
 *
 * sandbox 全局对象：storage（storage.db[集合] 是 mongo 集合，方法返回 Promise）、
 * map、bots、system、utils、print。表达式为 Promise 时 CLI 等待 resolve 再返回。
 *
 * 用法：
 *   const { runCli } = require("./screeps-cli");
 *   const out = await runCli('storage.db.rooms.findOne({_id:"W1S6"}).then(r=>JSON.stringify(r))');
 *
 * 环境变量（tools/.env）：
 *   SCREEPS_CONTAINER  私服容器名（默认 screeps-server）
 *   SCREEPS_CLI_PORT   容器内 CLI 端口（默认 21026）
 */
require("./load-env");
const { execFile } = require("child_process");

const CONTAINER = process.env.SCREEPS_CONTAINER || "screeps-server";
const CLI_PORT = process.env.SCREEPS_CLI_PORT || "21026";

/**
 * 在私服 CLI sandbox 内执行一段 JS，返回结果字符串（已 trim）。
 *
 * 命令通过 stdin 传入容器内 curl，避免 shell 转义地狱（表达式含引号/括号）。
 * CLI 对 Promise 结果会等待 resolve；非字符串结果用 util.inspect 序列化。
 */
function runCli(expression, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    // docker exec -i：-i 保持 stdin 打开，把表达式通过管道喂给容器内 curl。
    // curl --data-binary @- 从 stdin 读 body，不做任何处理（保留原始字节）。
    const args = [
      "exec", "-i", CONTAINER,
      "curl", "-s", "-m", String(Math.ceil(timeoutMs / 1000)),
      "-XPOST", `http://localhost:${CLI_PORT}/cli`,
      "-H", "Content-Type: text/plain",
      "--data-binary", "@-",
    ];
    const child = execFile("docker", args, { timeout: timeoutMs + 5000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`CLI exec failed: ${err.message}${stderr ? ` | ${stderr.slice(0, 200)}` : ""}`));
        return;
      }
      const out = String(stdout).trim();
      // CLI 执行错误以 "Error:" 开头（sandbox 抛异常时原样回显堆栈）。
      if (/^Error:/.test(out)) {
        reject(new Error(`CLI eval error: ${out.slice(0, 400)}`));
        return;
      }
      resolve(out);
    });
    child.stdin.write(expression);
    child.stdin.end();
  });
}

/**
 * 便捷封装：把表达式包成「求值后 JSON.stringify」，返回已解析的对象。
 * 适用于读取 storage.db 文档。表达式本身应返回值或 Promise。
 */
async function runCliJson(expression, opts) {
  // 包裹：Promise.resolve 统一同步/异步；JSON.stringify 保证可解析回传。
  const wrapped = `Promise.resolve(${expression}).then(v=>JSON.stringify(v))`;
  const out = await runCli(wrapped, opts);
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`CLI JSON parse failed: ${out.slice(0, 300)}`);
  }
}

module.exports = { runCli, runCliJson, CONTAINER, CLI_PORT };
