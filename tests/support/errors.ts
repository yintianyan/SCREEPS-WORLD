/**
 * JS 致命错误判定唯一实现（FREEZE R20① / T3）。
 * 归并 e2e 层 26 处重复：helpers/assertions.ts 1 份 + 16 个场景本地
 * `function isJsError` + 9 处内联 includes 匹配。模式取两派已知变体的并集；
 * 模式扩展必须走本文件，禁止场景内再写 includes("TypeError") 一类判定。
 */
export const JS_ERROR_PATTERNS = [
  "TypeError",
  "ReferenceError",
  "is not a function",
  "Cannot read properties of undefined",
  "undefined is not",
  "Cannot read",
] as const;

/** 判断单条日志行是否为 JS 致命错误。 */
export function isJsError(line: string): boolean {
  return JS_ERROR_PATTERNS.some((p) => line.includes(p));
}

/** 过滤日志行集合中的 JS 致命错误行。 */
export function jsErrorLines(lines: string[]): string[] {
  return lines.filter(isJsError);
}

/** 日志行集合中是否出现 JS 致命错误。 */
export function hasJsError(lines: string[]): boolean {
  return lines.some(isJsError);
}
