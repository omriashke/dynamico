import { useSyncExternalStore } from "react";
import type { RegistryModuleSubscription } from "@omriashke/dynamico-core";

/** React hook that re-renders when a registry data module (e.g. Colors) is pushed. */
export function createUseRegistryModule<T extends Record<string, unknown>>(
  subscription: RegistryModuleSubscription<T>,
): () => T {
  return function useRegistryModule() {
    return useSyncExternalStore(
      subscription.subscribe,
      subscription.getSnapshot,
      subscription.getSnapshot,
    );
  };
}
