/**
 * 角色注册与 CONFIG.roles 一致性测试。
 *
 * CONFIG.roles 兼任两个职责：角色数量边界（getRoleBounds）与
 * recyclePass 的「在役角色」白名单（KNOWN_ROLES）。bootstrap 注册了
 * 角色但 roles 表漏配时，该角色孵出即被判「废弃角色」标记回收 —
 * 需求侧看到缺员再孵，形成「孵化 → 回收 → 再孵化」的烧能循环
 * （线上实测：remoteDefender 漏配，远矿威胁期每轮白烧 520 能量，
 * 且威胁永远无人处理）。本测试把这条隐式契约固化为显式断言。
 */
import { describe, expect, it } from "vitest";
import { CONFIG } from "../../../src/config";
import { registry } from "../../../src/bootstrap";

describe("bootstrap 注册角色与 CONFIG.roles 的一致性", () => {
  it("注册的每个角色名都必须在 CONFIG.roles 中（防孵出即回收）", () => {
    const configRoles = new Set(Object.keys(CONFIG.roles));
    for (const role of registry.getRoles()) {
      expect(
        configRoles.has(role.name),
        `角色 "${role.name}" 已在 bootstrap 注册但缺席 CONFIG.roles — ` +
          `它孵出后会被 recyclePass 当废弃角色立即回收`,
      ).toBe(true);
    }
  });

  it("CONFIG.roles 中的每个角色都有对应的注册实现（防幽灵配置）", () => {
    const registered = new Set(registry.getRoles().map(r => r.name));
    for (const name of Object.keys(CONFIG.roles)) {
      expect(
        registered.has(name),
        `CONFIG.roles 中的 "${name}" 没有对应的角色注册 — ` +
          `demand 可能为一个不存在的角色生成孵化请求`,
      ).toBe(true);
    }
  });
});
