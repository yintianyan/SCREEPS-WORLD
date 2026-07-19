import { CONFIG } from "../config";

/** Keep one faulty extension from consuming the entire tick. */
export function safeRun(label: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    if (CONFIG.kernel.logErrors) console.log(`[${Game.time}] ${label}: ${formatError(error)}`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
