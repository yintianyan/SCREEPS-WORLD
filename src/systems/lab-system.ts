/**
 * Lab System — P1 系统，每 tick 执行 lab 反应和 boost。
 * 职责：收集 lab/terminal/storage 化合物库存 → 规划反应链（从 RoomMemory 目标产物
 * 反向推导）→ 分配 lab 角色（input1/input2/output/boost）→ 执行反应与 boost。
 * 约束：RCL6+ 才有 lab（3 个），RCL7 有 6 个，RCL8 有 10 个；每 tick 每对 lab 只能
 * 反应一次（cooldown）；boost 优先于反应（即时战力提升）；反应链状态持久化在
 * RoomMemory.industry。
 */
import type { RoomSnapshot, System, TickContext } from "../kernel/contracts";
import type { Compound, LabAssignment, LabDemandTable, LabLoadDemand, LabPlan, LabUnloadDemand, ReactionPlan } from "../domain/industry/types";
import { BOOST_EFFECTS, BOOST_EFFECT_PART } from "../domain/industry/types";
import { evaluateBoostRequests, decideWarReactionTarget, DEFAULT_BOOST_POLICY } from "../domain/industry/boost";
import { getNextExecutableStep, planReactionChain, selectReactionTrio, LAB_REACTION_AMOUNT } from "../domain/industry/reactions";
import { globalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";
import { collectFullInventory } from "../domain/industry/inventory";
import { expandReactionDemands } from "../domain/industry/procurement";
import type { ProcurementDemand } from "../kernel/global-cache";

// ─── Boost/装料常量（引擎数值：boostCreep 每部件 30 矿物 + 20 能量）────

const LAB_BOOST_MINERAL = 30;
const LAB_BOOST_ENERGY = 20;
/** 反应 input lab 的装料目标 — 一个批次量，避免一次抽干 storage。 */
const REACTION_LOAD_TARGET = 300;
/** output lab 产物积累到此量即发布回收需求（攒批搬运，减少往返）。 */
const OUTPUT_RECLAIM_THRESHOLD = 100;
/** war 前馈激活房的休眠时长（tick）— 缩短重试间隔，market 补给基础矿后
 * 能更快恢复反应（非 war 房保持 500，防原料断供时 BFS 规划纯空转）。 */
const WAR_IDLE_TICKS = 50;

// ─── RoomMemory 扩展 ────────────────────────────────────────

interface IndustryMemory {
  /** 当前反应目标产物。 */
  reactionTarget?: Compound;
  /** 反应目标数量。 */
  reactionAmount?: number;
  /** 当前反应计划（序列化）。 */
  reactionPlan?: ReactionPlan;
  /** 已 boost 的 creep 名列表（防止重复 boost）。 */
  boostedCreeps?: string[];
  /** 原料断供休眠截止 tick — 休眠期内跳过本房 lab 规划（见 run 内注释）。 */
  idleUntil?: number;
}

function getIndustryMemory(roomName: string): IndustryMemory {
  const mem = Memory.rooms[roomName] as Record<string, unknown> | undefined;
  if (!mem) return {};
  if (!mem.industry) mem.industry = {};
  return mem.industry as IndustryMemory;
}

// ─── 库存收集 ───────────────────────────────────────────────

/**
 * 收集房间中所有非 energy 资源的完整库存视图。
 * 统一库存视图（阶段 0 改造）：storage + terminal + labs + factory。
 * 旧实现遗漏 factory 在制 stock — commodity 生产链的原料/产物不在口径内，
 * 反应链规划时 factory 中的化合物被忽略，可能重复规划已有库存的反应。
 */
function collectCompoundInventory(snapshot: RoomSnapshot): Record<string, number> {
  return collectFullInventory(snapshot);
}

// ─── Lab 分配 ───────────────────────────────────────────────

/**
 * 规划 lab 分配：优先 boost，剩余做反应。
 * 策略：1 个 lab 专门 boost（有请求时）→ 剩余取 3 个做反应（2 input + 1 output）→ 其余 idle。
 */
function planLabs(
  snapshot: RoomSnapshot,
  boostRequests: readonly { creepName: string; compound: Compound; bodyParts: number }[],
  reactionStep: { input1: Compound; input2: Compound; output: Compound } | null,
): LabPlan {
  const labs = snapshot.labs;
  const assignments: LabAssignment[] = [];

  if (labs.length === 0) {
    return { assignments: [] };
  }

  let labIndex = 0;

  // 1. Boost lab（第一个 lab）
  if (boostRequests.length > 0 && labs.length > 0) {
    const boostLab = labs[labIndex]!;
    const req = boostRequests[0]!;
    assignments.push({
      labId: boostLab.id,
      role: "boost",
      boostTarget: req.creepName,
      boostCompound: req.compound,
      boostParts: req.bodyParts,
    });
    labIndex++;
  }

  // 2. Reaction labs（需要 3 个相邻的：2 input + 1 output）。
  // runReaction 要求两个 input lab 均在 output lab 的 range≤2 内，
  // 因此不能任意取 3 个——须挑选满足相邻约束的三元组，否则本 tick 不反应（P2-8）。
  const remainingLabs = labs.slice(labIndex);
  if (reactionStep && remainingLabs.length >= 3) {
    const trio = selectReactionTrio(
      remainingLabs.map(l => ({ id: l.id as string, x: l.pos.x, y: l.pos.y })),
    );
    if (trio) {
      assignments.push(
        { labId: trio.input1, role: "input1" },
        { labId: trio.input2, role: "input2" },
        { labId: trio.output, role: "output" },
      );

      // 未参与反应的剩余 lab 标记 idle。
      for (const lab of remainingLabs) {
        if (!assignments.some(a => a.labId === lab.id)) {
          assignments.push({ labId: lab.id, role: "idle" });
        }
      }

      return {
        assignments,
        reaction: { ...reactionStep, amount: LAB_REACTION_AMOUNT },
      };
    }
    // 找不到相邻三元组：lab 分散布局，本 tick 不反应，全部 idle（走下方 fallback）。
  }

  // 3. 剩余 idle
  for (let i = labIndex; i < labs.length; i++) {
    const lab = labs[i]!;
    if (!assignments.some(a => a.labId === lab.id)) {
      assignments.push({ labId: lab.id, role: "idle" });
    }
  }

  return { assignments };
}

// ─── 搬运需求推导 ───────────────────────────────────────────

/** lab 当前装载的矿物（能量除外；空 lab 返回 undefined）。 */
function heldMineral(lab: StructureLab): ResourceConstant | undefined {
  return (Object.keys(lab.store) as ResourceConstant[])
    .find(r => r !== RESOURCE_ENERGY && (lab.store[r] ?? 0) > 0);
}

/**
 * 依据 lab 分配推导本 tick 的装/卸料需求表。
 * 规则：boost lab 需 boostCompound（parts×30）+ 能量（parts×20），装错矿先清位；
 * input lab 需对应反应原料至批次目标量，装错矿先清位；output lab 装着非本反应产物
 * 立即回收、产物积攒到阈值后攒批回收；idle lab 任何残留回收。
 * 错矿 lab 在清位完成前不发装料需求 — 否则搬运端会对满仓 lab 反复 ERR_FULL 空转。
 * @internal 导出仅供接线级单元测试使用，业务代码不直接调用。
 */
export function computeLabDemands(labPlan: LabPlan): LabDemandTable {
  const loads: LabLoadDemand[] = [];
  const unloads: LabUnloadDemand[] = [];
  const reaction = labPlan.reaction;

  for (const assignment of labPlan.assignments) {
    const lab = Game.getObjectById(assignment.labId as Id<StructureLab>);
    if (!lab) continue;
    const held = heldMineral(lab);

    let want: ResourceConstant | undefined;
    let target = 0;
    if (assignment.role === "boost" && assignment.boostCompound) {
      want = assignment.boostCompound as ResourceConstant;
      const parts = assignment.boostParts ?? 5;
      target = parts * LAB_BOOST_MINERAL;
      const energyMissing = parts * LAB_BOOST_ENERGY - lab.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energyMissing > 0) {
        loads.push({ labId: assignment.labId, resource: RESOURCE_ENERGY, amount: energyMissing });
      }
    } else if (assignment.role === "input1" && reaction) {
      want = reaction.input1 as ResourceConstant;
      target = REACTION_LOAD_TARGET;
    } else if (assignment.role === "input2" && reaction) {
      want = reaction.input2 as ResourceConstant;
      target = REACTION_LOAD_TARGET;
    }

    if (want) {
      if (held && held !== want) {
        unloads.push({ labId: assignment.labId, resource: held });
        continue;
      }
      const missing = target - (lab.store[want] ?? 0);
      if (missing > 0) {
        loads.push({ labId: assignment.labId, resource: want, amount: missing });
      }
      continue;
    }

    if (!held) continue;
    if (assignment.role === "output" && reaction && held === (reaction.output as ResourceConstant)) {
      // 本反应的正常产出 — 攒批回收，避免每 5 单位跑一趟。
      if ((lab.store[held] ?? 0) >= OUTPUT_RECLAIM_THRESHOLD) {
        unloads.push({ labId: assignment.labId, resource: held });
      }
    } else {
      // idle 残留 / output 装着往期产物 — 立即回收清位。
      unloads.push({ labId: assignment.labId, resource: held });
    }
  }
  return { loads, unloads };
}

