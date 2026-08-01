# 帝国运营思维导图

以资源流与决策闭环视角组织的全局导图，与仓库实际实现对齐。
三张图层层递进：帝国全局 → Creep 行为分支 → 建筑维修链。

- 角色实现：[src/creeps/roles/](../src/creeps/roles/)
- 执行引擎：[src/creeps/engine/](../src/creeps/engine/)
- 需求与调优：[src/domain/spawn/demand.ts](../src/domain/spawn/demand.ts)、[src/domain/tuning/](../src/domain/tuning/)
- 维修动作：[src/creeps/engine/actions/repair.ts](../src/creeps/engine/actions/repair.ts)、[src/systems/tower-defense.ts](../src/systems/tower-defense.ts)

## 一、帝国全局

纵向是闭环，不是清单：`Sense → Demand/Plan → Spawn → 执行 → Feedback → 重规划`。
任何分支若没有下游消费者，就是死指标。

```mermaid
mindmap
  root((Screeps 帝国运营))
    世界状态 Sense
      房间快照 RoomSnapshot
        资源点 Source Mineral
        建筑索引
        敌情可见单位
      Intel 情报
        远程房侦察 Observer
        过期时间 TTL
        威胁评分 Threat Score
      账本 Ledger
        能量收入与支出
        库存 Storage Terminal
        CPU 与 Bucket
    需求与规划 Demand Plan
      人口规划
        required 等于 需求加替换加冗余
        gap 驱动 Spawn 请求
        预替换窗口 孵化时长加路程
      建造队列 BuildQueue
        版本化蓝图 Layout
        每 tick 限量放 site
        道路按交通热度铺
      远矿收益判定
        毛收入减维护减护航减CPU
        威胁超阈值即止损关闭
      扩张评估
        房间价值 与 复建成本
        GCL 与 CPU 余量
    Spawn 孵化
      唯一孵化入口 SpawnManager
        角色禁止自行孵化
        请求幂等合并 稳定key
      优先级队列
        P0 灾后恢复 200能量保底
        防御 与 关键经济优先
        低优先级可被抢占
      Body 设计
        按可用能量分档
        MOVE 配比看地形道路
        战时 Boost 换算交换比
    Creep 行为 Execution
      经济类
        harvester 定点采 不搬运
        hauler 干线搬运 顺路捡遗留
        distributor 填 spawn extension tower
        upgrader controller 专职
        builder 消费 BuildQueue
        worker 早期万金油 后期退役
      扩张类
        claimer 占房
        reserver 预定远矿房
        remote harvester 远矿采集
        remote hauler 远矿回运
      军事类
        defender 本土防御
        remote defender 远矿护航清野
      行为硬约束
        小状态机 空满切换防抖
        禁止全房 find 用快照索引
        缓存 targetId
        ERR_NOT_IN_RANGE 才移动
    建筑网络 Structures
      能量流节点
        Container 采集点缓冲
        Storage 中央水库
        Link 瞬时干线
        Terminal 跨房与市场
      生产链
        Extension 决定 body 上限
        Lab 化合物与 Boost
        Factory 商品加工
      防御工事
        Tower 射程衰减 集火逻辑
        Rampart Wall 最小割布防
        Safe Mode 最后底牌
      控制节点
        Controller 降级计时是红线
        Spawn 本身要被 rampart 护住
    CPU 与内存 治理
      Bucket 四档降级
        Healthy Guarded Conserve Recovery
        恢复需滞回 防抖动
      预算分层
        P0 防御移动孵化保命
        P3 全量扫描报表最后跑
      Memory 纪律
        只存 ID 枚举 短key
        派生缓存放 heap 可重建
        schemaVersion 幂等迁移
      错误隔离 safeRun
        单点错误不断整 tick
    战时状态机 War
      和平 警戒 防御 收缩 恢复
      战时目标先声明
        守住 拖延 撤离 消耗 拒止
      资源重分配
        spawn 配额转防御
        远矿按利润关闭
        库存保护或转移
    反馈 Feedback
      指标必须有消费者
        人口缺口 反哺孵化
        交通热度 反哺修路
        远矿利润 反哺开关
      Telemetry 时序数据
      每个 plan 有 TTL 强制重算
```

## 二、Creep 行为分支

本项目的 creep 层是声明式动作管线：角色只声明 `acquire`/`work` 候选链，
统一由 role-runner 驱动，共享 FSM（acquire/work/idle/flee）在 lifecycle.ts。
链序即策略——候选顺序就是行为优先级。

