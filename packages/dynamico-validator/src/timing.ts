import { act } from "./act.js";

/**
 * Yield to React so any pending state updates / useEffect / promises commit
 * before the next assertion. Use after firing events that schedule work.
 */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
