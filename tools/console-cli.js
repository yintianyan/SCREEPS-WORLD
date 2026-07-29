/**
 * 私服 console 执行 — 在服务端 CLI sandbox 内跑诊断表达式，直接回显结果。
 *
 * 与官服 console-eval.js 的区别：官服走 HTTP console API + Memory.__diag 中转
 * （表达式在游戏 loop 里跑）；私服 CLI 在服务端 sandbox 跑（可直接访问
 * storage.db），无需中转、无需游戏 tick 配合，读运行时状态更直接。
 *
 * 注意：CLI sandbox 不是游戏运行时（没有 Game 对象）——它操作的是 storage 层
 * （mongo 文档）。要读 creep/room 的实时状态，查 storage.db.rooms.objects 等
 * 集合，而非 Game.creeps。
 *
 * 用法：
 *   node tools/console-cli.js 'storage.db.rooms.count({}).then(n=>"rooms="+n)'
 *   node tools/console-cli.js -f tools/diag-private.js   # 从文件读表达式
 */
require("./load-env");
const fs = require("fs");
const { runCli } = require("./screeps-cli");

async function main() {
  const args = process.argv.slice(2);
  let expr;
  if (args[0] === "-f" && args[1]) {
    expr = fs.readFileSync(args[1], "utf8");
  } else {
    expr = args[0] || '"usage: console-cli.js <expr> | -f <file>"';
  }
  try {
    const out = await runCli(expr, { timeoutMs: 30000 });
    console.log(out);
  } catch (e) {
    console.error("CLI error:", e.message);
    process.exit(1);
  }
}

main();
