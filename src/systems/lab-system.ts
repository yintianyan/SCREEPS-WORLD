/**
 * Lab System — P1 系统，每 tick 执行 lab 反应和 boost。
 *
 * 职责：
 *   1. 收集 lab/terminal/storage 中的化合物库存
 *   2. 规划反应链（从 RoomMemory 中的目标产物反向推导）
 *   3. 分配 lab 角色（input1/input2/output/boost）
 *   4. 执行反应（lab.runReaction）
 *   5. 执行 boost（lab.boostCreep）
 *
 * 设计约束：
 *   - RCL6+ 才有 lab（3 个），RCL7 有 6 个，RCL8 有 10 个
 *   - 每 tick 每对 lab 只能执行一次反应（cooldown）
 *   - boost 优先于反应（boost 是即时战力提升）
 *   - 反应链状态持久化在 RoomMemory.industry 中
 */
import type { RoomSnapshot, System, TickContext } from "../kernel/contracts";
import type { Compound, LabAssignment, LabPlan, ReactionPlan } from "../domain/industry/types";
import { evaluateBoostRequests, DEFAULT_BOOST_POLICY } from "../domain/industry/boost";
import { getNextExecutableStep, planReactionChain, selectReactionTrio, LAB_REACTION_AMOUNT } from "../domain/industry/reactions";

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
}

function getIndustryMemory(roomName: string): IndustryMemory {
  const mem = Memory.rooms[roomName] as Record<string, unknown> | undefined;
  if (!mem) return {};
  if (!mem.industry) mem.industry = {};
  return mem.industry as IndustryMemory;
}

// ─── 库存收集 ───────────────────────────────────────────────

/** 收集房间中所有化合物库存（storage + terminal + labs）。 */
function collectCompoundInventory(snapshot: RoomSnapshot): Record<string, number> {
  const inventory: Record<string, number> = {};

  // Storage
  if (snapshot.storage) {
    const store = snapshot.storage.store;
    for (const resource of Object.keys(store) as ResourceConstant[]) {
      if (resource === RESOURCE_ENERGY) continue;
      inventory[resource] = (inventory[resource] ?? 0) + store[resource]!;
    }
  }

  // Terminal
  if (snapshot.terminal) {
    const store = snapshot.terminal.store;
    for (const resource of Object.keys(store) as ResourceConstant[]) {
      if (resource === RESOURCE_ENERGY) continue;
      inventory[resource] = (inventory[resource] ?? 0) + store[resource]!;
    }
  }

  // Labs（正在反应中的也算库存）
  for (const lab of snapshot.labs) {
    const store = lab.store;
    for (const resource of Object.keys(store) as ResourceConstant[]) {
      if (resource === RESOURCE_ENERGY) continue;
      inventory[resource] = (inventory[resource] ?? 0) + store[resource]!;
    }
  }

  return inventory;
}

// ─── Lab 分配 ───────────────────────────────────────────────

/**
 * 规划 lab 分配：优先 boost，剩余做反应。
 *
 * 策略：
 *   - 1 个 lab 专门 boost（如果有 boost 请求）
 *   - 剩余 lab 中取 3 个做反应（2 input + 1 output）
 *   - 其余 idle
 */
function planLabs(
  snapshot: RoomSnapshot,
  boostRequests: readonly { creepName: string; compound: Compound }[],
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
      const inventory = collectCompoundInventory(snapshot);

      // P2-9：清理已死亡 creep 的名字，防止 boostedCreeps 无限累积。
      // 复用 Game.creeps 判断存活，去重后仅保留仍在世的名字（无需 schema 迁移）。
      if (industryMem.boostedCreeps && industryMem.boostedCreeps.length > 0) {
        industryMem.boostedCreeps = industryMem.boostedCreeps.filter(
          name => Game.creeps[name] !== undefined,
        );
      }

      // ── 1. Boost 决策 ──
      const creepSummaries = Object.values(Game.creeps)
        .filter(c => c.memory.home === snapshot.roomName)
        .map(c => ({
          name: c.name,
          role: c.memory.role ?? "unknown",
          ticksToLive: c.ticksToLive ?? 0,
          boosted: (industryMem.boostedCreeps ?? []).includes(c.name),
        }));

      const boostRequests = evaluateBoostRequests(
        creepSummaries,
        snapshot.rcl,
        inventory,
        DEFAULT_BOOST_POLICY,
      );

      // ── 2. 反应规划（含自动目标选择） ──
      // 如果没有手动设定反应目标，根据 boost 需求自动决定。
      if (!industryMem.reactionTarget) {
        if (boostRequests.length > 0) {
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

      // ── 3. Lab 分配 ──
      const labPlan = planLabs(snapshot, boostRequests, reactionStep);

      // ── 4. 执行 boost ──
      for (const assignment of labPlan.assignments) {
        if (assignment.role !== "boost" || !assignment.boostTarget || !assignment.boostCompound) continue;

        const lab = Game.getObjectById(assignment.labId as Id<StructureLab>);
        const creep = Game.creeps[assignment.boostTarget];
        if (!lab || !creep) continue;

        // 确保 lab 中有正确的化合物
        const labStore = lab.store;
        const compoundAmount = labStore[assignment.boostCompound as ResourceConstant] ?? 0;
        if (compoundAmount < 30) {
          // hauler 的 supplyLabs action 会自动从 storage 补充化合物到 lab
          continue;
        }

        // 执行 boost
        const result = lab.boostCreep(creep);
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
