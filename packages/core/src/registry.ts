import type {
  ComponentFactory,
  DynamicError,
  RegistryEntry,
  RegistryListener,
  Scope,
  Source,
  Version,
} from "./types.js";
import { loadModule } from "./loader.js";
import { collectRelativeComponentDeps } from "./relativeRequires.js";

/**
 * In-memory, versioned registry of dynamic components.
 *
 * The registry is the single source of truth that runtime packages
 * (@omriashke/dynamico-web, @omriashke/dynamico-native) subscribe to. It receives compiled
 * modules from a Source, evaluates them via the loader using a host-provided
 * Scope, and notifies subscribers when a component's version changes.
 */
export class Registry {
  private entries = new Map<string, RegistryEntry>();
  private listeners = new Map<string, Set<RegistryListener>>();
  private anyListeners = new Set<RegistryListener>();
  private inflight = new Map<string, Promise<RegistryEntry>>();
  /** WS push cache — modules are ingested only when ensure() or a subscriber asks. */
  private moduleCache = new Map<string, import("./types.js").CompiledModule>();
  private watchReleases = new Map<string, () => void>();

  constructor(
    private readonly source: Source,
    private scope: Scope,
  ) {
    this.source.subscribe(({ module }) => {
      if (module.removed) {
        this.moduleCache.delete(module.name);
        if (this.entries.has(module.name) || (this.listeners.get(module.name)?.size ?? 0) > 0) {
          void this.ingestAsync(module.name, module);
        }
        return;
      }
      this.moduleCache.set(module.name, module);
      if (this.shouldIngestOnPush(module.name)) {
        void this.ingestAsync(module.name, module);
      }
    });
  }

  /** Re-ingest a WS push when the component is already loaded or has active subscribers. */
  private shouldIngestOnPush(name: string): boolean {
    return (
      this.entries.has(name) ||
      (this.listeners.get(name)?.size ?? 0) > 0 ||
      this.inflight.has(name)
    );
  }

  /** Replace or extend the current scope (rare; typically set once). */
  setScope(scope: Scope): void {
    this.scope = scope;
  }

  /**
   * Return the merged host scope. Dynamic components reach the same values
   * via `require(name)`, but `getScope()` lets host code (or `useScope()`
   * inside a dynamic component) introspect what's available.
   */
  getScope(): Scope {
    return this.scope;
  }

  /** Get the current entry for a name, if any. */
  peek(name: string): RegistryEntry | undefined {
    return this.entries.get(name);
  }

  /**
   * Ensure a component is loaded. Triggers an initial fetch if we don't yet
   * have an entry for this name. Returns the latest known entry.
   */
  async ensure(name: string): Promise<RegistryEntry> {
    const existing = this.entries.get(name);
    if (existing) return existing;
    const pending = this.inflight.get(name);
    if (pending) return pending;
    const cached = this.moduleCache.get(name);
    const p = (cached ? Promise.resolve(cached) : this.source.fetch(name))
      .then((module) => this.ingestAsync(name, module))
      .finally(() => {
        this.inflight.delete(name);
      });
    this.inflight.set(name, p);
    return p;
  }

