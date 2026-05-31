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

  constructor(
    private readonly source: Source,
    private scope: Scope,
  ) {
    this.source.subscribe(({ module }) => {
      this.ingest(module.name, module);
    });
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
    const p = this.source
      .fetch(name)
      .then((module) => this.ingest(name, module))
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
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(name);
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
   * The returned value is a *lazy proxy module*: it has the same shape as
   * a real CommonJS module (`{ default, ...rest }`), but every member is a
   * React function component that re-resolves the target on each render.
   * This means:
   *   - Card can `require("./Hello")` at eval time even before Hello has
   *     loaded — the proxy is returned immediately.
   *   - When Hello actually arrives (or hot-swaps to a new version), Card's
   *     next render automatically picks it up; no manual preload needed.
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

  private makeLazyProxy(name: string): Record<string, unknown> {
    const cached = this.lazyProxies.get(name);
    if (cached) return cached;
    const registry = this;
    const proxy: Record<string, unknown> = {};
    const make = (key: string) => {
      const Comp = function LazyDynamic(props: Record<string, unknown>) {
        const entry = registry.entries.get(name);
        // Not loaded yet — render nothing. When the dependency arrives, the
        // cross-dep notification in `notify()` refreshes our parent's entry,
        // which causes useSyncExternalStore to re-render and we'll resolve
        // for real on the next pass.
        if (!entry || (!entry.factory && !entry.error)) return null;
        if (entry.error) {
          // Surface the dep error inline. Parent can wrap in errorFallback at
          // its own level if it wants; we don't have access to it here.
          return null;
        }
        const target = entry.factory?.[key];
        if (typeof target !== "function") return null;
        // The host-scope's React.createElement is what invoked us; we just
        // call the real component function. props is what the parent passed.
        return (target as (p: Record<string, unknown>) => unknown)(props);
      };
      Object.defineProperty(Comp, "name", { value: `Lazy(${name}.${key})` });
      return Comp;
    };
    proxy.default = make("default");
    // Allow named imports via Proxy: any key access returns a fresh lazy
    // component bound to that key. Default is set above; everything else
    // is created on demand.
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(target, prop) {
        if (typeof prop !== "string") return undefined;
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
  private ingest(name: string, module: import("./types.js").CompiledModule): RegistryEntry {
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
