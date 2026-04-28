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
 * (@dynamico/web, @dynamico/native) subscribe to. It receives compiled
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
    const entry = this.entries.get(base);
    if (!entry || !entry.factory) {
      throw new Error(
        `dynamico: cannot require './${base}' — component not loaded yet. ` +
          `Render it via <DynamicComponent name="${base}"/> first, or preload via useDynamico.`,
      );
    }
    return entry.factory;
  }

  /**
   * Take a CompiledModule from the source, evaluate it (or record a compile
   * error), update the entry, and notify listeners.
   */
  private ingest(name: string, module: import("./types.js").CompiledModule): RegistryEntry {
    let entry: RegistryEntry;
    if (module.error) {
      entry = {
        name,
        version: module.version,
        error: {
          kind: "compile",
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
  }
}

function toLoadError(name: string, version: Version, err: unknown): DynamicError {
  const e = err instanceof Error ? err : new Error(String(err));
  return { kind: "load", name, version, message: e.message, stack: e.stack };
}
