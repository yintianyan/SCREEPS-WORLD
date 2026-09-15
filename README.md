# Screeps World Framework

一个以「内核稳定、业务可插拔」为目标的 Screeps: World TypeScript 起步框架。

## 开始

```bash
npm install
npm run typecheck
npm run build
```

将 `dist/main.js` 上传为 Screeps 的 `main` 模块。开发时用 `npm run watch` 持续构建。

## 目录结构

```
src/
├── main.ts / bootstrap.ts      启动入口与唯一组合根（所有角色/系统在此注册）
├── kernel/                     内核：调度、容错、CPU 预算、版本化内存
│   └── migrations/             Memory schema 迁移数据表（按版本段拆分）
├── config/                     策略参数单一入口（CONFIG、body 配比、调优基线）
├── domain/                     纯领域逻辑（尽量与 Screeps 全局隔离，便于测试）
│   ├── assignment/ economy/ expansion/ industry/ logistics/ remote/ spawn/
│   ├── combat/ defense/ military/ tactical/ war/          战斗与战争域
│   ├── construction/ layout/                              建造与布局域
│   ├── strategy/ operation/ tuning/                       战略、行动、调优域
│   └── intel.ts              情报数据结构
├── systems/                    系统（Game/Memory 交互层），按业务域分子目录
│   ├── room/                   房间经济运行时：spawn/分配/建造/工业/物流/灾后恢复
│   ├── empire/                 帝国战略与资产：议程/经济/扩张(含状态机子模块)/调优
│   ├── military/               军事防御：塔防/战争规划/战术运行时/野采编队
│   ├── trade/                  市场贸易：terminal 编排、交易动作、跨房互济
│   ├── remote/                 远矿运营：编排 + 账本/回收/情报/道路四子模块
│   └── (根)                    横切共享层：intelligence(情报查询)、site-quota(工地账本)、
│                               room-snapshot(快照构建)、room-observer(视野采集)、
│                               telemetry-collector(遥测)
├── creeps/                     单位层：roles(角色)/engine(驱动)/movement(移动)/support(共享)
└── telemetry/                  遥测导出与指标
tests/
├── unit/ integration/ e2e/     三层测试（职责见 AGENT.md）
└── support/                    测试工厂与 TestWorld 框架
```

### 分层规则

- `kernel/` 只维护运行秩序，不感知业务；`domain/` 不触碰 Game/Memory（纯函数）；`systems/` 是两者之间的 Game 交互层。
- 新增角色：实现 `CreepRole` 后在 `src/bootstrap.ts` 注册。新增系统：实现 `System` 并注册；系统故障会被隔离，不中断本 tick。
- 系统间值导入受 R11 架构守卫约束（`tests/unit/architecture/compliance.test.ts` 白名单）。

## 架构

`main` 只负责启动内核。内核按 tick 执行：内存迁移/清理 → 系统调度 → 单位行为调度。

- `kernel/`：调度、容错、性能预算、版本化内存。
- `systems/`：跨房间/跨单位的领域服务；通过注册表扩展。
- `creeps/`：角色和任务行为；角色由 `CreepMemory.role` 决定。
- `domain/`：纯领域逻辑，应尽量与 Screeps 全局对象隔离，便于测试。
- `config/`：所有策略参数的单一入口。
