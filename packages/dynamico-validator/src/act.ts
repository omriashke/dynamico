import { act as reactAct } from "react";

/**
 * React omits `act` from production builds. react-test-renderer does too.
 * For push-gate smoke tests a minimal batching shim is enough.
 */
function fallbackAct<T>(callback: () => T): T {
  return callback();
}

export const act: typeof reactAct =
  typeof reactAct === "function" ? reactAct : (fallbackAct as typeof reactAct);