// ─── 系统实现 ───────────────────────────────────────────────

export const labSystem: System = {
  name: "lab-manager",
  priority: 1,

  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      // RCL6+ 才有 lab
      if (snapshot.rcl < 6) continue;
      if (snapshot.labs.length === 0) continue;

      const room = Game.rooms[snapshot.roomName];
      if (!room) continue;

      const industryMem = getIndustryMemory(snapshot.roomName);

      // war 前馈激活判定（boost 战前强化链）：war 姿态且本房是 sponsor（或
      // 计划未立 — sponsor 未知时所有 RCL6+ 房先备料，反正化合物不浪费）。
      // 仅 sponsor 前馈：非参战房继续默认 XGH2O 生产线不受打扰。
      const warPlan = Memory.kernel?.warPlan;
      const warActive = Memory.kernel?.strategy?.posture === "war" &&
        (!warPlan || warPlan.sponsor === snapshot.roomName);

      // 原料断供休眠：单房间只产一种矿物，多矿种原料在市场/跨房补给接入前
      // 不会自行出现。此时每 tick「规划反应链 → 无可执行步骤 → 清除 → 再规划」
      // 是纯 CPU 空转。休眠期内跳过本房全部 lab 逻辑，到期后重新评估
      //（休眠由下方「无反应可执行且无 boost 需求」时设置）。
      if (industryMem.idleUntil !== undefined && ctx.tick < industryMem.idleUntil) {
        continue;
      }

      const inventory = collectCompoundInventory(snapshot);

      // P2-9：清理已死亡 creep 的名字，防止 boostedCreeps 无限累积。
      // 复用 Game.creeps 判断存活，去重后仅保留仍在世的名字（无需 schema 迁移）。
      if (industryMem.boostedCreeps && industryMem.boostedCreeps.length > 0) {
        industryMem.boostedCreeps = industryMem.boostedCreeps.filter(
          name => Game.creeps[name] !== undefined,
        );
      }

      // ── 1. Boost 决策 ──
      // warBuildPhase：编队 build 相位放宽报到窗口（编队集结本就是待命，
      // 化合物前馈未到位时窗口不该把强化机会关死 — 见 boost.ts）。
      const creepSummaries = Object.values(Game.creeps)
        .filter(c => c.memory.home === snapshot.roomName)
        .map(c => ({
          name: c.name,
          role: c.memory.role ?? "unknown",
          ticksToLive: c.ticksToLive ?? 0,
          boosted: (industryMem.boostedCreeps ?? []).includes(c.name),
          body: c.body,
        }));

      const boostRequests = evaluateBoostRequests(
        creepSummaries,
        snapshot.rcl,
        inventory,
        DEFAULT_BOOST_POLICY,
        warPlan?.phase === "build",
      );

      // ── 2. 反应规划（含自动目标选择） ──
      // 优先级：war 前馈（库存缺口预产编队化合物）> G 威慑备弹（nuker 存在且
      // G 合计低于备弹目标 — 常态威慑资产，先于经济 boost 投资）> boost 请求
      // 化合物 > 默认 XGH2O。不抢占已设定的目标 — 反应批次很快完成，切目标浪费半成品。
      // G 合计口径 = 反应链可见库存（storage+terminal+labs）+ nuker 已装填当量。
      if (!industryMem.reactionTarget) {
        const warTarget = decideWarReactionTarget(
          warActive,
          inventory,
          CONFIG.war.boostStockpile,
        );
        const gTotal = (inventory[RESOURCE_GHODIUM] ?? 0) +
          (snapshot.nuker?.store[RESOURCE_GHODIUM] ?? 0);
        const gShort = snapshot.nuker !== undefined &&
          gTotal < CONFIG.nuker.ghodiumStockpile;
        if (warTarget) {
          industryMem.reactionTarget = warTarget;
          industryMem.reactionAmount = 300;
        } else if (gShort) {
          // G 备弹量纲大（5k），整链一次规划到位（300/批重规划会在 5000/300≈17
          // 个批次间反复重建计划）；反应执行仍按 5/tick 涓流，装填由 stockNuker 搬运。
          industryMem.reactionTarget = "G";
          industryMem.reactionAmount = CONFIG.nuker.ghodiumStockpile;
        } else if (boostRequests.length > 0) {
          // 优先生产 boost 需要的化合物
          industryMem.reactionTarget = boostRequests[0]!.compound;
          industryMem.reactionAmount = 300; // 一批 300 单位
        } else {
          // 默认生产 XGH2O（upgrade boost，最高价值）
          industryMem.reactionTarget = "XGH2O";
          industryMem.reactionAmount = 300;
        }
      }

      let reactionStep: { input1: Compound; input2: Compound; output: Compound } | null = null;

      if (industryMem.reactionTarget && industryMem.reactionAmount) {
        // 使用持久化的反应计划
        if (!industryMem.reactionPlan || industryMem.reactionPlan.target !== industryMem.reactionTarget) {
          industryMem.reactionPlan = planReactionChain(
            industryMem.reactionTarget,
            industryMem.reactionAmount,
            inventory,
          ) ?? undefined;
        }

        if (industryMem.reactionPlan) {
          const step = getNextExecutableStep(industryMem.reactionPlan, inventory);
          if (step) {
            reactionStep = step;
          } else {
            // 反应链完成，清除目标让下 tick 重新评估
            industryMem.reactionTarget = undefined;
            industryMem.reactionAmount = undefined;
            industryMem.reactionPlan = undefined;
          }
        }
      }

      // ── 2.5 发布采购需求（阶段 1 改造）──
      // 反应链计划存在时，展开基础矿物缺口写入 globalCache.procurementDemands，
      // 供 terminal-manager 按 priority 排序后买入。旧实现硬编码 MINERAL_RESERVE_TARGET
      // (500/200) 与实际消费速率无关 — 此处让需求信号从消费方传递到采购方。
      // 需求有效期 = market.interval(200) + buffer(50) = 250 tick，确保跨终端冷却窗口。
      if (industryMem.reactionPlan) {
        const demands = expandReactionDemands(
          industryMem.reactionPlan,
          inventory,
          ctx.tick,
          CONFIG.market.interval + 50,
        );
        if (demands.length > 0) {
          const g = globalCache();
          if (!g.procurementDemands || g.procurementDemands.tick !== ctx.tick) {
            g.procurementDemands = { tick: ctx.tick, byRoom: {} };
          }
          g.procurementDemands.byRoom[snapshot.roomName] = demands as ProcurementDemand[];
        }
      }

      // ── 2.6 发布盈余化合物卖出信号（阶段 4 改造）──
      // lab 产出的 boost 化合物在库存超过 boostStockpile 后可卖出变现。
      // 旧实现只卖 homeMineral 和 battery — T3 化合物（XGH2O/XUH2O 等）永远囤着不卖，
      // 库存膨胀后 lab output 无处回收 → 反应链停摆。此处让盈余信号从生产方传到卖出方。
      {
        const g = globalCache();
        if (!g.surplusCompounds || g.surplusCompounds.tick !== ctx.tick) {
          g.surplusCompounds = { tick: ctx.tick, items: {} };
        }
        // 检查所有 boost 化合物库存是否超过 boostStockpile。
        for (const [res, qty] of Object.entries(inventory)) {
          if (res === RESOURCE_ENERGY) continue;
          // 只对 boost 化合物（T1-T3 tier）发卖出信号 — 不卖基础矿（走 homeMineral 通道）。
          const boostEffect = BOOST_EFFECTS[res as Compound];
          if (!boostEffect) continue;
          const surplus = qty - CONFIG.war.boostStockpile;
          if (surplus > 0) {
            g.surplusCompounds.items[res] = (g.surplusCompounds.items[res] ?? 0) + surplus;
          }
        }
      }

      // 无可执行反应且无 boost 需求 → 进入休眠，等原料库存变化后再评估。
      // 500 tick ≈ 一个 tuning 评估窗口，对 boost 时效的影响可忽略；
      // war 前馈房用短休眠（WAR_IDLE_TICKS）— 缺矿时 market 买入（tryBuyDeficit）
      // 补给后能更快恢复预产，战时等待即战机。
      if (!reactionStep && boostRequests.length === 0) {
        industryMem.idleUntil = ctx.tick + (warActive ? WAR_IDLE_TICKS : 500);
        continue;
      }

      // ── 3. Lab 分配 ──
      const labPlan = planLabs(snapshot, boostRequests, reactionStep);

      // ── 3.2 发布搬运需求表 ──
      // lab 角色分配只有本系统知道 — 不发布需求表，supplyLabs 只能盲搬，
      // 化合物永远进不了正确的 lab（工业链断路的第二层根因）。
      // 系统先于角色运行，同 tick 数据可达。
      const demandTable = computeLabDemands(labPlan);
      {
        const g = globalCache();
        if (!g.labDemands || g.labDemands.tick !== ctx.tick) {
          g.labDemands = { tick: ctx.tick, byRoom: {} };
        }
        g.labDemands.byRoom[snapshot.roomName] = demandTable;
      }

      // ── 3.5 发布 boost 报到分配 ──
      // 把「creep → boost lab」写入 globalCache，供 role-runner 引导新生 creep
      // 走到 lab 旁（boostCreep 要求相邻）。系统先于角色运行，同 tick 数据可达。
      // ready = lab 内化合物与能量均已备足（boostCreep 每部件 30 矿物 + 20 能量，
      // 缺任一项都会 ERR_NOT_ENOUGH_RESOURCES）：未备足时不引导报到
      //（creep 先正常干活，supplyLabs 搬运到位后的评估周期再来），防止在 lab 旁空等。
      for (const assignment of labPlan.assignments) {
        if (assignment.role !== "boost" || !assignment.boostTarget) continue;
        const g = globalCache();
        if (!g.boostAssignments || g.boostAssignments.tick !== ctx.tick) {
          g.boostAssignments = { tick: ctx.tick, byCreep: {} };
        }
        const boostLab = Game.getObjectById(assignment.labId as Id<StructureLab>);
        const stocked = assignment.boostCompound !== undefined &&
          ((boostLab?.store[assignment.boostCompound as ResourceConstant] ?? 0) >= LAB_BOOST_MINERAL) &&
          ((boostLab?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) >= LAB_BOOST_ENERGY);
        g.boostAssignments.byCreep[assignment.boostTarget] = {
          labId: assignment.labId,
          ready: stocked,
        };
      }

      // ── 4. 执行 boost ──
      for (const assignment of labPlan.assignments) {
        if (assignment.role !== "boost" || !assignment.boostTarget || !assignment.boostCompound) continue;

        const lab = Game.getObjectById(assignment.labId as Id<StructureLab>);
        const creep = Game.creeps[assignment.boostTarget];
        if (!lab || !creep) continue;

        // 部件数按三重约束封顶：矿物存量 / 能量存量 / creep 实际可强化的部件数。
        // 不封顶直接 boostCreep 会尝试强化全部匹配部件 — 备料只够 5 个部件时
        // 必然 ERR_NOT_ENOUGH_RESOURCES，boost 永不成功。
        const compound = assignment.boostCompound as ResourceConstant;
        const effect = BOOST_EFFECTS[assignment.boostCompound];
        const partType = effect ? BOOST_EFFECT_PART[effect] : undefined;
        if (!partType) continue;
        const matchedParts = creep.body.filter(p => p.type === partType && !p.boost).length;
        const byMineral = Math.floor((lab.store[compound] ?? 0) / LAB_BOOST_MINERAL);
        const byEnergy = Math.floor(lab.store.getUsedCapacity(RESOURCE_ENERGY) / LAB_BOOST_ENERGY);
        const parts = Math.min(matchedParts, byMineral, byEnergy);
        if (parts <= 0) {
          // 备料未到位 — supplyLabs 依据需求表补给后，下一评估周期执行。
          continue;
        }

        const result = lab.boostCreep(creep, parts);
        if (result === OK) {
          if (!industryMem.boostedCreeps) industryMem.boostedCreeps = [];
          industryMem.boostedCreeps.push(creep.name);
        }
      }

      // ── 5. 执行反应 ──
      if (labPlan.reaction) {
        const input1Assignment = labPlan.assignments.find(a => a.role === "input1");
        const input2Assignment = labPlan.assignments.find(a => a.role === "input2");

        if (input1Assignment && input2Assignment) {
          const input1Lab = Game.getObjectById(input1Assignment.labId as Id<StructureLab>);
          const input2Lab = Game.getObjectById(input2Assignment.labId as Id<StructureLab>);

          if (input1Lab && input2Lab) {
            // 确保 input labs 中有正确的原料
            const input1Amount = input1Lab.store[labPlan.reaction.input1 as ResourceConstant] ?? 0;
            const input2Amount = input2Lab.store[labPlan.reaction.input2 as ResourceConstant] ?? 0;

            if (input1Amount >= LAB_REACTION_AMOUNT && input2Amount >= LAB_REACTION_AMOUNT) {
              // 找一个 output lab 来执行反应
              const outputAssignment = labPlan.assignments.find(a => a.role === "output");
              if (outputAssignment) {
                const outputLab = Game.getObjectById(outputAssignment.labId as Id<StructureLab>);
                if (outputLab) {
                  outputLab.runReaction(input1Lab, input2Lab);
                }
              }
            }
          }
        }
      }
    }
  },
};
