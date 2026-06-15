import { act } from "./act.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Yield to React so any pending state updates / useEffect / promises commit
 * before the next assertion. Use after firing events that schedule work.
 */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
