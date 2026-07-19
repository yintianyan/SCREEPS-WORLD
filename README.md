# Screeps World Framework

一个以「内核稳定、业务可插拔」为目标的 Screeps: World TypeScript 起步框架。

## 开始

```bash
npm install
npm run typecheck
npm run build
```

将 `dist/main.js` 上传为 Screeps 的 `main` 模块。开发时用 `npm run watch` 持续构建。

## 架构

`main` 只负责启动内核。内核按 tick 执行：内存迁移/清理 → 系统调度 → 单位行为调度。

- `kernel/`：调度、容错、性能预算、版本化内存。
- `systems/`：跨房间/跨单位的领域服务；通过注册表扩展。
- `creeps/`：角色和任务行为；角色由 `CreepMemory.role` 决定。
- `domain/`：纯领域逻辑，应尽量与 Screeps 全局对象隔离，便于测试。
- `config/`：所有策略参数的单一入口。

新增角色：实现 `CreepRole`，然后在 `src/bootstrap.ts` 注册。新增系统：实现 `System` 并注册；系统故障会被隔离，不会中断本 tick 的其余工作。
