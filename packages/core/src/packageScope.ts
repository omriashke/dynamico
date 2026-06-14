import type { Scope, Source } from "./types.js";
import { loadModule } from "./loader.js";

export interface PackageScopeOptions {
  /** Registry component names (export name = registry name). */
  components: readonly string[];
  /** Synchronous exports merged into the package (Colors, useTheme, theme tokens, …). */
  values?: Record<string, unknown>;
}

type LazyComponent = (props: Record<string, unknown>) => unknown;

interface ModuleState {
  factory?: Record<string, unknown>;
  loading?: Promise<void>;
}

/**
 * Synthetic npm-like scope module backed by the Dynamico registry.
 *
 * - `values` are available synchronously (data + hooks shared with ThemeProvider).
 * - `components` are lazy React wrappers that load/render registry entries.
 */
export function createPackageScope(
  source: Source,
  getScope: () => Scope,
  options: PackageScopeOptions,
): Record<string, unknown> {
  const { components, values = {} } = options;
  const modules = new Map<string, ModuleState>();

  const ensureLoaded = (name: string): void => {
    let state = modules.get(name);
    if (!state) {
      state = {};
      modules.set(name, state);
    }
    if (state.factory || state.loading) return;
    state.loading = source.fetch(name).then((mod) => {
      if (mod.error || !mod.code) return;
      try {
        const scope = getScope();
        const factory = loadModule(mod.code, scope, (rel) => {
          const base = rel
            .replace(/^\.+\//, "")
            .replace(/\.[tj]sx?$/, "")
            .split("/")
            .pop();
          if (!base) throw new Error(`dynamico: cannot resolve '${rel}'`);
          ensureLoaded(base);
          const dep = modules.get(base)?.factory;
          return dep ?? { default: makeLazy(base) };
        }) as Record<string, unknown>;
        state.factory = factory;
      } catch {
        state.factory = undefined;
      }
    });
  };

  const makeLazy = (name: string): LazyComponent => {
    ensureLoaded(name);
    const Lazy: LazyComponent = (props) => {
      const factory = modules.get(name)?.factory;
      if (!factory) return null;
      const target = factory.default ?? factory[name];
      if (typeof target !== "function") return null;
      return (target as (p: Record<string, unknown>) => unknown)(props);
    };
    Object.defineProperty(Lazy, "name", { value: `PackageScope(${name})` });
    return Lazy;
  };

  const pkg: Record<string, unknown> = { ...values, __esModule: true };
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
