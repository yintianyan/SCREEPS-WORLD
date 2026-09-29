/**
 * updateMode 的 build 租约例外（2026-09-29 第一次自主扩张 W38S56 驱动）。
 *
 * 线上同拍四只 builder 持同一份 `kind:"build"` 租约：只有 e=200/200 的转 work，
 * e=160/200 的仍停在 acquire 去补采 40 能量 ⇒ 两个工地 progress 恒 0、10 只拓荒队
 * 盖不出一座 spawn。根因是 `free === 0` 这个**唯一**换向条件对"手里有货、唯一消费者
 * 就是工地"的情形不成立。
 *
 * 第二、三条用例钉住**作用域**：这条例外只在 build 租约上成立。`装满才送` 是物流侧
 * 故意的批量策略，放宽成通用规则会让全帝国运输变半载往返。
 */
import { describe, expect, it } from "vitest";
import { updateMode } from "../../../src/creeps/engine/lifecycle";

function mock(used: number, cap: number, mode: string, assignment?: { kind: string }): any {
  return {
    memory: { mode, assignment },
    store: {
      getUsedCapacity: () => used,
      getFreeCapacity: () => cap - used,
    },
  };
}

describe("updateMode 的 build 租约例外", () => {
  it("有 build 租约 + 半载 ⇒ 转 work（带着能量就去卸，不再补采）", () => {
    const c = mock(160, 200, "acquire", { kind: "build" });
    updateMode(c);
    expect(c.memory.mode).toBe("work");
  });

  it("对照：hauler 半载**不**转 work —— 装满才送是物流的批量策略，不得被放宽成通用规则", () => {
    const c = mock(160, 200, "acquire", { kind: "haul" });
    updateMode(c);
    expect(c.memory.mode).toBe("acquire");
  });

  it("对照：无 assignment 的半载采集者不转 work", () => {
    const c = mock(160, 200, "acquire", undefined);
    updateMode(c);
    expect(c.memory.mode).toBe("acquire");
  });

  it("空载的 build 租约不转 work（没货可卸，仍该去采）", () => {
    const c = mock(0, 200, "acquire", { kind: "build" });
    updateMode(c);
    expect(c.memory.mode).toBe("acquire");
  });
});
