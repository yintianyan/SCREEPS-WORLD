/** 统一 Logger 门面 —— 业务/内核代码禁止直接 console.log（plan §7）。 */

import { CONFIG } from "../config";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

type Sink = (line: string, level: LogLevel) => void;
let sinkOverride: Sink | undefined;

function currentLevel(): LogLevel {
  const lv = (CONFIG.kernel as { logLevel?: LogLevel }).logLevel ?? "info";
  return lv;
}

function out(level: LogLevel, module: string, msg: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;
  const line = "[t" + Game.time + "][" + level.toUpperCase() + "][" + module + "] " + msg;
  const sink = sinkOverride ?? ((l) => console.log(l));
  sink(line, level);
}

/** 输出重定向（测试注入）。传 undefined 恢复 console。 */
export function setLogSink(sink: Sink | undefined): void {
  sinkOverride = sink;
}

export const log = {
  debug(module: string, msg: string): void {
    out("debug", module, msg);
  },
  info(module: string, msg: string): void {
    out("info", module, msg);
  },
  warn(module: string, msg: string): void {
    out("warn", module, msg);
  },
  error(module: string, msg: string): void {
    out("error", module, msg);
  },
};
