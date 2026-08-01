# Screeps 私服工具集

当前环境为私服（Docker screeps-launcher + CLI 后门）。所有工具通过
`tools/screeps-cli.js`（docker exec → 容器内 21026 CLI 端口）访问服务端
storage 层（`storage.db` + `storage.env`），无需 HTTP 认证。

## 核心工具

### `empire-collector.js` — 帝国全面数据采集器（后分析主通道）

每 20 tick（私服 100ms/tick → 2s）采集一次**紧凑时间序列**，每 1000 tick
采集一次**全量快照**。数据从当前 tick 持续记录；检测到 gameTime 回退
（世界重置）自动开新会话文件，保证从 RCL1 开始的完整生命周期可重建。

```bash
# 常驻采集（推荐，输出到 tools/data/collect/）
npm run collect:private

# 单次采样 / 单次快照 / 高频模式（10 tick + 500 tick 快照）
npm run collect:private:once
npm run collect:private:snapshot
npm run collect:private:fast
```

输出（`tools/data/collect/`）：

| 文件 | 内容 |
|------|------|
| `timeseries-<tick>.jsonl` | 每 20 tick 一行紧凑记录（见下方字段） |
| `snapshots-<tick>.jsonl` | 每 1000 tick 一行全量快照（objects + Memory + layout segment） |
| `session.json` | 会话元信息（startTick/lastTick/文件指针） |

**timeseries 每行字段**（后分析定位问题用）：

- 全局：`t` tick、`ts` 主机时间、`sv` schemaVersion、`cpu`、`gcl`
- `kernel`：tier / recoveryTicks / skipReasons / strategy / expansion / layoutGaps
- `kernel.tuning`：lastTunedAge / baselineMatch / 覆盖房数 / params / frozen / pending（调参有效性）
- `layoutBlocked`：每房 segment 黑名单条目数（布局任务卡死信号）
- `cpuTop`：bucket + 总 CPU + Top3 系统（来自遥测 segment）
- `events`：最近 10 条事件；`eventStats`：环形缓冲全量事件分布
  （入侵/塔战/死亡/调参回滚等 k0-22 计数 + deaths/deathsViolent）
- `rooms[]`：每房——
  - controller：rcl / prog / downgrade / safeMode
  - 决策态：colonyState / phase / economyPressure / storageNearFull
  - spawn：队列长度 + 按角色计数 + 总 body 成本（找「为什么不孵化」）
  - build：队列长度 + 按类型 + blocked 按类型（找「建造卡死」）
  - 物流：energy 各仓位（spawn/ext/container/storage/terminal/source/tower）、
    resources 全量（storage/terminal/factory/lab/powerSpawn/nuker 的完整 store）、
    droppedEnergy / tombstones / minerals（找「能量断流/积压」）
  - 人口：creeps 按角色、body 部件汇总、携带能量、平均 ttl（找「编制失衡/空转」）
  - creepMode：per-role total/acquire/work/stuck/assigned（找「空转/卡位/任务缺失」）
  - 布局：layout 状态 / revision / nextPlan / nextGapPlan / anchorScore、
    gaps（目标清单缺口）
  - 军事：hostiles / towers（位置+能量）/ safeMode / struct 计数
  - 远矿：remoteOps 摘要（state/haulerNeed/threat）
- `remoteRooms`：远矿目标房 + 我方 creep 活动房的实况（creeps/hostiles/contE/srcE/dropped）

**snapshot 每行字段**：`objects`（己方房间 + 活动房全部对象的精简字段：
type/structureType/坐标/store/能量/hits/ttl/body/spawning/进度/资源等）、
`memory`（完整 Memory）、`layoutSegments`（segment 0 布局 overrides/blocked）。

## 其他工具

| 工具 | 用途 |
|------|------|
| `monitor-empire.js` | 实时帝国看板（`--watch` 前台刷新 / `--once` 摘要日志） |
| `probe-tuning.js` / `probe-tuning-full.js` | tuning 引擎状态与 CONFIG 基线对照 |
| `console-cli.js` / `console-eval.js` / `diag-expr.js` / `diag-stall.js` | 私服 CLI 诊断通道 |
| `deploy-cli.js` / `deploy-screeps.js` / `check-branches.js` / `check-ci.js` | 部署与 CI 检查 |
| `screeps-cli.js` / `load-env.js` | CLI 通道基础设施（勿删） |

## 后分析建议

```python
import json
# 每行一个 JSON 对象
with open("tools/data/collect/timeseries-*.jsonl") as f:
    rows = [json.loads(line) for line in f]
# 能量流：差分 storage/terminal 能量即可得到净流入速率
# 人口：按房间按角色画数量时间线，对照 spawnQueueByRole 找孵化瓶颈
# 卡死：layoutBlocked / buildQueueBlocked 非零时间段 = 建造异常窗口
```