```mermaid
mindmap
  root((Creep 行为分支))
    执行引擎 Engine
      共享状态机 FSM
        mode acquire 背包满转work
        mode work 背包空转acquire
        mode idle 有能转work 空载转acquire
        mode flee 威胁解除自动恢复
        只在阈值跨越写Memory 防抖动
      RolePolicy 声明式契约
        gate 门禁 false即idle
        acquire 候选链 取能
        work 候选链 消耗
        onFlee 钩子 角色特化逃跑
        park 空闲让位停车
        combat 战斗角色跳过逃跑检测
      动作候选 ActionCandidate
        resolve 找目标 找不到fallthrough
        execute 执行 NOT_IN_RANGE才移动
        链式回退 按序尝试到第一个命中
    威胁与逃跑 Lifecycle
      shouldFlee 本房 fleeRange分级
        远端过境敌人不中断经济
      shouldFleeForeignRoom 远矿加过境房
        per tick per room 威胁缓存
        联盟白名单过滤
      flee 三级策略
        一 spawn比敌近 走塔防圈
        二 走敌人反向出口
        三 无路可退向spawn靠拢
      flee时释放assignment 防幽灵任务
      hauler onFlee 防御圈内安全充能
        战时tower优先 不消耗预约配额
    经济角色
      harvester 定点采
        绑source 采满dump
        dump到link优先于container
        溢出drop 由hauler回收
      hauler 收集者 P1
        acquire 顺序即策略
          assignment container 任务定向
          排空storage link 防背压堵死
          大额遗留插队 衰减资源优先
          最满container 主取能防溢出空转
          零头遗留兜底 排最后
        work 顺序
          矿物进storage
          fillStorage优先 防空置死锁
          spawn extension紧急直送
          supplyLabs 化合物供料
          全满即待命 是需求信号
        铁律 永不从storage取能
      distributor 分发者
        storage到spawn extension tower lab
        水位分级 绝对能量阈值
        与hauler单向流不成环
      upgrader 专职升级
        controller container link取能
        gated版本 按经济水位节流
      builder 消费BuildQueue
        assignment site优先
        修critical 修container衰减
      worker 早期万金油 P0
        灾后恢复保底
        后期被专职角色替代
    扩张角色
      claimer 占领目标房
      reserver 预定远矿房
        InvaderCore压制时止损撤链
      remoteHarvester 远矿定点采
      remoteHauler 远矿回运
        过境房遇袭fleeToHome
    军事角色 combat true
      defender 本土拦截
      remoteDefender 远矿清野护航
      不逃跑 不参与经济FSM
    支撑设施 Support
      assignment adapter 任务领取释放
      targeting 目标选择纯函数
      obj cache getObjectById缓存
      movement
        moveToTarget reusePath
        moveTowardRoom 跨房通勤
        recordTraffic 喂修路热度
        parking 空闲让位
        stuck recovery 卡死自救
    硬约束 红线
      禁全房find 用snapshot索引
      禁自行spawnCreep
      禁每tick PathFinder search
      禁重规划建筑
      移动仅NOT_IN_RANGE触发
      Memory只存ID枚举短key
```

## 三、建筑维修链

双轨制：creep 维修是主力（1 能量/100 hits/WORK），塔维修是安全网
（每次 10 能量 + 距离衰减，仅当房内无 builder/worker 时接管）。

```mermaid
mindmap
  root((建筑维修链))
    双轨制
      轨道A creep维修 主力
        经济性 1能量修100hits每WORK
      轨道B 塔维修 安全网
        代价 每次10能量加距离衰减
        仅当房内无builder worker时接管
        能量低于50不修 保弹药
    creep侧 谁修什么
      harvester 站桩自维护
        repairNearbyContainer range2
        仅container满溢时顺手修
      worker 灾后保底
        repairCritical 血量低于50关键结构
      builder 全职维修工
        建site优先于一切维修
        repairContainerDecay 低于80 物流保命
        repairCritical spawn tower等
        repairRoads 低于40
        repairFortifications rampart先于wall
        RCL分级墙目标 受袭升档
      目标持久化 repairTargetId
        带structureType守卫 防跨类型泄漏
    塔侧 无维修creep时
      critical spawn ext tower container
      wall rampart 需normal且能量高于70
      不修路 ← 注意
    门禁 统一红线
      有威胁不修墙不修路 白送能量
      conserve recovery tier不修
      有storage须真盈余才修墙
```

## 已知裂缝备忘

勘探中确认的两处缺口（详情见对应勘探结论）：

| 编号 | 级别 | 描述 | 状态 |
| --- | --- | --- | --- |
| 裂缝一 | P1 | 成熟房 builder 随 site 归零消亡，道路无人修（塔不修路），只能塌毁重建——重建成本约为维修 6 倍，附带无路窗口期物流减速 | ✅ 已修：demand 增加道路维修需求信号（待修道路 ≥ 3 条时维持 1 个 builder，替换门禁同步放行） |
| 裂缝二 | P2 | 远矿 container 无维修链：衰减塌毁后靠满载自建重建（建造链已由 P0-A 补齐），塌毁-重建窗口期转 drop-mining 承受衰减损耗 | 已知取舍，暂不处理 |

另有一处注释与实现不符：demand.ts 中「tuning-engine 观测到 hauler 空闲」
实际接线是 container/link 空置率代理信号，TuningSignals 无 idle 字段。✅ 注释已修正。
