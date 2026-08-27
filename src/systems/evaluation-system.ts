/**
 * Evaluation System — T3: AI Evaluation 闭环系统。
 *
 * 低频运行（每 100 tick），消费 EvaluationRegistry 中的 pending expectations：
 * - 检测超时 pending → 标记 expired
 * - 计算各域偏差汇总
 * - 产出 Strategy Feedback 写入 globalCache
 * - 记录 Evaluation Metrics
 *
 * 安全不变式：本系统完全失败时，帝国照常安全运行。
 * CPU 预算：< 0.05% CPU（轻量扫描 ring buffer + 算术运算）。
 * 频率：每 100 tick（与 EVAL_INTERVAL 对齐）。
 * 降级：Recovery/Conserve tier 跳过。
 * Memory 增长：零（不写入 Memory）。
 * global reset 后：从空重建（pending 丢失可接受 — 未完成的期望只用于偏差追踪）。
 */

import type { Priority, System, TickContext } from "../kernel/contracts";
import { safeRun } from "../kernel/safe-run";
import { systemPhase } from "../kernel/phase";
import {
    evaluatePending,
    shouldEvaluate,
    pendingCount,
    recentResolved,
} from "../telemetry";
import {
    recordExpectationDeclared,
    recordExpectationFulfilled,
    recordExpectationMissed,
    recordExpectationExpired,
    recordPendingCount,
} from "../telemetry";

const EVAL_SYSTEM_INTERVAL = 100;

export const evaluationSystem: System = {
    name: "evaluation-system",
    priority: 3 as Priority,
    interval: EVAL_SYSTEM_INTERVAL,
    phase: "post",

    run(ctx: TickContext): void {
        const tick = ctx.tick;

        // 频率守卫
        if (!shouldEvaluate(tick)) return;

        safeRun("evaluation-system/run", () => {
            // 1. 评估所有 pending → 计算 deviation → 产出 Strategy Feedback
            const feedback = evaluatePending(tick);

            // 2. 记录 Evaluation Metrics
            for (const [domain, entry] of Object.entries(feedback.byDomain)) {
                recordPendingCount(domain, entry.sampleCount);
            }

            // 3. 按 resolved 状态记录指标
            const recent = recentResolved(50);
            for (const r of recent) {
                if (r.resolvedAtTick < tick - EVAL_SYSTEM_INTERVAL) continue; // 只记录本窗口
                switch (r.status) {
                    case "fulfilled":
                        recordExpectationFulfilled(r.domain, r.aggregateDeviation);
                        break;
                    case "missed":
                        recordExpectationMissed(r.domain, r.aggregateDeviation);
                        break;
                    case "expired":
                        recordExpectationExpired(r.domain);
                        break;
                }
            }

            // 4. 记录当前 pending 总量
            const pending = pendingCount();
            if (pending > 0) {
                recordPendingCount("all", pending);
            }
        });
    },
};
