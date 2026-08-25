# Phase 8 — Long-Run Environment Audit

## 1. 环境总览

项目具备**两条独立的长运行验证路径**，均为真实 Screeps Runtime（非 mock loop）。

### 路径 A：screeps-server-mockup（E2E 测试框架）

| 项 | 值 |
|----|-----|
| 包 | `screeps-server-mockup@1.5.1`（github:screepers/screeps-server-mockup） |
| 引擎 | `@screeps/common@2.16.0` + `@screeps/engine@4.3.0` |
| 运行方式 | vitest 进程内启动 ScreepsServer 实例，`server.tick()` 逐 tick 推进 |
| tick 速度 | ~50-100ms/tick（本地硬件决定，非墙钟驱动） |
| 10k tick 耗时 | ~8-17 分钟 |
| 代码加载 | `dist/main.js`（构建产物，CJS 格式） |
| 世界构建 | `WorldBuilder` 精细控制地形/结构/source/controller |
| 状态读取 | `bot.memory` + `server.world.roomObjects()` |
| 已有测试 | E2E-006 10000 tick 长稳定性测试（已编写，含分段检查+死亡螺旋检测+Memory 泄漏检测） |
| 优势 | 完全隔离的测试环境，每次 reset 创建新世界，可注入 hostile creep 等故障 |
| 劣势 | 非 24/7 运行模式，无 Global Reset（mockup 不模拟跨进程 reset） |

### 路径 B：Docker 私服（screeps-launcher）

| 项 | 值 |
|----|-----|
| 镜像 | `screepers/screeps-launcher:latest` |
| 引擎 | `@screeps/common@2.16.0` + `@screeps/engine@4.3.0`（与 mockup 同版本） |
| 容器 | `screeps-server`（引擎）+ `screeps-mongo`（MongoDB 8 持久化）+ `screeps-redis`（Redis 8 缓存）+ `screeps-client`（Web UI :8080） |
| tickRate | 100ms（config.yml 配置，10× 官服速度） |
| 10k tick 耗时 | ~17 分钟（100ms × 10000） |
| 代码部署 | `tools/private/deploy-cli.js` → mongosh upsert `users.code` |
| 数据采集 | `tools/private/empire-collector.js` → CLI 后门（21026）采样 timeseries + snapshot |
| 当前状态 | 已运行，tick=1,324,938，用户 `yty` 拥有 W7N7 RCL6 房间 |
| 优势 | 真实 24/7 运行模式，MongoDB 持久化，模拟 Global Reset，已有长期运行历史 |
| 劣势 | 无法精细控制初始世界（依赖已有房间状态），故障注入需通过 CLI 操作 |

## 2. 运行时版本矩阵

| 组件 | 版本 | 来源 |
|------|------|------|
| Screeps 引擎 (common) | 2.16.0 | `@screeps/common/package.json` |
| Screeps 引擎 (engine) | 4.3.0 | `@screeps/engine/package.json` |
| screeps-server-mockup | 1.5.1 | `package-lock.json` |
| screeps-launcher | latest | Docker image |
| MongoDB | 8 | `mongo:8` Docker image |
| Redis | 8 | `redis:8` Docker image |
| Node.js (私服) | v24.19.0 | launcher 下载 |
| Node.js (本地) | v24.x | `package.json` engines |

## 3. World Configuration

### 私服 (Docker)
- **tickRate**: 100ms（config.yml）
- **constants**: 未修改（官方常量）
- **mods**: screepsmod-mongo + screepsmod-admin-utils + screepsmod-auth
- **bots**: 无（空净世界）
- **persistence**: MongoDB + Redis（跨重启持久化）
- **Memory Reset Behavior**: 引擎 Global Reset 每 ~4-12h（取决于内存压力），reset 后 Memory 清空、Heap 丢失、RawMemory segments 保留

### E2E (mockup)
- **tickRate**: 非墙钟驱动（`server.tick()` 同步推进）
- **constants**: 官方默认
- **世界**: `WorldBuilder.addRooms()` 精细构建（`standardRoom()` = spawn + 2 source + 1 controller + 1 mineral）
- **persistence**: 内存（进程退出即丢失）
- **Memory Reset Behavior**: 不模拟 Global Reset

## 4. 数据采集能力

### 私服采集器（`empire-collector.js`）
- **timeseries**: 每 20 tick 采样一次，记录：
  - 房间状态（RCL/progress/safeMode/colonyState/phase/economyPressure）
  - 能量全景（spawn/extension/container/storage/terminal/source/tower）
  - Creep 分布（per-room per-role total/acquire/work/stuck/assigned）
  - Spawn queue（长度/by-role/cost）
  - Build queue（长度/by-type/blocked）
  - Remote ops（state/haulerNeed/threat）
  - CPU 遥测（bucket/top3 system）
  - 事件摘要（最近 10 条 + 全量分布统计）
  - Tuning 引擎摘要
  - Layout gaps
- **snapshot**: 每 1000 tick 全量快照（所有 objects + Memory + segments）
- **会话管理**: tick 回退检测 → 新会话文件

### E2E 快照（`SnapshotInspector`）
- 每 tick 从 `bot.memory` 提取：
  - creepCountByRole / totalCreeps
  - consoleLogs / notifications
  - rawMemory（完整 Memory 对象）

## 5. 长运行方案选择

### 方案：双路径并行验证

**路径 A（E2E mockup）— 10k tick 受控验证**:
- 使用已有 `06-long-stability.test.ts` 框架
- 扩展为完整的 Phase 8 验证套件
- 优势：完全受控、可注入故障、可精确断言
- 执行：`npm run test:e2e`

**路径 B（Docker 私服）— 真实 24/7 验证**:
- 部署最新 `dist/main.js` 到私服
- 启动 `empire-collector.js` 常驻采集
- 在真实运行中观察 Recovery/Economy/Autonomy
- 优势：真实 Global Reset、真实持久化、长期运行

## 6. 已有基础设施清单

| 工具 | 文件 | 用途 |
|------|------|------|
| 部署 | `tools/private/deploy-cli.js` | mongosh upsert 代码到私服 |
| 采集 | `tools/private/empire-collector.js` | CLI 后门采样 timeseries + snapshot |
| CLI | `tools/private/screeps-cli.js` | docker exec → curl → CLI sandbox |
| 监控 | `tools/private/monitor-empire.js` | 实时看板 |
| 分析 | `tools/private/analyze-collect.js` | 离线分析采集数据 |
| E2E 框架 | `tests/e2e/framework/` | ScenarioRunner + ServerHarness + BotHarness |
| E2E 夹具 | `tests/e2e/fixtures/rooms.ts` | standardRoom / disasterRoom / rcl4Room / remoteMiningRooms |

## 7. 判定

**环境就绪度: ✅ 可以执行长运行验证**

- Docker 私服已运行，引擎版本与 mockup 一致
- 部署/采集/分析工具链完整
- E2E 框架已有 10k tick 长稳定性测试
- 两条路径互补：mockup 做受控故障注入，私服做真实长期运行
