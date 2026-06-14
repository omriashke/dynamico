import type { Scope, Source } from "./types.js";
import { loadModule } from "./loader.js";

export type ColorLike = Record<string, string>;

export interface RegistryModuleSubscription<T extends Record<string, unknown>> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  /** Live view — property reads always use the latest snapshot. */
  proxy: T;
  reload: () => Promise<void>;
}

function resolveModuleData(name: string, factory: Record<string, unknown>): Record<string, unknown> {
  const def = factory.default;
  if (def && typeof def === "object" && !Array.isArray(def)) {
    return def as Record<string, unknown>;
  }
  const named = factory[name];
  if (named && typeof named === "object" && !Array.isArray(named)) {
    return named as Record<string, unknown>;
  }
  return factory;
}

function mergePalette<T extends Record<string, unknown>>(defaults: T, next: Record<string, unknown>): T {
  const out = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "string") out[key] = value;
  }
  return out as T;
}

/**
 * Subscribe to a registry data module (e.g. Colors) and expose a live proxy +
 * snapshot for useSyncExternalStore hooks.
 */
export function createRegistryModuleSubscription<T extends Record<string, unknown>>(
  source: Source,
  getScope: () => Scope,
  name: string,
  defaults: T,
): RegistryModuleSubscription<T> {
  let snapshot = { ...defaults } as T;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const reload = async (): Promise<void> => {
    const mod = await source.fetch(name);
    if (mod.error || !mod.code) return;
    try {
      const factory = loadModule(mod.code, getScope(), (specifier) => {
        const base = specifier
          .replace(/^\.+\//, "")
          .replace(/\.[tj]sx?$/, "")
          .split("/")
          .pop();
        if (!base) throw new Error(`dynamico: cannot resolve '${specifier}'`);
        return {};
      }) as Record<string, unknown>;
      snapshot = mergePalette(defaults, resolveModuleData(name, factory));
      notify();
    } catch {
      /* keep previous snapshot */
    }
  };

  const proxy = new Proxy({} as T, {
    get(_target, key: PropertyKey) {
      if (key === "__esModule") return true;
      if (key === "default") return proxy;
      if (typeof key === "symbol") return undefined;
      return snapshot[key as keyof T] ?? defaults[key as keyof T];
    },
  });

  source.subscribe(({ module }) => {
    if (module.name === name) {
      void reload();
    }
  });

  void reload();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    proxy,
    reload,
  };
}
