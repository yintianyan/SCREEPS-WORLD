import { kernel } from "./bootstrap";
import { runWithFatalGuard } from "./kernel/safe-run";

export const loop = (): void => {
  runWithFatalGuard(() => kernel.run());
};
