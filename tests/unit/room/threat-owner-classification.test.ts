/**
 * #152：把威胁按行凶者身份分类（NPC / 玩家）。
 *
 * 立案理由（线上读数，本会话）：把 posture 钉在 `war` 的是**房级** `rooms.<r>.lastHostileAt`，
 * 而按人域（段 5）的 `lastHostileAt` 对 NPC 恒为 0 —— `intelligence.ts:83-91` 显式排除
 * `INVADER_USERNAME`。实测到 30 天尺度：`players=3`（其中一条是我们自己）、三条
 * `lastHostileAt` **全为 0**，第三方记录旧 840,753 / 213,257 拍，而进犯约每 3,000 拍一次。
 * ⇒ 恒战的成因是"NPC 骚扰与玩家宣战在同一把尺上同价"，而 #151 要谈"按来源降尾税"必须先有输入。
 *
 * 本文件只测分类本身：**这两把尺当前零消费者**，不参与任何决策，所以这些用例不背书行为变化。
 */
import { describe, expect, it } from "vitest";
import { classifyThreatOwners } from "../../../src/systems/room/room-state";
import { INVADER_USERNAME } from "../../../src/domain/intel";

const by = (username: string | undefined): { owner?: { username?: string } } =>
  username === undefined ? {} : { owner: { username } };

describe("#152 classifyThreatOwners", () => {
  it("全是 NPC ⇒ 只算 invader 一类，player 为假（这就是三十天里的真实形状）", () => {
    expect(classifyThreatOwners([by(INVADER_USERNAME), by(INVADER_USERNAME)])).toEqual({
      invader: true,
      player: false,
    });
  });

  it("有玩家 ⇒ player 为真；两类同时在场时两把尺都该盖章", () => {
    expect(classifyThreatOwners([by(INVADER_USERNAME), by("Aguia")])).toEqual({
      invader: true,
      player: true,
    });
    expect(classifyThreatOwners([by("Aguia")])).toEqual({ invader: false, player: true });
  });

  it("控制组：读不到 owner（对象已消失）不算任何一类 ⇒ 不把'看不见'记成'没发生'", () => {
    expect(classifyThreatOwners([by(undefined), {} as never])).toEqual({
      invader: false,
      player: false,
    });
    expect(classifyThreatOwners([])).toEqual({ invader: false, player: false });
  });

  it("空用户名（''）既不是 NPC 也不是玩家 —— 走'看不见'那一支", () => {
    expect(classifyThreatOwners([by("")])).toEqual({ invader: false, player: false });
  });
});
