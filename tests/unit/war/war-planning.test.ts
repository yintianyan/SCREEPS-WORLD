/**
 * war/planning — 战争目标选择纯函数测试。
 *
 * 覆盖：
 *   - 合法目标被选中（普通房 + 有主 + 情报新鲜 + 塔数达标 + 未占用）
 *   - 多候选选通勤最近（pathCost；缺失回退线性距离）
 *   - 过滤：SK 房 / 无主房 / 己方房 / 情报过期 / tower ≥ 上限 / 已被占用
 *   - 无合格目标 → undefined
 *   - decideSquadSize 编队规模
 */
import { describe, expect, it } from "vitest";
import { decideSquadSize, selectWarTarget } from "../../../src/domain/war/planning";

const BASE_INPUT = {
  tick: 1000,
  myUsername: "Me",
  freshness: 1500,
  maxTowers: 3,
} as const;

/** 快速构造候选。 */
function candidate(overrides: Partial<{
  roomName: string;
  home: string;
  kind: string;
  owner: string | undefined;
  lastSeen: number;
  towers: number | undefined;
  pathCost: number | undefined;
  occupied: boolean;
}> = {}): any {
  return {
    roomName: "W6N4",
    home: "W7N4",
    kind: "normal",
    owner: "Enemy",
    lastSeen: 900,
    towers: 0,
    pathCost: 400,
    occupied: false,
    ...overrides,
  };
}

describe("selectWarTarget", () => {
  it("合法目标被选中，sponsor = 情报归属的 home", () => {
    const target = selectWarTarget({ ...BASE_INPUT, candidates: [candidate()] });
    expect(target).toEqual({ roomName: "W6N4", sponsor: "W7N4", towersSeen: 0, distance: 400 });
  });

  it("多候选选通勤成本最低者", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ roomName: "W6N5", home: "W7N4", pathCost: 800 }),
        candidate({ roomName: "W6N4", home: "W7N4", pathCost: 400 }),
        candidate({ roomName: "W5N5", home: "W7N4", pathCost: 600 }),
      ],
    });
    expect(target?.roomName).toBe("W6N4");
  });

  it("pathCost 缺失回退线性距离", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ roomName: "W8N8", pathCost: undefined }), // 距 W7N4 较远
        candidate({ roomName: "W6N4", pathCost: undefined }), // 距 W7N4 最近
      ],
    });
    // 线性距离更近的 W6N4 应胜出。
    expect(target?.roomName).toBe("W6N4");
  });

  it("过滤 SK / center / highway 房", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ roomName: "W5N5", kind: "sk" }), // 双 5 → sk
        candidate({ roomName: "W6N4", kind: "center" }),
      ],
    });
    expect(target).toBeUndefined();
  });

  it("过滤无主房（owner undefined）", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [candidate({ owner: undefined })],
    });
    expect(target).toBeUndefined();
  });

  it("过滤己方房（owner === myUsername）", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [candidate({ owner: "Me" })],
    });
    expect(target).toBeUndefined();
  });

  it("过滤情报过期目标（超过 freshness 窗口）", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ lastSeen: 1000 - 1600 }), // 距今 1600 > 1500
        candidate({ roomName: "W6N5", lastSeen: 900 }), // 新鲜
      ],
    });
    expect(target?.roomName).toBe("W6N5");
  });

  it("过滤 tower 数 ≥ 上限的目标", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      maxTowers: 3,
      candidates: [
        candidate({ towers: 1 }),
        candidate({ roomName: "W6N5", towers: 3 }), // 3 ≥ 3 → 不可攻击
        candidate({ roomName: "W5N4", towers: 2 }), // 有塔但允许 → 追加编队
      ],
    });
    expect(target?.roomName).toBe("W6N4"); // towers=1 更近（第一个候选仍是 400 路径）
  });

  it("过滤已被我方占用的房", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ occupied: true }),
        candidate({ roomName: "W6N5", occupied: false }),
      ],
    });
    expect(target?.roomName).toBe("W6N5");
  });

  it("无合格目标 → undefined", () => {
    const target = selectWarTarget({
      ...BASE_INPUT,
      candidates: [
        candidate({ owner: undefined }),
        candidate({ kind: "sk" }),
        candidate({ occupied: true }),
      ],
    });
    expect(target).toBeUndefined();
  });
});

describe("decideSquadSize", () => {
  it("无 tower 基数；有 tower 追加", () => {
    expect(decideSquadSize(0, 3, 2)).toBe(3);
    expect(decideSquadSize(1, 3, 2)).toBe(5);
    expect(decideSquadSize(3, 3, 2)).toBe(5);
  });
});