import { createElement, useSyncExternalStore, type ComponentType } from "react";
import type { CompiledModule, Scope, Source } from "./types.js";
import { loadModule } from "./loader.js";

export interface PackageScopeOptions {
  /** Registry component names (export name = registry name). */
  components: readonly string[];
  /** Synchronous exports merged into the package (Colors, useTheme, theme tokens, …). */
  values?: Record<string, unknown>;
  /**
   * After a component loads, copy named exports onto the package root.
   * e.g. `{ ThemeProvider: ['useTheme', 'useAppTheme'] }`
   */
  reexports?: Record<string, readonly string[]>;
}

type LazyComponent = (props: Record<string, unknown>) => unknown;

interface ModuleState {
  factory?: Record<string, unknown>;
  loading?: Promise<void>;
  /** Bumped on every ingest so useSyncExternalStore subscribers re-render. */
  revision: number;
  listeners: Set<() => void>;
  watchRelease?: () => void;
}

/**
 * Synthetic npm-like scope module backed by the Dynamico registry.
 *
 * - `values` are available synchronously (data + hooks shared with ThemeProvider).
 * - `components` are lazy React wrappers that load/render registry entries.
 * - Subscribes to the source WebSocket so registry pushes hot-swap live in the host.
 */
export function createPackageScope(
  source: Source,
  getScope: () => Scope,
  options: PackageScopeOptions,
): Record<string, unknown> {
  const { components, values = {}, reexports = {} } = options;
  const componentSet = new Set(components);
  const modules = new Map<string, ModuleState>();
  const pkg: Record<string, unknown> = { ...values, __esModule: true };

  const getState = (name: string): ModuleState => {
    let state = modules.get(name);
    if (!state) {
      state = { revision: 0, listeners: new Set() };
      modules.set(name, state);
    }
    return state;
  };

  const subscribe = (name: string, listener: () => void): (() => void) => {
    const state = getState(name);
    const wasEmpty = state.listeners.size === 0;
    state.listeners.add(listener);
    if (wasEmpty && source.watch) {
      state.watchRelease = source.watch(name);
    }
    return () => {
      state.listeners.delete(listener);
      if (state.listeners.size === 0) {
        state.watchRelease?.();
        state.watchRelease = undefined;
      }
    };
  };

  const getRevision = (name: string): number => getState(name).revision;

  const notify = (name: string): void => {
    const state = modules.get(name);
    if (state) for (const listener of state.listeners) listener();
    // A dependency update may change what an already-mounted parent renders.
    for (const [otherName, other] of modules) {
      if (otherName === name) continue;
      if (other.listeners.size === 0) continue;
      for (const listener of other.listeners) listener();
    }
  };

  let makeLazy: (name: string) => LazyComponent;

  const requireRelative = (specifier: string): unknown => {
    const base = specifier
      .replace(/^\.+\//, "")
      .replace(/\.[tj]sx?$/, "")
      .split("/")
      .pop();
    if (!base) throw new Error(`dynamico: cannot resolve '${specifier}'`);
    ensureLoaded(base);
    const dep = modules.get(base)?.factory;
    return dep ?? { default: makeLazy(base) };
  };

  const ingest = (name: string, module: CompiledModule): void => {
    const state = getState(name);
    if (module.error || !module.code) {
      state.factory = undefined;
      state.revision += 1;
      notify(name);
      return;
    }
    try {
      const factory = loadModule(module.code, getScope(), requireRelative) as Record<
        string,
        unknown
      >;
      state.factory = factory;
      state.revision += 1;
      const extra = reexports[name];
      if (extra) {
        for (const key of extra) {
          const exported = factory[key];
          if (exported !== undefined) pkg[key] = exported;
        }
      }
    } catch {
      state.factory = undefined;
      state.revision += 1;
    }
    notify(name);
  };

  const ensureLoaded = (name: string): void => {
    const state = getState(name);
    if (state.factory !== undefined || state.loading) return;
    state.loading = source
      .fetch(name)
      .then((module) => {
        ingest(name, module);
      })
      .finally(() => {
        state.loading = undefined;
      });
  };

  source.subscribe(({ module }) => {
    if (!componentSet.has(module.name)) return;
    const state = getState(module.name);
    if (state.factory !== undefined || state.listeners.size > 0 || state.loading) {
      ingest(module.name, module);
    }
  });

  makeLazy = (name: string): LazyComponent => {
    const Lazy: LazyComponent = (props) => {
      ensureLoaded(name);
      const revision = useSyncExternalStore(
        (cb) => subscribe(name, cb),
        () => getRevision(name),
        () => getRevision(name),
      );
      void revision;
      const factory = getState(name).factory;
      if (!factory) return null;
      const target = factory.default ?? factory[name];
      if (typeof target !== "function") return null;
      return createElement(target as ComponentType<Record<string, unknown>>, props);
    };
    Object.defineProperty(Lazy, "name", { value: `PackageScope(${name})` });
    return Lazy;
  };

  for (const name of components) {
    pkg[name] = makeLazy(name);
  }
  return pkg;
}

export function createPackageScopeFromNames(
  source: Source,
  getScope: () => Scope,
  componentNames: readonly string[],
  values?: Record<string, unknown>,
): Record<string, unknown> {
  return createPackageScope(source, getScope, { components: componentNames, values });
}
