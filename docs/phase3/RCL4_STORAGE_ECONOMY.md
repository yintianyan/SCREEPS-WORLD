# RCL4_STORAGE_ECONOMY — Storage 经济切换（P3）

> 合同锚点：ECONOMY §2.1-4（三容器分层水位）、§3（储备口径）；任务书 §6–§7、§31。

## 1. 切换判据与现状

- 结构面：storage site 在建造优先序顶层（priority=1/maxWorkers=2 + 非 storage builder
  强制让位）——P2 已落地，本阶段复验。
- 经济面切换（本阶段交付）：contractReserve（storage+terminal+link 水位）进入核算与
  预留体系；风险缓冲/risk-reserve 仅在 cr>0 时生效——**低容量房维持原动态**，即「经济
  模式随 storage 出现而切换」的机制化（任务书 §6）。
## 2. 流向分工（不变式）

```text
harvester → source container ─(hauler 收集请求·池)→ storage / spawn·ext·tower（fillTargets 塔置顶）
storage ─(distributor 直配·不经池)→ spawn/ext/tower/lab/factory sink
```
hauler 永不从 storage 取能（TD-013）；distributor 泵断供兜底（既有）。塔补给并入物流＝
缺口聚合为收集请求提级（REQUEST_POOL_DESIGN §3），非新增执行器。
## 3. 水位阈值区间制

消费点现状：upgrade.sprintStorage/sustainedStorage/perTickWithdrawLimit/drainRateLimit
（升级功率水位驱动）+ storageNearFull（demand 限采/加速消化）+ processEnergyFloor
（factory）。区间参数已全部存在且消费者接通——本阶段将其纳入 tuning 候选清单，不再新造参数。