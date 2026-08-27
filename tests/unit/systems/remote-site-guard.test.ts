/** P0-A 静态守卫 — remote-harvester 禁止调 createConstructionSite。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("P0-A 静态守卫 — remote-harvester 禁止调 createConstructionSite", () => {
  it("src/creeps/roles/remote-harvester.ts 非注释代码不含 createConstructionSite 调用", () => {
    const sourcePath = join(process.cwd(), "src", "creeps", "roles", "remote-harvester.ts");
    const source = readFileSync(sourcePath, "utf-8");

    // 排除注释行（// 开头、* 开头的 JSDoc、块注释内的行）。
    const codeLines = source.split("\n").filter(l => {
      const trimmed = l.trim();
      return trimmed !== "" &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*");
    });
    const code = codeLines.join("\n");

    expect(
      code.includes(".createConstructionSite("),
      "remote-harvester.ts 不应直接调 room.createConstructionSite — " +
        "site 创建权已收编到 remote-mining-manager.fulfillContainerRequests（P0-A）。" +
        "角色层只写 needContainer 申请标记。",
    ).toBe(false);
  });
});