  /** Subscribe to changes for a specific component. */
  subscribe(name: string, listener: RegistryListener): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    const wasEmpty = set.size === 0;
    set.add(listener);
    if (wasEmpty && this.source.watch) {
      this.watchReleases.set(name, this.source.watch(name));
    }
    const cached = this.moduleCache.get(name);
    if (cached && !this.entries.has(name) && !this.inflight.has(name)) {
      void this.ingestAsync(name, cached);
    }
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(name);
        const release = this.watchReleases.get(name);
        release?.();
        this.watchReleases.delete(name);
      }
    };
  }

  /** Subscribe to all changes (used internally / for debugging). */
  subscribeAll(listener: RegistryListener): () => void {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  /**
   * Resolve a relative-path require from inside a dynamic component.
   * Cross-component imports look up other components by name in the registry.
   * v1: we map "./Other" -> "Other" (basename, no extension).
   *
   * Returns a lazy proxy module. When the dependency is loaded, non-component
   * exports (e.g. `Colors`) and hooks resolve to their real values so module-
   * level reads like `Colors.primary` work. Components not yet loaded still
   * get lazy wrappers that re-resolve on each render for hot-swap.
   */
  requireByPath(specifier: string): unknown {
    const base = specifier
      .replace(/^\.+\//, "")
      .replace(/\.[tj]sx?$/, "")
      .split("/")
      .pop();
    if (!base) {
      throw new Error(`dynamico: cannot resolve relative require '${specifier}'`);
    }
    if (!this.entries.has(base) && !this.inflight.has(base)) {
      void this.ensure(base);
    }
    return this.makeLazyProxy(base);
  }

  private lazyProxies = new Map<string, Record<string, unknown>>();

  private resolveExport(name: string, key: string): unknown | undefined {
    const entry = this.entries.get(name);
    if (!entry?.factory || entry.error) return undefined;
    if (!Object.prototype.hasOwnProperty.call(entry.factory, key)) return undefined;
    return entry.factory[key];
  }

  private makeLazyProxy(name: string): Record<string, unknown> {
    const cached = this.lazyProxies.get(name);
    if (cached) return cached;
    const registry = this;
    const proxy: Record<string, unknown> = {};
    const make = (key: string) => {
      const Comp = function LazyDynamic(props: Record<string, unknown>) {
        const entry = registry.entries.get(name);
        if (!entry || (!entry.factory && !entry.error)) return null;
        if (entry.error) return null;
        const target = entry.factory?.[key];
        if (typeof target !== "function") return null;
        return (target as (p: Record<string, unknown>) => unknown)(props);
      };
      Object.defineProperty(Comp, "name", { value: `Lazy(${name}.${key})` });
      return Comp;
    };
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(target, prop) {
        if (typeof prop !== "string") return undefined;
        const resolved = registry.resolveExport(name, prop);
        if (resolved !== undefined) return resolved;
        if (prop in target) return target[prop];
        const c = make(prop);
        target[prop] = c;
        return c;
      },
    };
    const wrapped = new Proxy(proxy, handler);
    this.lazyProxies.set(name, wrapped);
    return wrapped;
  }

  /**
   * Take a CompiledModule from the source, evaluate it (or record a compile
   * error), update the entry, and notify listeners.
   */
  private async ingestAsync(
    name: string,
    module: import("./types.js").CompiledModule,
  ): Promise<RegistryEntry> {
    if (module.removed) {
      this.entries.delete(name);
      this.lazyProxies.delete(name);
      const removalEntry: RegistryEntry = {
        name,
        version: module.version,
        error: {
          kind: "load",
          name,
          version: module.version,
          message: `'${name}' was removed from the registry`,
        },
      };
      this.notify(name, removalEntry);
      return removalEntry;
    }
    let entry: RegistryEntry;
    if (module.error) {
      entry = {
        name,
        version: module.version,
        error: {
          kind: module.error.kind === "typecheck" ? "load" : "compile",
          name,
          version: module.version,
          message: module.error.message,
          stack: module.error.stack,
        },
      };
    } else {
      try {
        const deps = collectRelativeComponentDeps(module.code, name);
        await Promise.all(deps.map((dep) => this.ensure(dep)));
        this.lazyProxies.delete(name);
        const factory = loadModule(module.code, this.scope, (rel) =>
          this.requireByPath(rel),
        ) as ComponentFactory;
        entry = { name, version: module.version, factory };
      } catch (err) {
        entry = {
          name,
          version: module.version,
          error: toLoadError(name, module.version, err),
        };
      }
    }
    this.entries.set(name, entry);
    this.notify(name, entry);
    return entry;
  }

  private notify(name: string, entry: RegistryEntry): void {
    const set = this.listeners.get(name);
    if (set) for (const l of set) l(entry);
    for (const l of this.anyListeners) l(entry);

    // A new/updated component may be a dependency of others that are already
    // mounted via lazy proxies. For v1 we don't track an explicit dep graph;
    // instead we notify every other subscribed name with a *fresh entry
    // object* (same content, new identity) so that useSyncExternalStore
    // picks up the change and React re-renders, which causes the lazy
    // proxy's render path to re-resolve the now-loaded dependency.
    for (const [otherName, listeners] of this.listeners) {
      if (otherName === name) continue;
      const other = this.entries.get(otherName);
      if (!other) continue;
      const refreshed: RegistryEntry = { ...other };
      this.entries.set(otherName, refreshed);
      for (const l of listeners) l(refreshed);
    }
  }
}

function toLoadError(name: string, version: Version, err: unknown): DynamicError {
  const e = err instanceof Error ? err : new Error(String(err));
  return { kind: "load", name, version, message: e.message, stack: e.stack };
}
