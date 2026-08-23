# 私服重置+种子配方（Step 12 续，待执行）

前置：docker 栈 healthy；P3 代码已部署（users.code default，deploy-cli）；
CLI=tools/private/console-cli.js；用户 _id=6a6a1daa720eee0411548bf2。

## 已确认
- CLI 能力：system.resetAllData / setTickDuration / getTickDuration；map.generateRoom
- 采集器通道正常（empire-collector.js --once）

## 注意
- 高负载下 CLI 查询偶发 undefined —— 先 system.pauseSimulation() 稳定后再查。

## 执行序列
1. pauseSimulation()
2. 捕获模板：users.findOne({_id:'6a6a1daa720eee0411548bf2'})全文 → /tmp/p3seed/user.json；
   rooms.objects.findOne({type:'spawn'}) → spawn.json
3. setTickDuration(50)
4. resetAllData()（用户已授权）
5. map.generateRoom('W7N3')
6. mongosh 重插用户（去 _id）→ 取 uid
7. rooms.updateOne 设 controller {user:uid, level:1}
8. rooms.objects 插入 spawn（模板改居中、user=uid、store.energy=300）
9. resumeSimulation()
10. 验证 tick 推进 + AI 孵 worker（≤200 tick）→ 启动周期采样

## 执行快照（2026-08-23，部分完成）

已完成：pauseSimulation ✓ → setTickDuration(50) ✓ → resetAllData() ✓（世界已清空）。
未完成：generateRoom 报 express 层错误；resumeSimulation 报错（或已自动恢复——
resetAllData 通常重启主循环）；用户/spawn 种子未插入。

## 下轮首步
1. CLI 探测：system.getTickDuration() 与 storage.db.rooms.countDocuments() ——
   若 tick 在推进说明 sim 已自动 resume；否则排查 resumeSimulation 错误栈全文。
2. map.generateRoom('W7N3') 重试（若报"房间已存在"则跳过）。
3. mongosh 直接种子（绕过 CLI）：
   docker exec -i screeps-mongo mongosh --quiet screeps --eval '<script>'
   ① users.insertOne({username:'yty',cpu:100,cpuAvailable:100,gcl:0,gclLevel:1,...})
      —— 先 users.countDocuments() 确认清空；字段以 deploy-cli 曾定位的
      _id=6a6a1daa720eee0411548bf2 文档结构为准（重置前未捕获成功，可从
      mongo 备份或 driver 默认值推断；password 字段可省略——authmod 未装）。
   ② rooms.updateOne({_id:'W7N3'},{$set:{controller:{user:<uid>,level:1}}})
   ③ rooms.objects.insertOne({type:'spawn',room:'W7N3',x:25,y:25,user:<uid>,
      store:{energy:300},hits:5000,hitsMax:5000,_id:'spawn-W7N3-1'})
4. 验证：tick 推进 + ≤200tick 孵出 worker → 启动周期采样。

## 执行快照 II（种子完成，引擎未出 creep）

已完成：yty 用户（steam 标记已补）✅ / W10N8 controller{user,level:1} ✅ /
spawn(25,25,300E) ✅ / users.code{uid,default,activeWorld:true} ✅。
现象：数千 tick 无 creep 孵出。

## 下轮排查序
1. cli: map.openRoom('W10N8') —— 私服房间可能需显式 open 才进模拟集。
2. 验证 driver 是否执行该房：storage.env.get(MEMORY+uid) 是否被 AI 初始化
   （AI 首 tick 会写 Memory）→ 空=代码未跑；有=跑了但 spawn 门禁卡住
   （查 spawn store.energy 是否被扣/ea 快照）。
3. 若代码未跑：检查 users.code.activeWorld 语义与 users.activeActiveWorld/
   rooms.__openRooms 等 launcher 环境键；对照 JackBot 房间为何在跑。

## 排查快照 II（active 已设，仍无 creep）

已做：W10N8 active:true ✓；deploy-cli 重打 timestamp ✓（驱动应热重载）。
结果：40s(~800t) 后仍 CREEPS=0、spawn 满 300 —— AI 未在 W10N8 执行。

## 下轮定位序（二选一必中）
A. 对照法：取 JackBot 正在跑的房间文档全文 vs W10N8 文档逐字段 diff
   （mongosh print(JSON.stringify(...))），差异字段即开关。
B. 日志法：docker logs screeps-server --tail 200 | grep -iv heartbeat
   找 driver 对 W10N8/uid 的处理与报错。

优先 B（零侵入）。

## 排查快照 III（最高概率假设：driver 房间集缓存）

服务器日志止于启动时刻——driver 可能在启动时缓存房间集；resetAllData 与种子
都发生在运行期，W10N8 未进 driver 模拟集。activeSim:true 已补（与 JackBot 一致），
仍无 creep。

## 下轮第一步（成本最低、命中概率最高）
1. docker restart screeps-server（整栈重启更稳：docker restart screeps-redis screeps-mongo screeps-server）
2. 等 60s → 采样器 --once → 看 tick 推进 + CREEPS 数。
3. 若仍为 0 → 对照 JackBot 用户文档全文与 yty 逐字段 diff（含 __activeBot 等私有键）。

## 另一备选（若重启无效）
放弃手动种子，改用 launcher 原生 bot 机制：把 P3 bundle 注册为一个 bot
（launcher config 的 bots 段），由 launcher 全权负责房间/用户/模拟——
代价是走 bot 而非 player 管线，需验证 AI 兼容性。

## 快照 IV（重启后）
docker restart 后 tick=46657 在推进（引擎活着），但 collector rooms=0 ——
驱动未把 W10N8 纳入任何用户的模拟集。手动 DB 种子路线到此为止，
**建议改用 launcher 原生机制**（二选一）：
A. launcher 配置文件加 bots 段注册 P3 bundle（launcher 全权管理房间/用户/模拟）；
B. 安装 screepsmod-auth 等 mod 走标准 HTTP 注册/出生点流程。
两条路都绕开「手动 DB 种子 + driver 房间集」的未知层。

## 快照 V（阻塞点：模拟未运行）
重启整栈后 engine 进程活着但零 tick（env=0、ea 冻结 300、CLI getTickDuration undefined）。
launcher-cli 的 resumeSimulation 端点报错（mods/screeps-launcher-cli.js L34）。
**最快解法（需人工一次点击）**：打开私服 Web UI（screeps-client 已在运行，
通常 http://localhost:21025）→ 左上角暂停/恢复按钮切到「运行」。
之后采样器自动累积数据，无需任何其他操作。

程序侧备选：读 mods/screeps-launcher-cli.js L34 上下文补齐该端点所需参数后重试。

## 快照 VI（模拟已运行，观测通道定案）
- /api/game/time 确认 tick 推进（33753→33812，~10t/s @50ms）——**模拟运行中**。
- 私服未装 authmod：console/memory 的 HTTP API 均 401（signin Bad Request）；
  CLI 21026 通道重启后不稳定。
- CREEPS=0（mongo 口径）暂无法区分「AI 未跑」vs「跑但未到孵化门槛」。

## 下轮首步（二选一，推荐 A）
A. **装 screepsmod-auth**（launcher mod 目录加依赖重启）→ signin 获得 token →
   console/memory 全 REST 化，采样器从 docker-exec 改直连 HTTP，稳定且可 CI 化。
B. 人工在 :8080 Web UI 看 W1S1 是否有 creep 走动并截图反馈。
