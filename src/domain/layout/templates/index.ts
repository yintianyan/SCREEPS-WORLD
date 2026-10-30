/** 布局模板注册表（R662）——按房内 `layout.templateId` 取模板。
 *
 * 老房默认 V2（已建结构不被新模板改位），新 claim 由 `seedLayoutAnchor` 显式写 V3。
 * 缺省回退 V2：宁可沿用已验证几何，也不对未知 id 静默换模板。
 */
import type { Blueprint } from "../types";
import { COMPACT_CORE_V2 } from "./compact-core-v2";
import { COMPACT_CORE_V3 } from "./compact-core-v3";

const REGISTRY: Readonly<Record<string, Blueprint>> = {
  "compact-core-v2": COMPACT_CORE_V2,
  "compact-core-v3": COMPACT_CORE_V3,
};

export function getTemplateById(id: string | undefined): Blueprint {
  if (id && REGISTRY[id]) return REGISTRY[id]!;
  return COMPACT_CORE_V2;
}

export { COMPACT_CORE_V2, COMPACT_CORE_V3 };
