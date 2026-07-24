/**
 * 最小冒烟验证脚本 — 验证 screeps-server-mockup + dist/main.js 链路。
 * 不用 vitest，直接用 Node 跑，快速验证环境。
 */
const { ScreepsServer, TerrainMatrix } = require("screeps-server-mockup");
const fs = require("node:fs");

async function main() {
  console.log("=== 1. 读取 dist/main.js ===");
  const code = fs.readFileSync("dist/main.js", "utf8");
  console.log(`代码长度: ${code.length} 字符`);

  console.log("=== 2. 创建 server ===");
  const server = new ScreepsServer();

  console.log("=== 3. 重置世界 ===");
  await server.world.reset();

  console.log("=== 4. 创建房间 W0N1 ===");
  const terrain = new TerrainMatrix();
  await server.world.addRoom("W0N1");
  await server.world.setTerrain("W0N1", terrain);
  await server.world.addRoomObject("W0N1", "controller", 10, 10, { level: 1 });
  await server.world.addRoomObject("W0N1", "source", 10, 40, {
    energy: 3000, energyCapacity: 3000, ticksToRegeneration: 300,
  });
  await server.world.addRoomObject("W0N1", "source", 40, 10, {
    energy: 3000, energyCapacity: 3000, ticksToRegeneration: 300,
  });
  await server.world.addRoomObject("W0N1", "mineral", 40, 40, {
    mineralType: "H", density: 3, mineralAmount: 3000,
  });

  console.log("=== 5. 注册 bot（加载 dist/main.js）===");
  const bot = await server.world.addBot({
    username: "bot",
    room: "W0N1",
    x: 25,
    y: 25,
    modules: { main: code },
  });

  const logs = [];
  bot.on("console", (lines) => {
    for (const line of lines) logs.push(line);
  });

  console.log("=== 6. 启动 server ===");
  await server.start();

  console.log("=== 7. 跑 5 tick ===");
  for (let i = 0; i < 5; i++) {
    await server.tick();
    const time = await server.world.gameTime;
    const mem = await bot.memory;
    console.log(`tick ${time}: memory 长度 = ${mem.length}`);

    // 检查是否有错误日志
    const errors = logs.filter(
      (l) =>
        l.includes("TypeError") ||
        l.includes("ReferenceError") ||
        l.includes("is not a function"),
    );
    if (errors.length > 0) {
      console.log("!!! 检测到错误日志 !!!");
      for (const e of errors) console.log(`  ERROR: ${e}`);
    }
  }

  console.log("=== 8. 验证 Memory 结构 ===");
  const finalMem = JSON.parse(await bot.memory);
  console.log("Memory 顶层 keys:", Object.keys(finalMem).join(", "));
  if (finalMem.creeps) {
    console.log("creeps 数量:", Object.keys(finalMem.creeps).length);
  }
  if (finalMem.rooms) {
    console.log("rooms:", Object.keys(finalMem.rooms).join(", "));
  }

  console.log("=== 9. 清理 ===");
  server.stop();
  console.log("=== 冒烟测试通过 ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("冒烟测试失败:", e.message);
  console.error(e.stack);
  process.exit(1);
});
